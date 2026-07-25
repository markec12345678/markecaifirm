'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Bell, Settings, ListPlus, Zap, RefreshCw, AlertCircle, LayoutGrid, BarChart3, Search, Heart, TrendingUp, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { MonitorsView } from '@/components/dashboard/monitors-view';
import { AlertsView } from '@/components/dashboard/alerts-view';
import { SettingsView } from '@/components/dashboard/settings-view';
import { ListingsView } from '@/components/dashboard/listings-view';
import { AnalyticsView } from '@/components/dashboard/analytics-view';
import { HealthView } from '@/components/dashboard/health-view';
import { TradesView } from '@/components/dashboard/trades-view';
import { NotificationHistoryView } from '@/components/dashboard/notification-history-view';
import { SearchModal } from '@/components/dashboard/search-modal';

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'analytics' | 'trades' | 'health' | 'notifications' | 'settings';

const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'monitors', label: 'Monitorji', icon: ListPlus },
  { id: 'alerts', label: 'Alerti', icon: Bell },
  { id: 'listings', label: 'Oglasi', icon: LayoutGrid },
  { id: 'trades', label: 'Skladišče', icon: TrendingUp },
  { id: 'analytics', label: 'Analitika', icon: BarChart3 },
  { id: 'notifications', label: 'Obvestila', icon: History },
  { id: 'health', label: 'Zdravje', icon: Heart },
  { id: 'settings', label: 'Nastavitve', icon: Settings },
];

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Clock effect — only subscribe to setInterval, initial value set lazily to avoid setState in effect
  useEffect(() => {
    // Defer first set to next tick to avoid synchronous setState warning
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const statsRes = await fetch('/api/stats');
      if (statsRes.ok) {
        const stats = await statsRes.json();
        setUnreadAlerts(stats.unreadAlerts ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const doRefresh = async () => {
      await refreshUnread();
      if (!mounted) return;
    };
    doRefresh();
    const t = setInterval(refreshUnread, 30_000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [refreshUnread]);

  // Ctrl+K shortcut for global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K → search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // Don't trigger when dialog is open
      if (searchOpen) return;

      // v2.5: Tab navigation shortcuts
      const navMap: Record<string, View> = {
        '1': 'dashboard',
        '2': 'monitors',
        '3': 'alerts',
        '4': 'listings',
        '5': 'trades',
        '6': 'analytics',
        '7': 'notifications',
        '8': 'health',
        '9': 'settings',
      };
      if (navMap[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setView(navMap[e.key]);
        return;
      }
      // ? → help overlay
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header — terminal style */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="pulse-dot text-primary text-lg">●</span>
                <span className="text-primary terminal-glow font-bold tracking-tight">
                  markec@ai-firm
                </span>
                <span className="text-muted-foreground">:</span>
                <span className="text-amber-400 amber-glow">~/opportunity-monitor</span>
                <span className="text-muted-foreground">$</span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-card/50 hover:border-primary/30 hover:text-primary transition-colors"
                title="Iskanje (Ctrl+K)"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Iskanje</span>
                <kbd className="text-[10px] bg-background/60 px-1.5 py-0.5 rounded border border-border">Ctrl+K</kbd>
              </button>
              {now && (
                <span className="font-mono">
                  {now.toLocaleDateString('sl-SI')} {now.toLocaleTimeString('sl-SI')}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot" />
                ONLINE
              </span>
            </div>
            <button
              onClick={() => setSearchOpen(true)}
              className="md:hidden p-2 rounded border border-border bg-card/50 hover:border-primary/30"
              aria-label="Iskanje"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Nav tabs */}
      <nav className="border-b border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                    active
                      ? 'border-primary text-primary terminal-glow'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="uppercase tracking-wider">{item.label}</span>
                  {item.id === 'alerts' && unreadAlerts > 0 && (
                    <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">
                      {unreadAlerts}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {view === 'dashboard' && <DashboardView onNavigate={setView} />}
        {view === 'monitors' && <MonitorsView />}
        {view === 'alerts' && <AlertsView />}
        {view === 'listings' && <ListingsView />}
        {view === 'trades' && <TradesView />}
        {view === 'analytics' && <AnalyticsView />}
        {view === 'notifications' && <NotificationHistoryView />}
        {view === 'health' && <HealthView />}
        {view === 'settings' && <SettingsView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="text-primary">markec-ai-firm</span>
              <span>v4.5.0</span>
              <span>•</span>
              <span>local-first</span>
              <span>•</span>
              <span>zero-cloud</span>
            </div>
            <div className="flex items-center gap-3">
              <span>cron: <code className="text-amber-400">GET /api/cron/run-all</code></span>
            </div>
          </div>
        </div>
      </footer>

      {/* v4.3: Keyboard shortcut help overlay */}
      {helpOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary terminal-glow uppercase">Tipkovne bližnjice</h2>
              <button onClick={() => setHelpOpen(false)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { key: '1', desc: 'Dashboard' },
                { key: '2', desc: 'Monitorji' },
                { key: '3', desc: 'Alerti' },
                { key: '4', desc: 'Oglasi' },
                { key: '5', desc: 'Skladišče' },
                { key: '6', desc: 'Analitika' },
                { key: '7', desc: 'Obvestila' },
                { key: '8', desc: 'Zdravje' },
                { key: '9', desc: 'Nastavitve' },
                { key: 'Ctrl+K', desc: 'Globalno iskanje' },
                { key: '?', desc: 'Ta pomoč' },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">{s.desc}</span>
                  <kbd className="px-2 py-0.5 bg-background border border-border rounded text-xs font-mono text-primary">{s.key}</kbd>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              Pritisni <kbd className="px-1 py-0.5 bg-background border border-border rounded text-xs">?</kbd> za prikaz tega okna.
            </p>
          </div>
        </div>
      )}

      {/* v1.3: Global search modal */}
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} onNavigate={setView} />
    </div>
  );
}
