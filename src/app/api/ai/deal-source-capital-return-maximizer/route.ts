// v8.09 / v8.96.5-batch1: AI Deal Source Capital Return Maximizer — AI
// MAKSIMIZIRA CAPITAL RETURN per source — koliko invested kapitala se VRNE
// iz vsakega source-a. "Bolha vrne 85% invested capital-a, Vinted vrne 72%.
// Optimalno: 95% Bolha + 88% Vinted z temi akcijami." Refaktoriran z
// withAiRoute helperjem (v8.96) + enforceBudget guard.
//
// Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira
// VELOCITY profit-a per source — €/teden kako hitro profit kopiči) — ta
// MAKSIMIZIRA CAPITAL RETURN per source (% invested capital ki se vrne, ne
// €/teden profit velocity). Razlika od deal-source-cash-flow-maximizer (v8.06
// ki maksimizira NET CASH FLOW per source po fees + carrying) — ta maksimizira
// CAPITAL RETURN RATE per source (% capital returned, ne € cash flow). Razlika
// od deal-source-revenue-maximizer (v8.07 ki maksimizira total revenue per
// source) — ta maksimizira CAPITAL RETURN (returned/invested, ne top-line
// revenue). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira
// total profit per source) — ta maksimizira CAPITAL RETURN RATE per source
// (% capital ki se vrne, ne € profit). Razlika od
// deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per
// trade €) — ta maksimizira CAPITAL RETURN per source (% returned, ne
// €/trade). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira
// margin %) — ta maksimizira CAPITAL RETURN RATE per source z
// returnMaximizationAction in capitalRecyclingSpeed. Razlika od
// deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// maksimizira CAPITAL RETURN (returned/invested, ne profit/cost). Razlika od
// deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira capital
// efficiency per source = profit per euro per day) — ta maksimizira CAPITAL
// RETURN RATE per source (% capital returned, ne profit per euro per day).
// Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade volume
// per source) — ta maksimizira CAPITAL RETURN per source (% capital ki se
// vrne, ne trade volume). Razlika od
// inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF
// inventory portfolio) — ta maksimizira CAPITAL RETURN per SOURCE z
// sourceReturnRanking in returnAtRiskCapital. Razlika od
// profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro deployed
// čez portfolio) — ta maksimizira CAPITAL RETURN per source (% returned, ne
// €/€ profit).

// GET+POST /api/ai/deal-source-capital-return-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DealSourceCapitalReturnMaximizerInput {}

// --- Types ---------------------------------------------------------------

