// v6.48: AI Inventory Aging Predictor — depreciation curve in sell-by deadline za vsak item
// POST /api/ai/inventory-aging-predictor
// Body: { tradeId?: string }
// Returns: { ok, predictor: { items, depreciationCurves, sellByDeadlines, actions, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Kategorijski depreciation profili (letni % padec vrednosti)
const DEPRECIATION_PROFILES: Record<string, {
  annualDepreciationPct: number;
  curveType: 'linear' | 'exponential' | 'logarithmic' | 'step';
  firstYearDropPct: number; // prvotni padec v prvem letu
  saturationAgeDays: number; // kdaj se vrednost stabilizira
  floorValuePct: number; // minimalna vrednost (% originala)
  seasonalFactor: number; // 0-100, vpliv sezone
  liquidityHalfLifeDays: number; // polovična doba prodaje
}> = {
  'elektronika':  { annualDepreciationPct: 25, curveType: 'exponential', firstYearDropPct: 35, saturationAgeDays: 365, floorValuePct: 15, seasonalFactor: 20, liquidityHalfLifeDays: 14 },
  'telefoni':     { annualDepreciationPct: 35, curveType: 'exponential', firstYearDropPct: 45, saturationAgeDays: 270, floorValuePct: 10, seasonalFactor: 15, liquidityHalfLifeDays: 10 },
  'avto':         { annualDepreciationPct: 15, curveType: 'linear',      firstYearDropPct: 20, saturationAgeDays: 1825, floorValuePct: 20, seasonalFactor: 25, liquidityHalfLifeDays: 45 },
  'nepremicnine': { annualDepreciationPct: 3,  curveType: 'logarithmic', firstYearDropPct: 0,  saturationAgeDays: 3650, floorValuePct: 70, seasonalFactor: 10, liquidityHalfLifeDays: 90 },
  'kolesa':       { annualDepreciationPct: 18, curveType: 'linear',      firstYearDropPct: 25, saturationAgeDays: 730, floorValuePct: 25, seasonalFactor: 80, liquidityHalfLifeDays: 30 },
  'pohištvo':     { annualDepreciationPct: 8,  curveType: 'logarithmic', firstYearDropPct: 12, saturationAgeDays: 1825, floorValuePct: 30, seasonalFactor: 15, liquidityHalfLifeDays: 60 },
  'drugo':        { annualDepreciationPct: 15, curveType: 'linear',      firstYearDropPct: 20, saturationAgeDays: 730, floorValuePct: 20, seasonalFactor: 30, liquidityHalfLifeDays: 21 },
};

