// v9.64: Format utilities — dosledno formatiranje EUR, številk in časa.
//
// Uporablja se povsod v aplikaciji za profesionalen in dosleden prikaz:
// - EUR: "€1.687" (z ločilom tisočic, brez decimalk za celoštevilske)
// - Negativne: "−€39" (pravi minus znak, ne crtica)
// - Številke: "1.687" (slovensko ločilo tisočic)
// - Relativni čas: "pred 14 h" + click za exact datum
// - ROI/Procenti: "85%" (brez decimalk)

/**
 * Format EUR amount — dosledno po slovenski konvenciji.
 * - Pozitivne: "€1.687" (z ločilom tisočic)
 * - Negativne: "−€39" (pravi minus znak U+2212, ne crtica)
 * - Zero: "€0"
 * - Null/undefined: "—"
 *
 * @param amount - znesek v EUR
 * @param opts.decimals - število decimalk (default 0)
 * @param opts.sign - ali prikazati + za pozitivne (default false)
 */
export function formatEuro(
  amount: number | null | undefined,
  opts: { decimals?: number; sign?: boolean } = {}
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';

  const { decimals = 0, sign = false } = opts;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('sl-SI', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // Pravi minus znak (U+2212) za negativne, ne crtica (-)
  if (amount < 0) return `−€${formatted}`;
  if (sign && amount > 0) return `+€${formatted}`;
  return `€${formatted}`;
}

/**
 * Format profit with sign — za prikaz dobička/izgube jasno.
 * - Pozitivne: "+€1.687"
 * - Negativne: "−€39" (rdeča barva naj se določi v UI)
 * - Zero: "€0"
 */
export function formatProfit(amount: number | null | undefined): string {
  return formatEuro(amount, { sign: true });
}

/**
 * Format number with thousands separator (slovenska konvencija).
 * - 1687 → "1.687"
 * - 1234567 → "1.234.567"
 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('sl-SI');
}

/**
 * Format percentage — brez decimalk.
 * - 85.4 → "85%"
 * - 0 → "0%"
 * - null → "—"
 */
export function formatPercent(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

/**
 * Format ROI — z znakom za pozitivne/negativne.
 * - 35.4 → "+35%"
 * - -15.2 → "−15%"
 */
export function formatRoi(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n > 0) return `+${Math.round(n)}%`;
  if (n < 0) return `−${Math.abs(Math.round(n))}%`;
  return '0%';
}

// ═══════════════════════════════════════════════════════════════════════
// TIME FORMATTING z click-to-toggle
// ═══════════════════════════════════════════════════════════════════════

/**
 * Format relativni čas v slovenščini.
 * - < 1 min: "zdaj"
 * - < 1 h: "pred 5 min"
 * - < 1 dan: "pred 5 h"
 * - < 7 dni: "pred 3 dnevi"
 * - < 30 dni: "pred 14 dni"
 * - več: "24. avg 2026"
 *
 * Za future čas: "čez 5 min", "čez 2 dni"
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—';

  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absMs = Math.abs(diffMs);

  const sec = Math.floor(absMs / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  const prefix = isPast ? 'pred ' : 'čez ';
  const suffix = isPast ? '' : '';

  if (sec < 60) return isPast ? 'zdaj' : 'čez nekaj sekund';
  if (min < 60) {
    const unit = min === 1 ? 'minuto' : min === 2 ? 'minuti' : min <= 4 ? 'minute' : 'minut';
    return `${prefix}${min} ${unit}${suffix}`;
  }
  if (hour < 24) {
    const unit = hour === 1 ? 'uro' : hour === 2 ? 'uri' : hour <= 4 ? 'ure' : 'ur';
    return `${prefix}${hour} ${unit}${suffix}`;
  }
  if (day < 7) {
    const unit = day === 1 ? 'dnevmi' : day === 2 ? 'dnevoma' : 'dnevi';
    return `${prefix}${day} ${unit}${suffix}`;
  }
  if (day < 30) {
    return `${prefix}${day} dnevi${suffix}`;
  }

  // Več kot 30 dni — pokaži exact datum
  return formatDateTime(d, { short: true });
}

/**
 * Format exact datetime — slovenski format.
 * - short: "24. avg 2026"
 * - full: "24. avg 2026, 10:30"
 * - time: "10:30"
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  opts: { short?: boolean; time?: boolean; full?: boolean } = {}
): string {
  if (!date) return '—';

  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  const { short, time, full } = opts;

  if (time) {
    return d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  }

  if (short) {
    return d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (full) {
    return d.toLocaleString('sl-SI', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // Default: full date + time
  return d.toLocaleString('sl-SI', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Format duration in milliseconds — za prikaz trajanja.
 * - < 1s: "523ms"
 * - < 1min: "5.2s"
 * - < 1h: "5min 23s"
 * - več: "1h 23min"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;

  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  if (min < 60) return `${min}min ${remSec}s`;

  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hour}h ${remMin}min`;
}

/**
 * v9.64: Keyboard shortcut map — za tooltip hints na nav gumbih.
 * Maps view IDs to their keyboard shortcut keys.
 */
export const VIEW_SHORTCUTS: Record<string, string> = {
  dashboard: '1',
  monitors: '2',
  alerts: '3',
  listings: '4',
  watchlist: '5',
  trades: '6',
  analytics: '7',
  notifications: '8',
  health: '9',
  settings: '0',
  buyers: 'B',
  'ai-hub': 'A',
  inventory: 'I',
  pricing: 'P',
  'listing-opt': 'L',
  risk: 'R',
};

/**
 * v9.64: Build tooltip z shortcut hint-om.
 * Returns "Dashboard (tipka 1)" for views with shortcuts.
 */
export function navTitleWithShortcut(label: string, viewId: string): string {
  const shortcut = VIEW_SHORTCUTS[viewId];
  return shortcut ? `${label} (tipka ${shortcut})` : label;
}