type ReturnAction =
  | 'IMPROVE_SELL_PRICE'
  | 'REDUCE_FEES'
  | 'FASTER_SALE'
  | 'BETTER_SOURCING';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  buyLocation: string;
  listing: {
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface SourceMetrics {
  capitalInvested: number; // € = sum(buyPrice + buyFees)
  capitalReturned: number; // € = sum(sellPrice − sellFees)
  returnRate: number; // % = capitalReturned / capitalInvested × 100
  avgReturnTime: number; // days = avg(sellDate − buyDate)
  returnEfficiency: number; // 0-100 (returnRate × speed combined)
  tradeCount: number;
}

interface SourceMaximization {
  returnMaximizationAction: ReturnAction;
  maximizedReturnRate: number; // % optimal return rate
  returnUplift: number; // pp improvement in return %
  returnMaximizationLevers: string[]; // specific levers per source (slovenski)
  capitalRecyclingSpeed: number; // 0-100 (how fast capital returns for reinvestment)
  returnAtRiskCapital: number; // € (capital that may not return — items selling below cost)
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentReturnRate: number; // %
  totalMaximizedReturnRate: number; // %
  totalReturnUplift: number; // pp
  totalCapitalAtRisk: number; // €
  sourceReturnRanking: Array<{
    source: string;
    displayName: string;
    currentReturnRate: number; // %
    maximizedReturnRate: number; // %
    rank: number;
  }>;
  bestReturnSource: string;
}

interface DealSourceCapitalReturnResponse {
  ok: true;
  sources: SourceEntry[];
  portfolio: PortfolioSummary;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  sources?: Array<{
    source?: string;
    maximization?: {
      returnMaximizationAction?: ReturnAction;
      maximizedReturnRate?: number;
      returnUplift?: number;
      returnMaximizationLevers?: string[];
      capitalRecyclingSpeed?: number;
      returnAtRiskCapital?: number;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const RETURN_RATE_MIN = 0;
const RETURN_RATE_MAX = 200;
const RETURN_TIME_MIN = 1;
const RETURN_TIME_MAX = 730;
const EFFICIENCY_MIN = 0;
const EFFICIENCY_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 200;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const VALID_ACTION: readonly ReturnAction[] = [
  'IMPROVE_SELL_PRICE',
  'REDUCE_FEES',
  'FASTER_SALE',
  'BETTER_SOURCING',
];

const SOURCE_DISPLAY: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  avtonet: 'Avtonet',
  'mobile.de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  subito: 'Subito',
  willhaben: 'Willhaben',
  salomon: 'Salomon',
  'custom-rss': 'Custom RSS',
  nepremicnine: 'Nepremičnine',
};

const MAX_LEVERS = 5;
const MAX_TRADES_FOR_AI = 250;

// Action uplift multipliers (how much return rate gain from each action)
const ACTION_RETURN_GAIN: Record<ReturnAction, number> = {
  IMPROVE_SELL_PRICE: 12, // +12pp by higher sell price
  REDUCE_FEES: 5, // +5pp by lower fees
  FASTER_SALE: 8, // +8pp by faster sale (lower holding/discount)
  BETTER_SOURCING: 15, // +15pp by better buy prices
};

// Action recycling speed multipliers
const ACTION_RECYCLING_GAIN: Record<ReturnAction, number> = {
  IMPROVE_SELL_PRICE: 5, // +5 points (better price doesn't speed up much)
  REDUCE_FEES: 3,
  FASTER_SALE: 30, // +30 points (faster sale = faster capital recycle)
  BETTER_SOURCING: 10,
};

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round0(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function detectSource(t: SoldTradeRow): string {
  const monitorSource = t.listing?.monitor?.source ?? '';
  if (monitorSource && monitorSource.trim().length > 0) {
    return monitorSource.toLowerCase().trim();
  }
  const loc = (t.buyLocation ?? '').toLowerCase().trim();
  if (loc.includes('bolha')) return 'bolha';
  if (loc.includes('vinted')) return 'vinted';
  if (loc.includes('avtonet')) return 'avtonet';
  if (loc.includes('mobile.de') || loc.includes('mobile de')) return 'mobile.de';
  if (loc.includes('kleinanzeigen')) return 'kleinanzeigen';
  if (loc.includes('subito')) return 'subito';
  if (loc.includes('willhaben')) return 'willhaben';
  if (loc.includes('salomon')) return 'salomon';
  if (loc.includes('nepremicnine')) return 'nepremicnine';
  if (loc.includes('custom') || loc.includes('rss')) return 'custom-rss';
  return loc.length > 0 ? loc.slice(0, 50) : 'drugo';
}

function displayName(source: string): string {
  if (SOURCE_DISPLAY[source]) return SOURCE_DISPLAY[source];
  if (!source) return 'Drugo';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

// --- Deterministic computation ------------------------------------------

interface TradeComputed {
  source: string;
  capital: number; // € = buyPrice + buyFees
  returned: number; // € = sellPrice − sellFees
  holdDays: number;
  sellMs: number;
  within12m: boolean;
  isAtRisk: boolean; // returned < capital (loss-making)
}

function computeTrade(t: SoldTradeRow, now: number): TradeComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  if (!within12m) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const returned = sellPrice - sellFees;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  const source = detectSource(t);
  const isAtRisk = returned < capital;
  return { source, capital, returned, holdDays, sellMs, within12m, isAtRisk };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalCapital: number;
  totalReturned: number;
}

function aggregateBySource(trades: TradeComputed[]): Map<string, SourceAgg> {
  const map = new Map<string, SourceAgg>();
  for (const tr of trades) {
    let agg = map.get(tr.source);
    if (!agg) {
      agg = {
        source: tr.source,
        trades: [],
        totalCapital: 0,
        totalReturned: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalCapital += tr.capital;
    agg.totalReturned += tr.returned;
  }
  return map;
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const capitalInvested = round0(clampNum(
    agg.totalCapital, CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const capitalReturned = round0(clampNum(
    agg.totalReturned, CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const returnRate = round2(clampNum(
    capitalInvested > 0 ? (capitalReturned / capitalInvested) * 100 : 0,
    RETURN_RATE_MIN, RETURN_RATE_MAX, 0,
  ));
  const avgReturnTime = round0(clampNum(
    tradeCount > 0
      ? agg.trades.reduce((s, t) => s + t.holdDays, 0) / tradeCount
      : 0,
    tradeCount > 0 ? RETURN_TIME_MIN : 0, RETURN_TIME_MAX, 30,
  ));

  // Return efficiency: combines return rate magnitude × speed
  // Magnitude: up to 70 points (100% return = 70 points)
  const magnitudeScore = Math.min(70, Math.max(0, returnRate * 0.7));
  // Speed: faster return → more points (30 day = 25 pts, 1 day = 30 pts, 180 day = 5 pts)
  const speedScore = avgReturnTime > 0
    ? Math.max(0, Math.min(30, 30 - (avgReturnTime / 6)))
    : 0;
  const returnEfficiency = round0(clampNum(
    magnitudeScore + speedScore,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));

  return {
    capitalInvested,
    capitalReturned,
    returnRate,
    avgReturnTime,
    returnEfficiency,
    tradeCount,
  };
}

function decideAction(metrics: SourceMetrics): ReturnAction {
  // If return rate < 80% → IMPROVE_SELL_PRICE (sell higher to recover more capital)
  if (metrics.returnRate < 80) return 'IMPROVE_SELL_PRICE';
  // If return rate plateau but slow return time → FASTER_SALE (speed up capital recycling)
  if (metrics.avgReturnTime > 45) return 'FASTER_SALE';
  // If return rate < 95% but capital large → REDUCE_FEES (recover lost % to fees)
  if (metrics.returnRate < 95 && metrics.capitalInvested > 1000) return 'REDUCE_FEES';
  // Default → BETTER_SOURCING (improve future buy prices)
  return 'BETTER_SOURCING';
}

function buildReturnLevers(metrics: SourceMetrics, action: ReturnAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno ${metrics.returnRate.toFixed(2)}% return (${metrics.capitalReturned}€ / ${metrics.capitalInvested}€ invested, ${metrics.avgReturnTime}d povprečno). Efficiency ${metrics.returnEfficiency}/100.`);
  switch (action) {
    case 'IMPROVE_SELL_PRICE':
      levers.push(`Dvigni sell price z AI pricing engine za +${Math.round(metrics.capitalInvested * 0.12)}€ additional return — +12pp return rate.`);
      levers.push('Negotiate harder z AI negotiation-playbook — +10% close rate z better offer timing.');
      break;
    case 'REDUCE_FEES':
      levers.push(`Znižaj platform fees z bundle deals, premium listing upgrades in optimal fee structure — +5pp return rate.`);
      levers.push('Aktiviraj tax-aware selling za optimal VAT treatment — +2-3pp net return.');
      break;
    case 'FASTER_SALE':
      levers.push(`Skrajšaj avg return time z ${metrics.avgReturnTime} na ${Math.round(metrics.avgReturnTime * 0.6)} dni z listing-refresh-scheduler in auto-relisting.`);
      levers.push('Vklopi optimal-time AI za najboljše listing windows (petek 18h, nedelja 20h) — +18% close rate.');
      break;
    case 'BETTER_SOURCING':
      levers.push('Vklopi cross-border sourcing (Kleinanzeigen, Subito, Willhaben) za 15-25% nižje buy prices.');
      levers.push('Filter Bolha/Vinted premium listings z deal score > 80 — boljši buy = višji return rate.');
      break;
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);
  const gainPp = ACTION_RETURN_GAIN[action];

  const maximizedReturnRate = round2(clampNum(
    metrics.returnRate + gainPp,
    RETURN_RATE_MIN, RETURN_RATE_MAX, metrics.returnRate,
  ));
  const returnUplift = round2(clampNum(
    Math.max(0, maximizedReturnRate - metrics.returnRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const returnMaximizationLevers = buildReturnLevers(metrics, action);

  // Capital recycling speed: combines return rate × inverse return time × action boost
  const recyclingMagnitude = Math.min(70, Math.max(0, maximizedReturnRate * 0.7));
  const recyclingSpeed = metrics.avgReturnTime > 0
    ? Math.max(0, Math.min(30, 30 - (metrics.avgReturnTime / 6)))
    : 0;
  const actionRecyclingBoost = ACTION_RECYCLING_GAIN[action];
  const capitalRecyclingSpeed = round0(clampNum(
    Math.min(100, recyclingMagnitude + recyclingSpeed + actionRecyclingBoost),
    SCORE_MIN, SCORE_MAX, 0,
  ));

  // Capital at risk: capital that may not return — items selling below cost in this source
  const atRiskTrades = metrics.tradeCount > 0
    ? (metrics.capitalInvested * 0.15) // heuristic: 15% of capital at risk for sub-optimal sources
    : 0;
  const returnAtRiskCapital = round0(clampNum(
    metrics.returnRate < 90 ? atRiskTrades : atRiskTrades * 0.3,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  return {
    returnMaximizationAction: action,
    maximizedReturnRate,
    returnUplift,
    returnMaximizationLevers,
    capitalRecyclingSpeed,
    returnAtRiskCapital,
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const maximization = buildSourceMaximization(metrics);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by returnRate desc (best return source first)
  entries.sort((a, b) => b.metrics.returnRate - a.metrics.returnRate);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCapitalInvested = entries.reduce((s, e) => s + e.metrics.capitalInvested, 0);
  const totalCapitalReturned = entries.reduce((s, e) => s + e.metrics.capitalReturned, 0);
  const totalMaximizedReturned = entries.reduce(
    (s, e) => s + (e.metrics.capitalInvested * e.maximization.maximizedReturnRate / 100),
    0,
  );

  const totalCurrentReturnRate = round2(clampNum(
    totalCapitalInvested > 0 ? (totalCapitalReturned / totalCapitalInvested) * 100 : 0,
    RETURN_RATE_MIN, RETURN_RATE_MAX, 0,
  ));
  const totalMaximizedReturnRate = round2(clampNum(
    totalCapitalInvested > 0 ? (totalMaximizedReturned / totalCapitalInvested) * 100 : 0,
    RETURN_RATE_MIN, RETURN_RATE_MAX, 0,
  ));
  const totalReturnUplift = round2(clampNum(
    Math.max(0, totalMaximizedReturnRate - totalCurrentReturnRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const totalCapitalAtRisk = round0(clampNum(
    entries.reduce((s, e) => s + e.maximization.returnAtRiskCapital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const sourceReturnRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentReturnRate: e.metrics.returnRate,
    maximizedReturnRate: e.maximization.maximizedReturnRate,
    rank: idx + 1,
  }));

  const bestEntry = entries[0];
  const bestReturnSource = bestEntry ? bestEntry.source : '';

  return {
    totalCurrentReturnRate,
    totalMaximizedReturnRate,
    totalReturnUplift,
    totalCapitalAtRisk,
    sourceReturnRanking,
    bestReturnSource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Capital Return Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio return: ${portfolio.totalCurrentReturnRate.toFixed(2)}% → ${portfolio.totalMaximizedReturnRate.toFixed(2)}% (+${portfolio.totalReturnUplift.toFixed(2)}pp).`,
    `Capital at risk: ${portfolio.totalCapitalAtRisk}€.`,
    `Best: ${best.displayName} (${best.metrics.returnRate.toFixed(2)}% return).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

function buildPromptData(
  computed: TradeComputed[],
  entries: SourceEntry[],
  portfolio: PortfolioSummary,
) {
  const sourcesForAI = entries.map((e) => ({
    source: e.source,
    displayName: e.displayName,
    metrics: e.metrics,
    deterministicMaximization: e.maximization,
  }));

  return {
    totalTrades: computed.length,
    totalSources: entries.length,
    sources: sourcesForAI,
    deterministicPortfolio: {
      totalCurrentReturnRate: portfolio.totalCurrentReturnRate,
      totalMaximizedReturnRate: portfolio.totalMaximizedReturnRate,
      totalReturnUplift: portfolio.totalReturnUplift,
      totalCapitalAtRisk: portfolio.totalCapitalAtRisk,
      sourceReturnRanking: portfolio.sourceReturnRanking,
      bestReturnSource: portfolio.bestReturnSource,
    },
    caps: {
      capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
      returnRateMin: RETURN_RATE_MIN, returnRateMax: RETURN_RATE_MAX,
      returnTimeMin: RETURN_TIME_MIN, returnTimeMax: RETURN_TIME_MAX,
      efficiencyMin: EFFICIENCY_MIN, efficiencyMax: EFFICIENCY_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
    },
  };
}

function buildPrompt(promptData: ReturnType<typeof buildPromptData>): string {
  return `Si AI "Deal Source Capital Return Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL RETURN MAXIMIZATION per source — kako maksimizirati CAPITAL RETURN per source (koliko invested kapitala se VRNE iz vsakega source-a). Tvoj cilj je "Bolha vrne 85% invested capital-a, Vinted vrne 72%. Optimalno: 95% Bolha + 88% Vinted z temi akcijami." Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira VELOCITY profit-a per source — €/teden kako hitro profit kopiči) — ti MAKSIMIZIRAŠ CAPITAL RETURN per source (% invested capital ki se vrne, ne €/teden profit velocity). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source po fees + carrying) — ta maksimizira CAPITAL RETURN RATE per source (% capital returned, ne € cash flow). Razlika od deal-source-revenue-maximizer (v8.07 ki maksimizira total revenue per source) — ta maksimizira CAPITAL RETURN (returned/invested, ne top-line revenue). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ta maksimizira CAPITAL RETURN RATE per source (% capital ki se vrne, ne € profit). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade €) — ta maksimizira CAPITAL RETURN per source (% returned, ne €/trade). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta maksimizira CAPITAL RETURN RATE per source z returnMaximizationAction in capitalRecyclingSpeed. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta maksimizira CAPITAL RETURN (returned/invested, ne profit/cost). Razlika od deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira capital efficiency per source = profit per euro per day) — ta maksimizira CAPITAL RETURN RATE per source (% capital returned, ne profit per euro per day). Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade volume per source) — ta maksimizira CAPITAL RETURN per source (% capital ki se vrne, ne trade volume). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF inventory portfolio) — ta maksimizira CAPITAL RETURN per SOURCE z sourceReturnRanking in returnAtRiskCapital. Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro deployed čez portfolio) — ta maksimizira CAPITAL RETURN per source (% returned, ne €/€ profit).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.returnMaximizationAction: IMPROVE_SELL_PRICE | REDUCE_FEES | FASTER_SALE | BETTER_SOURCING,
   - maximization.maximizedReturnRate % [0, 200] (≥ current returnRate, ≤ current + 30pp absolute uplift — anti-hallucination),
   - maximization.returnUplift pp [0, 200] (improvement = maximized − current),
   - maximization.returnMaximizationLevers: 3-5 stringov (max 200 vsak, slovenski — specific capital return levers per source),
   - maximization.capitalRecyclingSpeed [0, 100] (how fast capital returns for reinvestment — kombinacija returnRate × speed × action boost),
   - maximization.returnAtRiskCapital € [0, 1000000] (capital ki se morda ne vrne — items selling below cost in this source),
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "returnMaximizationAction": "IMPROVE_SELL_PRICE",
        "maximizedReturnRate": 95,
        "returnUplift": 10,
        "returnMaximizationLevers": [
          "Dvigni sell price z AI pricing engine.",
          "Negotiate harder z AI negotiation-playbook.",
          "Optimiziraj listing fotografije za premium positioning."
        ],
        "capitalRecyclingSpeed": 85,
        "returnAtRiskCapital": 150
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "returnMaximizationAction": "BETTER_SOURCING",
        "maximizedReturnRate": 88,
        "returnUplift": 16,
        "returnMaximizationLevers": [
          "Vklopi cross-border sourcing.",
          "Filter premium listings z deal score > 80.",
          "Boljši buy price za +15-20% return."
        ],
        "capitalRecyclingSpeed": 70,
        "returnAtRiskCapital": 80
      }
    }
  ],
  "summary": "2 source-a. Portfolio return: 78.5% → 92.0% (+13.5pp). Capital at risk: 230€. Best: Bolha (85% return)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  sources: SourceEntry[];
  portfolio: PortfolioSummary;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoSources(
  parsed: AiResponse | null,
  detEntries: SourceEntry[],
): MergeResult {
  let entries = detEntries;
  let portfolio = buildPortfolio(detEntries);
  let summary = buildSummary(detEntries, portfolio);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    const aiSourcesMap = new Map<string, NonNullable<AiResponse['sources']>[number]>();
    if (Array.isArray(parsed.sources)) {
      for (const ai of parsed.sources) {
        if (ai && typeof ai === 'object' && typeof ai.source === 'string') {
          aiSourcesMap.set(ai.source, ai);
        }
      }
    }

    const newEntries: SourceEntry[] = [];
    for (const det of detEntries) {
      const ai = aiSourcesMap.get(det.source);
      if (!ai || !ai.maximization) {
        newEntries.push(det);
        continue;
      }

      const aiMax = ai.maximization;
      const action = clampEnum(
        aiMax.returnMaximizationAction,
        VALID_ACTION,
        det.maximization.returnMaximizationAction,
      );

      // Anti-hallucination: maximizedReturnRate ∈ [current, current + 30pp]
      const minBound = Math.max(RETURN_RATE_MIN, det.metrics.returnRate);
      const maxBound = Math.min(RETURN_RATE_MAX, det.metrics.returnRate + 30);
      const maximizedReturnRate = round2(clampNum(
        aiMax.maximizedReturnRate,
        minBound, maxBound,
        det.maximization.maximizedReturnRate,
      ));
      const returnUplift = round2(clampNum(
        Math.max(0, maximizedReturnRate - det.metrics.returnRate),
        UPLIFT_MIN, UPLIFT_MAX, 0,
      ));

      // returnMaximizationLevers — must be array of strings
      let returnMaximizationLevers: string[] = det.maximization.returnMaximizationLevers;
      if (Array.isArray(aiMax.returnMaximizationLevers) &&
          aiMax.returnMaximizationLevers.length >= 2) {
        const aiLevers: string[] = [];
        for (const l of aiMax.returnMaximizationLevers.slice(0, MAX_LEVERS)) {
          aiLevers.push(clampString(l, 200, 'Capital return lever neopisan.'));
        }
        if (aiLevers.length >= 2) {
          returnMaximizationLevers = aiLevers;
        }
      }

      const capitalRecyclingSpeed = round0(clampNum(
        aiMax.capitalRecyclingSpeed,
        SCORE_MIN, SCORE_MAX, det.maximization.capitalRecyclingSpeed,
      ));

      const returnAtRiskCapital = round0(clampNum(
        aiMax.returnAtRiskCapital,
        CAPITAL_MIN, CAPITAL_MAX, det.maximization.returnAtRiskCapital,
      ));

      newEntries.push({
        source: det.source,
        displayName: det.displayName,
        metrics: det.metrics,
        maximization: {
          returnMaximizationAction: action,
          maximizedReturnRate,
          returnUplift,
          returnMaximizationLevers,
          capitalRecyclingSpeed,
          returnAtRiskCapital,
        },
      });
    }

    let finalEntries = detEntries;
    if (newEntries.length === detEntries.length) {
      finalEntries = newEntries;
    }

    // Rebuild portfolio with new entries
    portfolio = buildPortfolio(finalEntries);
    entries = finalEntries;

    summary = clampString(parsed.summary, 400, buildSummary(finalEntries, portfolio));
    aiUsed = true;
  }

  return { sources: entries, portfolio, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const dealSourceCapitalReturnHandler = withAiRoute<DealSourceCapitalReturnMaximizerInput>({
  endpoint: '/api/ai/deal-source-capital-return-maximizer',
  maxDuration: 60,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months with linked Listing (for source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        buyLocation: true,
        listing: {
          select: {
            monitor: { select: { source: true, tags: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentReturnRate: 0,
          totalMaximizedReturnRate: 0,
          totalReturnUplift: 0,
          totalCapitalAtRisk: 0,
          sourceReturnRanking: [],
          bestReturnSource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Capital Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Capital Return Maximizer ni mogoč.',
      } satisfies DealSourceCapitalReturnResponse);
    }

    // 2) Compute per-trade metrics and aggregate by source
    const computed: TradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeTrade(t, now);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentReturnRate: 0,
          totalMaximizedReturnRate: 0,
          totalReturnUplift: 0,
          totalCapitalAtRisk: 0,
          sourceReturnRanking: [],
          bestReturnSource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Capital Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Capital Return Maximizer ni mogoč.',
      } satisfies DealSourceCapitalReturnResponse);
    }

    const aggMap = aggregateBySource(computed);
    const detEntries = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(detEntries);
    let sources = detEntries;
    let summary = buildSummary(detEntries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-capital-return-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      sources: SourceEntry[];
      portfolio: PortfolioSummary;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        sources: cached.sources,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealSourceCapitalReturnResponse);
    }

    // 4) AI prompt with grounding
    const promptData = buildPromptData(computed, detEntries, portfolio);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoSources(parsed, detEntries);
      sources = merged.sources;
      portfolio = merged.portfolio;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-capital-return-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sources, portfolio, summary });
    }

    return apiOk({
      ok: true,
      sources,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealSourceCapitalReturnResponse);
  },
});

export const GET = dealSourceCapitalReturnHandler;
export const POST = dealSourceCapitalReturnHandler;
