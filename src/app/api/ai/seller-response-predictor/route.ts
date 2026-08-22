// v7.49 / v8.94.5-a: Seller Response Predictor — AI napove ali bo prodajalec odgovoril + kako hitro.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// "Ta prodajalec odgovori v povprečju 4h (hitro) — pošlji ponudbo zdaj!
//  Ta prodajalec ni odgovoril v 48h na 3 prejšnje ponudbe — preskoči."
//
// POST /api/ai/seller-response-predictor
// Body: { sellerName: string }
// Returns: { ok, prediction: { willRespond, expectedResponseHours, responseRate, confidence, recommendation } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface SellerResponseInput {
  sellerName: string;
}

export const POST = withAiRoute<SellerResponseInput>({
  endpoint: '/api/ai/seller-response-predictor',
  maxDuration: 60,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { sellerName: body?.sellerName ? String(body.sellerName) : '' };
  },

  validateInput: (input) => {
    if (!input.sellerName) return 'sellerName je obvezen';
    return null;
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db } = ctx;
    const { sellerName } = input;

    // 1. Pridobi vse listing-e tega prodajalca z zgodovino kontaktov
    const listings = await db.listing.findMany({
      where: { sellerName: sellerName },
      select: {
        id: true, title: true, contactStatus: true, contactedAt: true,
        sellerResponse: true, firstSeenAt: true,
        negotiationMessages: {
          select: { direction: true, createdAt: true, status: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      take: 100,
    });

    if (listings.length === 0) {
      return apiOk({
        ok: true,
        prediction: {
          willRespond: 'UNKNOWN',
          expectedResponseHours: null,
          responseRate: 0,
          confidence: 0,
          recommendation: 'Ni zgodovine za tega prodajalca — pošlji ponudbo in čakaj.',
        },
      });
    }

    // 2. Analiziraj zgodovino kontaktov
    const { contacted, responded, noResponse, responseRate } = analyzeContactHistory(listings);
    const { avgResponseHours, minResponseHours, maxResponseHours } = computeResponseTimes(listings);

    // 3. Napoved + priporočilo
    const prediction = computePrediction(responseRate, avgResponseHours, contacted.length);
    const recommendation = buildRecommendation(
      sellerName, prediction.willRespond, responseRate, avgResponseHours, noResponse.length, prediction.expectedResponseHours
    );

    return apiOk({
      ok: true,
      prediction: {
        willRespond: prediction.willRespond,
        expectedResponseHours: prediction.expectedResponseHours,
        responseRate,
        confidence: prediction.confidence,
        avgResponseHours,
        minResponseHours: minResponseHours ? Math.round(minResponseHours) : null,
        maxResponseHours: maxResponseHours ? Math.round(maxResponseHours) : null,
        totalContacted: contacted.length,
        totalResponded: responded.length,
        totalNoResponse: noResponse.length,
        recommendation,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ListingRow {
  contactStatus: string;
  negotiationMessages: Array<{ direction: string; createdAt: Date }>;
}

interface ContactBreakdown {
  contacted: ListingRow[];
  responded: ListingRow[];
  noResponse: ListingRow[];
  responseRate: number;
}

function analyzeContactHistory(listings: ListingRow[]): ContactBreakdown {
  const contacted = listings.filter(l => l.contactStatus !== 'none');
  const responded = listings.filter(l => l.contactStatus === 'responded' || l.contactStatus === 'closed');
  const noResponse = listings.filter(l => l.contactStatus === 'contacted'); // contacted but no response
  const responseRate = contacted.length > 0 ? Math.round((responded.length / contacted.length) * 100) : 0;
  return { contacted, responded, noResponse, responseRate };
}

interface ResponseTimeStats {
  avgResponseHours: number | null;
  minResponseHours: number | null;
  maxResponseHours: number | null;
}

function computeResponseTimes(listings: ListingRow[]): ResponseTimeStats {
  // Compute response time from negotiation messages: first 'sent' followed by first 'received'
  const responseTimes: number[] = [];
  for (const l of listings) {
    const msgs = l.negotiationMessages;
    if (msgs.length < 2) continue;
    let sentTime: Date | null = null;
    for (const m of msgs) {
      if (m.direction === 'sent' && !sentTime) {
        sentTime = new Date(m.createdAt);
      } else if (m.direction === 'received' && sentTime) {
        const hours = (new Date(m.createdAt).getTime() - sentTime.getTime()) / 3600000;
        if (hours >= 0 && hours < 168) { // within 7 days
          responseTimes.push(hours);
        }
        sentTime = null;
      }
    }
  }

  const avgResponseHours = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, h) => s + h, 0) / responseTimes.length)
    : null;
  const minResponseHours = responseTimes.length > 0 ? Math.min(...responseTimes) : null;
  const maxResponseHours = responseTimes.length > 0 ? Math.max(...responseTimes) : null;
  return { avgResponseHours, minResponseHours, maxResponseHours };
}

type WillRespond = 'FAST' | 'LIKELY' | 'UNLIKELY' | 'UNKNOWN';

interface Prediction {
  willRespond: WillRespond;
  expectedResponseHours: number | null;
  confidence: number;
}

function computePrediction(
  responseRate: number,
  avgResponseHours: number | null,
  contactedCount: number
): Prediction {
  if (responseRate >= 70 && avgResponseHours !== null && avgResponseHours <= 12) {
    return {
      willRespond: 'FAST',
      expectedResponseHours: avgResponseHours,
      confidence: Math.min(95, 50 + responseRate / 2),
    };
  }
  if (responseRate >= 50) {
    return {
      willRespond: 'LIKELY',
      expectedResponseHours: avgResponseHours ?? 24,
      confidence: Math.min(70, 30 + responseRate / 2),
    };
  }
  if (responseRate >= 20) {
    return {
      willRespond: 'UNLIKELY',
      expectedResponseHours: avgResponseHours ?? 48,
      confidence: 40,
    };
  }
  if (contactedCount === 0) {
    return {
      willRespond: 'UNKNOWN',
      expectedResponseHours: null,
      confidence: 0,
    };
  }
  return {
    willRespond: 'UNLIKELY',
    expectedResponseHours: null,
    confidence: 30,
  };
}

function buildRecommendation(
  sellerName: string,
  willRespond: WillRespond,
  responseRate: number,
  avgResponseHours: number | null,
  noResponseCount: number,
  expectedResponseHours: number | null
): string {
  if (willRespond === 'FAST') {
    return `✅ ${sellerName} odgovori hitro (avg ${avgResponseHours}h, ${responseRate}% response rate). Pošlji ponudbo ZDAJ — verjetno bo odgovoril v ${expectedResponseHours}h!`;
  }
  if (willRespond === 'LIKELY') {
    return `🟡 ${sellerName} verjetno odgovori (${responseRate}% rate, avg ${avgResponseHours ?? '?'}h). Vredno poskusiti, a ne čakaj predolgo.`;
  }
  if (willRespond === 'UNLIKELY') {
    return `🔴 ${sellerName} redko odgovori (${responseRate}% rate, ${noResponseCount} neodgovorjenih). Preskoči — porabi čas na drugih prodajalcih.`;
  }
  return `❓ Ni zgodovine za ${sellerName}. Pošlji ponudbo in preveri v 24h.`;
}