// Izračun depreciation curve po točkah
function calcDepreciationCurve(profile: typeof DEPRECIATION_PROFILES[string], initialValue: number, maxDays: number = 365) {
  const points: Array<{ day: number; valueEur: number; depreciationPct: number }> = [];
  const intervals = [0, 7, 14, 30, 60, 90, 120, 180, 270, 365];

  for (const day of intervals) {
    if (day > maxDays) break;
    let depreciationPct: number;
    const yearFraction = day / 365;

    switch (profile.curveType) {
      case 'exponential':
        depreciationPct = profile.firstYearDropPct * (1 - Math.exp(-2 * yearFraction)) + profile.annualDepreciationPct * Math.max(0, yearFraction - 1);
        break;
      case 'linear':
        depreciationPct = profile.annualDepreciationPct * yearFraction;
        break;
      case 'logarithmic':
        depreciationPct = profile.annualDepreciationPct * Math.log10(1 + 9 * yearFraction);
        break;
      case 'step':
        depreciationPct = yearFraction >= 1 ? profile.firstYearDropPct + (yearFraction - 1) * profile.annualDepreciationPct : profile.firstYearDropPct * yearFraction;
        break;
      default:
        depreciationPct = profile.annualDepreciationPct * yearFraction;
    }

    depreciationPct = Math.min(100 - profile.floorValuePct, Math.max(0, depreciationPct));
    const valueEur = Math.round(initialValue * (1 - depreciationPct / 100));
    points.push({ day, valueEur, depreciationPct: Math.round(depreciationPct * 10) / 10 });
  }
  return points;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, imageUrl: true, location: true } },
      },
      take: tradeId ? 1 : 30,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, predictor: null, message: 'Ni held tradeov za aging analizo.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const now = Date.now();

    const items = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const profile = DEPRECIATION_PROFILES[cat] ?? DEPRECIATION_PROFILES['drugo'];
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const initialValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.max(0, Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)));
      const yearFraction = daysHeld / 365;

      // Trenutna depreciated vrednost
      let currentDepreciationPct: number;
      switch (profile.curveType) {
        case 'exponential':
          currentDepreciationPct = profile.firstYearDropPct * (1 - Math.exp(-2 * yearFraction)) + profile.annualDepreciationPct * Math.max(0, yearFraction - 1);
          break;
        case 'linear':
          currentDepreciationPct = profile.annualDepreciationPct * yearFraction;
          break;
        case 'logarithmic':
          currentDepreciationPct = profile.annualDepreciationPct * Math.log10(1 + 9 * yearFraction);
          break;
        case 'step':
          currentDepreciationPct = yearFraction >= 1 ? profile.firstYearDropPct + (yearFraction - 1) * profile.annualDepreciationPct : profile.firstYearDropPct * yearFraction;
          break;
        default:
          currentDepreciationPct = profile.annualDepreciationPct * yearFraction;
      }
      currentDepreciationPct = Math.min(100 - profile.floorValuePct, Math.max(0, currentDepreciationPct));
      const currentValue = Math.round(initialValue * (1 - currentDepreciationPct / 100));
      const currentValueVsCost = currentValue - cost;

      // Sell-by deadline (kdaj currentValue pade pod cost)
      let sellByDeadline: number | null = null;
      if (currentValueVsCost > 0) {
        // Iterativno poišči kdaj currentValue <= cost
        for (let d = daysHeld; d <= 730; d += 7) {
          const yf = d / 365;
          let depPct: number;
          switch (profile.curveType) {
            case 'exponential':
              depPct = profile.firstYearDropPct * (1 - Math.exp(-2 * yf)) + profile.annualDepreciationPct * Math.max(0, yf - 1);
              break;
            case 'linear':
              depPct = profile.annualDepreciationPct * yf;
              break;
            case 'logarithmic':
              depPct = profile.annualDepreciationPct * Math.log10(1 + 9 * yf);
              break;
            case 'step':
              depPct = yf >= 1 ? profile.firstYearDropPct + (yf - 1) * profile.annualDepreciationPct : profile.firstYearDropPct * yf;
              break;
            default:
              depPct = profile.annualDepreciationPct * yf;
          }
          depPct = Math.min(100 - profile.floorValuePct, Math.max(0, depPct));
          const v = initialValue * (1 - depPct / 100);
          if (v <= cost) { sellByDeadline = d; break; }
        }
      }

      // Holding cost (opportunity cost)
      const opportunityCostPerDay = Math.round((initialValue * 0.0003 + cost * 0.0002) * 100) / 100; // ~0.05% daily
      const totalHoldingCost = Math.round(opportunityCostPerDay * daysHeld * 100) / 100;

      return {
        id: t.id,
        title: t.title,
        category: cat,
        cost,
        initialValue,
        daysHeld,
        profile,
        currentValue,
        currentDepreciationPct: Math.round(currentDepreciationPct * 10) / 10,
        currentValueVsCost: Math.round(currentValueVsCost),
        sellByDeadlineDays: sellByDeadline,
        sellByDeadlineDate: sellByDeadline ? new Date(now + sellByDeadline * 24*60*60*1000).toISOString().slice(0, 10) : null,
        opportunityCostPerDay,
        totalHoldingCost,
        liquidityHalfLifeDays: profile.liquidityHalfLifeDays,
      };
    });

    // Sortiraj po urgency (sellByDeadlineDays ascending)
    items.sort((a, b) => {
      if (a.sellByDeadlineDays === null) return 1;
      if (b.sellByDeadlineDays === null) return -1;
      return a.sellByDeadlineDays - b.sellByDeadlineDays;
    });

    const itemsStr = items.slice(0, 20).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.initialValue}€ | ${i.daysHeld}d | sedaj ${i.currentValue}€ (${i.currentDepreciationPct}% depc) | sell-by ${i.sellByDeadlineDays ?? 'prekoračen'}d | holding cost ${i.totalHoldingCost}€ | curve ${i.profile.curveType}`
    ).join('\n');

    const prompt = `Si AI inventory aging predictor z depreciation curve analizo.
Analiziraj staranje inventarja in predlagaj akcije glede na to kdaj item postane negativen.

INVENTAR (${items.length}):
${itemsStr}

Depreciation curve tipi:
- EXPONENTIAL: hitro pada (telefoni, elektronika) — 35-45% v 1. letu
- LINEAR: enakomerno pada (avto, kolesa) — 15-25% na leto
- LOGARITHMIC: hitro pade, nato stabilno (pohištvo, nepremičnine)
- STEP: stopnjasto pade (elektronika ob novi verziji)

