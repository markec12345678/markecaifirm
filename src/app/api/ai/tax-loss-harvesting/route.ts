// v6.15 / v8.96.2-batch1: AI Tax Loss Harvesting Optimizer — identificira izgube za davčno optimizacijo
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/tax-loss-harvesting
// Body: { year?: number }
// Returns: { ok, harvesting: { realizedGains, realizedLosses, netGain, taxableBase, taxSaved, candidates: [...] }, recommendations, taxStrategy }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface TaxLossHarvestingInput {
  year: number;
}

// Slovenian tax rules:
// - 5.000€ neoporečno dobička na leto (capital gains)
// - 40% dohodnina na dobiček nad 5.000€
// - Izgube se prenašajo do 3 let nazaj in naprej
// - 1/3 znižanja davka pri držanju >3 leta (za nekatera sredstva)
const TAX_FREE_ALLOWANCE = 5000;
const TAX_RATE = 0.40;
const LOSS_CARRYFORWARD_YEARS = 3;

export const POST = withAiRoute<TaxLossHarvestingInput>({
  endpoint: '/api/ai/tax-loss-harvesting',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { year: Number(body?.year) || new Date().getFullYear() };
  },

  // No validateInput — year ima default (trenutno leto)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { year } = input;

    // 1. Pridobi vse sold tradeove v izbranem letu
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    const soldThisYear = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { gte: yearStart, lte: yearEnd },
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
      },
    });

    // 2. Pridobi held trades — kandidati za harvesting (prodaj z izgubo)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    // 3. Pridobi sold trades iz prejšnjih let (za loss carryforward)
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - LOSS_CARRYFORWARD_YEARS);
    const priorYearsSold = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { gte: threeYearsAgo, lt: yearStart },
      },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, category: true },
    });

    // 4. Izračunaj realized gains/losses + carryforward
    const {
      realizedGains, realizedLosses, netGain, taxableBase, taxDue,
      priorYearsLosses, taxableBaseAfterCarryforward, taxDueAfterCarryforward, taxSavedByCarryforward,
    } = computeTaxSummary(soldThisYear, priorYearsSold);

    // 6. Kandidati za loss harvesting — held trades, ki bi z prodajo ustvarili izgubo
    const candidates = buildCandidates(heldTrades);

    // 7. AI analiza
    const prompt = buildPrompt({
      year, realizedGains, realizedLosses, netGain, taxableBase, taxDue,
      priorYearsLosses, taxDueAfterCarryforward, taxSavedByCarryforward,
      candidates,
    });
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const { recommendations, yearEndPlan, carryforwardAnalysis, warnings, taxStrategy } = transformTaxPlan(parsed, candidates, year, taxDue, taxableBase, priorYearsLosses);

    return apiOk({
      ok: true,
      harvesting: {
        year,
        realizedGains: Math.round(realizedGains),
        realizedLosses: Math.round(realizedLosses),
        netGain: Math.round(netGain),
        taxFreeAllowance: TAX_FREE_ALLOWANCE,
        taxableBase: Math.round(taxableBase),
        taxRate: TAX_RATE * 100,
        taxDue,
        priorYearsLosses: Math.round(priorYearsLosses),
        taxableBaseAfterCarryforward: Math.round(taxableBaseAfterCarryforward),
        taxDueAfterCarryforward,
        taxSavedByCarryforward,
        candidatesCount: candidates.length,
      },
      recommendations,
      yearEndPlan,
      carryforwardAnalysis,
      warnings,
      taxStrategy,
      candidates: candidates.slice(0, 20),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}

interface PriorSoldRow {
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  category: string | null;
}

interface TaxCandidate {
  id: string;
  title: string;
  category: string;
  cost: number;
  estimatedValue: number;
  projectedLoss: number;
  daysHeld: number;
  taxBenefit: number;
  daysHeldYears: number;
}

interface PromptData {
  year: number;
  realizedGains: number;
  realizedLosses: number;
  netGain: number;
  taxableBase: number;
  taxDue: number;
  priorYearsLosses: number;
  taxDueAfterCarryforward: number;
  taxSavedByCarryforward: number;
  candidates: TaxCandidate[];
}

function computeTaxSummary(soldThisYear: SoldTradeRow[], priorYearsSold: PriorSoldRow[]) {
  let realizedGains = 0;
  let realizedLosses = 0;
  for (const t of soldThisYear) {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    if (profit >= 0) {
      realizedGains += profit;
    } else {
      realizedLosses += Math.abs(profit);
    }
  }

  const netGain = realizedGains - realizedLosses;
  const taxableBase = Math.max(0, netGain - TAX_FREE_ALLOWANCE);
  const taxDue = Math.round(taxableBase * TAX_RATE);

  let priorYearsLosses = 0;
  for (const t of priorYearsSold) {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - cost;
    if (profit < 0) priorYearsLosses += Math.abs(profit);
  }
  const taxableBaseAfterCarryforward = Math.max(0, taxableBase - priorYearsLosses);
  const taxDueAfterCarryforward = Math.round(taxableBaseAfterCarryforward * TAX_RATE);
  const taxSavedByCarryforward = taxDue - taxDueAfterCarryforward;
  return {
    realizedGains, realizedLosses, netGain, taxableBase, taxDue,
    priorYearsLosses, taxableBaseAfterCarryforward, taxDueAfterCarryforward, taxSavedByCarryforward,
  };
}

function buildCandidates(heldTrades: HeldTradeRow[]): TaxCandidate[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 0.9);
    const projectedLoss = cost - estValue;
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    const taxBenefit = projectedLoss > 0 ? Math.round(projectedLoss * TAX_RATE) : 0;
    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost,
      estimatedValue: estValue,
      projectedLoss,
      daysHeld,
      taxBenefit,
      daysHeldYears: Math.round((daysHeld / 365) * 10) / 10,
    };
  }).filter(c => c.projectedLoss > 0)
    .sort((a, b) => b.taxBenefit - a.taxBenefit);
}

