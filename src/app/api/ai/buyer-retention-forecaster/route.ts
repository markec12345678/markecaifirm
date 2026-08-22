// v7.75 / v8.94-refactor: AI Buyer Retention Forecaster — AI napove KATERI kupci bodo postal
// repeat customers in KDAJ bodo verjetno ponovno kupili. Identificira buyers
// z visoko retention probability in priporoča timing za outreach.
// "Marjan: 5 kupov, retention 85/100, predicted next buy 2026-09-15.
//  Outreach: 'Pridejo novi iPhone-i!'"
//
// Razlika od buyer-retention-predictor (ki napove retention za posameznega
// kupca v časovnem oknu) — ta forecast-a FUTURE retention TIMELINE čez vse
// kupce (kdaj bo kdo ponovno kupil, kakšen bo LTV, kakšna je churn verjetnost).
// Razlika od buyer-retention-score-calculator (ki izračuna retention score)
// — ta napove retention TIMELINE in outreach timing. Razlika od
// buyer-sentiment-analyzer-v2 (ki analizira sentiment) — ta napove retention
// verjetnost in predictedNextPurchaseDate. Razlika od buyer-clv-predictor
// (ki napove customer lifetime value) — ta napove RETENTION TIMELINE in
// outreach timing. Razlika od buyer-churn-predictor-v2 (ki napove churn
// tveganje) — ta forecast-a retention segment, churn risk in outreach date.
//
// GET+POST /api/ai/buyer-retention-forecaster
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BuyerRetentionForecastInput {}

// --- Types ---------------------------------------------------------------

type RetentionSegment = 'LOYAL' | 'REPEAT' | 'OCCASIONAL' | 'ONE_TIME';
type ChurnRisk = 'LOW' | 'MEDIUM' | 'HIGH';

interface BuyerForecast {
  buyerName: string;
  purchaseCount: number;
  firstPurchaseDate: string; // YYYY-MM-DD
  lastPurchaseDate: string; // YYYY-MM-DD
  avgDaysBetweenPurchases: number;
  daysSinceLastPurchase: number;
  buyerLifetimeValue: number;
  avgOrderValue: number;
  retentionScore: number; // 0-100
  retentionProbability: number; // 0-100 (%)
  predictedNextPurchaseDate: string; // YYYY-MM-DD
  predictedNextPurchaseWindow: { earliest: string; latest: string };
  retentionSegment: RetentionSegment;
  churnRisk: ChurnRisk;
  recommendedOutreachDate: string; // YYYY-MM-DD
  outreachMessage: string;
  expectedLifetimeValue: number;
  reasoning: string;
}

interface Summary {
  totalBuyers: number;
  loyalCount: number;
  repeatCount: number;
  occasionalCount: number;
  oneTimeCount: number;
  avgRetentionProbability: number;
  highChurnRiskCount: number;
  advice: string;
}

interface AiRetentionResponse {
  buyers?: unknown;
  summary?: unknown;
}

interface BuyerTrade {
  sellDate: number; // ms
  sellPrice: number;
  sellFees: number;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
  buyDate: Date | null;
}

// --- Helpers (pure, testable) -------------------------------------------

const DAY_MS = 86_400_000;

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

const VALID_SEGMENT: readonly RetentionSegment[] = [
  'LOYAL',
  'REPEAT',
  'OCCASIONAL',
  'ONE_TIME',
];

const VALID_CHURN: readonly ChurnRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// Validate YYYY-MM-DD date string and clamp to future (or fallback)
function clampFutureDate(
  raw: unknown,
  fallback: string,
  minMs: number = Date.now(),
): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) {
    const ms = new Date(raw.slice(0, 10) + 'T00:00:00Z').getTime();
    if (Number.isFinite(ms) && ms >= minMs) {
      return raw.slice(0, 10);
    }
  }
  return fallback;
}