Aging phases:
- FRESH (0-7d): optimalen čas za prodajo, najvišja vrednost
- NORMAL (7-30d): še vedno dober čas, ni akcije potrebne
- AGING (30-60d): začne se izgubljati vrednost, razmisli o popustu
- STALE (60-90d): previdno, cena pada
- CRITICAL (90-180d): močna izguba, agersivna akcija
- DEAD (180+): likvidacija, zapiši izgubo

Akcije glede na aging:
- HOLD (fresh): čakaj na optimalno ceno
- LIST_AGAIN (normal): ponovno objavi z novim naslovom
- PRICE_DROP_5 (aging): znižaj za 5%
- PRICE_DROP_10 (stale): znižaj za 10%
- BUNDLE_OFFER (critical): ponudi kot del bundla
- LIQUIDATE (dead): prodaj pod ceno, sprosti kapital
- WRITE_OFF (zombie): zapiši kot izgubo, doniraj ali recikliraj

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "aging_phase": "<fresh|normal|aging|stale|critical|dead|zombie>",
      "current_value_eur": <number>,
      "projected_value_30d_eur": <number>,
      "projected_value_90d_eur": <number>,
      "recommended_action": "<hold|list_again|price_drop_5|price_drop_10|bundle_offer|liquidate|write_off>",
      "recommended_price_eur": <number>,
      "urgency_score": <number 0-100>,
      "days_until_loss": <number ali null>,
      "loss_if_no_action_eur": <number>,
      "reasoning": "<max 120 znakov>"
    }
  ],
  "depreciation_curves": [
    { "category": "<kategorija>", "curve_type": "<exponential|linear|logarithmic|step>", "annual_depreciation_pct": <number>, "first_year_drop_pct": <number>, "floor_value_pct": <number>, "saturation_age_days": <number>, "description": "<max 100 znakov>" }
  ],
  "sell_by_deadlines": [
    { "trade_id": "<id>", "title": "<naslov>", "sell_by_date": "<YYYY-MM-DD ali null>", "days_remaining": <number ali null>, "status": "<safe|warning|critical|overdue>", "current_loss_eur": <number> }
  ],
  "actions": [
    { "action": "<max 120 znakov>", "items_affected": <number>, "expected_revenue_recovery_eur": <number>, "priority": "<high|medium|low>", "deadline": "<YYYY-MM-DD>" }
  ],
  "summary": {
    "total_items": <number>,
    "fresh_count": <number>,
    "aging_count": <number>,
    "stale_count": <number>,
    "critical_count": <number>,
    "dead_count": <number>,
    "total_current_value_eur": <number>,
    "total_initial_value_eur": <number>,
    "total_depreciation_loss_eur": <number>,
    "total_holding_cost_eur": <number>,
    "items_losing_money": <number>,
    "next_30d_projected_loss_eur": <number>,
    "aging_efficiency_score": <number 0-100>,
    "biggest_threat": "<max 100 znakov>",
    "quickest_action": "<max 100 znakov>"
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    // Generiraj depreciation curves za AI prikaz
    const curvesByCategory = new Map<string, any[]>();
    for (const item of items) {
      if (!curvesByCategory.has(item.category)) {
        curvesByCategory.set(item.category, calcDepreciationCurve(item.profile, item.initialValue, 365));
      }
    }

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 30)
        .map((it: any) => {
          const orig = items.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            title: orig?.title ?? '',
            category: orig?.category ?? '',
            agingPhase: ['fresh', 'normal', 'aging', 'stale', 'critical', 'dead', 'zombie'].includes(String(it?.aging_phase)) ? String(it.aging_phase) : 'normal',
            currentValueEur: Math.max(0, Math.round(Number(it?.current_value_eur ?? orig?.currentValue ?? 0))),
            projectedValue30dEur: Math.max(0, Math.round(Number(it?.projected_value_30d_eur ?? (orig?.currentValue ? orig.currentValue * 0.95 : 0)))),
            projectedValue90dEur: Math.max(0, Math.round(Number(it?.projected_value_90d_eur ?? (orig?.currentValue ? orig.currentValue * 0.85 : 0)))),
            recommendedAction: ['hold', 'list_again', 'price_drop_5', 'price_drop_10', 'bundle_offer', 'liquidate', 'write_off'].includes(String(it?.recommended_action)) ? String(it.recommended_action) : 'hold',
            recommendedPriceEur: Math.max(0, Math.round(Number(it?.recommended_price_eur ?? orig?.currentValue ?? 0))),
            urgencyScore: Math.max(0, Math.min(100, Number(it?.urgency_score ?? 50))),
            daysUntilLoss: it?.days_until_loss !== null && it?.days_until_loss !== undefined ? Math.max(0, Number(it.days_until_loss)) : orig?.sellByDeadlineDays ?? null,
            lossIfNoActionEur: Math.round(Number(it?.loss_if_no_action_eur ?? 0)),
            reasoning: String(it?.reasoning ?? '').slice(0, 250),
          };
        }),
      depreciationCurves: Array.from(curvesByCategory.entries()).map(([cat, curve]) => {
        const profile = DEPRECIATION_PROFILES[cat] ?? DEPRECIATION_PROFILES['drugo'];
        const aiCurve = (parsed?.depreciation_curves || []).find((c: any) => String(c?.category) === cat);
        return {
          category: cat,
          curveType: profile.curveType,
          annualDepreciationPct: profile.annualDepreciationPct,
          firstYearDropPct: profile.firstYearDropPct,
          floorValuePct: profile.floorValuePct,
          saturationAgeDays: profile.saturationAgeDays,
          description: String(aiCurve?.description ?? '').slice(0, 200),
          points: curve,
        };
      }),
      sellByDeadlines: (parsed?.sell_by_deadlines || [])
        .filter((d: any) => validIds.has(String(d?.trade_id ?? '')))
        .slice(0, 20)
        .map((d: any) => {
          const orig = items.find(x => x.id === String(d?.trade_id));
          return {
            tradeId: String(d?.trade_id ?? ''),
            title: String(d?.title ?? orig?.title ?? '').slice(0, 100),
            sellByDate: String(d?.sell_by_date ?? orig?.sellByDeadlineDate ?? '').slice(0, 20),
            daysRemaining: d?.days_remaining !== null && d?.days_remaining !== undefined ? Math.max(0, Number(d.days_remaining)) : orig?.sellByDeadlineDays ?? null,
            status: ['safe', 'warning', 'critical', 'overdue'].includes(String(d?.status)) ? String(d.status) : 'safe',
            currentLossEur: Math.round(Number(d?.current_loss_eur ?? 0)),
          };
        }),
      actions: (parsed?.actions || []).slice(0, 6).map((a: any) => ({
        action: String(a?.action ?? '').slice(0, 250),
        itemsAffected: Math.max(0, Number(a?.items_affected ?? 0)),
        expectedRevenueRecoveryEur: Math.round(Number(a?.expected_revenue_recovery_eur ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
        deadline: String(a?.deadline ?? '').slice(0, 20),
      })),
      summary: {
        totalItems: items.length,
        freshCount: Math.max(0, Number(parsed?.summary?.fresh_count ?? items.filter(i => i.daysHeld <= 7).length)),
        agingCount: Math.max(0, Number(parsed?.summary?.aging_count ?? items.filter(i => i.daysHeld > 30 && i.daysHeld <= 60).length)),
        staleCount: Math.max(0, Number(parsed?.summary?.stale_count ?? items.filter(i => i.daysHeld > 60 && i.daysHeld <= 90).length)),
        criticalCount: Math.max(0, Number(parsed?.summary?.critical_count ?? items.filter(i => i.daysHeld > 90 && i.daysHeld <= 180).length)),
        deadCount: Math.max(0, Number(parsed?.summary?.dead_count ?? items.filter(i => i.daysHeld > 180).length)),
        totalCurrentValueEur: Math.round(items.reduce((s, i) => s + i.currentValue, 0)),
        totalInitialValueEur: Math.round(items.reduce((s, i) => s + i.initialValue, 0)),
        totalDepreciationLossEur: Math.round(items.reduce((s, i) => s + (i.initialValue - i.currentValue), 0)),
        totalHoldingCostEur: Math.round(items.reduce((s, i) => s + i.totalHoldingCost, 0)),
        itemsLosingMoney: Math.max(0, Number(parsed?.summary?.items_losing_money ?? items.filter(i => i.currentValueVsCost < 0).length)),
        next30dProjectedLossEur: Math.round(Number(parsed?.summary?.next_30d_projected_loss_eur ?? 0)),
        agingEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aging_efficiency_score ?? 50))),
        biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 200),
        quickestAction: String(parsed?.summary?.quickest_action ?? '').slice(0, 200),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