function buildPrompt(d: PromptData): string {
  const candidatesStr = d.candidates.slice(0, 20).map(c =>
    `- ${c.title} | ${c.category} | nabavna: ${c.cost}€ | est. prodajna: ${c.estimatedValue}€ | izguba: ${c.projectedLoss}€ | davčna korist: ${c.taxBenefit}€ | ${c.daysHeld}d v skladišču (${c.daysHeldYears} let)`
  ).join('\n');

  return `Si ekspert za davčno optimizacijo pri preprodaji v Sloveniji.
Analiziraj priložnosti za "tax loss harvesting" — prodaja izgubo donosnih itemov za zmanjšanje davka.

DAVČNO STANJE (leto ${d.year}):
- Realizirani dobički: ${d.realizedGains}€
- Realizirane izgube: ${d.realizedLosses}€
- Neto dobiček: ${d.netGain}€
- Neoporečni del: ${TAX_FREE_ALLOWANCE}€
- Obdavčljiva osnova: ${d.taxableBase}€
- Davk (40%): ${d.taxDue}€
- Izgube iz prejšnjih let (carryforward): ${d.priorYearsLosses}€
- Davk po odbitku carryforward: ${d.taxDueAfterCarryforward}€ (prihranek ${d.taxSavedByCarryforward}€)

KANDIDATI ZA LOSS HARVESTING (held trades z morebitno izgubo):
${candidatesStr || '- Ni kandidatov'}

Slovenski davčni zakon:
- Capital gains 40% nad 5.000€ neoporečnega
- Izgube lahko prenašaš do 3 let
- Holding period >3 leta: 1/3 znižanja davka (za nekatere)
- Year-end harvesting: prodaj izgube do 31. dec, da zmanjšaš letni davek

Strategije:
- "harvest_now": prodaj izgubo takoj (če davk > 0)
- "wait_year_end": počakaj do decembra za year-end harvesting
- "wait_3yr_holding": čakaj >3 leta za 1/3 znižanja
- "hold": obdrži — izguba premajhna ali bo prinesla dobiček kasneje
- "bundle_with_gain": bundle z dobičkonosnim itemom

Odgovori LE z JSON:
{
  "tax_strategy": "<splošna davčna strategija, max 200 znakov>",
  "recommendations": [
    {
      "trade_id": "<id>",
      "action": "<harvest_now|wait_year_end|wait_3yr_holding|hold|bundle_with_gain>",
      "tax_benefit_eur": <number>,
      "deadline": "<do kdaj, max 50 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "year_end_plan": {
    "should_harvest": <boolean>,
    "target_loss_eur": <number, koliko izgube naj realizira do konca leta>,
    "tax_savings_eur": <number>,
    "deadline": "<31.12.YYYY>",
    "steps": ["<korak, max 100 znakov>", "..."]
  },
  "carryforward_analysis": {
    "available_losses_eur": <number, izgube iz prejšnjih let>,
    " utilized_this_year_eur": <number>,
    "remaining_for_future_eur": <number>,
    "optimal_usage": "<max 150 znakov>"
  },
  "warnings": ["<davčno opozorilo, max 100 znakov>", "..."]
}`;
}

