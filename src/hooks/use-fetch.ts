'use client';

// v8.56: useFetch — reusable hook for API calls with loading/error/retry states.
// Best practice: DRY, consistent UX across all dashboard cards.
//
// Usage:
//   const { data, loading, error, refetch } = useFetch<T>('/api/analytics/profit-forecast');
//   if (loading) return <CardSkeleton />;
//   if (error) return <CardError onRetry={refetch} />;
//   return <ActualContent data={data} />;

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGlobalRefreshListener } from '@/hooks/use-global-refresh';

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFetch<T>(
  url: string | null,
  options?: {
    interval?: number;        // auto-refresh interval in ms
    skip?: boolean;           // skip initial fetch
  }
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options?.skip);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!url || options?.skip) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!mountedRef.current) return;
      setData(json);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message ?? 'Napaka pri nalaganju');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [url, options?.skip, retryCount]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!options?.interval || !url) return;
    const id = setInterval(() => {
      setRetryCount(c => c + 1); // triggers re-fetch via fetchData dependency
    }, options.interval);
    return () => clearInterval(id);
  }, [options?.interval, url]);

  // v8.57: Global refresh — when triggerGlobalRefresh() is called (after any mutation),
  // ALL useFetch instances refetch immediately. No more waiting for interval.
  const unsubscribe = useGlobalRefreshListener(() => {
    setRetryCount(c => c + 1);
  });
  useEffect(() => unsubscribe, [unsubscribe]);

  const refetch = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  return { data, loading, error, refetch };
}
