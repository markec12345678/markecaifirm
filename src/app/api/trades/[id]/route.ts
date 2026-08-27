import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { serializeTags } from '../route';
import { evaluateSuggestionOutcome } from '@/lib/copilot/outcome-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const trade = await db.trade.findUnique({
      where: { id },
      include: { listing: { select: { id: true, title: true, url: true, imageUrl: true } } },
    });
    if (!trade) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });
    return NextResponse.json(trade);

  } catch (err) {
    logger.error("/api/trades/[id]", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: any = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.category === 'string') data.category = body.category;
    if (typeof body.imageUrl === 'string' || body.imageUrl === null) data.imageUrl = body.imageUrl;
    if (typeof body.url === 'string' || body.url === null) data.url = body.url;
    if (typeof body.buyPrice === 'number') data.buyPrice = body.buyPrice;
    if (typeof body.buyDate === 'string') data.buyDate = new Date(body.buyDate);
    if (typeof body.buyLocation === 'string') data.buyLocation = body.buyLocation;
    if (typeof body.buyFees === 'number') data.buyFees = body.buyFees;
    if (typeof body.sellPrice === 'number' || body.sellPrice === null) data.sellPrice = body.sellPrice;
    if (typeof body.sellDate === 'string' || body.sellDate === null) data.sellDate = body.sellDate ? new Date(body.sellDate) : null;
    if (typeof body.sellLocation === 'string') data.sellLocation = body.sellLocation;
    if (typeof body.sellFees === 'number') data.sellFees = body.sellFees;
    if (typeof body.status === 'string') data.status = body.status;
    if (typeof body.notes === 'string') data.notes = body.notes;
    // v8.63: tags — accept array or comma-string, normalize
    if (Array.isArray(body.tags) || typeof body.tags === 'string') {
      data.tags = serializeTags(body.tags);
    }

    // Auto-set status to "sold" when sellPrice is set
    if (typeof body.sellPrice === 'number' && body.sellPrice > 0 && !body.sellDate) {
      data.sellDate = new Date();
      data.status = 'sold';
    }

    const updated = await db.trade.update({ where: { id }, data });

    // v9.82: Auto-trigger Copilot outcome evaluation when a trade is sold.
    // Če je ta trade povezan z Copilot predlogom (preko relatedTradeId ali relatedListingId),
    // avtomatsko evalviraj in zabeleži izid — ne rabi uporabnik ročno zabeležiti.
    const becameSold = data.status === 'sold' || (typeof body.sellPrice === 'number' && body.sellPrice > 0);
    if (becameSold) {
      try {
        // Najdi povezan predlog (sell → relatedTradeId, buy → relatedListingId)
        const trade = await db.trade.findUnique({
          where: { id },
          select: { id: true, listingId: true },
        });
        if (trade) {
          const linkedSuggestions = await db.copilotSuggestion.findMany({
            where: {
              status: 'executed',
              OR: [
                { relatedTradeId: trade.id },
                ...(trade.listingId ? [{ relatedListingId: trade.listingId }] : []),
              ],
            },
            select: { id: true, type: true },
          });
          for (const sug of linkedSuggestions) {
            // evaluateSuggestionOutcome sam posodobi status in polja če je trade sold
            const result = await evaluateSuggestionOutcome(sug.id);
            if (result) {
              logger.info('/api/trades/[id]', `Auto-evaluated outcome for suggestion ${sug.id} (${sug.type}) → wasCorrect=${result.wasCorrect}`);
            }
          }
        }
      } catch (evalErr) {
        // Ne failaj celotnega PUT-a če evalvacija ne uspe — samo logiraj
        logger.error('/api/trades/[id]', 'Auto-evaluate outcome failed (non-fatal)', evalErr);
      }
    }

    return NextResponse.json(updated);

  } catch (err) {
    logger.error("/api/trades/[id]", "PUT handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.trade.delete({ where: { id } });
    return NextResponse.json({ ok: true });

  } catch (err) {
    logger.error("/api/trades/[id]", "DELETE handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
