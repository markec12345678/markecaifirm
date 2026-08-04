// v7.32: Deal Flow Analytics — metrike za maksimalen zaslužek.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const trades = await db.trade.findMany({ where: { status: { in: ['held', 'sold'] } }, select: { id: true, buyPrice: true, buyFees: true, buyDate: true, sellPrice: true, sellFees: true, sellDate: true, status: true, category: true } });
    const sold = trades.filter(t => t.status === 'sold' && t.sellPrice != null && t.sellDate != null);
    const held = trades.filter(t => t.status === 'held');

    if (sold.length === 0) {
      return NextResponse.json({ ok: true, metrics: { roi: 0, winRate: 0, avgMargin: 0, avgHoldDays: 0, moneyVelocity: 0, pipeline: { heldCount: held.length, heldValue: held.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0), estProfit: 0 }, cashFlow: { last30d: 0, last90d: 0, ytd: 0 } }, message: 'Ni prodaj za analizo.' });
    }

    const totalInvested = sold.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalReturned = sold.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const totalProfit = totalReturned - totalInvested;
    const roi = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const profitable = sold.filter(t => ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)) > 0);
    const winRate = (profitable.length / sold.length) * 100;
    const avgMargin = totalProfit / sold.length;
    const holdTimes = sold.map(t => (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000).filter(d => d >= 0);
    const avgHoldDays = holdTimes.length > 0 ? holdTimes.reduce((s, d) => s + d, 0) / holdTimes.length : 0;
    const moneyVelocity = avgHoldDays > 0 ? 365 / avgHoldDays : 0;
    const heldValue = held.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const estProfit = avgMargin > 0 ? avgMargin * held.length : 0;
    const now = new Date();
    const cf = (days: number) => sold.filter(t => new Date(t.sellDate!) >= new Date(now.getTime() - days * 86400000)).reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    const catStats = new Map<string, { inv: number; ret: number; cnt: number }>();
    for (const t of sold) { const c = t.category || 'drugo'; const cur = catStats.get(c) || { inv: 0, ret: 0, cnt: 0 }; cur.inv += t.buyPrice + (t.buyFees ?? 0); cur.ret += (t.sellPrice ?? 0) - (t.sellFees ?? 0); cur.cnt += 1; catStats.set(c, cur); }
    const topCategories = Array.from(catStats.entries()).map(([cat, s]) => ({ category: cat, roi: s.inv > 0 ? ((s.ret - s.inv) / s.inv) * 100 : 0, profit: s.ret - s.inv, count: s.cnt })).sort((a, b) => b.profit - a.profit).slice(0, 5);

    return NextResponse.json({ ok: true, metrics: { roi: Math.round(roi * 100) / 100, winRate: Math.round(winRate * 10) / 10, avgMargin: Math.round(avgMargin * 100) / 100, avgHoldDays: Math.round(avgHoldDays * 10) / 10, moneyVelocity: Math.round(moneyVelocity * 100) / 100, pipeline: { heldCount: held.length, heldValue: Math.round(heldValue * 100) / 100, estProfit: Math.round(estProfit * 100) / 100 }, cashFlow: { last30d: Math.round(cf(30) * 100) / 100, last90d: Math.round(cf(90) * 100) / 100, ytd: Math.round(cf(365) * 100) / 100 }, topCategories }, totals: { soldCount: sold.length, heldCount: held.length, totalProfit: Math.round(totalProfit * 100) / 100, totalInvestedSold: Math.round(totalInvested * 100) / 100 } });
  } catch (err: any) {
    logger.error('/api/trades/deal-flow', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
