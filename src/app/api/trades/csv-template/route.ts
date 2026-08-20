// v8.36: CSV Template Download — GET returns a CSV template for users to
// fill in. Headers + one example row, comma-delimited (Excel-friendly).
//
// Returns: text/csv with Content-Disposition: attachment; filename="trade-template.csv"
//
// Headers: title, category, buyPrice, buyDate, buyLocation, buyFees,
//          sellPrice, sellDate, sellLocation, sellFees, status, notes
//
// Used by the "📄 Prenesi predlogo CSV" link in the trades-view import dialog.

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { generateCsvTemplate } from '@/lib/trades/csv-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/trades/csv-template
 *
 * Returns CSV template as text/csv attachment.
 */
export async function GET() {
  try {
    const csv = generateCsvTemplate();
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="trade-template.csv"',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: unknown) {
    return apiError('/api/trades/csv-template', 'GET failed', err);
  }
}
