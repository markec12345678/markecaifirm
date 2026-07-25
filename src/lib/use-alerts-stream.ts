'use client';

// v4.9: useAlertsStream — React hook for SSE real-time alerts
// Auto-reconnects on disconnect (EventSource does this natively)

import { useEffect, useState, useRef, useCallback } from 'react';

interface AlertEvent {
  id: string;
  title: string;
  url: string;
  aiVerdict: string | null;
  aiScore: number | null;
  aiRisk: number | null;
  createdAt: string;
  monitor: { name: string; source: string } | null;
}

interface ListingEvent {
  count: number;
  listings: Array<{
    id: string;
    title: string;
    price: number | null;
    priceText: string;
    url: string;
    firstSeenAt: string;
    aiVerdict: string | null;
    monitor: { name: string; source: string } | null;
  }>;
}

interface StatsEvent {
  totalAlerts: number;
  unreadAlerts: number;
  totalListings: number;
  activeMonitors: number;
}

interface UseAlertsStreamResult {
  connected: boolean;
  lastAlert: AlertEvent | null;
  lastListingEvent: ListingEvent | null;
  stats: StatsEvent | null;
  lastEventAt: Date | null;
}

export function useAlertsStream(enabled: boolean = true): UseAlertsStreamResult {
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);
  const [lastListingEvent, setLastListingEvent] = useState<ListingEvent | null>(null);
  const [stats, setStats] = useState<StatsEvent | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (eventSourceRef.current) return;

    try {
      const es = new EventSource('/api/alerts/stream');
      eventSourceRef.current = es;

      es.addEventListener('hello', (e) => {
        setConnected(true);
        setLastEventAt(new Date());
      });

      es.addEventListener('alert', (e) => {
        try {
          const data = JSON.parse(e.data);
          setLastAlert(data);
          setLastEventAt(new Date());
        } catch { /* ignore */ }
      });

      es.addEventListener('listing', (e) => {
        try {
          const data = JSON.parse(e.data);
          setLastListingEvent(data);
          setLastEventAt(new Date());
        } catch { /* ignore */ }
      });

      es.addEventListener('stats', (e) => {
        try {
          const data = JSON.parse(e.data);
          setStats(data);
          setLastEventAt(new Date());
        } catch { /* ignore */ }
      });

      es.addEventListener('heartbeat', () => {
        setLastEventAt(new Date());
      });

      es.onerror = () => {
        setConnected(false);
        // EventSource will auto-reconnect
      };

      es.onopen = () => {
        setConnected(true);
      };
    } catch {
      // EventSource not supported
    }
  }, [enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);

  return { connected, lastAlert, lastListingEvent, stats, lastEventAt };
}
