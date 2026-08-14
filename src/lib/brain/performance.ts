// v8.33: Performance Metrics — tracks response times for each brain layer.
//
// Stores a ROLLING WINDOW of the last 100 response times per brain layer
// (master, profit, inventory, market, sourcing, risk, buyer, pricing).
// Computes avg, p50 (median), p95, p99, min, max, plus a per-brain
// cacheHitRate (cached / total entries recorded).
//
// Memory-only — process restart clears the perf store (acceptable for
// monitoring). Stats are populated by the route handlers, which wrap each
// brain call with `withPerf(brainName, fn, cached)` — the wrapper records
// the duration and the `cached` flag (true on cache hit, false on miss).
//
// Used by:
//   - src/app/api/ai/brain/performance/route.ts (GET aggregates all brain
//     stats; POST clears them)
//   - src/components/dashboard/ai-hub-view.tsx ⚡ Performance card (renders
//     per-namespace cache stats + per-brain response times + color-coded
//     thresholds: green <50ms, amber 50-200ms, red >200ms)

interface PerfEntry {
  timestamp: number;
  durationMs: number;
  cached: boolean;
}

const perfStore = new Map<string, PerfEntry[]>();
const MAX_ENTRIES = 100;

/** v8.33: Record a performance entry for a brain layer.
 *  `cached=true` means the call hit the in-memory cache (fast path);
 *  `cached=false` means the brain had to compute the result (slow path).
 *  The cacheHitRate in PerfStats is `cached / total * 100`. */
export function recordPerf(brain: string, durationMs: number, cached: boolean): void {
  if (!perfStore.has(brain)) {
    perfStore.set(brain, []);
  }
  const entries = perfStore.get(brain)!;
  entries.push({ timestamp: Date.now(), durationMs, cached });
  // Rolling window — drop oldest entries beyond MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

export interface PerfStats {
  brain: string;
  count: number;
  avgMs: number;
  p50Ms: number; // median
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  cacheHitRate: number; // cached / total × 100
  lastDurationMs: number;
}

/** v8.33: Get performance stats for a brain layer. Returns null if no entries
 *  have been recorded yet (e.g. right after process start or after a reset). */
export function getPerfStats(brain: string): PerfStats | null {
  const entries = perfStore.get(brain);
  if (!entries || entries.length === 0) return null;

  // Sort a COPY (don't mutate the source array — order matters for `last`/`shift`)
  const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);
  const cachedCount = entries.filter((e) => e.cached).length;
  const count = entries.length;

  // Percentile helper. `p` is a fraction 0..1.
  // Uses the nearest-rank method (floor(p × count)) — same approach as the
  // spec example. For small sample sizes (count < 100) this is approximate
  // but good enough for "is this brain slow?" monitoring.
  const percentile = (p: number) => durations[Math.min(durations.length - 1, Math.floor(p * count))];

  return {
    brain,
    count,
    avgMs: Math.round(durations.reduce((s, d) => s + d, 0) / count),
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    p99Ms: Math.round(percentile(0.99)),
    minMs: Math.round(durations[0]),
    maxMs: Math.round(durations[durations.length - 1]),
    cacheHitRate: (cachedCount / count) * 100,
    lastDurationMs: Math.round(entries[entries.length - 1].durationMs),
  };
}

/** v8.33: Get performance stats for ALL brain layers (sorted alphabetically
 *  by brain name for stable UI rendering). */
export function getAllPerfStats(): PerfStats[] {
  const result: PerfStats[] = [];
  for (const brain of perfStore.keys()) {
    const stats = getPerfStats(brain);
    if (stats) result.push(stats);
  }
  return result.sort((a, b) => a.brain.localeCompare(b.brain));
}

/** v8.33: Reset performance stats for a brain (or all if no brain provided).
 *  Used by the POST reset endpoint. */
export function resetPerfStats(brain?: string): void {
  if (brain) {
    perfStore.delete(brain);
  } else {
    perfStore.clear();
  }
}

/**
 * v8.33: Wrap an async function with performance tracking.
 *
 * Records the wall-clock duration of `fn()` and writes a PerfEntry for the
 * given brain. The `cached` flag is caller-supplied — set to `true` if the
 * function returns a cached value (fast path), `false` if it had to compute.
 *
 * Usage:
 *   ```ts
 *   const result = await withPerf('master', () => masterBrain(input), false);
 *   ```
 *
 * Errors are re-thrown after recording — perf tracking is non-destructive.
 */
export async function withPerf<T>(brain: string, fn: () => Promise<T>, cached = false): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    recordPerf(brain, Date.now() - start, cached);
    return result;
  } catch (err) {
    // Record the failed call too — it still took time, and the cacheHitRate
    // metric should reflect all attempts (success or failure).
    recordPerf(brain, Date.now() - start, cached);
    throw err;
  }
}
