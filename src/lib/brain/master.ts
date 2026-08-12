// v8.22: Master Brain — FINAL orchestration layer above all 7 Domain Brains.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the APEX of the Brain hierarchy. It sits ABOVE
// all 7 Domain Brains (Profit v8.15, Inventory v8.16, Market v8.17,
// Sourcing v8.18, Risk v8.19, Buyer v8.20, Pricing v8.21) and synthesizes
// their outputs into ONE final decision that answers: "Kaj naj naredim danes?"
//
// How it works:
// 1. Calls all 7 Domain Brain functions in PARALLEL (direct TS imports,
//    not HTTP — `Promise.all([profitBrain(), inventoryBrain(), ...])`)
// 2. Collects all 21+ actions (3 per domain × 7 domains = 21 minimum)
// 3. Detects CONFLICTS between domains (e.g. Profit says "buy more",
//    Risk says "reduce concentration")
// 4. Prioritizes TOP 5 actions across all domains, ranked by
//    expectedUpliftEUR × confidence × domainWeight
// 5. Generates 30d / 90d / 12m strategy (synthesized from all 7 projections)
// 6. Computes overallHealth score (0-100, weighted across 7 domain grades)
// 7. Identifies bottlenecks (weakest domains) and strengths (strongest)
// 8. Returns ONE oneLineSummary: "Danes: <top action>. 30d: <profit>. Tveganje: <risk>/100."
//
// Pure TypeScript function — no `next/server` import, no Prisma calls.
// All 7 Domain Brain functions are called with their DEFAULT inputs (or
// injected inputs via MasterBrainInput).
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// The individual Domain Brains handle their own DB injection when invoked
// via their own routes. When Master Brain calls them directly with inputs,
// they use those inputs (or fall back to defaults baked into each brain).
//
// 10-MIN CACHE: caller (route handler) sets a 10-min cache (longer than the
// 5-min cache of individual Domain Brains — because Master Brain aggregates
// 7 brains and is expensive to re-compute).

import { profitBrain, type ProfitBrainResult, type ProfitGrade, type Confidence } from './profit';
import { inventoryBrain, type InventoryBrainResult } from './inventory';
import { marketBrain, type MarketBrainResult } from './market';
import { sourcingBrain, type SourcingBrainResult } from './sourcing';
import { riskBrain, type RiskBrainResult } from './risk';
import { buyerBrain, type BuyerBrainResult } from './buyer';
import { pricingBrain, type PricingBrainResult } from './pricing';

// --- Types ----------------------------------------------------------------

export type DomainName = 'profit' | 'inventory' | 'market' | 'sourcing' | 'risk' | 'buyer' | 'pricing';

export interface MasterBrainInput {
  // Optional overrides — if provided, passed to the corresponding Domain Brain
  profitInput?: import('./profit').ProfitBrainInput;
  inventoryInput?: import('./inventory').InventoryBrainInput;
  marketInput?: import('./market').MarketBrainInput;
  sourcingInput?: import('./sourcing').SourcingBrainInput;
  riskInput?: import('./risk').RiskBrainInput;
  buyerInput?: import('./buyer').BuyerBrainInput;
  pricingInput?: import('./pricing').PricingBrainInput;
  // If true, skip calling a domain (for performance) — defaults to false
  skipProfit?: boolean;
  skipInventory?: boolean;
  skipMarket?: boolean;
  skipSourcing?: boolean;
  skipRisk?: boolean;
  skipBuyer?: boolean;
  skipPricing?: boolean;
}

export interface DomainResult {
  name: DomainName;
  grade: ProfitGrade;
  gradeScore: number; // 0-100 (A+ = 95, A = 80, B = 65, C = 50, D = 35, F = 15)
  topActions: Array<{
    rank: number;
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: Confidence;
  }>;
  bestOpportunity: string;
  oneLineSummary: string;
}

