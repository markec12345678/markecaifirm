// v8.43: Tax Report PDF Generator.
//
// GET /api/trades/tax-report-pdf?year=2026
//   → application/pdf binary download (Content-Disposition: attachment)
//
// Generates a professional PDF tax report suitable for accountant/FURS:
//   - Section 1: Povzetek (totalRevenue, totalCost, grossProfit, estimatedTax, netProfit)
//   - Section 2: Četrtletni pregled (Q1-Q4 table)
//   - Section 3: Mesečni pregled (Jan-Dec table with cumulative)
//   - Section 4: Top 5 transakcij (table)
//   - Section 5: Kategorijski pregled (table)
//   - Section 6: Viri prihodka (source platform breakdown table)
//   - Footer: "Generirano z Markec AI Firm v8.43 · <timestamp>"
//
// Uses pdfkit for PDF generation (pure JS, no external deps). DejaVu Sans
// font (bundled at /assets/fonts/) is used for full Slovenian character
// support (č, š, ž, ć, đ).
//
// Tax model: Slovenian flat 22% (poenostavljena stopnja za dohodek iz dejavnosti).
// Above 60.000€/yr — out of scope, must register as s.p.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=30s

import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
// v8.43: pdfkit types are declared globally (PDFKit namespace) in @types/pdfkit.
// We import the default export (constructor function) via esModuleInterop.
// At runtime it's the PDFDocument constructor; TypeScript types it as an
// instance due to the unusual `export = doc; var doc: PDFKit.PDFDocument`
// declaration in @types/pdfkit. We cast through `unknown` to construct.
import PDFDocument from 'pdfkit';
import { logger } from '@/lib/logger';
import { getAnnualSummary, fmtEUR } from '@/lib/trades/annual-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Font paths (bundled with project to ensure Slovenian char support across environments)
const FONT_REGULAR = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

// Fallback to system path if bundled fonts not available (dev environment)
function resolveFontPath(bundled: string, systemFallback: string): string {
  try {
    if (fs.existsSync(bundled)) return bundled;
  } catch { /* ignore */ }
  return systemFallback;
}

const REGULAR_FONT = resolveFontPath(FONT_REGULAR, '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const BOLD_FONT = resolveFontPath(FONT_BOLD, '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');

function parseYear(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('year');
    if (!raw) return new Date().getFullYear();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 2000 || n > 2100) {
      return new Date().getFullYear();
    }
    return n;
  } catch {
    return new Date().getFullYear();
  }
}

// ─── Helpers for table drawing ─────────────────────────────────────────────

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

function drawTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Column[],
  rows: string[][],
  options: { headerBg?: [number, number, number]; rowHeight?: number; fontSize?: number } = {},
): number {
  const headerBg = options.headerBg ?? [0.95, 0.95, 0.95];
  const rowHeight = options.rowHeight ?? 18;
  const fontSize = options.fontSize ?? 9;
  const headerHeight = 22;
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);

  // Page break check
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const neededHeight = headerHeight + rows.length * rowHeight;
  if (y + neededHeight > pageBottom) {
    doc.addPage();
    y = doc.y;
  }

  // Header background
  doc.save();
  doc.rect(x, y, tableWidth, headerHeight).fill([headerBg[0], headerBg[1], headerBg[2]]);
  doc.restore();

  // Header text
  doc.font(BOLD_FONT).fontSize(fontSize).fillColor([0.1, 0.1, 0.1]);
  let cx = x;
  for (const col of cols) {
    const align = col.align ?? 'left';
    if (align === 'right') {
      doc.text(col.header, cx + 4, y + 5, { width: col.width - 8, align: 'right' });
    } else if (align === 'center') {
      doc.text(col.header, cx + 4, y + 5, { width: col.width - 8, align: 'center' });
    } else {
      doc.text(col.header, cx + 4, y + 5, { width: col.width - 8, align: 'left' });
    }
    cx += col.width;
  }

  y += headerHeight;

  // Rows
  doc.font(REGULAR_FONT);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Zebra striping
    if (i % 2 === 1) {
      doc.save();
      doc.rect(x, y, tableWidth, rowHeight).fill([0.97, 0.97, 0.97]);
      doc.restore();
    }

    doc.fillColor([0.15, 0.15, 0.15]);
    cx = x;
    for (let j = 0; j < cols.length; j++) {
      const col = cols[j];
      const val = row[j] ?? '';
      const align = col.align ?? 'left';
      if (align === 'right') {
        doc.text(val, cx + 4, y + 4, { width: col.width - 8, align: 'right' });
      } else if (align === 'center') {
        doc.text(val, cx + 4, y + 4, { width: col.width - 8, align: 'center' });
      } else {
        doc.text(val, cx + 4, y + 4, { width: col.width - 8, align: 'left' });
      }
      cx += col.width;
    }

    y += rowHeight;
  }

  // Border
  doc.save();
  doc.lineWidth(0.5);
  doc.rect(x, y - headerHeight - rows.length * rowHeight, tableWidth, headerHeight + rows.length * rowHeight).stroke([0.5, 0.5, 0.5]);
  doc.restore();

  return y + 8;
}