// Validate YYYY-MM-DD date string (no future constraint — for firstPurchase etc.)
function clampDate(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) {
    const ms = new Date(raw.slice(0, 10) + 'T00:00:00Z').getTime();
    if (Number.isFinite(ms)) {
      return raw.slice(0, 10);
    }
  }
  return fallback;
}

// Compute retention segment from purchase count
function computeSegment(purchaseCount: number): RetentionSegment {
  if (purchaseCount >= 5) return 'LOYAL';
  if (purchaseCount >= 3) return 'REPEAT';
  if (purchaseCount >= 2) return 'OCCASIONAL';
  return 'ONE_TIME';
}

// Compute churn risk from recency, frequency, segment
function computeChurnRisk(
  daysSinceLastPurchase: number,
  avgDaysBetweenPurchases: number,
  segment: RetentionSegment,
): ChurnRisk {
  // If never bought again (one-time), churn risk high (unless very recent)
  if (segment === 'ONE_TIME') {
    return daysSinceLastPurchase > 60 ? 'HIGH' : daysSinceLastPurchase > 21 ? 'MEDIUM' : 'LOW';
  }
  // For repeat buyers — check if they're "overdue" relative to their pattern
  if (avgDaysBetweenPurchases <= 0) return 'MEDIUM';
  const overdueRatio = daysSinceLastPurchase / avgDaysBetweenPurchases;
  if (overdueRatio > 1.5) return 'HIGH';
  if (overdueRatio > 1.0) return 'MEDIUM';
  return 'LOW';
}

// Compute retention score (0-100) using RFM-style:
// - Frequency (count): more purchases → higher score
// - Recency (daysSinceLast): recent → higher score
// - Monetary (LTV): higher LTV → higher score
function computeRetentionScore(
  purchaseCount: number,
  daysSinceLastPurchase: number,
  buyerLifetimeValue: number,
  avgDaysBetweenPurchases: number,
): number {
  // Frequency score (0-40): 1 buy=0, 5+ buys=40
  const freqScore = Math.min(40, (purchaseCount - 1) * 10);
  // Recency score (0-30): last purchase <7d=30, >180d=0
  let recencyScore: number;
  if (daysSinceLastPurchase <= 7) recencyScore = 30;
  else if (daysSinceLastPurchase <= 30) recencyScore = 25;
  else if (daysSinceLastPurchase <= 60) recencyScore = 18;
  else if (daysSinceLastPurchase <= 90) recencyScore = 12;
  else if (daysSinceLastPurchase <= 180) recencyScore = 6;
  else recencyScore = 0;
  // Monetary score (0-30): LTV scaling (1€=0, 2000€=30)
  const monetaryScore = Math.min(30, Math.max(0, (buyerLifetimeValue / 2000) * 30));
  // Regularity bonus: if buyer has consistent pattern (low variance), +5
  const regularityBonus = avgDaysBetweenPurchases > 0 && purchaseCount >= 3 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(freqScore + recencyScore + monetaryScore + regularityBonus)));
}

// Compute retention probability (0-100%) based on RFM
function computeRetentionProbability(
  retentionScore: number,
  segment: RetentionSegment,
  churnRisk: ChurnRisk,
): number {
  let prob = retentionScore * 0.8; // base scaling
  // Segment adjustment
  if (segment === 'LOYAL') prob += 15;
  else if (segment === 'REPEAT') prob += 8;
  else if (segment === 'OCCASIONAL') prob -= 5;
  else prob -= 15; // ONE_TIME
  // Churn risk adjustment
  if (churnRisk === 'HIGH') prob -= 20;
  else if (churnRisk === 'MEDIUM') prob -= 8;
  else if (churnRisk === 'LOW') prob += 5;
  return Math.max(0, Math.min(100, Math.round(prob)));
}

