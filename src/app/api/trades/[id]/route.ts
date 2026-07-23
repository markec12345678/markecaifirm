import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trade = await db.trade.findUnique({
    where: { id },
    include: { listing: { select: { id: true, title: true, url: true, imageUrl: true } } },
  });
  if (!trade) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });
  return NextResponse.json(trade);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Auto-set status to "sold" when sellPrice is set
  if (typeof body.sellPrice === 'number' && body.sellPrice > 0 && !body.sellDate) {
    data.sellDate = new Date();
    data.status = 'sold';
  }

  const updated = await db.trade.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.trade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