// ─── PDF generator ─────────────────────────────────────────────────────────

async function generateTaxReportPDF(year: number): Promise<Buffer> {
  const summary = await getAnnualSummary(year);

  // v8.43: pdfkit's default export is the constructor function at runtime.
  // TypeScript types it as an instance (via `export = doc` in @types/pdfkit)
  // so we cast through `unknown` to a constructor type for `new`.
  //
  // IMPORTANT: We pass `font: REGULAR_FONT` (path to DejaVu Sans TTF) so
  // pdfkit uses our bundled TTF as the initial font. Without this, pdfkit
  // would try to load its default `Helvetica.afm` from `__dirname/data/`
  // which doesn't exist when Next.js bundles the module (the .afm data
  // files are not included in the bundle). Loading TTF directly also gives
  // us full Slovenian character support (č, š, ž, ć, đ).
  const PDFDocumentCtor = PDFDocument as unknown as new (opts: {
    size?: string;
    margins?: { top: number; bottom: number; left: number; right: number };
    info?: Record<string, string>;
    font?: string;
    bufferPages?: boolean;
  }) => PDFKit.PDFDocument;
  const doc = new PDFDocumentCtor({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title: `Davčno poročilo ${year} — Markec AI Firm`,
      Author: 'Markec AI Firm v8.43',
      Subject: `Letno davčno poročilo za leto ${year}`,
      Creator: 'Markec AI Firm v8.43 — /api/trades/tax-report-pdf',
    },
    // Load bundled DejaVu Sans as default font (avoids missing Helvetica.afm
    // when bundled by Next.js, and ensures Slovenian char support).
    font: REGULAR_FONT,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left;

  // ─── Title ──────────────────────────────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(20).fillColor([0.1, 0.1, 0.1])
    .text('DAVČNO POROČILO', x, doc.y, { align: 'center', width: contentWidth });
  doc.font(REGULAR_FONT).fontSize(14).fillColor([0.3, 0.3, 0.3])
    .text(`LETO ${year}`, x, doc.y + 4, { align: 'center', width: contentWidth });
  doc.moveDown(0.5);
  doc.font(REGULAR_FONT).fontSize(9).fillColor([0.4, 0.4, 0.4])
    .text('Generirano z Markec AI Firm v8.43', x, doc.y, { align: 'center', width: contentWidth });
  doc.moveDown(0.3);
  const genAt = new Date().toLocaleString('sl-SI', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.text(`Generirano: ${genAt}`, x, doc.y, { align: 'center', width: contentWidth });
  doc.moveDown(0.5);

  // Horizontal rule
  const ruleY = doc.y;
  doc.save();
  doc.lineWidth(1.5).moveTo(x, ruleY).lineTo(x + contentWidth, ruleY).stroke([0.2, 0.2, 0.2]);
  doc.restore();
  doc.y = ruleY + 10;

  // Empty state — no sales in year
  if (summary.summary.soldTrades === 0) {
    doc.font(BOLD_FONT).fontSize(14).fillColor([0.6, 0.3, 0.3])
      .text(`Ni prodaj v letu ${year}.`, x, doc.y, { align: 'center', width: contentWidth });
    doc.font(REGULAR_FONT).fontSize(10).fillColor([0.4, 0.4, 0.4])
      .text('Davčno poročilo je prazno — ni realiziranega dobička.', x, doc.y + 8, { align: 'center', width: contentWidth });
    doc.end();
    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ─── Section 1: Povzetek ────────────────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('1. POVZETEK', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 4;

  const s = summary.summary;
  const povzetekRows: Array<[string, string, string]> = [
    ['Število prodaj', String(s.soldTrades), ''],
    ['Število v postopku (held)', String(s.heldTrades), ''],
    ['Skupni prihodek (prodaja − prodajne pristojbine)', fmtEUR(s.totalRevenue), ''],
    ['Skupni strošek nakupa (kupna cena + nakupne pristojbine)', fmtEUR(s.totalBuyCost), ''],
    ['Skupne pristojbine (nakup + prodaja)', fmtEUR(s.totalFees), ''],
    ['Bruto dobiček', fmtEUR(s.grossProfit), s.grossProfit >= 0 ? 'POSITIVNO' : 'NEGATIVNO'],
    [`Ocenjen davek (${s.taxRate}% poenostavljena stopnja)`, fmtEUR(s.estimatedTax), ''],
    ['Neto dobiček po davku', fmtEUR(s.netProfitAfterTax), ''],
    ['Povprečni ROI', `${s.avgROI}%`, ''],
    ['Win rate', `${s.winRate}%`, ''],
    ['Povprečni hold (dnevi)', String(s.avgHoldDays), ''],
    ['Povprečni dobiček/transakcija', fmtEUR(s.avgProfitPerTrade), ''],
  ];

  // Render as label/value pairs in two columns
  doc.font(REGULAR_FONT).fontSize(10);
  for (const [label, value, badge] of povzetekRows) {
    const isHighlight = label === 'Bruto dobiček' || label === 'Neto dobiček po davku' || label.startsWith('Ocenjen davek');
    if (isHighlight) {
      doc.font(BOLD_FONT).fillColor([0.1, 0.1, 0.1]);
    } else {
      doc.font(REGULAR_FONT).fillColor([0.2, 0.2, 0.2]);
    }
    doc.text(label, x, doc.y, { width: contentWidth * 0.65 });
    const yBefore = doc.y - 12; // approx height
    doc.font(BOLD_FONT).fillColor([0.1, 0.1, 0.1])
      .text(value, x + contentWidth * 0.65, yBefore, { width: contentWidth * 0.25, align: 'right' });
    if (badge) {
      const badgeColor: [number, number, number] = badge === 'POSITIVNO' ? [0.1, 0.5, 0.2] : [0.6, 0.2, 0.2];
      doc.font(BOLD_FONT).fontSize(9).fillColor([badgeColor[0], badgeColor[1], badgeColor[2]])
        .text(badge, x + contentWidth * 0.92, yBefore, { width: contentWidth * 0.08, align: 'right' });
    }
    doc.font(REGULAR_FONT).fontSize(10).fillColor([0.2, 0.2, 0.2]);
    doc.y = yBefore + 14;
  }
  doc.moveDown(0.5);

  // ─── Section 2: Quarterly breakdown ─────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('2. ČETRTLETNI PREGLED', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 6;

  const qCols: Column[] = [
    { header: 'Četrtletje', width: contentWidth * 0.22, align: 'left' },
    { header: 'Št. prodaj', width: contentWidth * 0.13, align: 'right' },
    { header: 'Prihodek', width: contentWidth * 0.18, align: 'right' },
    { header: 'Strošek', width: contentWidth * 0.15, align: 'right' },
    { header: 'Dobiček', width: contentWidth * 0.16, align: 'right' },
    { header: 'ROI', width: contentWidth * 0.08, align: 'right' },
    { header: 'Win %', width: contentWidth * 0.08, align: 'right' },
  ];
  const qRows = summary.quarterly.map((q) => [
    q.label,
    String(q.tradeCount),
    fmtEUR(q.revenue),
    fmtEUR(q.cost),
    fmtEUR(q.profit),
    `${q.avgROI}%`,
    `${q.winRate}%`,
  ]);

  doc.y = drawTable(doc, x, doc.y, qCols, qRows);

  // ─── Section 3: Monthly breakdown ───────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('3. MESEČNI PREGLED', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 6;

  const mCols: Column[] = [
    { header: 'Mesec', width: contentWidth * 0.22, align: 'left' },
    { header: 'Št. prodaj', width: contentWidth * 0.18, align: 'right' },
    { header: 'Dobiček', width: contentWidth * 0.25, align: 'right' },
    { header: 'Kumulativa', width: contentWidth * 0.35, align: 'right' },
  ];
  const mRows = summary.monthly.map((m) => [
    m.label,
    String(m.tradeCount),
    fmtEUR(m.profit),
    fmtEUR(m.cumulativeProfit),
  ]);

  doc.y = drawTable(doc, x, doc.y, mCols, mRows);

  // Best/worst month note
  if (summary.summary.bestMonth && summary.summary.worstMonth) {
    doc.font(REGULAR_FONT).fontSize(9).fillColor([0.3, 0.3, 0.3])
      .text(
        `Najboljši mesec: ${summary.summary.bestMonth.month} (${fmtEUR(summary.summary.bestMonth.profit)})  ·  ` +
        `Najslabši mesec: ${summary.summary.worstMonth.month} (${fmtEUR(summary.summary.worstMonth.profit)})`,
        x, doc.y, { width: contentWidth }
      );
    doc.moveDown(0.4);
  }

  // ─── Section 4: Top 5 trades ────────────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('4. TOP 5 TRANSAKCIJ', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 6;

  const tCols: Column[] = [
    { header: 'Naslov', width: contentWidth * 0.36, align: 'left' },
    { header: 'Kategorija', width: contentWidth * 0.16, align: 'left' },
    { header: 'Vir', width: contentWidth * 0.13, align: 'left' },
    { header: 'Datum prodaje', width: contentWidth * 0.15, align: 'center' },
    { header: 'ROI', width: contentWidth * 0.08, align: 'right' },
    { header: 'Dobiček', width: contentWidth * 0.12, align: 'right' },
  ];
  const tRows = summary.topTrades.map((t) => [
    t.title.length > 40 ? t.title.slice(0, 37) + '...' : t.title,
    t.category,
    t.source,
    t.sellDate ? new Date(t.sellDate).toLocaleDateString('sl-SI') : '—',
    `${t.roi}%`,
    fmtEUR(t.profit),
  ]);

  doc.y = drawTable(doc, x, doc.y, tCols, tRows);

  // Worst trades (if any losses)
  if (summary.worstTrades.length > 0) {
    doc.font(BOLD_FONT).fontSize(12).fillColor([0.6, 0.2, 0.2])
      .text('Najslabše transakcije (izgube):', x, doc.y);
    doc.y += 4;
    const wCols: Column[] = [
      { header: 'Naslov', width: contentWidth * 0.36, align: 'left' },
      { header: 'Kategorija', width: contentWidth * 0.16, align: 'left' },
      { header: 'Vir', width: contentWidth * 0.13, align: 'left' },
      { header: 'Datum prodaje', width: contentWidth * 0.15, align: 'center' },
      { header: 'ROI', width: contentWidth * 0.08, align: 'right' },
      { header: 'Izguba', width: contentWidth * 0.12, align: 'right' },
    ];
    const wRows = summary.worstTrades.map((t) => [
      t.title.length > 40 ? t.title.slice(0, 37) + '...' : t.title,
      t.category,
      t.source,
      t.sellDate ? new Date(t.sellDate).toLocaleDateString('sl-SI') : '—',
      `${t.roi}%`,
      fmtEUR(t.profit),
    ]);
    doc.y = drawTable(doc, x, doc.y, wCols, wRows);
  }

  // ─── Section 5: Category breakdown ──────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('5. KATEGORIJSKI PREGLED', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 6;

  const cCols: Column[] = [
    { header: 'Kategorija', width: contentWidth * 0.30, align: 'left' },
    { header: 'Št. prodaj', width: contentWidth * 0.13, align: 'right' },
    { header: 'Prihodek', width: contentWidth * 0.18, align: 'right' },
    { header: 'Strošek', width: contentWidth * 0.15, align: 'right' },
    { header: 'Dobiček', width: contentWidth * 0.14, align: 'right' },
    { header: 'ROI', width: contentWidth * 0.10, align: 'right' },
  ];
  const cRows = summary.categoryBreakdown.map((c) => [
    c.category,
    String(c.tradeCount),
    fmtEUR(c.revenue),
    fmtEUR(c.cost),
    fmtEUR(c.profit),
    `${c.roi}%`,
  ]);

  doc.y = drawTable(doc, x, doc.y, cCols, cRows);

  // ─── Section 6: Source breakdown ────────────────────────────────────────
  doc.font(BOLD_FONT).fontSize(14).fillColor([0.1, 0.1, 0.1])
    .text('6. VIRI PRIHODKA (PLATFORME)', x, doc.y);
  doc.moveDown(0.4);
  doc.y += 6;

  const srcCols: Column[] = [
    { header: 'Vir', width: contentWidth * 0.30, align: 'left' },
    { header: 'Št. prodaj', width: contentWidth * 0.13, align: 'right' },
    { header: 'Prihodek', width: contentWidth * 0.18, align: 'right' },
    { header: 'Strošek', width: contentWidth * 0.15, align: 'right' },
    { header: 'Dobiček', width: contentWidth * 0.14, align: 'right' },
    { header: 'ROI', width: contentWidth * 0.10, align: 'right' },
  ];
  const srcRows = summary.sourceBreakdown.map((s) => [
    s.source,
    String(s.tradeCount),
    fmtEUR(s.revenue),
    fmtEUR(s.cost),
    fmtEUR(s.profit),
    `${s.roi}%`,
  ]);

  doc.y = drawTable(doc, x, doc.y, srcCols, srcRows);

  // ─── Footer ─────────────────────────────────────────────────────────────
  const pageBottom = doc.page.height - 30;
  if (doc.y > pageBottom - 60) {
    doc.addPage();
  }
  doc.y = pageBottom - 40;
  doc.save();
  doc.lineWidth(0.5).moveTo(x, doc.y).lineTo(x + contentWidth, doc.y).stroke([0.5, 0.5, 0.5]);
  doc.restore();
  doc.y += 6;
  doc.font(REGULAR_FONT).fontSize(8).fillColor([0.5, 0.5, 0.5])
    .text(
      `Generirano z Markec AI Firm v8.43 · ${genAt} · Vir: /api/trades/annual-summary?year=${year}`,
      x, doc.y, { align: 'center', width: contentWidth }
    );
  doc.font(REGULAR_FONT).fontSize(8).fillColor([0.6, 0.6, 0.6])
    .text(
      'Davek: 22% poenostavljena stopnja (dohodek iz dejavnosti — ZDoh-2). Nad 60.000€ letno se zahteva registracija s.p.',
      x, doc.y + 2, { align: 'center', width: contentWidth }
    );

  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const year = parseYear(req);

    logger.info('/api/trades/tax-report-pdf', `generating PDF for year ${year}`);

    const pdfBuffer = await generateTaxReportPDF(year);

    const filename = `davcno-porocilo-${year}.pdf`;

    logger.info('/api/trades/tax-report-pdf', `PDF generated`, {
      year,
      sizeKB: Math.round(pdfBuffer.length / 1024),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'public, max-age=600',
        'X-Report-Version': 'v8.43',
        'X-Report-Year': String(year),
      },
    });
  } catch (err: any) {
    logger.error('/api/trades/tax-report-pdf', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri generiranju PDF' },
      { status: 500 },
    );
  }
}