// Compute predicted next purchase date from buyer pattern
function computePredictedNextPurchase(
  lastPurchaseMs: number,
  avgDaysBetweenPurchases: number,
): string {
  const now = Date.now();
  // If buyer has no pattern (one-time), assume 90-day default window
  const interval = avgDaysBetweenPurchases > 0 ? avgDaysBetweenPurchases : 90;
  let predictedMs = lastPurchaseMs + interval * DAY_MS;
  // If predicted in past (buyer is overdue), use now + remaining interval estimate
  if (predictedMs < now) {
    predictedMs = now + Math.max(7, interval * 0.3) * DAY_MS;
  }
  return new Date(predictedMs).toISOString().slice(0, 10);
}

// Compute predicted next purchase window (earliest, latest)
function computePredictedWindow(
  predictedDate: string,
  avgDaysBetweenPurchases: number,
): { earliest: string; latest: string } {
  const predictedMs = new Date(predictedDate + 'T00:00:00Z').getTime();
  // Window: ±50% of avg interval (or ±30d if no pattern)
  const halfWidth = avgDaysBetweenPurchases > 0
    ? avgDaysBetweenPurchases * 0.5
    : 30;
  const earliestMs = predictedMs - halfWidth * DAY_MS;
  const latestMs = predictedMs + halfWidth * DAY_MS;
  // Clamp earliest to today
  const now = Date.now();
  const earliest = Math.max(earliestMs, now);
  return {
    earliest: new Date(earliest).toISOString().slice(0, 10),
    latest: new Date(latestMs).toISOString().slice(0, 10),
  };
}

// Compute recommended outreach date — typically 7-14 days before predicted next purchase
function computeOutreachDate(
  predictedDate: string,
  segment: RetentionSegment,
  daysSinceLastPurchase: number,
): string {
  const predictedMs = new Date(predictedDate + 'T00:00:00Z').getTime();
  // Outreach 7-14 days before predicted purchase
  const leadTime = segment === 'LOYAL' ? 7 : segment === 'REPEAT' ? 10 : 14;
  let outreachMs = predictedMs - leadTime * DAY_MS;
  // If outreach is in past, recommend soon (within 3 days)
  const now = Date.now();
  if (outreachMs < now) {
    // Buyer is overdue or near purchase time — reach out ASAP
    outreachMs = now + (daysSinceLastPurchase > 90 ? 1 : 3) * DAY_MS;
  }
  return new Date(outreachMs).toISOString().slice(0, 10);
}

// Build deterministic outreach message in Slovenian
function buildOutreachMessage(
  buyerName: string,
  segment: RetentionSegment,
  purchaseCount: number,
  avgOrderValue: number,
): string {
  const firstName = buyerName.split(/\s+/)[0] || buyerName;
  switch (segment) {
    case 'LOYAL':
      return `Pozdravljen ${firstName}! Hvala za ${purchaseCount} dosedanjih nakupov. Pripravljam novo ponudbo v vrednosti ~${Math.round(avgOrderValue)}€ — naj pošljem pregled?`;
    case 'REPEAT':
      return `Živjo ${firstName}! Ker si naš zvest kupec, bi te rad obvestil o novi ponudbi, ki bi te lahko zanimala. Imamo sveže item-e v tvoji cenovni kategoriji (${Math.round(avgOrderValue)}€).`;
    case 'OCCASIONAL':
      return `Pozdravljen ${firstName}! Upam, da si zadovoljen s prejšnjim nakupom. Imam novo ponudbo, ki bi lahko ustrezala tvojemu okusu — naj pošljem informacije?`;
    case 'ONE_TIME':
      return `Živjo ${firstName}! Hvala za tvoj nakup. Ali bi te zanimalo še kaj iz naše ponudbe? Trenutno imamo sveže item-e v tvoji kategoriji.`;
  }
}

