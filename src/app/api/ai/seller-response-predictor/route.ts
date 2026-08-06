// v7.49: Seller Response Predictor — AI napove ali bo prodajalec odgovoril + kako hitro.
//
// "Ta prodajalec odgovori v povprečju 4h (hitro) — pošlji ponudbo zdaj!
//  Ta prodajalec ni odgovoril v 48h na 3 prejšnje ponudbe — preskoči."
//
// POST /api/ai/seller-response-predictor
// Body: { sellerName: string }
// Returns: { ok, prediction: { willRespond, expectedResponseHours, responseRate, confidence, recommendation } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sellerName } = body;
    if (!sellerName) return NextResponse.json({ error: 'sellerName je obvezen' }, { status: 400 });

    // Get all listings by this seller with contact tracking
    const listings = await db.listing.findMany({
      where: { sellerName: sellerName },
      select: {
        id: true, title: true, contactStatus: true, contactedAt: true,
        sellerResponse: true, firstSeenAt: true,
        negotiationMessages: { select: { direction: true, createdAt: true, status: true }, orderBy: { createdAt: 'asc' } },
      },
      take: 100,
    });

    if (listings.length === 0) {
      return NextResponse.json({
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

    // Analyze contact history
    const contacted = listings.filter(l => l.contactStatus !== 'none');
    const responded = listings.filter(l => l.contactStatus === 'responded' || l.contactStatus === 'closed');
    const noResponse = listings.filter(l => l.contactStatus === 'contacted'); // contacted but no response

    const responseRate = contacted.length > 0 ? Math.round((responded.length / contacted.length) * 100) : 0;

    // Compute response time from negotiation messages
    const responseTimes: number[] = [];
    for (const l of listings) {
      const msgs = l.negotiationMessages;
      if (msgs.length < 2) continue;
      // Find first 'sent' followed by first 'received'
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

    // Prediction
    let willRespond: 'FAST' | 'LIKELY' | 'UNLIKELY' | 'UNKNOWN';
    let expectedResponseHours: number | null = null;
    let confidence = 0;

    if (responseRate >= 70 && avgResponseHours !== null && avgResponseHours <= 12) {
      willRespond = 'FAST';
      expectedResponseHours = avgResponseHours;
      confidence = Math.min(95, 50 + responseRate / 2);
    } else if (responseRate >= 50) {
      willRespond = 'LIKELY';
      expectedResponseHours = avgResponseHours ?? 24;
      confidence = Math.min(70, 30 + responseRate / 2);
    } else if (responseRate >= 20) {
      willRespond = 'UNLIKELY';
      expectedResponseHours = avgResponseHours ?? 48;
      confidence = 40;
    } else if (contacted.length === 0) {
      willRespond = 'UNKNOWN';
      expectedResponseHours = null;
      confidence = 0;
    } else {
      willRespond = 'UNLIKELY';
      expectedResponseHours = null;
      confidence = 30;
    }

    // Recommendation
    let recommendation = '';
    if (willRespond === 'FAST') {
      recommendation = `✅ ${sellerName} odgovori hitro (avg ${avgResponseHours}h, ${responseRate}% response rate). Pošlji ponudbo ZDAJ — verjetno bo odgovoril v ${expectedResponseHours}h!`;
    } else if (willRespond === 'LIKELY') {
      recommendation = `🟡 ${sellerName} verjetno odgovori (${responseRate}% rate, avg ${avgResponseHours ?? '?'}h). Vredno poskusiti, a ne čakaj predolgo.`;
    } else if (willRespond === 'UNLIKELY') {
      recommendation = `🔴 ${sellerName} redko odgovori (${responseRate}% rate, ${noResponse.length} neodgovorjenih). Preskoči — porabi čas na drugih prodajalcih.`;
    } else {
      recommendation = `❓ Ni zgodovine za ${sellerName}. Pošlji ponudbo in preveri v 24h.`;
    }

    return NextResponse.json({
      ok: true,
      prediction: {
        willRespond,
        expectedResponseHours,
        responseRate,
        confidence,
        avgResponseHours,
        minResponseHours: minResponseHours ? Math.round(minResponseHours) : null,
        maxResponseHours: maxResponseHours ? Math.round(maxResponseHours) : null,
        totalContacted: contacted.length,
        totalResponded: responded.length,
        totalNoResponse: noResponse.length,
        recommendation,
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/seller-response-predictor', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
