// v6.34 / v8.95.6-profit: AI Profit Cascade Optimizer — kaskadno optimizira dobiček skozi celotno verigo
// Refaktoriran z withAiRoute helperjem (v8.95.6-profit) + enforceBudget guard.
//
// POST /api/ai/profit-cascade
// Body: {}
// Returns: { ok, cascade: { levels, optimizations, totalGain, waterfall } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitCascadeInput {}

export const POST = withAiRoute<ProfitCascadeInput>({
  endpoint: '/api/ai/profit-cascade',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {} as ProfitCascadeInput;
  },

  // No validateInput — brez polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 40,
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyLocation: true, sellLocation: true },
      take: 200,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, cascade: null, message: 'Ni podatkov za cascade analizo.' });
    }

    const currentProfit = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0), 0);
    const totalHeldValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    const prompt = buildPrompt(currentProfit, totalHeldValue, heldTrades.length, soldTrades.length);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const cascade = transformCascade(parsed, currentProfit);

    return apiOk({ ok: true, cascade });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

/**
 * Build AI prompt za profit cascade (besedilo IDENTIČNO originalu v6.34).
 */
function buildPrompt(
  currentProfit: number,
  totalHeldValue: number,
  heldCount: number,
  soldCount: number,
): string {
  return `Si ekspert za kaskadno optimizacijo dobička skozi celotno preprodajno verigo.
Analiziraj vsako stopnjo verige in identificiraj kumulativne izboljšave.

TRENUTNO STANJE:
- Realizirani dobiček: ${Math.round(currentProfit)}€
- Vezano v inventarju: ${Math.round(totalHeldValue)}€ (${heldCount} itemov)
- Prodaj: ${soldCount}

KASKADNE STOPINJE (vsaka stopnja vpliva na naslednjo):
1. SOURCING (kje kupovati): boljši vir = nižja nabavna cena → +5-15% dobička
2. NEGOTIATION (cena pri nakupu): -5-10% nabavne cene → +10-20% ROI
3. AI EVALUATION (boljše ocenjevanje): manj slabih nakupov → +5-10% uspešnost
4. HOLDING (optimalen čas držanja): manj holding cost → +3-8% dobička
5. PRICING (optimalna prodajna cena): +5-15% prodajne cene
6. PLATFORM (najboljša platforma): nižje pristojbine → +3-10% neto
7. BUNDLING (bundle strategija): +10-25% na bundle prodaji
8. TIMING (sezonski timing): +5-20% v sezonskem vrhu
9. REFURB (obnova pred prodajo): +15-40% vrednosti za ustrezne iteme
10. REINVESTMENT (pametno reinvestiranje): +10-30% sestavljeni dobiček

Za vsako stopnjo:
1. Trenutna učinkovitost (0-100%)
2. Optimizacijski potencial (€)
3. Konkretna akcija
4. Kumulativni vpliv na dobiček

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "levels": [
    {
      "level": <number 1-10>,
      "name": "<ime stopnje>",
      "current_efficiency_pct": <number 0-100>,
      "current_contribution_eur": <number>,
      "optimized_contribution_eur": <number>,
      "gain_eur": <number>,
      "gain_pct": <number>,
      "action": "<max 120 znakov>",
      "tool": "<kateri AI modul uporabiti, max 50 znakov>",
      "difficulty": "<easy|medium|hard>",
      "priority": "<high|medium|low>"
    }
  ],
  "waterfall": [
    { "step": "<ime>", "current_eur": <number>, "optimized_eur": <number>, "cumulative_eur": <number> }
  ],
  "cumulative_gain": {
    "current_total_profit_eur": <number>,
    "optimized_total_profit_eur": <number>,
    "total_gain_eur": <number>,
    "total_gain_pct": <number>
  },
  "quick_wins": [
    { "action": "<max 100 znakov>", "gain_eur": <number>, "effort": "<low|medium|high>", "timeline_days": <number> }
  ],
  "summary": {
    "overall_efficiency_pct": <number>,
    "biggest_opportunity": "<ime stopnje>",
    "total_optimization_potential_eur": <number>,
    "projected_roi_improvement_pct": <number>
  }
}`;
}

/**
 * Transform AI JSON v cascade rezultat. Clamp/slice logika IDENTIČNA originalu v6.34.
 */
function transformCascade(parsed: any, currentProfit: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    levels: (parsed?.levels || []).slice(0, 10).map((l: any) => ({
      level: Math.max(1, Math.min(10, Number(l?.level ?? 1))),
      name: String(l?.name ?? '').slice(0, 80),
      currentEfficiencyPct: Math.max(0, Math.min(100, Number(l?.current_efficiency_pct ?? 50))),
      currentContributionEur: Math.round(Number(l?.current_contribution_eur ?? 0)),
      optimizedContributionEur: Math.round(Number(l?.optimized_contribution_eur ?? 0)),
      gainEur: Math.round(Number(l?.gain_eur ?? 0)),
      gainPct: Math.round(Number(l?.gain_pct ?? 0)),
      action: String(l?.action ?? '').slice(0, 250),
      tool: String(l?.tool ?? '').slice(0, 80),
      difficulty: includes(DIFFICULTIES, String(l?.difficulty)) ? String(l.difficulty) : 'medium',
      priority: includes(PRIORITIES, String(l?.priority)) ? String(l.priority) : 'medium',
    })),
    waterfall: (parsed?.waterfall || []).slice(0, 10).map((w: any) => ({
      step: String(w?.step ?? '').slice(0, 80),
      currentEur: Math.round(Number(w?.current_eur ?? 0)),
      optimizedEur: Math.round(Number(w?.optimized_eur ?? 0)),
      cumulativeEur: Math.round(Number(w?.cumulative_eur ?? 0)),
    })),
    cumulativeGain: {
      currentTotalProfitEur: Math.round(Number(parsed?.cumulative_gain?.current_total_profit_eur ?? currentProfit)),
      optimizedTotalProfitEur: Math.round(Number(parsed?.cumulative_gain?.optimized_total_profit_eur ?? 0)),
      totalGainEur: Math.round(Number(parsed?.cumulative_gain?.total_gain_eur ?? 0)),
      totalGainPct: Math.round(Number(parsed?.cumulative_gain?.total_gain_pct ?? 0)),
    },
    quickWins: (parsed?.quick_wins || []).slice(0, 5).map((q: any) => ({
      action: String(q?.action ?? '').slice(0, 200),
      gainEur: Math.round(Number(q?.gain_eur ?? 0)),
      effort: includes(EFFORTS, String(q?.effort)) ? String(q.effort) : 'medium',
      timelineDays: Math.max(0, Number(q?.timeline_days ?? 7)),
    })),
    summary: {
      overallEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_efficiency_pct ?? 50))),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 80),
      totalOptimizationPotentialEur: Math.round(Number(parsed?.summary?.total_optimization_potential_eur ?? 0)),
      projectedRoiImprovementPct: Math.round(Number(parsed?.summary?.projected_roi_improvement_pct ?? 0)),
    },
  };
}