// Build deterministic reasoning in Slovenian
function buildReasoning(
  buyerName: string,
  purchaseCount: number,
  retentionScore: number,
  retentionProbability: number,
  predictedNextPurchaseDate: string,
  churnRisk: ChurnRisk,
  segment: RetentionSegment,
): string {
  const firstName = buyerName.split(/\s+/)[0] || buyerName;
  const segTxt = segment === 'LOYAL' ? 'zvest kupec'
    : segment === 'REPEAT' ? 'povratni kupec'
    : segment === 'OCCASIONAL' ? 'občasni kupec'
    : 'enkratni kupec';
  const churnTxt = churnRisk === 'HIGH' ? 'visok churn risk'
    : churnRisk === 'MEDIUM' ? 'zmernen churn risk'
    : 'nizek churn risk';
  return `${firstName}: ${purchaseCount} nakupov, retention ${retentionScore}/100, ${churnTxt} (${segTxt}). Napovedan naslednji nakup: ${predictedNextPurchaseDate}, verjetnost ${retentionProbability}%.`;
}

// Compute expected lifetime value (projected future LTV)
function computeExpectedLTV(
  avgOrderValue: number,
  retentionProbability: number,
  segment: RetentionSegment,
): number {
  // Expected future purchases based on probability + segment baseline
  const segmentBaseline = segment === 'LOYAL' ? 5
    : segment === 'REPEAT' ? 3
    : segment === 'OCCASIONAL' ? 1.5
    : 0.5;
  const expectedFuturePurchases = segmentBaseline * (retentionProbability / 100);
  return Math.round(avgOrderValue * expectedFuturePurchases);
}

// Group sold trades by buyer name (sellLocation) — extract buyer + trade info
function groupByBuyer(soldTrades: SoldTradeRow[]): Map<string, BuyerTrade[]> {
  const buyerMap = new Map<string, BuyerTrade[]>();
  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2) continue;
    const sellMs = t.sellDate
      ? new Date(t.sellDate as unknown as Date | string).getTime()
      : 0;
    if (sellMs <= 0) continue;
    const arr = buyerMap.get(name) || [];
    arr.push({
      sellDate: sellMs,
      sellPrice: t.sellPrice ?? 0,
      sellFees: t.sellFees ?? 0,
    });
    buyerMap.set(name, arr);
  }
  return buyerMap;
}

