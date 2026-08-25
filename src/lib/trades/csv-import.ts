// v8.36: CSV Import — parses CSV text into Trade records.
//
// Supports headers: title, category, buyPrice, buyDate, buyLocation, buyFees,
// sellPrice, sellDate, sellLocation, sellFees, status, notes
//
// Flexible: accepts both Slovenian and English headers, handles commas in
// quoted fields, auto-detects , or ; delimiter, strips BOM, skips invalid
// rows (returns errors array alongside valid rows).
//
// Used by:
//   - POST /api/trades/import-csv  — bulk import trades from CSV
//   - GET  /api/trades/csv-template — CSV template download for users
//
// No AI / no DB calls — pure parsing/validation logic. The route handler
// is responsible for persisting the validated rows to the Trade table.

export interface CsvImportRow {
  rowNumber: number;
  data: {
    title: string;
    category: string;
    buyPrice: number;
    buyDate: Date;
    buyLocation: string;
    buyFees: number;
    sellPrice: number | null;
    sellDate: Date | null;
    sellLocation: string;
    sellFees: number;
    status: 'held' | 'sold' | 'cancelled';
    notes: string;
  };
}

export interface CsvImportError {
  rowNumber: number;
  field: string;
  message: string;
  rawValue: string;
}

export interface CsvImportResult {
  ok: boolean;
  valid: CsvImportRow[];
  errors: CsvImportError[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}

// Header mapping (Slovenian + English → canonical)
const HEADER_MAP: Record<string, string> = {
  'naslov': 'title',
  'title': 'title',
  'naziv': 'title',
  'kategorija': 'category',
  'category': 'category',
  'kat': 'category',
  'nakupcena': 'buyPrice',
  'buyprice': 'buyPrice',
  'cena_nakupa': 'buyPrice',
  'nakupdatum': 'buyDate',
  'buydate': 'buyDate',
  'datum_nakupa': 'buyDate',
  'nakupkraj': 'buyLocation',
  'buylocation': 'buyLocation',
  'kraj_nakupa': 'buyLocation',
  'nakuppristojbine': 'buyFees',
  'buyfees': 'buyFees',
  'prodajacena': 'sellPrice',
  'sellprice': 'sellPrice',
  'cena_prodaje': 'sellPrice',
  'prodajadatum': 'sellDate',
  'selldate': 'sellDate',
  'datum_prodaje': 'sellDate',
  'prodajakraj': 'sellLocation',
  'selllocation': 'sellLocation',
  'kraj_prodaje': 'sellLocation',
  'prodajapristojbine': 'sellFees',
  'sellfees': 'sellFees',
  'status': 'status',
  'stanje': 'status',
  'opombe': 'notes',
  'notes': 'notes',
};

/**
 * Parse CSV text into rows. Handles:
 * - Quoted fields with commas ("hello, world")
 * - Escaped quotes ("he said ""hi""")
 * - Both , and ; as delimiters (auto-detect from first line)
 * - BOM (byte order mark)
 * - \r\n and \n line endings
 */
export function parseCsv(csvText: string): string[][] {
  // Remove BOM
  const text = csvText.replace(/^\uFEFF/, '');

  // Auto-detect delimiter (, or ;) — use the one that appears more in the first line
  const firstLine = text.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++; // skip \r\n
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 1 || currentRow[0] !== '') {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += char;
      }
    }
  }
  // Last field
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Validate and convert parsed CSV rows into Trade records.
 *
 * First row is treated as headers (matched against HEADER_MAP — both
 * Slovenian and English variants accepted). Rows with invalid data are
 * reported in `errors` but do not block valid rows from being returned.
 */
