// v8.37 / v8.95.5-deal: Deal Calculator API — hitra ROI kalkulacija.
// Refaktoriran z withAiRoute helperjem (v8.95.5-deal) + enforceBudget guard.
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

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { calculateDeal, type DealCalculatorInput } from '@/lib/trades/deal-calculator';
import type { NextResponse } from 'next/server';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface DealCalcRawInput {
  raw: Record<string, unknown>;
}

const REQUIRED_FIELDS = ['buyPrice', 'expectedSellPrice', 'buyFees', 'sellFees'] as const;

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
 * GET validateInput — required fields must be present (pre-check pred coerceInput).
 * Konsistentno z originalom v8.37 (GET vrne "Manjka obvezni parameter: X").
 */
function validateRequiredFields(raw: Record<string, unknown>): string | null {
  for (const f of REQUIRED_FIELDS) {
    if (raw[f] == null || raw[f] === '') {
      return `Manjka obvezni parameter: ${f}`;
    }
  }
  return null;
}

/**
 * Skupni handler za GET in POST — coerceInput + calculateDeal.
 * coerceInput napake (vsebujejo "mora biti") pretvori v ApiRouteError(400).
 */
async function dealCalcHandler(input: DealCalcRawInput, _ctx: AiRouteContext): Promise<NextResponse> {
  let dealInput: DealCalculatorInput;
  try {
    dealInput = coerceInput(input.raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Napaka';
    throw new ApiRouteError(msg, 400);
  }
  return apiOk(calculateDeal(dealInput));
}

/**
 * GET handler — query params.
 *
 * Example: ?buyPrice=280&expectedSellPrice=380&buyFees=0&sellFees=15
 * Optional: &shippingCost=10&refurbCost=20&avgHoldDays=14&category=elektronika
 */
export const GET = withAiRoute<DealCalcRawInput>({
  endpoint: '/api/ai/deal-calculator',
  maxDuration: 90,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req) => {
    const url = new URL(req.url);
    const raw: Record<string, unknown> = {};
    url.searchParams.forEach((v, k) => { raw[k] = v; });
    return { raw };
  },

  validateInput: (input) => validateRequiredFields(input.raw),

  handler: dealCalcHandler,
});

/**
 * POST handler — JSON body.
 *
 * Body: { buyPrice, expectedSellPrice, buyFees, sellFees,
 *         shippingCost?, refurbCost?, avgHoldDays?, category? }
 */
export const POST = withAiRoute<DealCalcRawInput>({
  endpoint: '/api/ai/deal-calculator',
  maxDuration: 90,
  enforceBudget: true,
  method: 'POST',

  parseBody: async (req) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiRouteError('Telo mora biti veljaven JSON', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new ApiRouteError('Telo mora biti JSON objekt', 400);
    }
    return { raw: body as Record<string, unknown> };
  },

  // No validateInput — coerceInput v handler-ju validira in vrne 400 z "mora biti" sporočilom
  handler: dealCalcHandler,
});
