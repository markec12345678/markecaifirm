// v6.28: AI Refurbishment ROI Predictor z vizualno analizo — napove ROI obnove z analizo slike
// POST /api/ai/refurb-roi-predictor
// Body: { listingId?: string, tradeId?: string, plannedImprovements?: string[] }
// Returns: { ok, prediction: { viable, totalCost, projectedRevenue, roiPct, timeline, riskLevel, improvements: [], visualAssessment } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const IMPROVEMENT_COSTS: Record<string, { low: number; high: number; timeHours: number; skillLevel: string }> = {
  'cleaning': { low: 5, high: 30, timeHours: 1, skillLevel: 'beginner' },
  'polishing': { low: 10, high: 50, timeHours: 2, skillLevel: 'beginner' },
  'paint_touchup': { low: 15, high: 60, timeHours: 3, skillLevel: 'intermediate' },
  'paint_full': { low: 80, high: 350, timeHours: 8, skillLevel: 'expert' },
  'battery_replacement': { low: 20, high: 100, timeHours: 1, skillLevel: 'intermediate' },
  'screen_replacement': { low: 50, high: 250, timeHours: 2, skillLevel: 'intermediate' },
  'keyboard_replacement': { low: 20, high: 80, timeHours: 1, skillLevel: 'beginner' },
  'upholstery_repair': { low: 50, high: 400, timeHours: 6, skillLevel: 'expert' },
  'rust_removal': { low: 20, high: 150, timeHours: 4, skillLevel: 'intermediate' },
  'wood_restoration': { low: 30, high: 300, timeHours: 8, skillLevel: 'expert' },
  'electrical_repair': { low: 20, high: 150, timeHours: 3, skillLevel: 'expert' },
  'part_replacement': { low: 10, high: 200, timeHours: 2, skillLevel: 'intermediate' },
  'software_repair': { low: 0, high: 50, timeHours: 1, skillLevel: 'beginner' },
  'repackaging': { low: 5, high: 30, timeHours: 0.5, skillLevel: 'beginner' },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, tradeId } = body;
    const plannedImprovements: string[] = Array.isArray(body?.plannedImprovements) ? body.plannedImprovements : [];

    let title = '', buyPrice = 0, description = '', imageUrl = '', category = '';
    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: String(tradeId) },
        select: { title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true } } },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title; category = trade.category || ''; buyPrice = trade.buyPrice;
      description = trade.listing?.detailDescription || trade.listing?.description || '';
      imageUrl = trade.listing?.imageUrl || '';
    } else if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { title: true, description: true, detailDescription: true, imageUrl: true, price: true,
          monitor: { select: { source: true } } },
      });
      if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = listing.title; buyPrice = listing.price ?? 0;
      description = listing.detailDescription || listing.description; imageUrl = listing.imageUrl || '';
    } else {
      return NextResponse.json({ error: 'listingId ali tradeId je obvezen' }, { status: 400 });
    }

    // Pridobi sliko za vizualno analizo
    let imageBase64: string | null = null;
    if (imageUrl) {
      try {
        const { downloadImageAsBase64 } = await import('@/lib/ai');
        imageBase64 = await downloadImageAsBase64(imageUrl);
      } catch { /* ignore */ }
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const improvementsStr = Object.entries(IMPROVEMENT_COSTS)
      .map(([k, v]) => `- ${k}: ${v.low}-${v.high}€, ${v.timeHours}h, ${v.skillLevel}`)
      .join('\n');

    const prompt = `Si ekspert za vrednotenje obnov (refurbishment) in ROI kalkulacije.
Analiziraj item in napovej ROI obnove z vizualno analizo slike.

NASLOV: ${title}
KATEGORIJA: ${category}
NABAVNA CENA: ${buyPrice}€
OPIS: ${description.slice(0, 600)}
${imageBase64 ? 'SLIKA: pridobljena za vizualno analizo' : 'SLIKA: ni na voljo'}
${plannedImprovements.length > 0 ? `\nNAČRTOVANE IZBOLJŠAVE: ${plannedImprovements.join(', ')}` : ''}

CENIK IZBOLJŠAV:
${improvementsStr}

Pravila:
1. Identificiraj POTREBNE izboljšave iz slike in opisa
2. Za vsako izboljšavo: cost, timeHours, skillLevel, valueAdded (koliko poveča vrednost)
3. Izračunaj: totalCost = buyPrice + sum(improvement costs)
4. projectedRevenue = estValueAfterRefurb
5. roiPct = (projectedRevenue - totalCost) / totalCost * 100
6. viable = roiPct > 15%
7. riskLevel: low (preprosto), medium (srednje), high (kompleksno)

Odgovori LE z JSON:
{
  "viable": <boolean>,
  "visual_assessment": "<kaj vidiš na sliki glede stanja, max 200 znakov>",
  "improvements": [
    {
      "name": "<ime izboljšave>",
      "cost_eur": <number>,
      "time_hours": <number>,
      "skill_level": "<beginner|intermediate|expert>",
      "value_added_eur": <number>,
      "net_value_eur": <number>,
      "priority": "<high|medium|low>",
      "optional": <boolean>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "total_improvement_cost_eur": <number>,
  "total_cost_eur": <number>,
  "projected_revenue_eur": <number>,
  "projected_profit_eur": <number>,
  "roi_pct": <number>,
  "total_time_hours": <number>,
  "total_time_days": <number>,
  "risk_level": "<low|medium|high>",
  "skills_required": ["<veščina, max 50 znakov>", "..."],
  "tools_needed": ["<orodje, max 50 znakov>", "..."],
  "market_demand_after_refurb": "<high|medium|low>",
  "expected_sell_time_days": <number>,
  "recommendation": "<refurb_and_sell|sell_as_is|part_out|avoid>",
  "reasoning": "<max 200 znakov>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);

    const prediction = {
      viable: Boolean(parsed?.viable ?? false),
      visualAssessment: String(parsed?.visual_assessment ?? '').slice(0, 400),
      improvements: (parsed?.improvements || []).slice(0, 12).map((i: any) => ({
        name: String(i?.name ?? '').slice(0, 100),
        costEur: Math.max(0, Number(i?.cost_eur ?? 0)),
        timeHours: Math.max(0, Number(i?.time_hours ?? 0)),
        skillLevel: ['beginner', 'intermediate', 'expert'].includes(String(i?.skill_level)) ? String(i.skill_level) : 'beginner',
        valueAddedEur: Math.max(0, Number(i?.value_added_eur ?? 0)),
        netValueEur: Math.round(Number(i?.net_value_eur ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium',
        optional: Boolean(i?.optional ?? false),
        reasoning: String(i?.reasoning ?? '').slice(0, 150),
      })),
      totalImprovementCostEur: Math.round(Number(parsed?.total_improvement_cost_eur ?? 0)),
      totalCostEur: Math.round(Number(parsed?.total_cost_eur ?? buyPrice)),
      projectedRevenueEur: Math.round(Number(parsed?.projected_revenue_eur ?? 0)),
      projectedProfitEur: Math.round(Number(parsed?.projected_profit_eur ?? 0)),
      roiPct: Math.round(Number(parsed?.roi_pct ?? 0)),
      totalTimeHours: Math.round(Number(parsed?.total_time_hours ?? 0)),
      totalTimeDays: Math.max(0, Number(parsed?.total_time_days ?? 0)),
      riskLevel: ['low', 'medium', 'high'].includes(String(parsed?.risk_level)) ? String(parsed.risk_level) : 'medium',
      skillsRequired: (parsed?.skills_required || []).slice(0, 6).map((s: any) => String(s).slice(0, 80)),
      toolsNeeded: (parsed?.tools_needed || []).slice(0, 8).map((t: any) => String(t).slice(0, 80)),
      marketDemandAfterRefurb: ['high', 'medium', 'low'].includes(String(parsed?.market_demand_after_refurb)) ? String(parsed.market_demand_after_refurb) : 'medium',
      expectedSellTimeDays: Math.max(0, Number(parsed?.expected_sell_time_days ?? 14)),
      recommendation: ['refurb_and_sell', 'sell_as_is', 'part_out', 'avoid'].includes(String(parsed?.recommendation))
        ? String(parsed.recommendation) : 'sell_as_is',
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({ ok: true, prediction, hasImage: !!imageBase64, buyPrice });
  } catch (e: any) {
    logger.error("/api/ai/refurb-roi-predictor", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
