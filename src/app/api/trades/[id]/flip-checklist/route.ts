// v7.35: Flip Workflow checklist API
// PATCH /api/trades/:id/flip-checklist
// Body: { step: string, completed?: boolean }
// Toggles a checklist step on/off, returns updated checklist.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// v7.35: Flip workflow steps — ordered pipeline for held trades.
// Each step prevents "inventory creep" — items sitting idle losing value.
export const FLIP_STEPS = [
  { id: 'received', label: 'Dobljeno', icon: '📦', description: 'Item fizično prejet' },
  { id: 'inspected', label: 'Pregledano', icon: '🔍', description: 'Stanje preverjeno (poškodbe, funkcionalnost)' },
  { id: 'cleaned', label: 'Očiščeno', icon: '🧽', description: 'Počiščeno, pripravljeno za fotografiranje' },
  { id: 'photographed', label: 'Fotografirano', icon: '📸', description: '6+ kvalitetnih slik iz različnih kotov' },
  { id: 'described', label: 'Opisano', icon: '✍️', description: 'AI optimiziran opis ustvarjen' },
  { id: 'listed_bolha', label: 'Bolha objava', icon: '🌐', description: 'Objavljeno na Bolha.com' },
  { id: 'listed_vinted', label: 'Vinted objava', icon: '👕', description: 'Objavljeno na Vinted (kategorija primerna)' },
  { id: 'listed_other', label: 'Druga platforma', icon: '📱', description: 'Facebook Marketplace / drugi' },
  { id: 'price_review_7d', label: '7d pregled cene', icon: '⏰', description: 'Po 7 dneh: ali so povprašanja? Prilagodi ceno.' },
  { id: 'price_drop_14d', label: '14d znižanje', icon: '📉', description: 'Po 14 dneh: znižaj za 10% če ni prodano' },
  { id: 'price_drop_30d', label: '30d znižanje', icon: '⚠️', description: 'Po 30 dneh: znižaj za 20% ali umakni' },
] as const;

interface ChecklistEntry {
  step: string;
  completedAt: string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const step = String(body?.step || '');
    const completed = body?.completed !== false; // default true

    if (!step) {
      return NextResponse.json({ error: 'step je obvezen' }, { status: 400 });
    }

    const trade = await db.trade.findUnique({
      where: { id },
      select: { flipChecklist: true, buyDate: true, title: true, status: true },
    });

    if (!trade) {
      return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
    }

    // Parse existing checklist
    let checklist: ChecklistEntry[] = [];
    try {
      checklist = JSON.parse(trade.flipChecklist || '[]');
    } catch {
      checklist = [];
    }

    // Toggle step
    const existing = checklist.find(c => c.step === step);
    if (completed) {
      if (!existing) {
        checklist.push({ step, completedAt: new Date().toISOString() });
      }
    } else {
      checklist = checklist.filter(c => c.step !== step);
    }

    // Update DB
    await db.trade.update({
      where: { id },
      data: { flipChecklist: JSON.stringify(checklist) },
    });

    // Compute progress
    const completedCount = checklist.length;
    const totalCount = FLIP_STEPS.length;
    const progressPct = Math.round((completedCount / totalCount) * 100);

    // v7.35: If "listed_bolha" is completed, auto-update trade status hint
    const isListed = checklist.some(c => c.step === 'listed_bolha' || c.step === 'listed_vinted' || c.step === 'listed_other');
    const daysSinceBuy = trade.buyDate
      ? Math.round((Date.now() - new Date(trade.buyDate).getTime()) / 86400000)
      : 0;

    let recommendation = '';
    if (completedCount === 0) {
      recommendation = '🚀 Začni z dobavo item-a. Vsak dan zamikanja = izguba vrednosti.';
    } else if (!isListed && completedCount < 5) {
      recommendation = '📸 Naslednji korak: fotografiraj in opiši. Cilj: objaviti v 24h po nakupu.';
    } else if (isListed && daysSinceBuy >= 7 && !checklist.some(c => c.step === 'price_review_7d')) {
      recommendation = '⏰ Preteklo 7 dni od nakupa — preglej ceno. Če ni povprašanj, znižaj za 5-10%.';
    } else if (daysSinceBuy >= 14 && !checklist.some(c => c.step === 'price_drop_14d')) {
      recommendation = '📉 Preteklo 14 dni — znižaj ceno za 10%. Capital tied up = carrying cost.';
    } else if (daysSinceBuy >= 30 && !checklist.some(c => c.step === 'price_drop_30d')) {
      recommendation = '⚠️ Preteklo 30 dni — znižaj za 20% ali umakni. Item izgublja vrednost.';
    } else if (progressPct === 100) {
      recommendation = '✅ Vsi koraki končani! Item je v prodajnem procesu.';
    } else {
      recommendation = `Napredek: ${progressPct}%. Nadaljuj z naslednjim korakom.`;
    }

    return NextResponse.json({
      ok: true,
      checklist,
      progressPct,
      completedCount,
      totalCount,
      daysSinceBuy,
      recommendation,
    });
  } catch (err) {
    logger.error('/api/trades/[id]/flip-checklist', 'PATCH handler failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const trade = await db.trade.findUnique({
      where: { id },
      select: { flipChecklist: true, buyDate: true, title: true, status: true },
    });

    if (!trade) {
      return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
    }

    let checklist: ChecklistEntry[] = [];
    try {
      checklist = JSON.parse(trade.flipChecklist || '[]');
    } catch {
      checklist = [];
    }

    const completedCount = checklist.length;
    const totalCount = FLIP_STEPS.length;
    const progressPct = Math.round((completedCount / totalCount) * 100);
    const daysSinceBuy = trade.buyDate
      ? Math.round((Date.now() - new Date(trade.buyDate).getTime()) / 86400000)
      : 0;

    return NextResponse.json({
      ok: true,
      trade: { id, title: trade.title, status: trade.status, buyDate: trade.buyDate },
      steps: FLIP_STEPS,
      checklist,
      progressPct,
      completedCount,
      totalCount,
      daysSinceBuy,
    });
  } catch (err) {
    logger.error('/api/trades/[id]/flip-checklist', 'GET handler failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
