// v8.36: CSV Import API — POST accepts { csv: string } (JSON) or multipart
// file upload (form field 'file'), parses CSV via parseCsv(), validates each
// row via validateCsvRows(), and bulk-creates trades in the Trade table.
//
// Returns: { ok, created, errors, totalRows, validCount, errorCount }
//
// Flexible: accepts both Slovenian (naslov, kategorija, nakupcena, ...) and
// English (title, category, buyPrice, ...) headers, auto-detects , or ;
// delimiter, handles quoted fields with commas, strips BOM.
//
// Invalid rows are reported in `errors` array but do NOT block valid rows
// from being created. The route is idempotent in the sense that re-importing
// the same CSV will create duplicates — caller is responsible for dedup.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { parseCsv, validateCsvRows } from '@/lib/trades/csv-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Extract CSV text from the request body.
 *
 * Two modes:
 *   1. JSON body with `csv` field: `{ "csv": "title,category,..." }`
 *   2. multipart/form-data with `file` field (the uploaded CSV file).
 */
async function extractCsvText(req: NextRequest): Promise<string | null> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file');
    if (file && file instanceof File) {
      return await file.text();
    }
    // Fallback: maybe `csv` field in form data
    const csvField = formData.get('csv');
    if (csvField && typeof csvField === 'string') {
      return csvField;
    }
    return null;
  }

  // JSON body
  try {
    const body = await req.json();
    if (body && typeof body.csv === 'string') return body.csv;
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/trades/import-csv
 *
 * Body: JSON `{ csv: string }` or multipart/form-data with `file` field.
 *
 * Returns summary: created count + per-row errors. Invalid rows are skipped
 * (not created) but valid rows proceed — partial success is supported.
 */
export async function POST(req: NextRequest) {
  try {
    const csvText = await extractCsvText(req);
    if (!csvText || csvText.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Manjka CSV vsebina (pošlji JSON {csv} ali multipart file)' },
        { status: 400 },
      );
    }

    // Parse + validate
    const parsed = parseCsv(csvText);
    const result = validateCsvRows(parsed);

    if (result.valid.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Nobena vrstica ni veljavna — preveri CSV format in glavo',
          errors: result.errors,
          totalRows: result.totalRows,
          validCount: 0,
          errorCount: result.errorCount,
        },
        { status: 400 },
      );
    }

    // Bulk create — use createMany for performance
    // Note: Prisma createMany doesn't return created records, just count.
    const createData = result.valid.map((row) => ({
      title: String(row.data.title),
      category: String(row.data.category || ''),
      buyPrice: Number(row.data.buyPrice),
      buyDate: row.data.buyDate,
      buyLocation: String(row.data.buyLocation || ''),
      buyFees: Number(row.data.buyFees) || 0,
      sellPrice: row.data.sellPrice != null ? Number(row.data.sellPrice) : null,
      sellDate: row.data.sellDate,
      sellLocation: String(row.data.sellLocation || ''),
      sellFees: Number(row.data.sellFees) || 0,
      status: String(row.data.status),
      notes: String(row.data.notes || ''),
    }));

    const createResult = await db.trade.createMany({
      data: createData,
    });

    logger.info('/api/trades/import-csv', `imported ${createResult.count} trades`, {
      totalRows: result.totalRows,
      valid: result.validCount,
      errors: result.errorCount,
    });

    return NextResponse.json({
      ok: true,
      created: createResult.count,
      errors: result.errors,
      totalRows: result.totalRows,
      validCount: result.validCount,
      errorCount: result.errorCount,
    });
  } catch (err: any) {
    logger.error('/api/trades/import-csv', 'POST handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri uvozu CSV' },
      { status: 500 },
    );
  }
}
