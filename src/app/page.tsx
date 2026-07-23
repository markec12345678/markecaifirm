'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Bell, Settings, ListPlus, Zap, RefreshCw, AlertCircle, LayoutGrid, BarChart3, Search, Heart } from 'lucide-react';
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
import { SearchModal } from '@/components/dashboard/search-modal';

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'analytics' | 'health' | 'settings';

const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'monitors', label: 'Monitorji', icon: ListPlus },
  { id: 'alerts', label: 'Alerti', icon: Bell },
  { id: 'listings', label: 'Oglasi', icon: LayoutGrid },
  { id: 'analytics', label: 'Analitika', icon: BarChart3 },
  { id: 'health', label: 'Zdravje', icon: Heart },
  { id: 'settings', label: 'Nastavitve', icon: Settings },
];

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

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
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
        {view === 'analytics' && <AnalyticsView />}
        {view === 'health' && <HealthView />}
        {view === 'settings' && <SettingsView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="text-primary">markec-ai-firm</span>
              <span>v1.3.0</span>
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

      {/* v1.3: Global search modal */}
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} onNavigate={setView} />
    </div>
  );
}