export function validateCsvRows(rows: string[][]): CsvImportResult {
  const valid: CsvImportRow[] = [];
  const errors: CsvImportError[] = [];

  if (rows.length === 0) {
    return {
      ok: false,
      valid: [],
      errors: [{ rowNumber: 0, field: 'file', message: 'CSV je prazen', rawValue: '' }],
      totalRows: 0,
      validCount: 0,
      errorCount: 1,
    };
  }

  // First row = headers
  const headerRow = rows[0].map((h) => h.trim().toLowerCase().replace(/\s/g, ''));
  const columnMap: Record<number, string> = {};
  headerRow.forEach((header, i) => {
    const canonical = HEADER_MAP[header];
    if (canonical) columnMap[i] = canonical;
  });

  // Check required columns
  if (
    !Object.values(columnMap).includes('title') ||
    !Object.values(columnMap).includes('buyPrice')
  ) {
    return {
      ok: false,
      valid: [],
      errors: [
        {
          rowNumber: 0,
          field: 'headers',
          message: 'Manjkajo obvezne kolone: title in buyPrice',
          rawValue: headerRow.join(', '),
        },
      ],
      totalRows: 0,
      validCount: 0,
      errorCount: 1,
    };
  }

  // Parse data rows (skip header)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || (row.length === 1 && row[0] === '')) continue; // skip empty

    // rowData fields are dynamic per CSV header mapping (no fixed shape)
    const rowData: Record<string, unknown> = {};
    let hasError = false;

    for (let c = 0; c < row.length; c++) {
      const canonical = columnMap[c];
      if (!canonical) continue;
      const rawValue = row[c]?.trim() || '';

      try {
        switch (canonical) {
          case 'title':
            if (!rawValue) {
              errors.push({ rowNumber: r + 1, field: 'title', message: 'Title je prazen', rawValue });
              hasError = true;
            }
            rowData.title = rawValue;
            break;
          case 'category':
            rowData.category = rawValue || '';
            break;
          case 'buyPrice': {
            const buyPrice = parseFloat(rawValue.replace(',', '.'));
            if (isNaN(buyPrice) || buyPrice < 0) {
              errors.push({ rowNumber: r + 1, field: 'buyPrice', message: 'Neveljavna cena', rawValue });
              hasError = true;
            }
            rowData.buyPrice = buyPrice;
            break;
          }
          case 'buyDate': {
            const buyDate = new Date(rawValue);
            if (isNaN(buyDate.getTime())) {
              errors.push({ rowNumber: r + 1, field: 'buyDate', message: 'Neveljaven datum (uporabi YYYY-MM-DD)', rawValue });
              hasError = true;
            }
            rowData.buyDate = buyDate;
            break;
          }
          case 'buyLocation':
            rowData.buyLocation = rawValue || '';
            break;
          case 'buyFees':
            rowData.buyFees = parseFloat(rawValue.replace(',', '.')) || 0;
            break;
          case 'sellPrice':
            rowData.sellPrice = rawValue ? parseFloat(rawValue.replace(',', '.')) : null;
            break;
          case 'sellDate':
            rowData.sellDate = rawValue ? new Date(rawValue) : null;
            break;
          case 'sellLocation':
            rowData.sellLocation = rawValue || '';
            break;
          case 'sellFees':
            rowData.sellFees = parseFloat(rawValue.replace(',', '.')) || 0;
            break;
          case 'status': {
            const status = rawValue.toLowerCase();
            rowData.status = ['held', 'sold', 'cancelled'].includes(status) ? status : 'held';
            break;
          }
          case 'notes':
            rowData.notes = rawValue || '';
            break;
        }
      } catch {
        errors.push({ rowNumber: r + 1, field: canonical, message: 'Napaka pri parsanju', rawValue });
        hasError = true;
      }
    }

    if (!hasError && rowData.title && typeof rowData.buyPrice === 'number') {
      // Apply defaults for optional fields that weren't in the CSV.
      // Required: title + buyPrice (already validated). All others default
      // to Trade model defaults if missing.
      const typed: CsvImportRow['data'] = {
        title: String(rowData.title),
        category: typeof rowData.category === 'string' ? rowData.category : '',
        buyPrice: Number(rowData.buyPrice),
        buyDate: rowData.buyDate instanceof Date ? rowData.buyDate : new Date(),
        buyLocation: typeof rowData.buyLocation === 'string' ? rowData.buyLocation : '',
        buyFees: typeof rowData.buyFees === 'number' ? rowData.buyFees : 0,
        sellPrice:
          typeof rowData.sellPrice === 'number' ? rowData.sellPrice : null,
        sellDate: rowData.sellDate instanceof Date ? rowData.sellDate : null,
        sellLocation:
          typeof rowData.sellLocation === 'string' ? rowData.sellLocation : '',
        sellFees: typeof rowData.sellFees === 'number' ? rowData.sellFees : 0,
        status:
          rowData.status === 'held' ||
          rowData.status === 'sold' ||
          rowData.status === 'cancelled'
            ? rowData.status
            : 'held',
        notes: typeof rowData.notes === 'string' ? rowData.notes : '',
      };
      valid.push({ rowNumber: r + 1, data: typed });
    }
  }

  return {
    ok: valid.length > 0,
    valid,
    errors,
    totalRows: rows.length - 1,
    validCount: valid.length,
    errorCount: errors.length,
  };
}

/**
 * Generate CSV template for download.
 *
 * Two rows: header + example. Uses commas as delimiter (Excel-friendly).
 */
export function generateCsvTemplate(): string {
  const headers = [
    'title',
    'category',
    'buyPrice',
    'buyDate',
    'buyLocation',
    'buyFees',
    'sellPrice',
    'sellDate',
    'sellLocation',
    'sellFees',
    'status',
    'notes',
  ];
  const exampleRow = [
    'iPhone 13 128GB',
    'elektronika',
    '280',
    '2026-07-01',
    'Bolha',
    '0',
    '380',
    '2026-07-25',
    'Bolha',
    '15',
    'sold',
    '',
  ];
  return [headers.join(','), exampleRow.join(',')].join('\n');
}
