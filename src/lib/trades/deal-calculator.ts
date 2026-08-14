// v8.37: Deal Calculator — hitra ROI kalkulacija za odločitev "naj kupim?"
//
// Pure function — no DB, no AI. Just math.
//
// Use case: uporabnik vidi oglas na Bolha (npr. iPhone 13 za 280€) ampak nima
// hitrega kalkulatorja ki bi povedal "če prodaš za 380€, profit je 85€ (30% ROI)
// po 15€ fee". Ta modul odgovori na to vprašanje z čisto matematiko.
//
// Recommendation logic:
//   - BUY    : ROI >= 30% AND netProfit >= 30€
//   - MARGINAL: ROI >= 15% AND netProfit >= 15€
//   - PASS   : vse ostalo (premajhen profit glede na tveganje)
//
// Risk assessment:
//   - LOW    : privzeto (ni dejavnikov)
//   - MEDIUM : hold > 30 dni ALI capital > 500€ ALI refurb > 20% nabavne
//   - HIGH   : margin < 15% ALI expectedSellPrice < breakEven (izguba)
//
// Used by:
//   - GET  /api/ai/deal-calculator?buyPrice=280&expectedSellPrice=380&...
//   - POST /api/ai/deal-calculator { buyPrice, expectedSellPrice, ... }
//   - Dashboard DealCalculatorWidget (live calculation as user types)

export interface DealCalculatorInput {
  buyPrice: number;            // EUR — cena nabave
  expectedSellPrice: number;  // EUR — pričakovana cena prodaje
  buyFees: number;            // EUR — pristojbine pri nakupu (shipping, Bolha fee)
  sellFees: number;           // EUR — pristojbine pri prodaji (platforma, shipping)
  shippingCost?: number;     // EUR — če shipaš (default 0)
  refurbCost?: number;       // EUR — če popravlja/čisti (default 0)
  category?: string;         // za povprečni ROI primerjavo (default '')
  avgHoldDays?: number;      // povprečni čas do prodaje (default 14)
}

export interface DealCalculatorResult {
  ok: true;
  input: DealCalculatorInput;
  // Profit metrics
  totalCost: number;          // buyPrice + buyFees + shippingCost + refurbCost
  totalRevenue: number;      // expectedSellPrice - sellFees
  netProfit: number;         // totalRevenue - totalCost
  roiPct: number;             // (netProfit / totalCost) × 100
  marginPct: number;          // (netProfit / totalRevenue) × 100
  // Break-even
  breakEvenPrice: number;     // minimalna prodajna cena za 0 profit = totalCost + sellFees
  breakEvenMargin: number;    // koliko pod expectedSellPrice je break-even (EUR)
  // Time metrics
  dailyProfit: number;        // netProfit / avgHoldDays
  weeklyProfit: number;        // dailyProfit × 7
  monthlyProfit: number;      // dailyProfit × 30
  // Recommendation
  recommendation: 'BUY' | 'MARGINAL' | 'PASS';
  recommendationReason: string;
  recommendationColor: 'green' | 'amber' | 'red';
  // Risk assessment
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskFactors: string[];
  source: 'v8.37-deal-calculator';
}

/**
 * Round to 2 decimal places (EUR precision).
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate deal profitability + recommendation + risk.
 *
 * Pure function — no side effects, no IO. Safe to call from any context.
 *
 * @param input Buy/sell prices + fees + optional shipping/refurb/hold time
 * @returns DealCalculatorResult with all metrics
 */
export function calculateDeal(input: DealCalculatorInput): DealCalculatorResult {
  const shippingCost = input.shippingCost ?? 0;
  const refurbCost = input.refurbCost ?? 0;
  const avgHoldDays = input.avgHoldDays ?? 14;

  // Core math
  const totalCost = input.buyPrice + input.buyFees + shippingCost + refurbCost;
  const totalRevenue = input.expectedSellPrice - input.sellFees;
  const netProfit = totalRevenue - totalCost;
  const roiPct = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;
  const marginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const breakEvenPrice = totalCost + input.sellFees;
  const breakEvenMargin = input.expectedSellPrice - breakEvenPrice;
  const dailyProfit = avgHoldDays > 0 ? netProfit / avgHoldDays : 0;

  // Recommendation logic — based on ROI % + absolute € profit
  let recommendation: 'BUY' | 'MARGINAL' | 'PASS';
  let recommendationReason: string;
  let recommendationColor: 'green' | 'amber' | 'red';

  if (roiPct >= 30 && netProfit >= 30) {
    recommendation = 'BUY';
    recommendationReason = `Odlična priložnost: ${roiPct.toFixed(0)}% ROI, ${netProfit.toFixed(0)}€ profit. Priporočamo nakup.`;
    recommendationColor = 'green';
  } else if (roiPct >= 15 && netProfit >= 15) {
    recommendation = 'MARGINAL';
    recommendationReason = `Marginalna priložnost: ${roiPct.toFixed(0)}% ROI, ${netProfit.toFixed(0)}€ profit. Preglej tržno ceno pred nakupom.`;
    recommendationColor = 'amber';
  } else {
    recommendation = 'PASS';
    recommendationReason = `Slaba priložnost: ${roiPct.toFixed(0)}% ROI, ${netProfit.toFixed(0)}€ profit. Premajhen profit glede na tveganje.`;
    recommendationColor = 'red';
  }

  // Risk assessment — factors push riskLevel up
  const riskFactors: string[] = [];
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  if (avgHoldDays > 30) {
    riskFactors.push(`Dolg hold: ${avgHoldDays} dni — večja izpostavljenost tržnim nihanjem`);
    riskLevel = 'MEDIUM';
  }
  if (totalCost > 500) {
    riskFactors.push(`Visok capital: ${totalCost.toFixed(0)}€ — večja izguba če ne prodaš`);
    riskLevel = 'MEDIUM';
  }
  if (marginPct < 15) {
    riskFactors.push(`Nizka margin: ${marginPct.toFixed(0)}% — malo prostora za cenovno prilagoditev`);
    riskLevel = 'HIGH';
  }
  if (input.expectedSellPrice < breakEvenPrice) {
    riskFactors.push(`Cena pod break-even: izguba ${Math.abs(netProfit).toFixed(0)}€`);
    riskLevel = 'HIGH';
  }
  if (refurbCost > 0 && refurbCost > totalCost * 0.2) {
    riskFactors.push(`Visok refurb cost: ${refurbCost.toFixed(0)}€ (>20% nabavne)`);
    if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
  }

  return {
    ok: true,
    input,
    totalCost: r2(totalCost),
    totalRevenue: r2(totalRevenue),
    netProfit: r2(netProfit),
    roiPct: r2(roiPct),
    marginPct: r2(marginPct),
    breakEvenPrice: r2(breakEvenPrice),
    breakEvenMargin: r2(breakEvenMargin),
    dailyProfit: r2(dailyProfit),
    weeklyProfit: r2(dailyProfit * 7),
    monthlyProfit: r2(dailyProfit * 30),
    recommendation,
    recommendationReason,
    recommendationColor,
    riskLevel,
    riskFactors,
    source: 'v8.37-deal-calculator',
  };
}