// Compute per-buyer forecast (RFM-based deterministic metrics)
function computeBuyerForecast(
  buyerName: string,
  trades: BuyerTrade[],
  now: number,
): BuyerForecast {
  // Sort by sellDate asc
  trades.sort((a, b) => a.sellDate - b.sellDate);
  const purchaseCount = trades.length;
  const firstPurchaseMs = trades[0]!.sellDate;
  const lastPurchaseMs = trades[trades.length - 1]!.sellDate;
  const firstPurchaseDate = new Date(firstPurchaseMs).toISOString().slice(0, 10);
  const lastPurchaseDate = new Date(lastPurchaseMs).toISOString().slice(0, 10);
  const daysSinceLastPurchase = Math.max(0, Math.floor((now - lastPurchaseMs) / DAY_MS));

  // avg days between purchases
  let avgDaysBetweenPurchases = 0;
  if (trades.length >= 2) {
    let totalDays = 0;
    for (let i = 1; i < trades.length; i++) {
      totalDays += (trades[i]!.sellDate - trades[i - 1]!.sellDate) / DAY_MS;
    }
    avgDaysBetweenPurchases = totalDays / (trades.length - 1);
  }

  // LTV = sum of (sellPrice - sellFees)
  const buyerLifetimeValue = trades.reduce(
    (s, t) => s + (t.sellPrice - t.sellFees),
    0,
  );
  const avgOrderValue = buyerLifetimeValue / purchaseCount;

  // Compute segment, churn risk, retention score
  const retentionSegment = computeSegment(purchaseCount);
  const churnRisk = computeChurnRisk(
    daysSinceLastPurchase,
    avgDaysBetweenPurchases,
    retentionSegment,
  );
  const retentionScore = computeRetentionScore(
    purchaseCount,
    daysSinceLastPurchase,
    buyerLifetimeValue,
    avgDaysBetweenPurchases,
  );
  const retentionProbability = computeRetentionProbability(
    retentionScore,
    retentionSegment,
    churnRisk,
  );

  const predictedNextPurchaseDate = computePredictedNextPurchase(
    lastPurchaseMs,
    avgDaysBetweenPurchases,
  );
  const predictedNextPurchaseWindow = computePredictedWindow(
    predictedNextPurchaseDate,
    avgDaysBetweenPurchases,
  );
  const recommendedOutreachDate = computeOutreachDate(
    predictedNextPurchaseDate,
    retentionSegment,
    daysSinceLastPurchase,
  );
  const outreachMessage = buildOutreachMessage(
    buyerName,
    retentionSegment,
    purchaseCount,
    avgOrderValue,
  );
  const expectedLifetimeValue = computeExpectedLTV(
    avgOrderValue,
    retentionProbability,
    retentionSegment,
  );
  const reasoning = buildReasoning(
    buyerName,
    purchaseCount,
    retentionScore,
    retentionProbability,
    predictedNextPurchaseDate,
    churnRisk,
    retentionSegment,
  );

  return {
    buyerName: buyerName.slice(0, 100),
    purchaseCount,
    firstPurchaseDate,
    lastPurchaseDate,
    avgDaysBetweenPurchases: Math.round(avgDaysBetweenPurchases * 10) / 10,
    daysSinceLastPurchase,
    buyerLifetimeValue: Math.round(buyerLifetimeValue * 100) / 100,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    retentionScore,
    retentionProbability,
    predictedNextPurchaseDate,
    predictedNextPurchaseWindow,
    retentionSegment,
    churnRisk,
    recommendedOutreachDate,
    outreachMessage,
    expectedLifetimeValue,
    reasoning,
  };
}

// Compute deterministic summary from baseline buyers (no AI)
function computeBaselineSummary(buyers: BuyerForecast[]): Summary {
  const totalBuyers = buyers.length;
  const loyalCount = buyers.filter((b) => b.retentionSegment === 'LOYAL').length;
  const repeatCount = buyers.filter((b) => b.retentionSegment === 'REPEAT').length;
  const occasionalCount = buyers.filter((b) => b.retentionSegment === 'OCCASIONAL').length;
  const oneTimeCount = buyers.filter((b) => b.retentionSegment === 'ONE_TIME').length;
  const avgRetentionProbability = totalBuyers > 0
    ? Math.round(
        (buyers.reduce((s, b) => s + b.retentionProbability, 0) / totalBuyers) * 10,
      ) / 10
    : 0;
  const highChurnRiskCount = buyers.filter((b) => b.churnRisk === 'HIGH').length;

  let advice: string;
  if (loyalCount > 0) {
    advice = `${loyalCount} zvestih kupcev (LOYAL) z visokim retention-om — kontaktiraj jih predviden datum za ponovne nakupe. `;
    if (highChurnRiskCount > 0) {
      advice += `${highChurnRiskCount} kupcev z visokim churn risk-om — takojšnji outreach priporočljiv.`;
    }
  } else if (repeatCount > 0) {
    advice = `${repeatCount} povratnih kupcev (REPEAT) — kreiraj loyalty program za prehod v LOYAL segment. `;
    if (highChurnRiskCount > 0) {
      advice += `${highChurnRiskCount} kupcev z visokim churn risk-om — aktiviraj retention akcije.`;
    }
  } else if (occasionalCount > 0) {
    advice = `${occasionalCount} občasnih kupcev (OCCASIONAL) — spodbujaj večjo frekvenco nakupov z personaliziranimi ponudbami.`;
  } else {
    advice = `Vsi kupci so enkratni (ONE_TIME) — implementiraj post-purchase follow-up strategijo za spodbujanje ponovnih nakupov.`;
  }

  return {
    totalBuyers,
    loyalCount,
    repeatCount,
    occasionalCount,
    oneTimeCount,
    avgRetentionProbability,
    highChurnRiskCount,
    advice,
  };
}

