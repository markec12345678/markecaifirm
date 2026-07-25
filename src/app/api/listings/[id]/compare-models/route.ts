// v4.8: AI model comparison — primerjaj ocene različnih AI modelov na istem oglasu
// POST /api/listings/:id/compare-models
// Body: { models: Array<{ provider, baseUrl?, apiKey?, model }> }
// Returns: { results: Array<{ model, ok, evaluation?, error?, durationMs }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evaluateListing, type AiSettings, type ListingEvaluation } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface CompareModel {
  provider: 'ollama' | 'openai' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
  model: string;
  label?: string; // user-friendly name
}

interface CompareResult {
  label: string;
  model: string;
  provider: string;
  ok: boolean;
  evaluation?: ListingEvaluation;
  error?: string;
  durationMs: number;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const models: CompareModel[] = Array.isArray(body?.models) ? body.models : [];

  if (models.length === 0) {
    return NextResponse.json({ error: 'Navedi vsaj en model za primerjavo' }, { status: 400 });
  }
  if (models.length > 5) {
    return NextResponse.json({ error: 'Maksimalno 5 modelov na primerjavo' }, { status: 400 });
  }

  const listing = await db.listing.findUnique({
    where: { id },
    include: { monitor: { select: { name: true, source: true } } },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }

  const results: CompareResult[] = [];

  for (const m of models) {
    const label = m.label || `${m.provider}/${m.model}`;
    const startTime = Date.now();
    try {
      const settings: AiSettings = {
        provider: m.provider,
        baseUrl: m.baseUrl || '',
        apiKey: m.apiKey || '',
        model: m.model,
      };
      // Use listing data for evaluation
      const evaluation = await evaluateListing(settings, {
        title: listing.title,
        priceText: listing.priceText,
        price: listing.price,
        location: listing.location,
        description: listing.description,
        source: listing.monitor?.source ?? 'neznan',
        monitorName: listing.monitor?.name ?? 'primerjava',
        customPrompt: '',
      });
      results.push({
        label,
        model: m.model,
        provider: m.provider,
        ok: true,
        evaluation,
        durationMs: Date.now() - startTime,
      });
    } catch (e: any) {
      results.push({
        label,
        model: m.model,
        provider: m.provider,
        ok: false,
        error: e?.message ?? 'AI call failed',
        durationMs: Date.now() - startTime,
      });
    }
  }

  // Increment daily AI usage counter by number of models used
  try {
    const settings = await db.settings.findFirst({ where: { id: 'singleton' } });
    const today = new Date().toISOString().slice(0, 10);
    if (settings) {
      if (settings.aiCallsDate !== today) {
        await db.settings.update({
          where: { id: 'singleton' },
          data: { aiCallsDate: today, aiCallsToday: models.length },
        });
      } else {
        await db.settings.update({
          where: { id: 'singleton' },
          data: { aiCallsToday: { increment: models.length } },
        });
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    ok: true,
    results,
    listingId: id,
    listingTitle: listing.title,
    comparedAt: new Date().toISOString(),
  });
}
