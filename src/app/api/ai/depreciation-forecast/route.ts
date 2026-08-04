// v6.23: AI Inventory Depreciation Forecaster — napove padec vrednosti inventarja čez čas
// POST /api/ai/depreciation-forecast
// Body: { tradeIds?: string[] } // če ni podan, uporabi vse held tradeove
// Returns: { ok, forecasts: [{ tradeId, title, category, currentValue, depreciationCurve: [], projectedValue, monthsToZeroProfit, action }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Kategorijski profile amortizacije (mesečni % padec)
const DEPRECIATION_PROFILES: Record<string, { monthly: number; yearly: number; lifespan: number; description: string }> = {
  'elektronika': { monthly: 2.5, yearly: 30, lifespan: 36, description: 'Hitra amortizacija (nova generacija vsako leto)' },
  'telefoni': { monthly: 3.0, yearly: 36, lifespan: 30, description: 'Zelo hitra (Apple/Samsung nov modeli letno)' },
  'racunalnistvo': { monthly: 2.0, yearly: 24, lifespan: 48, description: 'Hitra (CPU/GPU generacije)' },
  'avto': { monthly: 1.0, yearly: 12, lifespan: 120, description: 'Počasna (avtomobili obdržijo vrednost)' },
  'nepremicnine': { monthly: 0.2, yearly: 2.4, lifespan: 600, description: 'Zelo počasna (lahko celo raste)' },
  'kolesa': { monthly: 1.5, yearly: 18, lifespan: 60, description: 'Srednja (kompONENTE se porabijo)' },
  'pohistvo': { monthly: 0.8, yearly: 10, lifespan: 120, description: 'Počasna (vintage lahko raste)' },
  'umetnine': { monthly: -0.2, yearly: -2.4, lifespan: 1000, description: 'NEGATIVNA (raste v vrednosti!)' },
  'orozje': { monthly: 0.3, yearly: 4, lifespan: 300, description: 'Zelo počasna (zbirateljsko)' },
  'nakit': { monthly: 0.1, yearly: 1.2, lifespan: 600, description: 'Zelo počasna (zlato/srebro raste)' },
  'sport': { monthly: 1.8, yearly: 22, lifespan: 48, description: 'Srednja (sezonska + tehnologija)' },
  'moda': { monthly: 3.5, yearly: 42, lifespan: 24, description: 'Zelo hitra (trendi hitro minejo)' },
  'luxury': { monthly: -0.5, yearly: -6, lifespan: 1000, description: 'NEGATIVNA (luxury znamke rastejo)' },
  'drugo': { monthly: 1.5, yearly: 18, lifespan: 60, description: 'Povprečna' },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];

    // 1. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      take: 30,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        forecasts: [],
        message: 'Ni held tradeov za napoved amortizacije.',
      });
    }

    // 2. Izračunaj amortizacijsko krivuljo per item
    const items = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const profile = DEPRECIATION_PROFILES[cat] ?? DEPRECIATION_PROFILES['drugo'];
      const currentValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const monthsHeld = Math.round(daysHeld / 30);

      // Amortizacijska krivulja za naslednjih 24 mesecev
      const depreciationCurve: Array<{ month: number; projectedValue: number; lossFromCurrent: number; lossFromBuy: number }> = [];
      for (let m = 0; m <= 24; m++) {
        const totalMonths = monthsHeld + m;
        const depreciationFactor = Math.pow(1 - profile.monthly / 100, totalMonths);
        const projectedValue = Math.max(0, Math.round(t.buyPrice * depreciationFactor));
        depreciationCurve.push({
          month: m,
          projectedValue,
          lossFromCurrent: Math.round(((currentValue - projectedValue) / Math.max(1, currentValue)) * 100),
          lossFromBuy: Math.round(((t.buyPrice - projectedValue) / Math.max(1, t.buyPrice)) * 100),
        });
      }

      // Kdaj bomo izgubili ves dobiček (projectedValue <= buyPrice)
      const monthsToZeroProfit = depreciationCurve.find(d => d.projectedValue <= t.buyPrice)?.month ?? null;

      // Action priporočilo
      let action = 'hold';
      if (monthsToZeroProfit != null) {
        if (monthsToZeroProfit <= 1) action = 'sell_urgent';
        else if (monthsToZeroProfit <= 3) action = 'sell_soon';
        else if (monthsToZeroProfit <= 6) action = 'monitor';
        else action = 'hold';
      }

      return {
        id: t.id,
        title: t.title,
        category: cat,
        buyPrice: t.buyPrice,
        currentValue,
        daysHeld,
        monthsHeld,
        profile,
        depreciationCurve,
        monthsToZeroProfit,
        projectedValueIn6m: depreciationCurve[6]?.projectedValue ?? currentValue,
        projectedValueIn12m: depreciationCurve[12]?.projectedValue ?? currentValue,
        projectedValueIn24m: depreciationCurve[24]?.projectedValue ?? currentValue,
        lossIn6m: depreciationCurve[6]?.lossFromCurrent ?? 0,
        lossIn12m: depreciationCurve[12]?.lossFromCurrent ?? 0,
        lossIn24m: depreciationCurve[24]?.lossFromCurrent ?? 0,
        action,
      };
    });

    // 3. AI analiza in priporočila
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = items.slice(0, 20).map(i =>
      `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.buyPrice}€ | trenutna: ${i.currentValue}€ | ${i.monthsHeld}m v skladišču | prof. amortizacije: ${i.profile.yearly}%/leto | do izgube dobička: ${i.monthsToZeroProfit ?? 'nikoli'}m`
    ).join('\n');

    const prompt = `Si ekspert za vrednotenje in napovedovanje amortizacije rabljenih dobrin.
Za vsak held item analiziraj amortizacijsko krivuljo in priporoči optimalno strategijo.

INVENTAR Z AMORTIZACIJSKIMI PODATKI:
${itemsStr}

AMORTIZACIJSKI PROFILI PO KATEGORIJAH:
${Object.entries(DEPRECIATION_PROFILES).map(([k, v]) => `- ${k}: ${v.yearly}%/leto (${v.description})`).join('\n')}

Slovenski kontekst:
- Inflacija 2024: ~4%, vpliva na nominalne cene
- Elektronika: nov model vsakih 6-12 mesecev → hitra izguba vrednosti
- Avto: stabilen trg, počasna amortizacija
- Umetnine/luxury: lahko rastejo v vrednosti (negativna amortizacija)
- Sezonski: smuči (po zimi), kolesa (po poletju), kamp oprema

Strategije:
- "sell_now": prodaj takoj (velika izguba v naslednjih 1-2 mesecih)
- "sell_soon": prodaj v 1-3 mesecih (omeji izgubo)
- "monitor": sledi vrednost, prodaj ob priliki
- "hold": obdrži (amortizacija počasna ali negativna)
- "vintage_holding": obdrži za dolgo časa (potencial za rast)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o amortizaciji portfolia, max 250 znakov>",
  "forecasts": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "category": "<kategorija>",
      "current_value_eur": <number>,
      "projected_value_6m_eur": <number>,
      "projected_value_12m_eur": <number>,
      "projected_value_24m_eur": <number>,
      "loss_6m_pct": <number>,
      "loss_12m_pct": <number>,
      "loss_24m_pct": <number>,
      "months_to_zero_profit": <number | null>,
      "action": "<sell_now|sell_soon|monitor|hold|vintage_holding>",
      "reasoning": "<max 150 znakov>",
      "optimal_sell_window": "<kdaj prodati, max 80 znakov>",
      "alternative_strategy": "<alternativa, max 100 znakov>"
    }
  ],
  "portfolio_summary": {
    "total_current_value_eur": <number>,
    "projected_loss_6m_eur": <number>,
    "projected_loss_12m_eur": <number>,
    "projected_loss_24m_eur": <number>,
    "high_risk_count": <number>,
    "vintage_potential_count": <number>,
    "recommended_action": "<aggressive_sell|balanced|patient_hold>"
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));

    const forecasts = (parsed?.forecasts || [])
      .filter((f: any) => validIds.has(String(f?.id ?? '')))
      .map((f: any) => {
        const id = String(f.id);
        const orig = itemMap.get(id)!;
        return {
          tradeId: id,
          title: orig.title,
          category: orig.category,
          buyPrice: orig.buyPrice,
          currentValue: orig.currentValue,
          daysHeld: orig.daysHeld,
          projectedValue6mEur: Math.max(0, Number(f?.projected_value_6m_eur ?? orig.projectedValueIn6m)),
          projectedValue12mEur: Math.max(0, Number(f?.projected_value_12m_eur ?? orig.projectedValueIn12m)),
          projectedValue24mEur: Math.max(0, Number(f?.projected_value_24m_eur ?? orig.projectedValueIn24m)),
          loss6mPct: Math.round(Number(f?.loss_6m_pct ?? orig.lossIn6m)),
          loss12mPct: Math.round(Number(f?.loss_12m_pct ?? orig.lossIn12m)),
          loss24mPct: Math.round(Number(f?.loss_24m_pct ?? orig.lossIn24m)),
          monthsToZeroProfit: f?.months_to_zero_profit != null ? Number(f.months_to_zero_profit) : orig.monthsToZeroProfit,
          action: ['sell_now', 'sell_soon', 'monitor', 'hold', 'vintage_holding'].includes(String(f?.action))
            ? String(f.action) : orig.action,
          reasoning: String(f?.reasoning ?? '').slice(0, 250),
          optimalSellWindow: String(f?.optimal_sell_window ?? '').slice(0, 200),
          alternativeStrategy: String(f?.alternative_strategy ?? '').slice(0, 200),
          depreciationCurve: orig.depreciationCurve,
        };
      });

    // Summary
    const totalCurrentValue = forecasts.reduce((s, f) => s + f.currentValue, 0);
    const projected6m = forecasts.reduce((s, f) => s + f.projectedValue6mEur, 0);
    const projected12m = forecasts.reduce((s, f) => s + f.projectedValue12mEur, 0);
    const projected24m = forecasts.reduce((s, f) => s + f.projectedValue24mEur, 0);
    const portfolioSummary = {
      totalCurrentValueEur: totalCurrentValue,
      projectedLoss6mEur: Math.round(totalCurrentValue - projected6m),
      projectedLoss12mEur: Math.round(totalCurrentValue - projected12m),
      projectedLoss24mEur: Math.round(totalCurrentValue - projected24m),
      highRiskCount: forecasts.filter(f => f.action === 'sell_now' || f.action === 'sell_soon').length,
      vintagePotentialCount: forecasts.filter(f => f.action === 'vintage_holding').length,
      recommendedAction: ['aggressive_sell', 'balanced', 'patient_hold'].includes(String(parsed?.portfolio_summary?.recommended_action))
        ? String(parsed.portfolio_summary.recommended_action) : 'balanced',
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      forecasts,
      portfolioSummary,
    });
  } catch (e: any) {
    logger.error("/api/ai/depreciation-forecast", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
