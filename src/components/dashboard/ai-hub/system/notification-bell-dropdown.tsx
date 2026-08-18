/**
 * NotificationBellDropdown — v8.38 unread-count bell in header.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Shown in the BrainSynthesisCard header. Displays the
 * unread count as a red badge + opens a dropdown with the most recent 5
 * unread notifications + a "Glej vse" link that scrolls to the full
 * NotificationCenterCard section below.
 *
 * Polls /api/brain-notifications?limit=5&days=7&isRead=false every 30s for
 * the unread count + recent items. Closes on Escape key or backdrop click.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Bell, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { timeAgo } from '../utils';
import type { NotificationCenterItem } from './types';
import { NOTIFICATION_TYPE_LABELS } from './types';

export function NotificationBellDropdown({ onJumpToCenter }: { onJumpToCenter: () => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number>(0);
  const [recent, setRecent] = useState<NotificationCenterItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
        if (!res.ok) return;
        const json = await res.json();
        if (!json?.ok) return;
        if (cancelled) return;
        setUnread(json.stats.unread);
        setRecent(json.notifications);
      } catch {
        // Silent
      }
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleMarkReadFromDropdown = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      toast.success('✓ Označeno kot prebrano');
      // Refresh the dropdown
      const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
      if (res.ok) {
        const json = await res.json();
        if (json?.ok) {
          setUnread(json.stats.unread);
          setRecent(json.notifications);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-accent transition-colors"
        title={unread > 0 ? `${unread} neprebranih obvestil` : 'Obvestila'}
        aria-label={`Obvestila — ${unread} neprebranih`}
        aria-expanded={open}
      >
        <Bell className={cn('w-4 h-4', unread > 0 && 'text-orange-500 animate-pulse')} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Backdrop (click outside to close) */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Dropdown panel */}
          <div className="absolute right-0 top-full mt-1 w-72 sm:w-80 max-h-[400px] flex flex-col bg-popover border border-border rounded-md shadow-lg z-50">
            <div className="flex items-center justify-between p-2 border-b border-border">
              <span className="text-xs font-bold flex items-center gap-1">
                <Bell className="w-3 h-3" />
                Obvestila
                {unread > 0 && (
                  <Badge className="text-[9px] bg-red-500 text-white border-0 px-1 py-0 h-4">
                    {unread}
                  </Badge>
                )}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                aria-label="Zapri"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  Ni neprebranih obvestil.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((n) => {
                    const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
                    return (
                      <div key={n.id} className="p-2 hover:bg-accent/50 transition-colors">
                        <div className="flex items-start gap-1.5">
                          <span className="text-sm shrink-0">{typeMeta.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold truncate">{n.title}</div>
                            <p className="text-[10px] text-muted-foreground line-clamp-2">{n.body}</p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[9px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                              <button
                                onClick={() => handleMarkReadFromDropdown(n.id)}
                                disabled={loading}
                                className="text-[9px] text-primary hover:underline disabled:opacity-50"
                              >
                                ✓ Preberi
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-2 border-t border-border flex items-center justify-between gap-2">
              <button
                onClick={() => { setOpen(false); onJumpToCenter(); }}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                Glej vse →
              </button>
              <span className="text-[9px] text-muted-foreground">{unread} neprebranih</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
