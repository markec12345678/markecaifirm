// v9.65: Scheduler API — status + manual trigger + config.
//
// GET  /api/scheduler — vrne status schedulerja
// POST /api/scheduler — manual trigger ali config update
//   Body: { action: 'trigger' } — ročno zaženi scheduled run
//   Body: { action: 'restart' } — restart z novim intervalom
//   Body: { action: 'config', enabled?, intervalMin? } — posodobi nastavitve

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  getSchedulerStatus,
  triggerManualRun,
  restartScheduler,
} from '@/lib/scheduler/internal-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const status = getSchedulerStatus();
    const settings = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: {
        internalSchedulerEnabled: true,
        internalSchedulerIntervalMin: true,
      },
    });

    return NextResponse.json({
      ok: true,
      status,
      config: {
        enabled: settings?.internalSchedulerEnabled ?? true,
        intervalMin: settings?.internalSchedulerIntervalMin ?? 30,
      },
      message: status.running
        ? `Scheduler aktiven — interval ${settings?.internalSchedulerIntervalMin ?? 30} min`
        : 'Scheduler je ustavljen',
    });
  } catch (err: any) {
    logger.error('/api/scheduler', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'trigger') {
      // Ročno zaženi scheduled run
      const status = await triggerManualRun();
      return NextResponse.json({
        ok: true,
        status,
        message: status.lastRunStatus === 'success'
          ? 'Uspešno izvedeno — monitorji pognani'
          : 'Napaka pri izvajanju — preveri log',
      });
    }

    if (action === 'restart') {
      // Restart z novim intervalom
      const status = await restartScheduler();
      return NextResponse.json({
        ok: true,
        status,
        message: 'Scheduler ponovno zagnan z novimi nastavitvami',
      });
    }

    if (action === 'config') {
      // Posodobi nastavitve
      const { enabled, intervalMin } = body;
      const updates: Record<string, unknown> = {};

      if (typeof enabled === 'boolean') {
        updates.internalSchedulerEnabled = enabled;
      }
      if (typeof intervalMin === 'number' && intervalMin >= 5 && intervalMin <= 1440) {
        updates.internalSchedulerIntervalMin = intervalMin;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { ok: false, error: 'Manjkajo enabled ali intervalMin' },
          { status: 400 }
        );
      }

      await db.settings.update({
        where: { id: 'singleton' },
        data: updates,
      });

      // Restart scheduler da uporabi nove nastavitve
      const status = await restartScheduler();

      return NextResponse.json({
        ok: true,
        status,
        message: 'Nastavitve posodobljene in scheduler ponovno zagnan',
      });
    }

    return NextResponse.json(
      { ok: false, error: 'Neznana akcija. Uporabi: trigger, restart, ali config' },
      { status: 400 }
    );
  } catch (err: any) {
    logger.error('/api/scheduler', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 }
    );
  }
}
