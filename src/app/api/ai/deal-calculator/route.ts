// v8.37: Deal Calculator API — hitra ROI kalkulacija.
//
// GET  /api/ai/deal-calculator?buyPrice=280&expectedSellPrice=380&buyFees=0&sellFees=15
//      → DealCalculatorResult { ok, netProfit, roiPct, marginPct, breakEvenPrice,
//        recommendation, riskFactors, ... }
//
// POST /api/ai/deal-calculator
//      body: { buyPrice, expectedSellPrice, buyFees, sellFees,
//              shippingCost?, refurbCost?, category?, avgHoldDays? }
//      → DealCalculatorResult
//
// Pure math — no DB, no AI. Calls calculateDeal() from src/lib/trades/deal-calculator.ts.
// Categoriziran kot 'pricing' v /api/ai-list (ker vsebuje 'cost'/'profit' besede).

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { calculateDeal, type DealCalculatorInput } from '@/lib/trades/deal-calculator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Parse a number from query param or body field.
 * Accepts both `.` and `,` as decimal separator (Slovenian locale friendly).
 * Returns NaN if missing/invalid (caller decides what to default).
 */
function parseNum(raw: unknown): number {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return NaN;
  return Number(s);
}

/**
 * Coerce raw input (query string OR parsed JSON body) into a validated
 * DealCalculatorInput. Throws Error with field name on invalid required input.
 */
function coerceInput(raw: Record<string, unknown>): DealCalculatorInput {
  const buyPrice = parseNum(raw.buyPrice);
  const expectedSellPrice = parseNum(raw.expectedSellPrice);
  const buyFees = parseNum(raw.buyFees);
  const sellFees = parseNum(raw.sellFees);

  if (!Number.isFinite(buyPrice) || buyPrice < 0) {
    throw new Error('buyPrice mora biti ne-negativno število (EUR)');
  }
  if (!Number.isFinite(expectedSellPrice) || expectedSellPrice < 0) {
    throw new Error('expectedSellPrice mora biti ne-negativno število (EUR)');
  }
  if (!Number.isFinite(buyFees) || buyFees < 0) {
    throw new Error('buyFees mora biti ne-negativno število (EUR)');
  }
  if (!Number.isFinite(sellFees) || sellFees < 0) {
    throw new Error('sellFees mora biti ne-negativno število (EUR)');
  }

  const input: DealCalculatorInput = { buyPrice, expectedSellPrice, buyFees, sellFees };

  // Optional fields — only set if provided + valid
  const shippingCost = parseNum(raw.shippingCost);
  if (Number.isFinite(shippingCost) && shippingCost >= 0) {
    input.shippingCost = shippingCost;
  }
  const refurbCost = parseNum(raw.refurbCost);
  if (Number.isFinite(refurbCost) && refurbCost >= 0) {
    input.refurbCost = refurbCost;
  }
  const avgHoldDays = parseNum(raw.avgHoldDays);
  if (Number.isFinite(avgHoldDays) && avgHoldDays > 0 && Number.isInteger(avgHoldDays)) {
    input.avgHoldDays = avgHoldDays;
  }
  if (typeof raw.category === 'string' && raw.category.trim() !== '') {
    input.category = raw.category.trim();
  }

  return input;
}

/**
 * GET handler — query params.
 *
 * Example: ?buyPrice=280&expectedSellPrice=380&buyFees=0&sellFees=15
 * Optional: &shippingCost=10&refurbCost=20&avgHoldDays=14&category=elektronika
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });

    // Required fields must be present
    for (const f of ['buyPrice', 'expectedSellPrice', 'buyFees', 'sellFees']) {
      if (!params[f]) {
        return NextResponse.json(
          { ok: false, error: `Manjka obvezni parameter: ${f}` },
          { status: 400 },
        );
      }
    }

    const input = coerceInput(params);
    const result = calculateDeal(input);
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/deal-calculator', 'GET handler failed', err);
    const status = err?.message?.includes('mora biti') ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status },
    );
  }
}

/**
 * POST handler — JSON body.
 *
 * Body: { buyPrice, expectedSellPrice, buyFees, sellFees,
 *         shippingCost?, refurbCost?, avgHoldDays?, category? }
 */
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Telo mora biti veljaven JSON' },
        { status: 400 },
      );
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'Telo mora biti JSON objekt' },
        { status: 400 },
      );
    }

    const input = coerceInput(body as Record<string, unknown>);
    const result = calculateDeal(input);
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/deal-calculator', 'POST handler failed', err);
    const status = err?.message?.includes('mora biti') ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status },
    );
  }
}