function transformTaxPlan(
  parsed: any,
  candidates: TaxCandidate[],
  year: number,
  taxDue: number,
  taxableBase: number,
  priorYearsLosses: number,
) {
  const validIds = new Set(candidates.map(c => c.id));

  const recommendations = (parsed?.recommendations || [])
    .filter((r: any) => validIds.has(String(r?.trade_id ?? '')))
    .map((r: any) => {
      const id = String(r.trade_id);
      const orig = candidates.find(c => c.id === id)!;
      return {
        tradeId: id,
        title: orig.title,
        category: orig.category,
        cost: orig.cost,
        estimatedValue: orig.estimatedValue,
        projectedLoss: orig.projectedLoss,
        daysHeld: orig.daysHeld,
        daysHeldYears: orig.daysHeldYears,
        action: ['harvest_now', 'wait_year_end', 'wait_3yr_holding', 'hold', 'bundle_with_gain'].includes(String(r?.action))
          ? String(r.action) : 'hold',
        taxBenefitEur: Math.max(0, Number(r?.tax_benefit_eur ?? orig.taxBenefit)),
        deadline: String(r?.deadline ?? '').slice(0, 80),
        reasoning: String(r?.reasoning ?? '').slice(0, 200),
      };
    });

  const yearEndPlan = {
    shouldHarvest: Boolean(parsed?.year_end_plan?.should_harvest ?? taxDue > 0),
    targetLossEur: Math.max(0, Number(parsed?.year_end_plan?.target_loss_eur ?? taxableBase)),
    taxSavingsEur: Math.max(0, Number(parsed?.year_end_plan?.tax_savings_eur ?? 0)),
    deadline: String(parsed?.year_end_plan?.deadline ?? `31.12.${year}`).slice(0, 30),
    steps: Array.isArray(parsed?.year_end_plan?.steps)
      ? parsed.year_end_plan.steps.slice(0, 6).map((s: any) => String(s).slice(0, 200))
      : [],
  };

  const carryforwardAnalysis = {
    availableLossesEur: Math.round(priorYearsLosses),
    utilizedThisYearEur: Math.round(Math.min(priorYearsLosses, taxableBase)),
    remainingForFutureEur: Math.round(Math.max(0, priorYearsLosses - taxableBase)),
    optimalUsage: String(parsed?.carryforward_analysis?.optimal_usage ?? '').slice(0, 300),
  };

  const warnings = (parsed?.warnings || []).slice(0, 5).map((w: any) => String(w).slice(0, 200));

  const taxStrategy = String(parsed?.tax_strategy ?? '').slice(0, 500);

  return { recommendations, yearEndPlan, carryforwardAnalysis, warnings, taxStrategy };
}
