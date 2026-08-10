/**
 * v7.52: Anti-Hallucination Validation Layer.
 *
 * Prevents AI from making financial decisions based on fabricated data.
 *
 * Hallucination risks in this project:
 * 1. AI invents "fair market value" with no real comps
 * 2. AI fabricates comparable sales that never happened
 * 3. AI predicts unrealistic prices (too high/low vs history)
 * 4. AI makes up seller history or platform data
 * 5. AI gives high confidence to low-data predictions
 *
 * Solution: Multi-layer validation
 * Layer 1: Prompt grounding — "only use provided data, don't invent"
 * Layer 2: Numeric sanity — prices within historical min/max × tolerance
 * Layer 3: Cross-reference — AI claims verified against DB data
 * Layer 4: Confidence threshold — reject low-confidence outputs
 * Layer 5: Hallucination patterns — detect common fabrication signals
 */

import { db } from './db';

// === LAYER 1: Prompt grounding instructions ===

export const GROUNDING_PROMPT_SUFFIX = `

STROGA PRAVILA (anti-hallucination):
1. Uporabljaj SAMO podatke iz zgornjega konteksta. NE izmišljaj cen, prodaj ali imen.
2. Če ni dovolj podatkov, nastavi confidence na 0 in razloži kaj manjka.
3. Vsaka cena mora biti utemeljena z referenco na poskypljene podatke.
4. NE omenjaj prodaj ki se ne pojavljajo v kontekstu.
5. Če ne veš, reci "neznan" — ne izmišljaj.`;

export const GROUNDING_PROMPT_STRICT = `

KRITIČNA PRAVILA (zero-hallucination mode):
1. Izhključno uporabljaj podatke iz konteksta. Izmišljanje = kritična napaka.
2. Za vsako trditev navedi vir iz konteksta (npr. "glej prodajo #3").
3. Če manjkajo podatki: confidence = 0, explanation = kaj manjka.
4. Cene morajo biti znotraj [min, max] iz konteksta. Če predlagaš ceno izven, utemelji.
5. NE omenjaj platform, prodajalcev ali oglasov ki niso v kontekstu.
6. Verjetnosti (0-100%) morajo biti utemeljene na vzorcu podatkov, ne na občutku.`;

// === LAYER 2: Numeric sanity checks ===

/**
 * Validate a price against historical range.
 * Rejects prices outside [min × tolerance, max × tolerance].
 */
export function validatePrice(
  price: number,
  historicalPrices: number[],
  tolerance: number = 0.5, // allow 50% outside historical range
): { valid: boolean; reason?: string; clampedPrice: number; historicalMin: number; historicalMax: number } {
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, reason: 'Price is not a positive finite number', clampedPrice: 0, historicalMin: 0, historicalMax: 0 };
  }

  if (historicalPrices.length === 0) {
    return { valid: true, clampedPrice: price, historicalMin: 0, historicalMax: 0 }; // no history to compare
  }

  const min = Math.min(...historicalPrices);
  const max = Math.max(...historicalPrices);
  const lowerBound = min * (1 - tolerance);
  const upperBound = max * (1 + tolerance);

  if (price < lowerBound) {
    return {
      valid: false,
      reason: `Price ${price}€ is ${(100 - (price / min) * 100).toFixed(0)}% below historical min ${min}€ — likely hallucination`,
      clampedPrice: Math.round(lowerBound),
      historicalMin: min,
      historicalMax: max,
    };
  }

  if (price > upperBound) {
    return {
      valid: false,
      reason: `Price ${price}€ is ${((price / max) * 100 - 100).toFixed(0)}% above historical max ${max}€ — likely hallucination`,
      clampedPrice: Math.round(upperBound),
      historicalMin: min,
      historicalMax: max,
    };
  }

  return { valid: true, clampedPrice: price, historicalMin: min, historicalMax: max };
}

/**
 * Sanitize any numeric value from AI output.
 * Returns null for invalid numbers.
 */
export function sanitizeNumber(value: unknown, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 100) / 100;
}

/**
 * Validate percentage (0-100).
 */
export function validatePercentage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// === LAYER 3: Cross-reference validation ===

/**
 * Verify that AI-generated "comps" actually exist in the database.
 * Prevents AI from inventing fake comparable sales.
 */
export async function verifyComps(
  aiComps: Array<{ title?: string; soldPriceEur?: number }>,
  realSoldTrades: Array<{ title: string; sellPrice: number | null }>,
): Promise<{ verified: any[]; rejected: any[] }> {
  const verified: any[] = [];
  const rejected: any[] = [];

  for (const comp of aiComps) {
    if (!comp.title || !comp.soldPriceEur) {
      rejected.push({ ...comp, reason: 'Missing title or price' });
      continue;
    }

    // Find a real trade with similar title
    const compTitleLower = comp.title.toLowerCase();
    const titleWords = compTitleLower.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    const matchingTrade = realSoldTrades.find(t => {
      const tradeTitleLower = t.title.toLowerCase();
      return titleWords.some(w => tradeTitleLower.includes(w));
    });

    if (!matchingTrade) {
      rejected.push({ ...comp, reason: 'No matching real trade found — likely hallucinated' });
      continue;
    }

    // Verify price is within ±30% of real trade price
    const realPrice = matchingTrade.sellPrice ?? 0;
    if (realPrice > 0) {
      const diffPct = Math.abs((comp.soldPriceEur - realPrice) / realPrice);
      if (diffPct > 0.3) {
        rejected.push({ ...comp, reason: `Price ${comp.soldPriceEur}€ is ${(diffPct * 100).toFixed(0)}% off from real trade ${realPrice}€ — suspicious`, realPrice });
        continue;
      }
    }

    verified.push({ ...comp, verifiedAgainst: matchingTrade.title, realPrice });
  }

  return { verified, rejected };
}