export interface Conflict {
  id: string;
  domainA: DomainName;
  domainB: DomainName;
  description: string;
  resolution: string; // how to resolve the conflict
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface MasterAction {
  rank: number; // 1-5
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: Confidence;
  domainWeight: number; // weight applied during ranking
  finalScore: number; // expectedUpliftEUR × confidence × domainWeight
}

export interface MasterBrainResult {
  ok: true;
  // All 7 Domain Brain raw results (for transparency)
  domains: {
    profit: ProfitBrainResult | null;
    inventory: InventoryBrainResult | null;
    market: MarketBrainResult | null;
    sourcing: SourcingBrainResult | null;
    risk: RiskBrainResult | null;
    buyer: BuyerBrainResult | null;
    pricing: PricingBrainResult | null;
  };
  // Summarized domain results (lightweight)
  domainSummary: DomainResult[]; // up to 7 entries (fewer if some skipped)
  // TOP 5 actions across ALL domains, ranked
  topActions: MasterAction[]; // up to 5
  // Conflicts detected between domains
  conflicts: Conflict[];
  // Overall system health
  overallHealth: {
    score: number; // 0-100 weighted
    grade: ProfitGrade;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    bottlenecks: DomainName[]; // weakest domains (grade D or F)
    strengths: DomainName[]; // strongest domains (grade A+ or A)
  };
  // Strategy projections
  strategy: {
    projection30d: {
      profitEUR: number; // sum of all domain 30d profit projections
      riskScore: number; // projected risk
      keyMilestone: string; // human-readable
    };
    projection90d: {
      profitEUR: number;
      riskScore: number;
      keyMilestone: string;
    };
    projection12m: {
      profitEUR: number; // 12-month projection (90d × 4, compounded)
      riskScore: number;
      keyMilestone: string;
    };
  };
  // Final ONE-line summary — answers "Kaj naj naredim danes?"
  oneLineSummary: string;
  aiUsed: false;
  source: 'v8.22-master-brain';
  cachedAt?: number;
}

// --- Helpers --------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Map a ProfitGrade to a numeric score (0-100). Used for weighted average
 * computation across all 7 Domain Brain grades.
 *
 * A+ = 95, A = 80, B = 65, C = 50, D = 35, F = 15
 */
function gradeToScore(grade: ProfitGrade): number {
  switch (grade) {
    case 'A+':
      return 95;
    case 'A':
      return 80;
    case 'B':
      return 65;
    case 'C':
      return 50;
    case 'D':
      return 35;
    case 'F':
      return 15;
    default:
      return 15;
  }
}

/**
 * Inverse of gradeToScore — convert a 0-100 numeric score back to a grade.
 * Used to map the weighted-average domain score back to a letter grade.
 */
function gradeFromScore(score: number): ProfitGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

/**
 * Confidence → numeric weight (HIGH = 1.0, MEDIUM = 0.7, LOW = 0.4).
 * Applied during TOP 5 action ranking.
 */
function confidenceWeight(c: Confidence): number {
  switch (c) {
    case 'HIGH':
      return 1.0;
    case 'MEDIUM':
      return 0.7;
    case 'LOW':
      return 0.4;
    default:
      return 0.4;
  }
}

/**
 * Per-domain weight applied during TOP 5 action ranking.
 *
 * Rationale:
 *  - risk: 1.3 (highest — risk mitigation is most critical, NEVER deprioritize)
 *  - profit: 1.2 (revenue-generating actions get a premium)
 *  - sourcing: 1.1 (capital allocation has direct € impact)
 *  - pricing: 1.1 (price changes have direct revenue impact)
 *  - inventory: 1.0 (baseline)
 *  - market: 1.0 (baseline)
 *  - buyer: 0.9 (buyer cultivation is slower-acting, lower short-term weight)
 */
const DOMAIN_WEIGHTS: Record<DomainName, number> = {
  profit: 1.2,
  inventory: 1.0,
  market: 1.0,
  sourcing: 1.1,
  risk: 1.3,
  buyer: 0.9,
  pricing: 1.1,
};

/**
 * Per-domain weight for overallHealth.score computation.
 *
 * Rationale: profit + risk weighted highest (0.20 each) because profit
 * sustainability requires both top-line growth AND risk containment.
 * Inventory + market are next (0.15 each — operational fundamentals).
 * Sourcing + buyer + pricing get 0.10 each (they feed into profit/risk).
 */
const HEALTH_WEIGHTS: Record<DomainName, number> = {
  profit: 0.20,
  inventory: 0.15,
  market: 0.15,
  sourcing: 0.10,
  risk: 0.20,
  buyer: 0.10,
  pricing: 0.10,
};

/**
 * Domain order used to break ties in TOP 5 ranking (lower index = wins ties).
 */
const DOMAIN_TIEBREAKER: DomainName[] = [
  'risk',
  'profit',
  'pricing',
  'sourcing',
  'inventory',
  'market',
  'buyer',
];

// --- Domain summary extraction --------------------------------------------

/**
 * Extract grade + topActions + bestOpportunity from a Profit Brain result.
 * Returns null if profit result is null (skipped domain).
 */
function extractProfitSummary(p: ProfitBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'profit',
    grade: p.maximization.profitGrade,
    gradeScore: gradeToScore(p.maximization.profitGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'profit' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractInventorySummary(p: InventoryBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'inventory',
    grade: p.maximization.inventoryGrade,
    gradeScore: gradeToScore(p.maximization.inventoryGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'inventory' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractMarketSummary(p: MarketBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'market',
    grade: p.maximization.marketGrade,
    gradeScore: gradeToScore(p.maximization.marketGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'market' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractSourcingSummary(p: SourcingBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'sourcing',
    grade: p.maximization.sourcingGrade,
    gradeScore: gradeToScore(p.maximization.sourcingGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'sourcing' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractRiskSummary(p: RiskBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'risk',
    grade: p.maximization.riskGrade,
    gradeScore: gradeToScore(p.maximization.riskGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'risk' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.biggestRisk,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractBuyerSummary(p: BuyerBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'buyer',
    grade: p.maximization.buyerGrade,
    gradeScore: gradeToScore(p.maximization.buyerGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'buyer' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

function extractPricingSummary(p: PricingBrainResult | null): DomainResult | null {
  if (!p) return null;
  return {
    name: 'pricing',
    grade: p.maximization.pricingGrade,
    gradeScore: gradeToScore(p.maximization.pricingGrade),
    topActions: p.maximization.topActions.map((a) => ({
      rank: a.rank,
      domain: 'pricing' as DomainName,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    })),
    bestOpportunity: p.maximization.bestOpportunity,
    oneLineSummary: p.maximization.oneLineSummary,
  };
}

// --- Conflict detection ---------------------------------------------------

/**
 * Detect 5 conflict types between domains. Each conflict requires BOTH
 * conditions to be met; otherwise no conflict is recorded for that pair.
 *
 * 1. Profit vs Risk: Profit top action scales volume AND Risk concentration
 *    score < 40 (HIGH risk).
 * 2. Market vs Inventory: Market cycle is MARKDOWN AND Inventory aging score
 *    < 50 (stale inventory).
 * 3. Sourcing vs Pricing: Sourcing best source margin < 20% AND Pricing
 *    margin score < 50.
 * 4. Buyer vs Risk: Buyer churn rate > 15% AND Risk fraud score < 50.
 * 5. Pricing vs Market: Pricing recommends raising prices (>0%) AND Market
 *    sentiment is BEARISH.
 */
function detectConflicts(
  profit: ProfitBrainResult | null,
  inventory: InventoryBrainResult | null,
  market: MarketBrainResult | null,
  sourcing: SourcingBrainResult | null,
  risk: RiskBrainResult | null,
  buyer: BuyerBrainResult | null,
  pricing: PricingBrainResult | null,
): Conflict[] {
  const conflicts: Conflict[] = [];

  // 1. Profit vs Risk
  if (profit && risk) {
    const profitTopAction = profit.maximization.topActions[0]?.action ?? '';
    const wantsToScale = /skaliraj|povečaj|buy\s*more|scaling|dodaj/i.test(profitTopAction);
    const concentrationScore =
      risk.signals.find((s) => s.name === 'concentration')?.score ?? 100;
    if (wantsToScale && concentrationScore < 40) {
      conflicts.push({
        id: 'profit-vs-risk',
        domainA: 'profit',
        domainB: 'risk',
        description:
          'Profit želi več voluma, a Risk opozarja na preveliko koncentracijo',
        resolution: 'Skaliraj postopno (25% naenkrat) in diverzificiraj vire',
        severity: 'HIGH',
      });
    }
  }

  // 2. Market vs Inventory
  if (market && inventory) {
    const phaseIsMarkdown = market.current.inferredCyclePhase === 'MARKDOWN';
    const agingScore =
      inventory.signals.find((s) => s.name === 'aging')?.score ?? 100;
    if (phaseIsMarkdown && agingScore < 50) {
      conflicts.push({
        id: 'market-vs-inventory',
        domainA: 'market',
        domainB: 'inventory',
        description: 'Trg pada, a inventar zastaral — likvidacija nujna',
        resolution: 'Likvidiraj stale iteme s 15-20% popustom ne glede na market fazo',
        severity: 'HIGH',
      });
    }
  }

  // 3. Sourcing vs Pricing
  if (sourcing && pricing) {
    const bestSource = sourcing.current.sources.find(
      (s) => s.name === sourcing.current.bestSource,
    );
    const bestSourceMarginPct = bestSource?.avgProfitMarginPct ?? 100;
    const pricingMarginScore =
      pricing.signals.find((s) => s.name === 'margin')?.score ?? 100;
    if (bestSourceMarginPct < 20 && pricingMarginScore < 50) {
      conflicts.push({
        id: 'sourcing-vs-pricing',
        domainA: 'sourcing',
        domainB: 'pricing',
        description: 'Sourcing margin nizka in Pricing margin šibka — dvojni problem',
        resolution:
          'Prestavi sourcing v high-margin vire IN zvišaj cene na high-demand itemih',
        severity: 'MEDIUM',
      });
    }
  }

  // 4. Buyer vs Risk
  if (buyer && risk) {
    const churnRatePct = buyer.current.churnRatePct ?? 0;
    const fraudScore = risk.signals.find((s) => s.name === 'fraud')?.score ?? 100;
    if (churnRatePct > 15 && fraudScore < 50) {
      conflicts.push({
        id: 'buyer-vs-risk',
        domainA: 'buyer',
        domainB: 'risk',
        description: 'Visok churn + sumljive fraud signale — morda scam prodajalci',
        resolution:
          'Kreiraj blacklist sumljivih kupcev + reactivation kampanja z 10% popustom za zveste',
        severity: 'MEDIUM',
      });
    }
  }

  // 5. Pricing vs Market
  if (pricing && market) {
    const recommendedPriceChangePct =
      pricing.maximization.projection30d.recommendedPriceChangePct ?? 0;
    const sentimentBearish = market.current.inferredSentiment === 'BEARISH';
    if (recommendedPriceChangePct > 0 && sentimentBearish) {
      conflicts.push({
        id: 'pricing-vs-market',
        domainA: 'pricing',
        domainB: 'market',
        description: 'Pricing predlaga višje cene, a trg je BEARISH',
        resolution: 'Zadrži dvig za 30d, fokus na bundle value namesto cene',
        severity: 'MEDIUM',
      });
    }
  }

  return conflicts;
}

// --- Strategy projection synthesis ----------------------------------------

/**
 * Synthesize the 30d/90d profit projection by summing EUR profit projections
 * from the domains that produce them (profit + sourcing + pricing + buyer).
 *
 * Domains skipped (their projections are not directly EUR profit):
 *  - inventory: projects inventory value/aged % (not EUR profit)
 *  - market: projects market phase + price change % (not EUR profit)
 *  - risk: projects risk budget (capital recommendation, not profit)
 */
function synthesizeProfitProjection30d(
  profit: ProfitBrainResult | null,
  sourcing: SourcingBrainResult | null,
  pricing: PricingBrainResult | null,
  buyer: BuyerBrainResult | null,
): number {
  let total = 0;
  if (profit) total += profit.maximization.projection30d;
  if (sourcing) total += sourcing.maximization.projection30d.projectedTotalMonthlyProfit;
  if (pricing) total += pricing.maximization.projection30d.projectedRevenue;
  if (buyer) {
    const projectedBuyers = buyer.maximization.projection30d.projectedActiveBuyers;
    const avgOrderValue = buyer.current.avgOrderValue;
    total += projectedBuyers * avgOrderValue;
  }
  return round2(total);
}

function synthesizeProfitProjection90d(
  profit: ProfitBrainResult | null,
  sourcing: SourcingBrainResult | null,
  pricing: PricingBrainResult | null,
  buyer: BuyerBrainResult | null,
): number {
  let total = 0;
  if (profit) total += profit.maximization.projection90d;
  if (sourcing) total += sourcing.maximization.projection90d.projectedTotalMonthlyProfit;
  if (pricing) total += pricing.maximization.projection90d.projectedRevenue;
  if (buyer) {
    const projectedBuyers = buyer.maximization.projection90d.projectedActiveBuyers;
    const avgOrderValue = buyer.current.avgOrderValue;
    total += projectedBuyers * avgOrderValue;
  }
  return round2(total);
}

// --- Master Brain ---------------------------------------------------------

/**
 * Master Brain — FINAL orchestration layer above all 7 Domain Brains.
 *
 * Calls all 7 Domain Brain functions in PARALLEL (direct TS imports, not HTTP)
 * and synthesizes their outputs into ONE final decision:
 *  - TOP 5 actions across all 7 domains, ranked by
 *    `expectedUpliftEUR × confidence × domainWeight`
 *  - Conflict detection between contradictory domain signals
 *  - overallHealth score (0-100, weighted across 7 domain grades)
 *  - 30d / 90d / 12m strategy projections (synthesized from EUR-profit domains)
 *  - Bottlenecks (weakest domains) + strengths (strongest domains)
 *  - ONE oneLineSummary that answers: "Kaj naj naredim danes?"
 *
 * Pure TypeScript function — no `next/server` import, no Prisma calls.
 * All 7 Domain Brain functions are called with their DEFAULT inputs (or
 * injected inputs via MasterBrainInput).
 *
 * Async because individual Brain functions may evolve to be async in the
 * future (e.g. DB-backed state injection inside the brain itself). Today
 * they are sync, but Promise.all() preserves the parallel call contract.
 */
export async function masterBrain(
  input: MasterBrainInput = {},
): Promise<MasterBrainResult> {
  // 1. Call all 7 Domain Brains in PARALLEL (direct imports, not HTTP)
  const [profit, inventory, market, sourcing, risk, buyer, pricing] =
    await Promise.all([
      input.skipProfit ? null : profitBrain(input.profitInput),
      input.skipInventory ? null : inventoryBrain(input.inventoryInput),
      input.skipMarket ? null : marketBrain(input.marketInput),
      input.skipSourcing ? null : sourcingBrain(input.sourcingInput),
      input.skipRisk ? null : riskBrain(input.riskInput),
      input.skipBuyer ? null : buyerBrain(input.buyerInput),
      input.skipPricing ? null : pricingBrain(input.pricingInput),
    ]);

  // 2. Build domainSummary (extract grade + topActions + bestOpportunity from each)
  const domainSummary: DomainResult[] = [];
  const profitSummary = extractProfitSummary(profit);
  if (profitSummary) domainSummary.push(profitSummary);
  const inventorySummary = extractInventorySummary(inventory);
  if (inventorySummary) domainSummary.push(inventorySummary);
  const marketSummary = extractMarketSummary(market);
  if (marketSummary) domainSummary.push(marketSummary);
  const sourcingSummary = extractSourcingSummary(sourcing);
  if (sourcingSummary) domainSummary.push(sourcingSummary);
  const riskSummary = extractRiskSummary(risk);
  if (riskSummary) domainSummary.push(riskSummary);
  const buyerSummary = extractBuyerSummary(buyer);
  if (buyerSummary) domainSummary.push(buyerSummary);
  const pricingSummary = extractPricingSummary(pricing);
  if (pricingSummary) domainSummary.push(pricingSummary);

  // 3. Collect ALL actions from all domains into one array
  const allActions: Array<{
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: Confidence;
  }> = [];
  for (const d of domainSummary) {
    for (const a of d.topActions) {
      allActions.push({
        domain: d.name,
        signal: a.signal,
        action: a.action,
        expectedUpliftEUR: a.expectedUpliftEUR,
        confidence: a.confidence,
      });
    }
  }

  // 4. Detect conflicts between domains
  const conflicts = detectConflicts(profit, inventory, market, sourcing, risk, buyer, pricing);

  // 5. Rank all actions by finalScore = expectedUpliftEUR × confidenceWeight × domainWeight
  const ranked = allActions
    .map((a) => {
      const cw = confidenceWeight(a.confidence);
      const dw = DOMAIN_WEIGHTS[a.domain];
      const finalScore = a.expectedUpliftEUR * cw * dw;
      return {
        ...a,
        domainWeight: dw,
        finalScore: round2(finalScore),
      };
    })
    .sort((a, b) => {
      // Primary: finalScore descending
      if (Math.abs(b.finalScore - a.finalScore) > 0.001) {
        return b.finalScore - a.finalScore;
      }
      // Tiebreaker: domain priority (risk > profit > pricing > sourcing > ...)
      const ai = DOMAIN_TIEBREAKER.indexOf(a.domain);
      const bi = DOMAIN_TIEBREAKER.indexOf(b.domain);
      return ai - bi;
    });

  // 6. Take TOP 5 actions
  const top5 = ranked.slice(0, 5);
  const topActions: MasterAction[] = top5.map((a, i) => ({
    rank: i + 1,
    domain: a.domain,
    signal: a.signal,
    action: a.action,
    expectedUpliftEUR: round2(a.expectedUpliftEUR),
    confidence: a.confidence,
    domainWeight: a.domainWeight,
    finalScore: a.finalScore,
  }));

  // 7. Compute overallHealth:
  //    - score = weighted avg of all domain gradeScores (weights from HEALTH_WEIGHTS)
  //    - grade via gradeFromScore
  //    - riskLevel: LOW >= 70, MEDIUM >= 50, HIGH >= 30, CRITICAL else
  //    - bottlenecks: domains with grade D or F
  //    - strengths: domains with grade A+ or A
  let weightedSum = 0;
  let totalWeight = 0;
  const bottlenecks: DomainName[] = [];
  const strengths: DomainName[] = [];
  for (const d of domainSummary) {
    const w = HEALTH_WEIGHTS[d.name] ?? 0;
    weightedSum += d.gradeScore * w;
    totalWeight += w;
    if (d.grade === 'D' || d.grade === 'F') bottlenecks.push(d.name);
    if (d.grade === 'A+' || d.grade === 'A') strengths.push(d.name);
  }
  const overallScore = totalWeight > 0 ? clamp(weightedSum / totalWeight, 0, 100) : 0;
  const overallGrade = gradeFromScore(overallScore);
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  if (overallScore >= 70) riskLevel = 'LOW';
  else if (overallScore >= 50) riskLevel = 'MEDIUM';
  else if (overallScore >= 30) riskLevel = 'HIGH';
  else riskLevel = 'CRITICAL';

  // 8. Generate strategy projections:
  //    - 30d/90d profit EUR = sum of profit + sourcing + pricing + buyer projections
  //    - 12m = projection90d × 4 × 0.9 (compounded, 10% uncertainty discount)
  //    - riskScore: from Risk Brain's overallRiskScore (lower = more risk), inverted
  //      for display purposes (so higher number = higher risk severity)
  const projection30dProfit = synthesizeProfitProjection30d(
    profit,
    sourcing,
    pricing,
    buyer,
  );
  const projection90dProfit = synthesizeProfitProjection90d(
    profit,
    sourcing,
    pricing,
    buyer,
  );
  const projection12mProfit = round2(projection90dProfit * 4 * 0.9);

  // Risk score: use risk domain's overallRiskScore if available.
  // risk.current.overallRiskScore is "0-100 (lower = more risk)" per v8.19.
  // For display we invert: riskSeverity = 100 - overallRiskScore (higher = more risk).
  const rawRiskScore = risk?.current.overallRiskScore ?? 100;
  const riskScoreForDisplay = clamp(100 - rawRiskScore, 0, 100);

  // If risk is skipped, default to moderate (50)
  const riskScore30d = risk ? riskScoreForDisplay : 50;
  // 90d/12m: risk improves if top risk actions are executed (1.2× improvement per quarter)
  const riskScore90d = risk
    ? clamp(riskScoreForDisplay * 0.85, 0, 100)
    : 50;
  const riskScore12m = risk
    ? clamp(riskScoreForDisplay * 0.7, 0, 100)
    : 50;

  // keyMilestone: human-readable based on topAction
  const topAction = topActions[0];
  const topDomain = topAction?.domain ?? 'profit';
  const milestone30d = topAction
    ? `30d: izvedi #1 ${topDomain} akcijo (+${Math.round(projection30dProfit)}€)`
    : `30d: pripravi akcijski načrt (+${Math.round(projection30dProfit)}€)`;
  const milestone90d = `90d: ${topDomain === 'risk' ? 'stabiliziraj tveganje' : 'skaliraj profit'} do ${Math.round(projection90dProfit)}€/mo`;
  const milestone12m = `12m: ${overallGrade === 'A+' || overallGrade === 'A' ? 'konsolidiraj pozicijo' : 'gradnja stabilnega sistema'} · ${Math.round(projection12mProfit)}€ projekcija`;

  // 9. Generate oneLineSummary:
  //    `Danes: ${topActions[0].action}. 30d: ${projection30d.profitEUR}€. Tveganje: ${riskScore}/100. Zdravje: ${grade}.`
  const topActionText = topAction?.action ?? 'Pripravi akcijski načrt';
  // Truncate long action text to keep oneLineSummary readable
  const truncatedAction =
    topActionText.length > 80
      ? `${topActionText.slice(0, 77)}...`
      : topActionText;
  const oneLineSummary = `Danes: ${truncatedAction}. 30d: ${Math.round(projection30dProfit)}€. Tveganje: ${Math.round(riskScore30d)}/100. Zdravje: ${overallGrade}.`;

  // 10. Return assembled result
  return {
    ok: true,
    domains: {
      profit,
      inventory,
      market,
      sourcing,
      risk,
      buyer,
      pricing,
    },
    domainSummary,
    topActions,
    conflicts,
    overallHealth: {
      score: round2(overallScore),
      grade: overallGrade,
      riskLevel,
      bottlenecks,
      strengths,
    },
    strategy: {
      projection30d: {
        profitEUR: projection30dProfit,
        riskScore: round2(riskScore30d),
        keyMilestone: milestone30d,
      },
      projection90d: {
        profitEUR: projection90dProfit,
        riskScore: round2(riskScore90d),
        keyMilestone: milestone90d,
      },
      projection12m: {
        profitEUR: projection12mProfit,
        riskScore: round2(riskScore12m),
        keyMilestone: milestone12m,
      },
    },
    oneLineSummary,
    aiUsed: false,
    source: 'v8.22-master-brain',
  };
}
