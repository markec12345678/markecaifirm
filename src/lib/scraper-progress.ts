/**
 * In-memory scraper progress tracker.
 * Stores live status of running monitors — polled by dashboard every 2s.
 */

export interface FoundListing {
  id: string;
  title: string;
  price: string;
  url: string;
  location?: string;
  isNew: boolean;
  aiScore?: number;
  aiRisk?: number;
  aiVerdict?: string;
  aiReason?: string;
  dealScore?: number;
}

export interface ScraperProgress {
  monitorId: string;
  monitorName: string;
  status: 'scraping' | 'dedup' | 'ai-evaluating' | 'sending-alerts' | 'done' | 'error';
  step: string;
  progress: number; // 0-100
  listingsFound: number;
  newListings: number;
  alertsSent: number;
  aiEvaluated: number;
  aiTotal: number;
  startedAt: number;
  error?: string;
  foundListings: FoundListing[];
}

const active = new Map<string, ScraperProgress>();

export function progressStart(monitorId: string, monitorName: string) {
  active.set(monitorId, {
    monitorId,
    monitorName,
    status: 'scraping',
    step: 'Začenjam...',
    progress: 0,
    listingsFound: 0,
    newListings: 0,
    alertsSent: 0,
    aiEvaluated: 0,
    aiTotal: 0,
    startedAt: Date.now(),
    foundListings: [],
  });
}

export function progressUpdate(monitorId: string, patch: Partial<Omit<ScraperProgress, 'monitorId' | 'monitorName' | 'startedAt'>>) {
  const p = active.get(monitorId);
  if (p) Object.assign(p, patch);
}

export function progressAddListing(monitorId: string, listing: FoundListing) {
  const p = active.get(monitorId);
  if (p) {
    // Avoid duplicates
    if (!p.foundListings.some(l => l.id === listing.id)) {
      p.foundListings.unshift(listing); // newest first
      // Keep max 50 to avoid memory bloat
      if (p.foundListings.length > 50) p.foundListings.length = 50;
    }
  }
}

export function progressUpdateListing(monitorId: string, listingId: string, patch: Partial<FoundListing>) {
  const p = active.get(monitorId);
  if (p) {
    const l = p.foundListings.find(x => x.id === listingId);
    if (l) Object.assign(l, patch);
  }
}

export function progressDone(monitorId: string) {
  const p = active.get(monitorId);
  if (p) {
    p.status = 'done';
    p.step = 'Končano';
    p.progress = 100;
  }
  setTimeout(() => active.delete(monitorId), 120_000);
}

export function progressError(monitorId: string, error: string) {
  const p = active.get(monitorId);
  if (p) {
    p.status = 'error';
    p.step = 'Napaka';
    p.error = error;
    p.progress = 100;
  }
  setTimeout(() => active.delete(monitorId), 120_000);
}

export function getAllProgress(): ScraperProgress[] {
  return Array.from(active.values());
}