/**
 * Verify AI-claimed seller data against real DB listings.
 */
export async function verifySellerClaims(
  sellerName: string,
  aiClaimedData: { totalListings?: number; avgPrice?: number },
): Promise<{ verified: boolean; realData: any; discrepancies: string[] }> {
  const realListings = await db.listing.count({
    where: { sellerName, isHidden: false },
  });

  const discrepancies: string[] = [];

  if (aiClaimedData.totalListings && Math.abs(aiClaimedData.totalListings - realListings) > 5) {
    discrepancies.push(`AI claimed ${aiClaimedData.totalListings} listings, DB has ${realListings}`);
  }

  return {
    verified: discrepancies.length === 0,
    realData: { totalListings: realListings },
    discrepancies,
  };
}

// === LAYER 4: Confidence threshold ===

/**
 * Evaluate AI confidence and decide whether to trust the output.
 */
export function evaluateConfidence(
  confidence: number,
  sampleSize: number,
  minConfidence: number = 40,
  minSampleSize: number = 3,
): { trusted: boolean; reason: string; adjustedConfidence: number } {
  let adjusted = confidence;

  // Reduce confidence if sample size is small
  if (sampleSize < minSampleSize) {
    adjusted = Math.round(adjusted * (sampleSize / minSampleSize));
  }

  if (adjusted < minConfidence) {
    return {
      trusted: false,
      reason: `Confidence ${adjusted}% below threshold ${minConfidence}%${sampleSize < minSampleSize ? ` (sample size ${sampleSize} < ${minSampleSize})` : ''}`,
      adjustedConfidence: adjusted,
    };
  }

  return {
    trusted: true,
    reason: `Confidence ${adjusted}% OK${sampleSize < minSampleSize ? ` (reduced from ${confidence} due to small sample)` : ''}`,
    adjustedConfidence: adjusted,
  };
}

// === LAYER 5: Hallucination pattern detection ===

const HALLUCINATION_SIGNALS = [
  // Generic stock phrases AI uses when fabricating
  'glede na splošno',
  'na splošno',
  'pogosto se dogaja',
  'običajno',
  'v povprečju na trgu',
  // Specific fabrication patterns
  'po mojih podatkih', // AI claiming to have data it doesn't
  'po raziskavah',
  'po statistikah',
  // Unrealistic precision
  'natančno',
  'zagotovo',
  '100% gotovo',
];

/**
 * Detect common hallucination signals in AI text output.
 */
export function detectHallucination(text: string): { suspicious: boolean; signals: string[]; warning?: string } {
  const lower = text.toLowerCase();
  const found = HALLUCINATION_SIGNALS.filter(s => lower.includes(s));

  if (found.length >= 2) {
    return {
      suspicious: true,
      signals: found,
      warning: `Multiple hallucination signals detected: ${found.join(', ')}. AI may be fabricating data.`,
    };
  }

  // Check for unrealistic price precision (e.g., "347.83€" — too precise for used items)
  const priceMatches = text.match(/\d{3,}\.\d{2}€/g);
  if (priceMatches && priceMatches.length > 3) {
    return {
      suspicious: true,
      signals: ['unrealistic_price_precision'],
      warning: 'AI output contains multiple prices with cent-level precision — unusual for used items.',
    };
  }

  return { suspicious: false, signals: found };
}

/**
 * Full validation pipeline for AI-generated financial data.
 * Use this as a post-processing step on critical AI outputs.
 */
export function validateAIFinancialOutput(params: {
  estimatedValue?: number;
  historicalPrices: number[];
  confidence?: number;
  sampleSize?: number;
  text?: string;
  minConfidence?: number;
}): {
  trusted: boolean;
  estimatedValue: number | null;
  confidence: number;
  warnings: string[];
  clampedValue: number | null;
} {
  const warnings: string[] = [];
  let trusted = true;
  let clampedValue: number | null = null;

  // Layer 2: Price validation
  if (params.estimatedValue != null) {
    const priceCheck = validatePrice(params.estimatedValue, params.historicalPrices);
    if (!priceCheck.valid) {
      warnings.push(priceCheck.reason!);
      clampedValue = priceCheck.clampedPrice;
      trusted = false;
    } else {
      clampedValue = params.estimatedValue;
    }
  }

  // Layer 4: Confidence check
  if (params.confidence != null) {
    const confCheck = evaluateConfidence(
      params.confidence,
      params.sampleSize ?? 0,
      params.minConfidence ?? 40,
    );
    if (!confCheck.trusted) {
      warnings.push(confCheck.reason);
      trusted = false;
    }
  }

  // Layer 5: Hallucination detection
  if (params.text) {
    const hallucCheck = detectHallucination(params.text);
    if (hallucCheck.suspicious) {
      warnings.push(hallucCheck.warning!);
      trusted = false;
    }
  }

  return {
    trusted,
    estimatedValue: params.estimatedValue ?? null,
    confidence: params.confidence ?? 0,
    warnings,
    clampedValue,
  };
}
