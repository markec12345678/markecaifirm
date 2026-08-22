/**
 * NotificationCenterCard — v8.38 orange/amber notification history card.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Centralized history of ALL Brain system notifications:
 * Brain digests, auto-pilot executions, anomalies, system events.
 *
 * Features:
 *   - Filter bar: by type / severity / read status
 *   - Stats row: total + unread + breakdown by type
 *   - Scrollable list (max-h-96) with per-item mark-read / delete buttons
 *   - Bulk actions: mark all read / delete read
 *   - Auto-refresh every 30s
 *
 * Fetches /api/brain-notifications?limit=50&days=30. Orange/amber-tinted
 * gradient (visual link to 🔔 bell emoji).
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, Check, Clock, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { severityBadgeClass, timeAgo } from '../utils';
import type { NotificationCenterData } from './types';
import { NOTIFICATION_TYPE_LABELS } from './types';

export function NotificationCenterCard() {
  const [data, setData] = useState<NotificationCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<string>('all');
  const [acting, setActing] = useState<string | null>(null); // 'markAll' | 'deleteRead' | notificationId

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('days', '30');
      if (filterType !== 'all') params.set('type', filterType);
      if (filterSeverity !== 'all') params.set('severity', filterSeverity);
      if (filterRead !== 'all') params.set('isRead', filterRead);
      const res = await fetch(`/api/brain-notifications?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error('API failed');
      setData(json);
    } catch {
      // Silent fail — the card just shows empty state
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity, filterRead]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30 * 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleMarkRead = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Označeno kot prebrano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDelete = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Izbrisano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleMarkAllRead = useCallback(async () => {
    setActing('markAll');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.updated} obvestil označenih kot prebranih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDeleteRead = useCallback(async () => {
    setActing('deleteRead');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.deleted} prebranih obvestil izbrisanih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const notifications = data?.notifications ?? [];
  const stats = data?.stats ?? { total: 0, unread: 0, byType: {}, bySeverity: {} };

  return (
    <div
      id="notification-center"
      className="rounded-xl border-2 bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-yellow-500/5 border-orange-500/30 p-3 sm:p-4 shadow-sm scroll-mt-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="w-5 h-5 shrink-0 text-orange-600 dark:text-orange-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🔔 Notification Center
          </span>
          <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-700 dark:text-orange-300 shrink-0 font-bold">
            v8.38
          </Badge>
          {stats.unread > 0 && (
            <Badge className="text-[10px] bg-red-500 text-white border-0 shrink-0 font-bold animate-pulse">
              {stats.unread} novo
            </Badge>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-2.5">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po tipu"
        >
          <option value="all">Vsi tipi</option>
          {Object.entries(NOTIFICATION_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po teži"
        >
          <option value="all">Vse teže</option>
          <option value="info">ℹ️ Info</option>
          <option value="success">✅ Success</option>
          <option value="warning">⚠️ Warning</option>
          <option value="error">❌ Error</option>
        </select>
        <select
          value={filterRead}
          onChange={(e) => setFilterRead(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po statusu prebranosti"
        >
          <option value="all">Vsa (prebrana + neprebrana)</option>
          <option value="false">📨 Samo neprebrana</option>
          <option value="true">✓ Samo prebrana</option>
        </select>
      </div>

      {/* Stats row */}
      <div className="text-[10px] text-muted-foreground mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono">
          <span className="font-bold text-foreground">{stats.total}</span> skupaj
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="font-mono">
          <span className={cn('font-bold', stats.unread > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
            {stats.unread}
          </span>{' '}neprebranih
        </span>
        {Object.entries(stats.byType).slice(0, 5).map(([type, count]) => (
          <span key={type} className="text-muted-foreground/50">
            · <span className="font-mono font-bold">{count}</span> {NOTIFICATION_TYPE_LABELS[type]?.label ?? type}
          </span>
        ))}
      </div>

      {/* Notification list (scrollable, max-h-96 with custom scrollbar styling) */}
      <div className="max-h-96 overflow-y-auto rounded border border-border bg-card/30">
        {loading ? (
          <div className="p-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Nalagam obvestila...
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Ni obvestil v zadnjih 30 dneh.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => {
              const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
              const truncatedBody = n.body.length > 200 ? n.body.slice(0, 200) + '...' : n.body;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'p-2.5 transition-colors',
                    !n.isRead && 'bg-orange-500/5 border-l-2 border-l-orange-500',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5" aria-hidden="true">{typeMeta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold leading-tight flex items-center gap-1.5">
                            {!n.isRead && (
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 animate-pulse" aria-label="neprebrano" />
                            )}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 break-words">
                            {truncatedBody}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={cn(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase',
                              severityBadgeClass(n.severity),
                            )}>
                              {n.severity}
                            </span>
                            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2 h-2" />
                              {timeAgo(n.createdAt)}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              · {n.source}
                            </span>
                          </div>
                          {/* v8.77: Action button za buy_request_match — deep link v Iskalnik */}
                          {n.type === 'buy_request_match' && (() => {
                            let buyRequestId: string | null = null;
                            try {
                              const meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata;
                              buyRequestId = meta?.buyRequestId || null;
                            } catch { /* ignore */ }
                            if (!buyRequestId) return null;
                            return (
                              <a
                                href={`/?view=iskalnik&matchRequestId=${encodeURIComponent(buyRequestId)}`}
                                className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                                title="Prikaži ujemanja v Iskalniku"
                              >
                                <Eye className="w-2.5 h-2.5" /> Prikaži ujemanja
                              </a>
                            );
                          })()}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {!n.isRead && (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              disabled={acting === n.id}
                              title="Označi kot prebrano"
                              aria-label="Označi kot prebrano"
                              className="text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(n.id)}
                            disabled={acting === n.id}
                            title="Izbriši"
                            aria-label="Izbriši obvestilo"
                            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Button
          onClick={handleMarkAllRead}
          disabled={acting === 'markAll' || stats.unread === 0}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
        >
          {acting === 'markAll' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
          Označi vse kot prebrano
        </Button>
        <Button
          onClick={handleDeleteRead}
          disabled={acting === 'deleteRead'}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10"
        >
          {acting === 'deleteRead' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
          Izbriši prebrane
        </Button>
      </div>

      {/* Footer */}
      <div className="mt-2 text-[9px] text-muted-foreground/70 leading-relaxed">
        💡 Avto-osvežitev vsakih 30s. Prikazujem zadnjih 30 dni. Tipi: 🧠 Brain digest · 🤖 Auto-pilot · ⚠️ Anomalija · 🔧 Sistem. Telegram + DB log — tudi če Telegram ni konfiguriran, so obvestila zabeležena tukaj.
      </div>
    </div>
  );
}