// Build AI prompt with grounding — top 25 buyers + summary stats
function buildAiPrompt(baselineBuyers: BuyerForecast[], summary: Summary): string {
  const buyersForPrompt = baselineBuyers.slice(0, 25).map((b) => ({
    buyerName: b.buyerName,
    purchaseCount: b.purchaseCount,
    firstPurchaseDate: b.firstPurchaseDate,
    lastPurchaseDate: b.lastPurchaseDate,
    avgDaysBetweenPurchases: b.avgDaysBetweenPurchases,
    daysSinceLastPurchase: b.daysSinceLastPurchase,
    buyerLifetimeValue: b.buyerLifetimeValue,
    avgOrderValue: b.avgOrderValue,
    deterministicRetentionScore: b.retentionScore,
    deterministicRetentionProbability: b.retentionProbability,
    deterministicSegment: b.retentionSegment,
    deterministicChurnRisk: b.churnRisk,
    deterministicPredictedNextPurchase: b.predictedNextPurchaseDate,
    deterministicOutreachDate: b.recommendedOutreachDate,
  }));

  return `Si AI "Buyer Retention Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napovej KATERI kupci bodo postal repeat customers in KDAJ bodo ponovno kupili. Identificiraj buyers z visoko retention probability in priporoči outreach timing.

KUPCI Z RFM PODATKI (deterministično izračunano):
${JSON.stringify(buyersForPrompt, null, 2)}

SKUPNI POVZETEK:
- Skupno kupcev: ${summary.totalBuyers}
- LOYAL (5+ kupov): ${summary.loyalCount}
- REPEAT (3-4): ${summary.repeatCount}
- OCCASIONAL (2): ${summary.occasionalCount}
- ONE_TIME (1): ${summary.oneTimeCount}
- Visok churn risk: ${summary.highChurnRiskCount}

PRAVILA ZA AI ODGOVOR:
1. buyers: array (sprejmi obstoječe buyerName-je, posodobi retentionSegment, churnRisk, recommendedOutreachDate, outreachMessage, expectedLifetimeValue, reasoning)
   - retentionSegment: LOYAL / REPEAT / OCCASIONAL / ONE_TIME (validiraj proti enum)
   - churnRisk: LOW / MEDIUM / HIGH (validiraj proti enum)
   - retentionProbability: 0-100 (anti-hallucination clamp)
   - retentionScore: 0-100 (anti-hallucination clamp)
   - predictedNextPurchaseDate: "YYYY-MM-DD" (mora biti v prihodnosti)
   - recommendedOutreachDate: "YYYY-MM-DD" (mora biti v prihodnosti)
   - expectedLifetimeValue: 0-100000€ (anti-hallucination clamp)
   - outreachMessage: personalizirano sporočilo v slovenščini (max 400 znakov)
   - reasoning: kratek slovenski opis (max 300 znakov)
2. summary: totalBuyers, loyalCount, repeatCount, occasionalCount, oneTimeCount, avgRetentionProbability, highChurnRiskCount, advice v slovenščini

VRNI LE JSON:
{
  "buyers": [
    { "buyerName": "...", "retentionSegment": "LOYAL", "churnRisk": "LOW", "retentionProbability": 0, "retentionScore": 0, "predictedNextPurchaseDate": "YYYY-MM-DD", "recommendedOutreachDate": "YYYY-MM-DD", "expectedLifetimeValue": 0, "outreachMessage": "...", "reasoning": "..." }
  ],
  "summary": { "totalBuyers": 0, "loyalCount": 0, "repeatCount": 0, "occasionalCount": 0, "oneTimeCount": 0, "avgRetentionProbability": 0, "highChurnRiskCount": 0, "advice": "..." }
}${GROUNDING_PROMPT_SUFFIX}`;
}

