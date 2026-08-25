'use client';

// v8.57: Global Refresh Broadcast — when any mutation happens (add/edit/delete trade,
// save settings, run auto-pilot), ALL dashboard cards immediately refetch.
// No more waiting 60s for stats to update.
//
// Best practice: cache invalidation via custom events.
// Pattern: Mutation → dispatchEvent → useFetch listeners → refetch
//
// Usage:
//   import { triggerGlobalRefresh, useGlobalRefreshListener } from '@/hooks/use-global-refresh';
//
//   // After mutation:
//   await fetch('/api/trades', { method: 'POST', ... });
//   triggerGlobalRefresh(); // ← all cards refetch instantly
//
//   // In useFetch (automatic — no manual subscription needed):
//   // useFetch already listens for 'global-refresh' events

const GLOBAL_REFRESH_EVENT = 'markec-global-refresh';

/**
 * Trigger a global refresh — all useFetch instances refetch immediately.
 * Call after ANY data mutation (add/edit/delete trade, save settings, etc).
 */
export function triggerGlobalRefresh(reason?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GLOBAL_REFRESH_EVENT, { detail: { reason, timestamp: Date.now() } }));
}

/**
 * Subscribe to global refresh events.
 * Returns an unsubscribe function.
 */
export function useGlobalRefreshListener(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => callback();
  window.addEventListener(GLOBAL_REFRESH_EVENT, handler);

  return () => {
    window.removeEventListener(GLOBAL_REFRESH_EVENT, handler);
  };
}

/**
 * Check if the global refresh event matches a specific reason.
 */
export function isGlobalRefreshEvent(event: Event): event is CustomEvent<{ reason?: string; timestamp: number }> {
  return event.type === GLOBAL_REFRESH_EVENT;
}
