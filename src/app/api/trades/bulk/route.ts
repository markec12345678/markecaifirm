// v5.7: Bulk Trade Operations — sell/update/categorize multiple trades at once
// POST /api/trades/bulk
// Body: { action: 'sell'|'update'|'categorize'|'delete', tradeIds: string[], data?: any }
//   sell: { data: { sellPrice, sellDate?, sellFees?, sellLocation? } }
//   update: { data: { category?, status?, notes? } }
//   categorize: (AI categorize all held trades)
//   delete: (delete selected trades)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
// v6.93: Priklop webhook-engine — trigger 'trade.sold' ob prodaji
import { triggerWebhooks } from '@/lib/webhook-engine';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tradeIds, data } = body;

    if (!action || !['sell', 'update', 'categorize', 'delete'].includes(action)) {
      return NextResponse.json({ error: 'Neveljaven action' }, { status: 400 });
    }
    if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
      return NextResponse.json({ error: 'tradeIds mora biti ne-prazen array' }, { status: 400 });
    }

    let updated = 0;
    let errors = 0;

    switch (action) {
      case 'sell': {
        if (!data?.sellPrice) {
          return NextResponse.json({ error: 'sellPrice je obvezen za sell action' }, { status: 400 });
        }
        for (const id of tradeIds) {
          try {
            // Fetch trade before update, da dobimo podatke za webhook
            const trade = await db.trade.findUnique({ where: { id }, select: { title: true, buyPrice: true, buyFees: true, category: true, listingId: true } });
            await db.trade.update({
              where: { id },
              data: {
                status: 'sold',
                sellPrice: data.sellPrice,
                sellDate: data.sellDate ? new Date(data.sellDate) : new Date(),
                sellFees: data.sellFees ?? 0,
                sellLocation: data.sellLocation ?? '',
              },
            });
            // v6.93: Trigger webhook 'trade.sold'
            if (trade) {
              try {
                await triggerWebhooks('trade.sold', {
                  tradeId: id,
                  title: trade.title,
                  buyPrice: trade.buyPrice,
                  buyFees: trade.buyFees,
                  sellPrice: data.sellPrice,
                  sellFees: data.sellFees ?? 0,
                  category: trade.category,
                  profit: data.sellPrice - (data.sellFees ?? 0) - trade.buyPrice - (trade.buyFees ?? 0),
                  listingId: trade.listingId,
                });
              } catch { /* webhook failures ne vplivajo */ }
            }
            updated++;
          } catch { errors++; }
        }
        break;
      }

      case 'update': {
        const updateData: any = {};
        if (typeof data?.category === 'string') updateData.category = data.category;
        if (typeof data?.status === 'string') updateData.status = data.status;
        if (typeof data?.notes === 'string') updateData.notes = data.notes;
        if (Object.keys(updateData).length === 0) {
          return NextResponse.json({ error: 'Ni polj za posodobitev' }, { status: 400 });
        }
        for (const id of tradeIds) {
          try {
            await db.trade.update({ where: { id }, data: updateData });
            updated++;
          } catch { errors++; }
        }
        break;
      }

      case 'categorize': {
        // AI categorize all trades (delegate to ai/categorize with bulk mode)
        // For now, just update category based on title keywords
        const trades = await db.trade.findMany({
          where: { id: { in: tradeIds } },
          select: { id: true, title: true, category: true },
        });
        for (const t of trades) {
          const cat = guessCategory(t.title);
          if (cat && cat !== t.category) {
            try {
              await db.trade.update({ where: { id: t.id }, data: { category: cat } });
              updated++;
            } catch { errors++; }
          }
        }
        break;
      }

      case 'delete': {
        const result = await db.trade.deleteMany({ where: { id: { in: tradeIds } } });
        updated = result.count;
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      updated,
      errors,
      total: tradeIds.length,
    });
  } catch (e: any) {
    logger.error("/api/trades/bulk", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

function guessCategory(title: string): string | null {
  const t = title.toLowerCase();
  if (/(iphone|samsung|telefon|laptop|macbook|pc|računalnik|konzola|ps5|xbox|tv|monitor)/.test(t)) return 'elektronika';
  if (/(avto|vozilo|golf|audi|bmw|toyota|renault|peugeot|citroen|ford|opel|skoda|vw|honda|mazda)/.test(t)) return 'avto';
  if (/(stanovanje|hiša|hisa|zemljišče|garaža|nepremičnin)/.test(t)) return 'nepremičnina';
  if (/(orodje|bosch|makita|dewalt|vijačnik|bušilka|brusilka)/.test(t)) return 'orodje';
  if (/(hlače|majica|jakna|čevlji|oblačila|nike|adidas|levis)/.test(t)) return 'moda';
  if (/(smuči|kolo|fitnes|žoga|tenis|kolesar)/.test(t)) return 'sport';
  if (/(miza|stol|omara|postelja|pohištvo|telerik)/.test(t)) return 'pohištvo';
  return null;
}