// Apply AI updates to baseline buyers + summary (anti-hallucination clamps).
// Returns { finalBuyers, summary, aiUsed }. aiUsed = true whenever AI parsed
// returns an object (even if no buyers/summary actually updated).
function applyAiUpdates(
  baselineBuyers: BuyerForecast[],
  baselineSummary: Summary,
  parsed: unknown,
): { finalBuyers: BuyerForecast[]; summary: Summary; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    return { finalBuyers: baselineBuyers, summary: baselineSummary, aiUsed: false };
  }

  const parsedObj = parsed as AiRetentionResponse;
  let finalBuyers = baselineBuyers;
  let summary = baselineSummary;

  // Parse buyers — apply anti-hallucination clamps
  if (Array.isArray(parsedObj.buyers)) {
    const updated: BuyerForecast[] = [];
    for (const b of parsedObj.buyers) {
      const r = b as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const buyerName = String(r.buyerName || '').trim();
      const existing = baselineBuyers.find((bb) => bb.buyerName === buyerName);
      if (!existing) continue;

      const retentionSegment = clampEnum(
        r.retentionSegment,
        VALID_SEGMENT,
        existing.retentionSegment,
      );
      const churnRisk = clampEnum(
        r.churnRisk,
        VALID_CHURN,
        existing.churnRisk,
      );
      const retentionScore = clampNumber(
        r.retentionScore,
        0,
        100,
        existing.retentionScore,
      );
      const retentionProbability = clampNumber(
        r.retentionProbability,
        0,
        100,
        existing.retentionProbability,
      );
      // Dates must be valid future dates (anti-hallucination)
      const predictedNextPurchaseDate = clampFutureDate(
        r.predictedNextPurchaseDate,
        existing.predictedNextPurchaseDate,
      );
      const recommendedOutreachDate = clampFutureDate(
        r.recommendedOutreachDate,
        existing.recommendedOutreachDate,
      );
      // Validate window dates (earliest, latest)
      const window = r.predictedNextPurchaseWindow as Record<string, unknown> | undefined;
      const earliest = window && typeof window.earliest === 'string'
        ? clampDate(window.earliest, existing.predictedNextPurchaseWindow.earliest)
        : existing.predictedNextPurchaseWindow.earliest;
      const latest = window && typeof window.latest === 'string'
        ? clampDate(window.latest, existing.predictedNextPurchaseWindow.latest)
        : existing.predictedNextPurchaseWindow.latest;
      const expectedLifetimeValue = clampNumber(
        r.expectedLifetimeValue,
        0,
        100000,
        existing.expectedLifetimeValue,
      );
      const outreachMessage = clampString(
        r.outreachMessage,
        400,
        existing.outreachMessage,
      );
      const reasoning = clampString(
        r.reasoning,
        300,
        existing.reasoning,
      );

      updated.push({
        ...existing,
        retentionSegment,
        churnRisk,
        retentionScore: Math.round(retentionScore),
        retentionProbability: Math.round(retentionProbability),
        predictedNextPurchaseDate,
        predictedNextPurchaseWindow: { earliest, latest },
        recommendedOutreachDate,
        expectedLifetimeValue: Math.round(expectedLifetimeValue),
        outreachMessage,
        reasoning,
      });
    }
    if (updated.length > 0) {
      // Re-sort by retentionScore desc
      updated.sort((a, b) => b.retentionScore - a.retentionScore);
      finalBuyers = updated;
    }
  }

  // Parse summary
  if (parsedObj.summary && typeof parsedObj.summary === 'object') {
    const s = parsedObj.summary as Record<string, unknown>;
    summary = {
      totalBuyers: finalBuyers.length,
      loyalCount: finalBuyers.filter((b) => b.retentionSegment === 'LOYAL').length,
      repeatCount: finalBuyers.filter((b) => b.retentionSegment === 'REPEAT').length,
      occasionalCount: finalBuyers.filter((b) => b.retentionSegment === 'OCCASIONAL').length,
      oneTimeCount: finalBuyers.filter((b) => b.retentionSegment === 'ONE_TIME').length,
      avgRetentionProbability: finalBuyers.length > 0
        ? Math.round(
            (finalBuyers.reduce((sum, b) => sum + b.retentionProbability, 0) / finalBuyers.length) * 10,
          ) / 10
        : 0,
      highChurnRiskCount: finalBuyers.filter((b) => b.churnRisk === 'HIGH').length,
      advice: clampString(s.advice, 800, baselineSummary.advice),
    };
  }

  return { finalBuyers, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const buyerRetentionForecastHandler = withAiRoute<BuyerRetentionForecastInput>({
  endpoint: '/api/ai/buyer-retention-forecaster',
  maxDuration: 60,
  enforceBudget: true,
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query all SOLD trades — extract buyer info from sellLocation
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        sellLocation: true,
        buyDate: true,
      },
      take: 20000,
    });

    // Empty state — no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        buyers: [],
        summary: {
          totalBuyers: 0,
          loyalCount: 0,
          repeatCount: 0,
          occasionalCount: 0,
          oneTimeCount: 0,
          avgRetentionProbability: 0,
          highChurnRiskCount: 0,
          advice:
            'Ni SOLD trade-ov — dodaj prodane trade-e (status "sold", sellLocation = ime kupca) za napoved retention-a.',
        },
        aiUsed: false,
        message: 'Ni SOLD trade-ov — Buyer Retention Forecast ni mogoč.',
      });
    }

    // 2) Group by buyer name (sellLocation)
    const buyerMap = groupByBuyer(soldTrades);

    // Empty state — no buyer names extracted
    if (buyerMap.size === 0) {
      return apiOk({
        ok: true,
        buyers: [],
        summary: {
          totalBuyers: 0,
          loyalCount: 0,
          repeatCount: 0,
          occasionalCount: 0,
          oneTimeCount: 0,
          avgRetentionProbability: 0,
          highChurnRiskCount: 0,
          advice:
            'Ni imen kupcev v sellLocation — dodaj ime kupca v polje "sellLocation" pri SOLD trade-ih za napoved retention-a.',
        },
        aiUsed: false,
        message: 'Ni imen kupcev — Buyer Retention Forecast ni mogoč.',
      });
    }

    // 3) Compute per-buyer metrics (deterministic baseline)
    const now = Date.now();
    const baselineBuyers: BuyerForecast[] = [];
    for (const [buyerName, trades] of buyerMap.entries()) {
      baselineBuyers.push(computeBuyerForecast(buyerName, trades, now));
    }
    // Sort by retentionScore desc (highest retention first)
    baselineBuyers.sort((a, b) => b.retentionScore - a.retentionScore);

    // 4) Compute summary
    const baselineSummary = computeBaselineSummary(baselineBuyers);

    // 5) AI cache check (6h TTL) — key by totalBuyers (snapshot of buyer base)
    const cacheKey = `buyer-retention-forecast:${baselineBuyers.length}`;
    const cached = getCachedAI<{
      buyers: BuyerForecast[];
      summary: Summary;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        buyers: cached.buyers,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
    const prompt = buildAiPrompt(baselineBuyers, baselineSummary);

    let finalBuyers = baselineBuyers;
    let summary = baselineSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw);
      const result = applyAiUpdates(baselineBuyers, baselineSummary, parsed);
      finalBuyers = result.finalBuyers;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/buyer-retention-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        buyers: finalBuyers,
        summary,
      });
    }

    return apiOk({
      ok: true,
      buyers: finalBuyers,
      summary,
      aiUsed,
    });
  },
});

export const GET = buyerRetentionForecastHandler;
export const POST = buyerRetentionForecastHandler;
