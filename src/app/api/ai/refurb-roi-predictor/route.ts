// v6.28 / v8.95.8-refactor: AI Refurbishment ROI Predictor z vizualno analizo — napove ROI obnove z analizo slike
// POST /api/ai/refurb-roi-predictor
// Body: { listingId?: string, tradeId?: string, plannedImprovements?: string[] }
// Returns: { ok, prediction: { viable, totalCost, projectedRevenue, roiPct, timeline, riskLevel, improvements: [], visualAssessment } }
// Refaktoriran z withAiRoute helperjem (v8.95.8) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
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

interface RefurbRoiPredictorInput {
  listingId?: string;
  tradeId?: string;
  plannedImprovements: string[];
}

export const POST = withAiRoute<RefurbRoiPredictorInput>({
  endpoint: '/api/ai/refurb-roi-predictor',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      listingId: body?.listingId ? String(body.listingId) : undefined,
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      plannedImprovements: Array.isArray(body?.plannedImprovements) ? body.plannedImprovements : [],
    };
  },

  validateInput: (input) =>
    (input.tradeId || input.listingId) ? null : 'listingId ali tradeId je obvezen',

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { listingId, tradeId, plannedImprovements } = input;

    let title = '', buyPrice = 0, description = '', imageUrl = '', category = '';
    if (tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: tradeId },
        select: { title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true } } },
      });
      if (!trade) throw new ApiRouteError('Trade ne obstaja', 404);
      title = trade.title; category = trade.category || ''; buyPrice = trade.buyPrice;
      description = trade.listing?.detailDescription || trade.listing?.description || '';
      imageUrl = trade.listing?.imageUrl || '';
    } else if (listingId) {
      const listing = await db.listing.findUnique({
        where: { id: listingId },
        select: { title: true, description: true, detailDescription: true, imageUrl: true, price: true,
          monitor: { select: { source: true } } },
      });
      if (!listing) throw new ApiRouteError('Listing ne obstaja', 404);
      title = listing.title; buyPrice = listing.price ?? 0;
      description = listing.detailDescription || listing.description; imageUrl = listing.imageUrl || '';
    } else {
      return apiBadRequest('listingId ali tradeId je obvezen');
    }

    // Pridobi sliko za vizualno analizo
    let imageBase64: string | null = null;
    if (imageUrl) {
      try {
        const { downloadImageAsBase64 } = await import('@/lib/ai');
        imageBase64 = await downloadImageAsBase64(imageUrl);
      } catch { /* ignore */ }
    }

    const prompt = buildPrompt({
      title, category, buyPrice, description,
      hasImage: !!imageBase64,
      plannedImprovements,
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const prediction = transformPrediction(parsed, buyPrice);

    return apiOk({ ok: true, prediction, hasImage: !!imageBase64, buyPrice });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PromptData {
  title: string;
  category: string;
  buyPrice: number;
  description: string;
  hasImage: boolean;
  plannedImprovements: string[];
}

function buildPrompt(d: PromptData): string {
  const improvementsStr = Object.entries(IMPROVEMENT_COSTS)
    .map(([k, v]) => `- ${k}: ${v.low}-${v.high}€, ${v.timeHours}h, ${v.skillLevel}`)
    .join('\n');

  return `Si ekspert za vrednotenje obnov (refurbishment) in ROI kalkulacije.
Analiziraj item in napovej ROI obnove z vizualno analizo slike.

NASLOV: ${d.title}
KATEGORIJA: ${d.category}
NABAVNA CENA: ${d.buyPrice}€
OPIS: ${d.description.slice(0, 600)}
${d.hasImage ? 'SLIKA: pridobljena za vizualno analizo' : 'SLIKA: ni na voljo'}
${d.plannedImprovements.length > 0 ? `\nNAČRTOVANE IZBOLJŠAVE: ${d.plannedImprovements.join(', ')}` : ''}

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
}

function transformPrediction(parsed: any, buyPrice: number): {
  viable: boolean;
  visualAssessment: string;
  improvements: any[];
  totalImprovementCostEur: number;
  totalCostEur: number;
  projectedRevenueEur: number;
  projectedProfitEur: number;
  roiPct: number;
  totalTimeHours: number;
  totalTimeDays: number;
  riskLevel: string;
  skillsRequired: string[];
  toolsNeeded: string[];
  marketDemandAfterRefurb: string;
  expectedSellTimeDays: number;
  recommendation: string;
  reasoning: string;
} {
  return {
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
}
