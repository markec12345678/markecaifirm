// v8.97: ML Price Prediction — hevristični model za hitro napovedovanje cen.
//
// Namesto da za vsako cenovno napoved kličemo LLM (počasi + drago),
// uporabimo hevristični model podoben XGBoost ki deluje v <1ms.
//
// Model uporablja:
// - Zgodovinske prodajne cene (iz Trade tabele)
// - Kategorijo produktov
// - Časovne vzorce (dan v tednu, ura, sezona)
// - Price history (padec/rast cene)
// - AI estimated value (če obstaja)
//
// Formula: predictedPrice = basePrice * categoryMultiplier * timeMultiplier * trendMultiplier
//
// Uporaba:
//   import { predictPrice } from '@/lib/ml-price-prediction';
//   const prediction = await predictPrice(db, { title, category, askingPrice, aiEstimatedValue });

import type { PrismaClient } from '@prisma/client';

export interface PricePredictionInput {
  title: string;
  category?: string | null;
  askingPrice: number;
  aiEstimatedValue?: number | null;
  daysListed?: number;
}

export interface PricePrediction {
  predictedPrice: number;
  confidence: number; // 0-100
  recommendedPrice: number; // za hitro prodajo
  premiumPrice: number; // za maksimalni dobiček
  factors: {
    basePrice: number;
    categoryMultiplier: number;
    timeMultiplier: number;
    trendMultiplier: number;
  };
  reasoning: string;
}

/**
 * Hevristični ML model za napovedovanje cen.
 * Deluje v <1ms, brez AI klica — ceneje in hitreje od LLM.
 */
export async function predictPrice(
  db: PrismaClient,
  input: PricePredictionInput
): Promise<PricePrediction> {
  const { title, category, askingPrice, aiEstimatedValue, daysListed = 0 } = input;

  // 1. Osnovna cena — iz AI estimate ali asking price
  const basePrice = aiEstimatedValue && aiEstimatedValue > 0
    ? aiEstimatedValue
    : Math.round(askingPrice * 1.2); // Default 20% markup

  // 2. Kategorija multiplier — iz zgodovinskih prodaj
  const categoryStats = await getCategoryStats(db, category);
  const categoryMultiplier = categoryStats.avgMultiplier || 1.0;

  // 3. Časovni multiplier — dan v tednu + ura
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=nedelja, 1=ponedeljek...
  const hour = now.getHours();
  const timeMultiplier = getTimeMultiplier(dayOfWeek, hour);

  // 4. Trend multiplier — padec/rast cene glede na dni na trgu
  const trendMultiplier = getTrendMultiplier(daysListed);

  // 5. Izračun predvidene cene
  const predictedPrice = Math.round(
    basePrice * categoryMultiplier * timeMultiplier * trendMultiplier
  );

  // 6. Priporočila za prodajo
  const recommendedPrice = Math.round(predictedPrice * 0.9); // 10% popust za hitro prodajo
  const premiumPrice = Math.round(predictedPrice * 1.1); // 10% premium za max dobiček

  // 7. Confidence — višji če imamo več zgodovinskih podatkov
  const confidence = Math.min(95, Math.max(30,
    50 + (categoryStats.sampleSize * 2) + (aiEstimatedValue ? 15 : 0) - (daysListed > 30 ? 10 : 0)
  ));

  const reasoning = `Base: ${basePrice}€ (AI est: ${aiEstimatedValue ?? 'N/A'}) × ` +
    `Kat: ${categoryMultiplier.toFixed(2)} (${categoryStats.sampleSize} prodaj) × ` +
    `Čas: ${timeMultiplier.toFixed(2)} (${getDayName(dayOfWeek)} ${hour}:00) × ` +
    `Trend: ${trendMultiplier.toFixed(2)} (${daysListed}d) = ${predictedPrice}€`;

  return {
    predictedPrice,
    confidence,
    recommendedPrice,
    premiumPrice,
    factors: { basePrice, categoryMultiplier, timeMultiplier, trendMultiplier },
    reasoning,
  };
}

/**
 * Pridobi statistiko prodaj za kategorijo.
 */
async function getCategoryStats(
  db: PrismaClient,
  category?: string | null
): Promise<{ avgMultiplier: number; sampleSize: number }> {
  if (!category) return { avgMultiplier: 1.0, sampleSize: 0 };

  const soldTrades = await db.trade.findMany({
    where: {
      status: 'sold',
      sellPrice: { not: null },
      buyPrice: { gt: 0 },
      category: { contains: category ?? '' },
    },
    select: { buyPrice: true, sellPrice: true },
    take: 50,
  });

  if (soldTrades.length === 0) return { avgMultiplier: 1.0, sampleSize: 0 };

  const multipliers = soldTrades.map(t =>
    t.buyPrice > 0 ? (t.sellPrice ?? 0) / t.buyPrice : 1.0
  );
  const avgMultiplier = multipliers.reduce((s, m) => s + m, 0) / multipliers.length;

  return {
    avgMultiplier: Math.max(0.5, Math.min(3.0, avgMultiplier)),
    sampleSize: soldTrades.length,
  };
}

/**
 * Časovni multiplier — kdaj je najbolje objaviti oglas.
 * Na podlagi splošnih vzorcev e-commerce:
 * - Večer (18-22h): +10% (uporabniki po delu)
 * - Vikend (sobota, nedelja): +15% (prosti čas)
 * - Delavnik dopoldne: -5% (manj aktivnosti)
 */
function getTimeMultiplier(dayOfWeek: number, hour: number): number {
  let multiplier = 1.0;

  // Vikend bonus
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    multiplier *= 1.15;
  }

  // Večerni bonus
  if (hour >= 18 && hour <= 22) {
    multiplier *= 1.10;
  }

  // Delavnik dopoldne penalty
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour <= 12) {
    multiplier *= 0.95;
  }

  return multiplier;
}

/**
 * Trend multiplier — kako dolgo je item na trgu.
 * - <7 dni: 1.1 (novo, sveže — dražje)
 * - 7-14 dni: 1.0 (normalno)
 * - 14-30 dni: 0.95 (začenja zastajati)
 * - >30 dni: 0.85 (potreben popust)
 */
function getTrendMultiplier(daysListed: number): number {
  if (daysListed < 7) return 1.1;
  if (daysListed < 14) return 1.0;
  if (daysListed < 30) return 0.95;
  return 0.85;
}

function getDayName(day: number): string {
  return ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'][day] ?? '?';
}
