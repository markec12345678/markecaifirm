/**
 * Shared types for AI Hub modules.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. All brain result interfaces, system health types,
 * and cross-module shared types live here to avoid circular dependencies.
 *
 * Module-local interfaces (used by only one component) are kept in their
 * respective module files.
 */

export interface BrainAction {
  rank: number;
  domain: string;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface BrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    monthlyProfit: number;
    profitGrowthRate: number;
    avgProfitPerTrade: number;
    tradesPerMonth: number;
    capitalDeployed: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: number;
    projection90d: number;
    profitGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.17: Market Brain result — projection30d/projection90d are STRUCTURED
// objects with `predictedPhase` + `predictedPriceChangePct` + `recommendedAction`
// (BUY/SELL/HOLD/LIQUIDATE). Different from both Profit (scalars) and
// Inventory (recommendedItemsToSell/Buy + projectedInventoryValue).
export interface MarketBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    activeListingCount: number;
    newLastWeek: number;
    avgPriceChangePctWeek: number;
    avgPriceChangePctMonth: number;
    buyerInquiriesLastWeek: number;
    sellThroughRatePct: number;
    avgDaysOnMarket: number;
    priceSpreadPct: number;
    inferredCyclePhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
    inferredSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    projection90d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    marketGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.16: Inventory Brain result — different `current` and `maximization`
// shape from Profit Brain (projections are STRUCTURED objects, not scalars).
export interface InventoryBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    itemCount: number;
    totalInventoryValue: number;
    avgDaysToSell: number;
    agedItemsCount: number;
    agedItemsPct: number;
    avgProfitMarginPct: number;
    capitalDeployed: number;
    monthlySalesCount: number;
    monthlyRevenue: number;
    inventoryTurnoverRate: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedItemsToSell: number;
      recommendedItemsToBuy: number;
      projectedInventoryValue: number;
      projectedAgedPct: number;
    };
    projection90d: {
      projectedInventoryValue: number;
      projectedAgedPct: number;
      projectedTurnoverRate: number;
    };
    inventoryGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}
export interface SourcingBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    sourceCount: number;
    sources: Array<{
      name: string;
      monthlyVolume: number;
      avgProfitMarginPct: number;
      avgDaysToSell: number;
      capitalDeployedEUR: number;
      monthlyProfitEUR: number;
    }>;
    totalCapitalDeployed: number;
    totalMonthlyProfit: number;
    bestSource: string;
    worstSource: string;
    avgMarginPct: number;
    concentrationPct: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedSourceToScale: string;
      recommendedSourceToReduce: string;
      projectedTotalMonthlyProfit: number;
      projectedConcentrationPct: number;
    };
    projection90d: {
      projectedTotalMonthlyProfit: number;
      projectedSourceCount: number;
      projectedConcentrationPct: number;
      recommendedNewSource?: string;
    };
    sourcingGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

export interface RiskBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = LOWER risk)
    grade: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskReductionEUR: number;
    topLever: string;
  }>;
  current: {
    totalCapitalDeployed: number;
    inventoryValue: number;
    agedInventoryValue: number;
    agedPct: number;
    capitalConcentrationPct: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    activeSources: number;
    fraudSuspicionsPct: number;
    avgDaysToSell: number;
    marketVolatilityPct: number;
    overallRiskScore: number; // 0-100 (lower = more risk)
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    projection90d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    riskGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    biggestRisk: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

export interface BuyerBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = better buyer health)
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    totalBuyers: number;
    activeBuyersLast30d: number;
    newBuyersLast30d: number;
    churnedBuyersLast30d: number;
    avgBuyerLifetimeValue: number;
    avgPurchaseFrequency: number;
    avgOrderValue: number;
    repeatBuyerRatePct: number;
    inquiriesConvertedPct: number;
    avgEngagementScore: number;
    highValueBuyersCount: number;
    churnRatePct: number;
    netGrowthPct: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;
    };
    projection90d: {
      projectedActiveBuyers: number;
      projectedLTV: number;
      projectedChurnRatePct: number;
      recommendedOutreachCount: number;
    };
    buyerGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

export interface PricingBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = better pricing health)
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    activeListingsCount: number;
    avgProfitMarginPct: number;
    avgDaysOnMarket: number;
    competitorPriceAvgPct: number;
    priceElasticityScore: number;
    sellThroughRatePct: number;
    monthlyRevenue: number;
    avgOrderValue: number;
    priceWarDetected: boolean;
    seasonalMultiplier: number;
    psychologyOptimizedPct: number;
    lastPriceChangePct: number;
    pricingPower: number; // 0-100 composite — ability to raise prices
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;
      listingsToReprice: number;
    };
    projection90d: {
      projectedMarginPct: number;
      projectedRevenue: number;
      recommendedPriceChangePct: number;
      listingsToReprice: number;
    };
    pricingGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

export interface BrainEndpointHealth {
  name: string;
  path: string;
  responsive: boolean;
  responseTimeMs: number;
  lastError: string | null;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | null;
}

export interface SystemHealthReport {
  ok: true;
  timestamp: string;
  overallHealthScore: number;
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  brainEndpoints: BrainEndpointHealth[];
  dataFreshness: {
    latestSnapshotDate: string | null;
    snapshotsCount: number;
    daysSinceLastSnapshot: number | null;
    accuracy30d: number | null;
    tradesRecorded: number;
  };
  autoPilot: {
    enabled: boolean;
    mode: 'safe' | 'aggressive';
    anomalySuspended: boolean;
    todayAutoExecuted: number;
    todayBudgetUsed: number;
  };
  draftQueue: {
    pending: number;
    executed: number;
    rejected: number;
    expired: number;
    total: number;
    executionRate: number;
  };
  riskProfile: {
    riskTolerance: 'conservative' | 'balanced' | 'aggressive';
    maxAcceptableRisk: number;
  };
  adaptiveWeights: {
    adjustedDomains: number;
    totalExecuted: number;
    totalRejected: number;
  };
  recommendations: string[];
  source: string;
}

export interface SeedInfo {
  ok: true;
  count: number;
  byStatus: { sold: number; held: number; cancelled: number };
  demoTemplateCount: number;
  source: string;
}

export interface AIEndpoint {
  name: string;
  description: string;
  bodyHint: string;
  category: string;
  // v8.94: deprecated flag iz /api/ai-list (JSDoc @deprecated zaznan v route.ts)
  deprecated?: boolean;
  deprecatedReplacement?: string;
}
export type DomainName = 'profit' | 'inventory' | 'market' | 'sourcing' | 'risk' | 'buyer' | 'pricing';
export interface AccuracyTrendSummary {
  totalSnapshots: number;
  snapshotsWithAccuracy30d: number;
  snapshotsWithAccuracy90d: number;
  avgAccuracy30d: number | null;
  avgAccuracy90d: number | null;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  message?: string;
}

export type DraftStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';

// v8.94.5-split: ActualProfitResponse — shared between BrainSnapshotsSection
// (automation-cards.tsx) and ActualProfitCard (system-cards.tsx).
export interface ActualProfitResponse {
  ok: true;
  period: string;
  totalProfitEUR: number;
  totalRevenueEUR: number;
  totalCostEUR: number;
  tradeCount: number;
  avgProfitPerTradeEUR: number;
  avgMarginPct: number;
  dailyAvgEUR: number;
  bestTrade: { title: string; profitEUR: number } | null;
  worstTrade: { title: string; profitEUR: number } | null;
}

