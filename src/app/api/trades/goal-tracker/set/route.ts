// v8.39: Set monthly profit goal.
//
// POST /api/trades/goal-tracker/set
//   body: { monthlyGoal: number }
//   → updates Settings.monthlyProfitGoal (singleton row, already exists from v1.x).
//   → if goal > 0 and current realizedProfit >= goal, also creates a
//     Notification (v8.38) of type 'system' severity 'success'
//     "🎉 Dosežen mesečni cilj!" so the user has a permanent record.
//
// Validation:
//   - monthlyGoal must be a finite number >= 0.
//   - Negative or NaN → 400.
//   - Reasonable upper bound: 1_000_000€ (refuse absurd values).
//
// Returns: { ok: true, monthlyGoal: number, goalAchieved: boolean }
//
// runtime='nodejs', dynamic='force-dynamic'.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_GOAL_EUR = 1_000_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Telo zahtevka mora biti JSON objekt z monthlyGoal.' },
        { status: 400 },
      );
    }

    const raw = body.monthlyGoal;
    const num = typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(String(raw).trim().replace(',', '.'))
        : NaN;

    if (!Number.isFinite(num) || num < 0) {
      return NextResponse.json(
        { error: 'monthlyGoal mora biti ne-negativno število (EUR).' },
        { status: 400 },
      );
    }
    if (num > MAX_GOAL_EUR) {
      return NextResponse.json(
        { error: `monthlyGoal presega zgornjo mejo ${MAX_GOAL_EUR}€.` },
        { status: 400 },
      );
    }

    // Update Settings singleton row. The row is created by app initialization
    // (id='singleton' is the documented convention across v1.x → v8.38).
    // Use update() per task spec — row exists; fall back to upsert only if
    // update affects 0 rows (defensive — e.g. fresh DB before first init).
    let updated: { monthlyProfitGoal: number } | null = null;
    try {
      updated = await db.settings.update({
        where: { id: 'singleton' },
        data: { monthlyProfitGoal: num },
        select: { monthlyProfitGoal: true },
      });
    } catch {
      // Row doesn't exist yet — create it with defaults + the new goal.
      updated = await db.settings.upsert({
        where: { id: 'singleton' },
        update: { monthlyProfitGoal: num },
        create: { id: 'singleton', monthlyProfitGoal: num },
        select: { monthlyProfitGoal: true },
      });
    }

    // Goal achievement check — only fire when goal is freshly set (>0) AND
    // current month's realized profit already meets/exceeds the goal. This
    // mirrors the v6.7 GET handler's `goalPct >= 100` branch.
    let goalAchieved = false;
    if (num > 0) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const sold = await db.trade.findMany({
        where: {
          status: 'sold',
          sellPrice: { not: null },
          sellDate: { gte: monthStart },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      });
      const realized = sold.reduce(
        (s, t) =>
          s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)),
        0,
      );

      if (realized >= num) {
        goalAchieved = true;
        try {
          await createNotification({
            type: 'system',
            severity: 'success',
            source: 'system',
            title: '🎉 Dosežen mesečni cilj!',
            body: `Mesečni cilj ${num}€ je dosežen (realizirani dobiček ${Math.round(realized)}€). Čestitke! Nadaljuj z nagibanjem trga za dodatni dobiček.`,
            metadata: {
              monthlyGoal: num,
              realizedProfit: Math.round(realized),
              achievedAt: now.toISOString(),
              sourceEndpoint: '/api/trades/goal-tracker/set',
            },
          });
        } catch (notifErr) {
          // Non-critical — Notification creation failure should NOT block the
          // goal update itself. Log and proceed.
          logger.warn(
            '/api/trades/goal-tracker/set',
            'Failed to create goal-achievement notification',
            notifErr,
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      monthlyGoal: updated?.monthlyProfitGoal ?? num,
      goalAchieved,
    });
  } catch (err) {
    logger.error('/api/trades/goal-tracker/set', 'POST handler failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Napaka' },
      { status: 500 },
    );
  }
}
