// v8.83: Setup Status API — checks if all critical setup steps are done.
// Returns checklist with done/pending state for: AI, Monitor, Cron, Push, Demo data.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: {
        aiProvider: true,
        aiBaseUrl: true,
        aiApiKey: true,
        aiModel: true,
        telegramEnabled: true,
        telegramBotToken: true,
        pushEnabled: true,
        vapidPublicKey: true,
        onboardingCompleted: true,
        monthlyProfitGoal: true,
      },
    });

    const monitorCount = await db.monitor.count();
    const activeMonitorCount = await db.monitor.count({ where: { isActive: true } });
    const monitorWithLastRun = await db.monitor.findFirst({
      where: { lastRunAt: { not: null } },
      select: { lastRunAt: true },
    });
    const listingCount = await db.listing.count();
    const tradeCount = await db.trade.count();

    // Check if cron has been run (heartbeat exists or any monitor has lastRunAt)
    const cronRunning = monitorWithLastRun != null;

    // Build checklist
    const checklist = [
      {
        id: 'ai',
        label: 'AI provider konfiguriran',
        done: settings?.aiProvider != null && settings.aiBaseUrl != null,
        detail: settings?.aiProvider
          ? `${settings.aiProvider} (${settings.aiModel})`
          : 'Ni nastavljeno — Nastavitve → AI',
        link: '/?view=settings',
      },
      {
        id: 'monitor',
        label: 'Monitor ustvarjen',
        done: monitorCount > 0,
        detail: monitorCount > 0
          ? `${monitorCount} monitorjev (${activeMonitorCount} aktivnih)`
          : 'Brez monitorjev — Monitorji → Nov monitor',
        link: '/?view=monitors',
      },
      {
        id: 'cron',
        label: 'Cron je pognan vsaj enkrat',
        done: cronRunning,
        detail: cronRunning
          ? 'Cron deluje (monitorji so se pognali)'
          : 'Cron še ni pognan — brez tega sistem ne scrapa!',
        link: '',
      },
      {
        id: 'listings',
        label: 'Oglasi so najdeni',
        done: listingCount > 0,
        detail: listingCount > 0
          ? `${listingCount} oglasov v bazi`
          : 'Brez oglasov — poženi monitor ali nastavi cron',
        link: '/?view=listings',
      },
      {
        id: 'trades',
        label: 'Trgovine v skladišču',
        done: tradeCount > 0,
        detail: tradeCount > 0
          ? `${tradeCount} trgovin`
          : 'Brez trgovin — dodaj v Skladišče ali naloži demo',
        link: '/?view=trades',
      },
      {
        id: 'push',
        label: 'Web Push omogočen',
        done: settings?.pushEnabled === true && !!settings?.vapidPublicKey,
        detail: settings?.pushEnabled
          ? 'Push aktiven'
          : 'Brez push-a — Nastavitve → Web Push',
        link: '/?view=settings',
      },
      {
        id: 'goal',
        label: 'Mesečni cilj nastavljen',
        done: settings?.monthlyProfitGoal != null && settings.monthlyProfitGoal > 0,
        detail: settings?.monthlyProfitGoal
          ? `${settings.monthlyProfitGoal}€/mesec`
          : 'Brez cilja',
        link: '',
      },
    ];

    const doneCount = checklist.filter(c => c.done).length;
    const totalCount = checklist.length;
    const allDone = doneCount === totalCount;

    return NextResponse.json({
      ok: true,
      checklist,
      doneCount,
      totalCount,
      allDone,
      onboardingCompleted: settings?.onboardingCompleted ?? false,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
