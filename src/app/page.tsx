'use client';

import { useEffect, useState, useRef, memo } from 'react';
import dynamic from 'next/dynamic';
import { Activity, Bell, Settings, ListPlus, Zap, RefreshCw, AlertCircle, LayoutGrid, BarChart3, Search, Heart, TrendingUp, History, Eye, PieChart, Menu, X, Users, Sparkles, Package, DollarSign, FileText, Shield, HelpCircle, ExternalLink, ChevronDown, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { APP_VERSION, STATS_LABEL } from '@/lib/version';
// v6.94: Lazy-load dashboard pogledov z next/dynamic.
// Prej so se vsi 11 pogledi (skupaj ~17K vrstic komponent) statično naložili ob prvem loadu.
// Sedaj se naloži samo aktivni pogled — prvi load je ~3-5K namesto ~17K vrstic.
const DashboardView = dynamic(() => import('@/components/dashboard/dashboard-view').then(m => ({ default: m.DashboardView })), { ssr: false, loading: () => <LoadingFallback /> });
const MonitorsView = dynamic(() => import('@/components/dashboard/monitors-view').then(m => ({ default: m.MonitorsView })), { ssr: false, loading: () => <LoadingFallback /> });
const AlertsView = dynamic(() => import('@/components/dashboard/alerts-view').then(m => ({ default: m.AlertsView })), { ssr: false, loading: () => <LoadingFallback /> });
const SettingsView = dynamic(() => import('@/components/dashboard/settings-view').then(m => ({ default: m.SettingsView })), { ssr: false, loading: () => <LoadingFallback /> });
const ListingsView = dynamic(() => import('@/components/dashboard/listings-view').then(m => ({ default: m.ListingsView })), { ssr: false, loading: () => <LoadingFallback /> });
const AnalyticsView = dynamic(() => import('@/components/dashboard/analytics-view').then(m => ({ default: m.AnalyticsView })), { ssr: false, loading: () => <LoadingFallback /> });
const HealthView = dynamic(() => import('@/components/dashboard/health-view').then(m => ({ default: m.HealthView })), { ssr: false, loading: () => <LoadingFallback /> });
const TradesView = dynamic(() => import('@/components/dashboard/trades-view').then(m => ({ default: m.TradesView })), { ssr: false, loading: () => <LoadingFallback /> });
const NotificationHistoryView = dynamic(() => import('@/components/dashboard/notification-history-view').then(m => ({ default: m.NotificationHistoryView })), { ssr: false, loading: () => <LoadingFallback /> });
const WatchlistView = dynamic(() => import('@/components/dashboard/watchlist-view').then(m => ({ default: m.WatchlistView })), { ssr: false, loading: () => <LoadingFallback /> });
const StatisticsView = dynamic(() => import('@/components/dashboard/statistics-view').then(m => ({ default: m.StatisticsView })), { ssr: false, loading: () => <LoadingFallback /> });
// v7.00: BuyersView — nov pogled za upravljanje kupcev (40 orphan buyer endpointi)
const BuyersView = memo(dynamic(() => import('@/components/dashboard/buyers-view').then(m => ({ default: m.BuyersView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.01: AIHubView — centralen pregled vseh 254 AI endpointov z iskalnikom
const AIHubView = memo(dynamic(() => import('@/components/dashboard/ai-hub-view').then(m => ({ default: m.AIHubView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.02: InventoryView — AI analiza skladišča (aging, stockout, shrinkage, liquidation, rebalancer)
const InventoryView = memo(dynamic(() => import('@/components/dashboard/inventory-view').then(m => ({ default: m.InventoryView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.04: PricingView — AI analiza cen in dobička (smart-pricing, forecast, margin, price-war, seasonal)
const PricingView = memo(dynamic(() => import('@/components/dashboard/pricing-view').then(m => ({ default: m.PricingView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.05: ListingOptimizationView — AI optimizacija oglasov (image-gen, desc-gen, seo, virality, ctr)
const ListingOptimizationView = memo(dynamic(() => import('@/components/dashboard/listing-optimization-view').then(m => ({ default: m.ListingOptimizationView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.06: RiskView — AI analiza tveganj (hedging, insurance, saturation, parity, guardian)
const RiskView = memo(dynamic(() => import('@/components/dashboard/risk-view').then(m => ({ default: m.RiskView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v8.71: IskalnikView — targeted item search with criteria + results
const IskalnikView = memo(dynamic(() => import('@/components/dashboard/iskalnik-view').then(m => ({ default: m.IskalnikView })), { ssr: false, loading: () => <LoadingFallback /> }));
// v7.19: ErrorBoundary — prepreči bel zaslon ob crashu komponente
import { ErrorBoundary } from '@/components/error-boundary';
import { PwaInstallPrompt } from '@/components/dashboard/pwa-install-prompt';
import { ProfileSwitcher } from '@/components/dashboard/profile-switcher';
import { SearchModal } from '@/components/dashboard/search-modal';
// v9.52: Help Center Content — kategorizirani članki po vzoru Sellerboard
import { HelpCenterContent } from '@/components/dashboard/help-center-content';
// v9.54: Sidebar Navigation — opcijska levo stranska navigacija (po vzoru Linear/Vercel)
import { SidebarNav } from '@/components/dashboard/sidebar-nav';
// v9.55: AI Assistant — Natural Language Query interface (po vzoru Tableau AI / Metabase AI)
import { AiAssistant } from '@/components/dashboard/ai-assistant';
import { useAlertsStream } from '@/lib/use-alerts-stream';
import { useAuth, LoginModal } from '@/components/dashboard/login-modal';
// v8.45: Mobile-First Responsive Optimization — bottom nav + FAB + haptic
import { MobileBottomNav } from '@/components/dashboard/mobile-bottom-nav';
import { MobileFAB } from '@/components/dashboard/mobile-fab';
import { QuickAddTradeModal } from '@/components/dashboard/quick-add-trade-modal';
import { useHaptic } from '@/hooks/use-haptic';
import { CommandPalette } from '@/components/dashboard/command-palette';
import { ThemeToggle } from '@/components/theme-toggle';
import { OnboardingWizard } from '@/components/dashboard/onboarding-wizard';

/** v6.94: Loading fallback za lazy-loaded poglede. */
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
      <div className="flex flex-col items-center gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="text-sm terminal-glow">Nalagam...</span>
      </div>
    </div>
  );
}

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'watchlist' | 'analytics' | 'statistics' | 'trades' | 'health' | 'notifications' | 'settings' | 'buyers' | 'ai-hub' | 'inventory' | 'pricing' | 'listing-opt' | 'risk' | 'iskalnik';

// v9.49: Progressive Disclosure — 3-nivojski vmesnik.
// Nivo 1: 4 GLAVNI zavihki (vedno vidni) — najbolj uporabljani dnevno.
// Nivo 2: "Več" dropdown (AI Orodja + Analitika + Iskalnik) — dostop z 1 klikom.
// Nivo 3: Sistem drawer (gear v desnem kotu) — Alerti/Watchlist/Obvestila/Zdravje/Nastavitve.
const NAV_PRIMARY: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'monitors', label: 'Monitorji', icon: ListPlus },
  { id: 'listings', label: 'Oglasi', icon: LayoutGrid },
  { id: 'trades', label: 'Skladišče', icon: TrendingUp },
];

const NAV_MORE_GROUPS: { title: string; icon: typeof Activity; accent: string; items: { id: View; label: string; icon: typeof Activity }[] }[] = [
  {
    title: 'Iskanje',
    icon: Search,
    accent: 'text-emerald-400',
    items: [
      { id: 'iskalnik', label: 'Iskalnik', icon: Search },
    ],
  },
  {
    title: 'AI Orodja',
    icon: Sparkles,
    accent: 'text-amber-400',
    items: [
      { id: 'inventory', label: 'Skladišče AI', icon: Package },
      { id: 'pricing', label: 'Cene AI', icon: DollarSign },
      { id: 'listing-opt', label: 'Oglasi AI', icon: FileText },
      { id: 'risk', label: 'Tveganja AI', icon: Shield },
      { id: 'buyers', label: 'Kupci', icon: Users },
    ],
  },
  {
    title: 'Analitika',
    icon: BarChart3,
    accent: 'text-sky-400',
    items: [
      { id: 'analytics', label: 'Analitika', icon: BarChart3 },
      { id: 'statistics', label: 'Statistike', icon: PieChart },
      { id: 'ai-hub', label: 'AI Hub', icon: Sparkles },
    ],
  },
];

const NAV_SYSTEM: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'alerts', label: 'Alerti', icon: Bell },
  { id: 'watchlist', label: 'Watchlist', icon: Eye },
  { id: 'notifications', label: 'Obvestila', icon: History },
  { id: 'health', label: 'Zdravje', icon: Heart },
  { id: 'settings', label: 'Nastavitve', icon: Settings },
];

// Vsi views (za kompatibilnost s PWA shortcut handlerjem)
const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  ...NAV_PRIMARY,
  ...NAV_MORE_GROUPS.flatMap(g => g.items),
  ...NAV_SYSTEM,
];

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  // v9.54: Sidebar layout mode — 'top' (default) ali 'sidebar' (po vzoru Linear/Vercel)
  // Persisten v localStorage. Power-user feature.
  const [layoutMode, setLayoutMode] = useState<'top' | 'sidebar'>('top');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load layout mode iz localStorage na mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('markec-layout-mode');
    if (saved === 'sidebar' || saved === 'top') {
      setLayoutMode(saved);
    }
    const collapsed = localStorage.getItem('markec-sidebar-collapsed');
    if (collapsed === 'true') {
      setSidebarCollapsed(true);
    }
  }, []);

  // Apply data-layout na <html> + persist
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (layoutMode === 'sidebar') {
      root.setAttribute('data-layout', 'sidebar');
    } else {
      root.removeAttribute('data-layout');
    }
    localStorage.setItem('markec-layout-mode', layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    localStorage.setItem('markec-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const toggleLayout = () => {
    setLayoutMode((prev) => (prev === 'top' ? 'sidebar' : 'top'));
  };

  // v9.49: Progressive Disclosure — dropdown menu + system drawer
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [systemDrawerOpen, setSystemDrawerOpen] = useState(false);
  // Auto-highlight "Več" when active view is in secondary groups
  const isMoreActive = NAV_MORE_GROUPS.some(g => g.items.some(i => i.id === view));
  const isSystemActive = NAV_SYSTEM.some(i => i.id === view);
  const [now, setNow] = useState<Date | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false); // v8.46: Command Palette (Cmd+K)
  const [onboardingOpen, setOnboardingOpen] = useState(false); // v8.50: First-Run Onboarding
  const [helpOpen, setHelpOpen] = useState(false);
  // v9.55: AI Assistant state — Natural Language Query modal
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<'shortcuts' | 'quickstart' | 'help'>('quickstart'); // v8.82: default to quickstart for new users. v9.52: added 'help' tab
  // v4.7: Mobile nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // v8.45: Quick Add Trade modal state (triggered by MobileFAB on mobile).
  // DashboardView has its own internal instance for its "Dodaj trade" button;
  // this page-level instance serves the FAB so the action is available on
  // every view, not just the dashboard.
  const [showQuickAddTrade, setShowQuickAddTrade] = useState(false);
  const haptic = useHaptic();
  // v4.9: Real-time alerts via SSE
  const { connected: sseConnected, lastAlert, stats: sseStats } = useAlertsStream(true);
  const lastSeenAlertId = useRef<string | null>(null);
  // v6.92: Auth check — prikaži login modal, če je APP_API_KEY nastavljen in uporabnik ni prijavljen
  const { needsAuth } = useAuth();

  // v7.09: Clock effect — reduced from 1s to 10s (header time doesn't need second precision)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  // v7.09: Removed redundant 30s polling — SSE already sends stats every 5s
  // (useAlertsStream sends 'stats' event with unreadAlerts, which updates state below)
  // Only do initial fetch on mount:
  useEffect(() => {
    fetch('/api/stats').then(r => r.ok ? r.json() : null).then(s => {
      if (s) setUnreadAlerts(s.unreadAlerts ?? 0);
    }).catch(() => {});
  }, []);

  // v8.50: First-Run Onboarding — check if onboarding is completed
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.onboardingCompleted === false) {
          setOnboardingOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  // v8.45: PWA shortcut handler — reads ?view= and ?action= from URL on mount.
  // Enables PWA shortcuts (manifest.json) to deep-link into specific views
  // or trigger actions (e.g. /?action=add-trade opens QuickAddTradeModal).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const actionParam = params.get('action');
    if (viewParam) {
      const validViews: View[] = ['dashboard', 'monitors', 'alerts', 'listings', 'iskalnik', 'watchlist', 'analytics', 'statistics', 'trades', 'health', 'notifications', 'settings', 'buyers', 'ai-hub', 'inventory', 'pricing', 'listing-opt', 'risk'];
      if (validViews.includes(viewParam as View)) {
        setView(viewParam as View);
      }
    }
    if (actionParam === 'add-trade') {
      setShowQuickAddTrade(true);
    }
    // v8.64: Clean only ?view= and ?action= from URL — keep ?tag= and ?matchRequestId= for deep linking.
    // ?tag= is consumed by TradesView, ?matchRequestId= by IskalnikView (v8.77).
    if (viewParam || actionParam) {
      const tagParam = params.get('tag');
      const matchParam = params.get('matchRequestId');
      const keepParams = new URLSearchParams();
      if (tagParam) keepParams.set('tag', tagParam);
      if (matchParam) keepParams.set('matchRequestId', matchParam);
      const cleanUrl = keepParams.toString()
        ? `${window.location.pathname}?${keepParams.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

  // v4.9: SSE — update unreadAlerts from stats + show toast on new alert
  useEffect(() => {
    if (sseStats) {
      setUnreadAlerts(sseStats.unreadAlerts);
    }
  }, [sseStats]);

  useEffect(() => {
    if (lastAlert && lastAlert.id !== lastSeenAlertId.current) {
      lastSeenAlertId.current = lastAlert.id;
      // Show toast only if user is not on alerts page
      if (view !== 'alerts') {
        const verdict = lastAlert.aiVerdict === 'PRILIKA' ? '🎯' :
                        lastAlert.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';
        toast.success(`${verdict} ${lastAlert.title?.slice(0, 60) ?? 'Nov alert'}`, {
          description: lastAlert.monitor?.name
            ? `${lastAlert.monitor.name} • klik za podrobnosti`
            : 'Klik za podrobnosti',
          action: {
            label: 'Odpri',
            onClick: () => setView('alerts'),
          },
          duration: 8000,
        });
      }
    }
  }, [lastAlert, view]);

  // v9.49: Close "Več" dropdown when clicking outside or on navigation
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    // Delay to avoid immediate close from the toggle click
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [moreMenuOpen]);

  // Ctrl+K shortcut for global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K → Command Palette (v8.46: replaces old search)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen(true);
        return;
      }
      // v9.55: Ctrl+J or Cmd+J → AI Assistant
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        setAiAssistantOpen(true);
        return;
      }
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // Don't trigger when dialog is open
      if (searchOpen || cmdkOpen || aiAssistantOpen) return;

      // v2.5: Tab navigation shortcuts
      const navMap: Record<string, View> = {
        '1': 'dashboard',
        '2': 'monitors',
        '3': 'alerts',
        '4': 'listings',
        '5': 'watchlist',
        '6': 'trades',
        '7': 'analytics',
        '8': 'notifications',
        '9': 'health',
        '0': 'settings',
        'b': 'buyers', // v7.00: shortcut za kupce
        'a': 'ai-hub', // v7.01: shortcut za AI Hub
        'i': 'inventory', // v7.02: shortcut za skladišče AI
        'p': 'pricing', // v7.04: shortcut za cene AI
        'l': 'listing-opt', // v7.05: shortcut za oglasi AI
        'r': 'risk', // v7.06: shortcut za tveganja AI
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
  }, [searchOpen, cmdkOpen, aiAssistantOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground pb-16 md:pb-0">
      {/* v8.45: pb-16 on mobile reserves space below the footer for the fixed
          MobileBottomNav (56px) so footer content isn't covered. */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="pulse-dot text-primary text-lg shrink-0">●</span>
                <span className="text-primary terminal-glow font-bold tracking-tight truncate">
                  <span className="hidden sm:inline">markec@ai-firm</span>
                  <span className="sm:hidden">markec</span>
                </span>
                <span className="text-muted-foreground hidden sm:inline">:</span>
                <span className="text-amber-400 amber-glow hidden sm:inline">~/opportunity-monitor</span>
                <span className="text-muted-foreground hidden sm:inline">$</span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
              {/* v4.9: Profile switcher */}
              <ProfileSwitcher />
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-card/50 hover:border-primary/30 hover:text-primary transition-colors"
                title="Iskanje (Ctrl+K)"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Iskanje</span>
                <kbd className="text-[10px] bg-background/60 px-1.5 py-0.5 rounded border border-border">Ctrl+K</kbd>
              </button>
              {/* v8.82: Pomoč button — visible help access */}
              <button
                onClick={() => { setHelpTab('quickstart'); setHelpOpen(true); }}
                className="flex items-center gap-1 px-2 py-1.5 rounded border border-border bg-card/50 hover:border-primary/30 hover:text-primary transition-colors"
                title="Pomoč & Quick Start"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Pomoč</span>
              </button>
              {/* v9.55: AI Assistant button — Cmd+J shortcut */}
              <button
                onClick={() => setAiAssistantOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                title="AI Asistent (Ctrl+J) — Vprašaj AI o svojih trgovinah"
                aria-label="Odpri AI asistent"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden lg:inline font-medium">Vprašaj AI</span>
                <kbd className="hidden xl:inline text-[9px] bg-background/60 px-1 py-0.5 rounded border border-primary/30 font-mono">⌘J</kbd>
              </button>
              {/* v8.47: Theme toggle */}
              <ThemeToggle />
              {/* v9.54: Layout toggle — top-nav ↔ sidebar (power user feature) */}
              <button
                onClick={toggleLayout}
                className="flex items-center gap-1 px-2 py-1.5 rounded border border-border bg-card/50 hover:border-primary/30 hover:text-primary transition-colors"
                title={layoutMode === 'top' ? 'Preklopi na stransko navigacijo (power user)' : 'Preklopi na zgornjo navigacijo'}
                aria-label={layoutMode === 'top' ? 'Preklopi na stransko navigacijo' : 'Preklopi na zgornjo navigacijo'}
              >
                <PanelLeft className={cn('w-3.5 h-3.5', layoutMode === 'sidebar' && 'text-primary')} />
                <span className="hidden xl:inline">{layoutMode === 'top' ? 'Sidebar' : 'Top nav'}</span>
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
              {/* v4.9: SSE live indicator */}
              <span
                className="flex items-center gap-1.5"
                title={sseConnected ? 'Real-time povezava aktivna' : 'Real-time povezava prekinjena'}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  sseConnected ? 'bg-primary pulse-dot' : 'bg-amber-400'
                )} />
                <span className={sseConnected ? 'text-primary' : 'text-amber-400'}>
                  {sseConnected ? 'LIVE' : 'OFFLINE'}
                </span>
              </span>
            </div>
            <button
              onClick={() => setSearchOpen(true)}
              className="md:hidden p-2 rounded border border-border bg-card/50 hover:border-primary/30"
              aria-label="Iskanje"
            >
              <Search className="w-4 h-4" />
            </button>
            {/* v4.7: Mobile nav hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 rounded border border-border bg-card/50 hover:border-primary/30"
              aria-label="Meni"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Nav tabs — desktop only — v9.49: Progressive Disclosure (4 primary + Več dropdown + Sistem gear)
          v9.54: Skrij ko je layoutMode='sidebar' (stranska navigacija prevzame) */}
      {layoutMode === 'top' && (
      <nav className="hidden md:block border-b border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1">
            {/* 🎯 NIVO 1: 4 GLAVNI zavihki — vedno vidni */}
            {NAV_PRIMARY.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                    active
                      ? 'border-primary text-primary terminal-glow'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="uppercase tracking-wider">{item.label}</span>
                </button>
              );
            })}

            {/* Divider */}
            <div className="h-6 w-px bg-border mx-1 shrink-0" />

            {/* 📂 NIVO 2: "Več" dropdown — Iskalnik + AI Orodja + Analitika */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setMoreMenuOpen(o => !o)}
                aria-label="Več funkcij — razširi meni"
                aria-expanded={moreMenuOpen}
                aria-haspopup="menu"
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                  moreMenuOpen
                    ? 'border-primary/50 text-primary'
                    : isMoreActive
                      ? 'border-primary text-primary terminal-glow'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <ChevronDown className={cn('w-3 h-3 transition-transform', moreMenuOpen && 'rotate-180')} />
                <span className="uppercase tracking-wider">Več</span>
              </button>

              {moreMenuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-px w-72 bg-card border border-border rounded-b-lg shadow-xl z-40 overflow-hidden"
                >
                  {NAV_MORE_GROUPS.map((group) => {
                    const GroupIcon = group.icon;
                    return (
                      <div key={group.title} className="border-b border-border/50 last:border-0">
                        <div className={cn('flex items-center gap-2 px-4 py-2 text-[10px] uppercase font-bold tracking-wider bg-card/50', group.accent)}>
                          <GroupIcon className="w-3 h-3" />
                          {group.title}
                        </div>
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const active = view === item.id;
                          return (
                            <button
                              key={item.id}
                              onClick={() => { setView(item.id); setMoreMenuOpen(false); }}
                              role="menuitem"
                              aria-label={item.label}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left',
                                active
                                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border-l-2 border-transparent'
                              )}
                            >
                              <Icon className="w-4 h-4 shrink-0" />
                              <span className="uppercase tracking-wider">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Spacer pushes Sistem to the right */}
            <div className="flex-1" />

            {/* ⚙️ NIVO 3: Sistem gear — odpre drawer iz desne */}
            <button
              onClick={() => setSystemDrawerOpen(true)}
              aria-label="Sistem — nastavitve, alerti, zdravje"
              aria-expanded={systemDrawerOpen}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap relative',
                isSystemActive
                  ? 'border-muted-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <Settings className="w-4 h-4" />
              <span className="uppercase tracking-wider">Sistem</span>
              {unreadAlerts > 0 && (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
              )}
            </button>
          </div>
        </div>
      </nav>
      )}

      {/* v9.54: Sidebar layout — ko je layoutMode='sidebar', prikaži stransko navigacijo + main v flex row */}
      {layoutMode === 'sidebar' && (
        <div className="hidden md:flex flex-1 min-h-0">
          <SidebarNav
            currentView={view}
            onNavigate={setView}
            unreadAlerts={unreadAlerts}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          />
          <main className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-20 md:pb-6">
            {view === 'dashboard' && <ErrorBoundary viewName="Dashboard"><DashboardView onNavigate={setView} /></ErrorBoundary>}
            {view === 'monitors' && <ErrorBoundary viewName="Monitorji"><MonitorsView /></ErrorBoundary>}
            {view === 'alerts' && <ErrorBoundary viewName="Alerti"><AlertsView /></ErrorBoundary>}
            {view === 'listings' && <ErrorBoundary viewName="Oglasi"><ListingsView /></ErrorBoundary>}
            {view === 'iskalnik' && <ErrorBoundary viewName="Iskalnik"><IskalnikView /></ErrorBoundary>}
            {view === 'watchlist' && <ErrorBoundary viewName="Watchlist"><WatchlistView onNavigate={setView} /></ErrorBoundary>}
            {view === 'trades' && <ErrorBoundary viewName="Skladišče"><TradesView /></ErrorBoundary>}
            {view === 'inventory' && <ErrorBoundary viewName="Skladišče AI"><InventoryView /></ErrorBoundary>}
            {view === 'pricing' && <ErrorBoundary viewName="Cene AI"><PricingView /></ErrorBoundary>}
            {view === 'listing-opt' && <ErrorBoundary viewName="Oglasi AI"><ListingOptimizationView /></ErrorBoundary>}
            {view === 'risk' && <ErrorBoundary viewName="Tveganja AI"><RiskView /></ErrorBoundary>}
            {view === 'buyers' && <ErrorBoundary viewName="Kupci"><BuyersView /></ErrorBoundary>}
            {view === 'analytics' && <ErrorBoundary viewName="Analitika"><AnalyticsView /></ErrorBoundary>}
            {view === 'statistics' && <ErrorBoundary viewName="Statistike"><StatisticsView /></ErrorBoundary>}
            {view === 'notifications' && <ErrorBoundary viewName="Obvestila"><NotificationHistoryView /></ErrorBoundary>}
            {view === 'health' && <ErrorBoundary viewName="Zdravje"><HealthView /></ErrorBoundary>}
            {view === 'settings' && <ErrorBoundary viewName="Nastavitve"><SettingsView /></ErrorBoundary>}
            {view === 'ai-hub' && <ErrorBoundary viewName="AI Hub"><AIHubView /></ErrorBoundary>}
          </main>
        </div>
      )}

      {/* 🗄️ NIVO 3: Sistem drawer — odpre se iz desne strani */}
      {systemDrawerOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          onClick={() => setSystemDrawerOpen(false)}
        >
          <div
            className="bg-card border-l border-border h-full w-72 max-w-[85vw] ml-auto p-4 overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-primary terminal-glow font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Sistem
              </span>
              <button
                onClick={() => setSystemDrawerOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-card/50"
                aria-label="Zapri drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] uppercase text-muted-foreground/60 font-bold px-3 pt-2 pb-1">⚙️ Sistem & Nastavitve</div>
              {NAV_SYSTEM.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id); setSystemDrawerOpen(false); }}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="uppercase tracking-wider flex-1 text-left">{item.label}</span>
                    {item.id === 'alerts' && unreadAlerts > 0 && (
                      <Badge variant="destructive" className="px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border text-[10px] text-muted-foreground/70 leading-relaxed">
              <p className="mb-1">⚡ Pritisni <kbd className="bg-background/60 px-1.5 py-0.5 rounded border border-border">?</kbd> za pomoč</p>
              <p className="mb-1">⌨️ <kbd className="bg-background/60 px-1.5 py-0.5 rounded border border-border">Ctrl+K</kbd> za ukazno paleto</p>
              <p>📊 18 funkcij skritih v 3-nivojskem vmesniku</p>
            </div>
          </div>
        </div>
      )}

      {/* v4.7: Mobile nav drawer */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="bg-card border-r border-border h-full w-64 max-w-[80vw] p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-primary terminal-glow font-bold text-sm uppercase">Navigacija</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label="Zapri"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {/* 🎯 GLAVNO — 4 zavihki */}
              <div className="text-[9px] uppercase text-muted-foreground/60 font-bold px-3 pt-2 pb-1">Glavno</div>
              {NAV_PRIMARY.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id); setMobileNavOpen(false); }}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="uppercase tracking-wider flex-1 text-left">{item.label}</span>
                  </button>
                );
              })}

              {/* 📂 VEČ — Iskalnik + AI Orodja + Analitika */}
              {NAV_MORE_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.title}>
                    <div className={cn('text-[9px] uppercase font-bold px-3 pt-3 pb-1 flex items-center gap-1', group.accent)}>
                      <GroupIcon className="w-3 h-3" />
                      {group.title}
                    </div>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = view === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setView(item.id); setMobileNavOpen(false); }}
                          aria-label={item.label}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors',
                            active
                              ? 'bg-primary/10 text-primary border border-primary/30'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent'
                          )}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="uppercase tracking-wider flex-1 text-left">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* ⚙️ SISTEM */}
              <div className="text-[9px] uppercase text-muted-foreground/60 font-bold px-3 pt-3 pb-1">⚙️ Sistem</div>
              {NAV_SYSTEM.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id); setMobileNavOpen(false); }}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="uppercase tracking-wider flex-1 text-left">{item.label}</span>
                    {item.id === 'alerts' && unreadAlerts > 0 && (
                      <Badge variant="destructive" className="px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <button
                onClick={() => { setSearchOpen(true); setMobileNavOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded border border-border bg-card/50 text-sm hover:border-primary/30"
              >
                <Search className="w-4 h-4" />
                <span>Iskanje</span>
                <kbd className="ml-auto text-[10px] bg-background/60 px-1.5 py-0.5 rounded border border-border">Ctrl+K</kbd>
              </button>
              {now && (
                <div className="text-[10px] text-muted-foreground font-mono text-center pt-2">
                  {now.toLocaleDateString('sl-SI')} {now.toLocaleTimeString('sl-SI')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main content — top-nav layout (default). v9.54: Skrij ko je layoutMode='sidebar' (prikazan zgoraj v sidebar bloku) */}
      {/* v8.45: pb-20 on mobile clears the fixed bottom nav (56px) + FAB. */}
      {layoutMode === 'top' && (
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-20 md:pb-6">
        {view === 'dashboard' && <ErrorBoundary viewName="Dashboard"><DashboardView onNavigate={setView} /></ErrorBoundary>}
        {view === 'monitors' && <ErrorBoundary viewName="Monitorji"><MonitorsView /></ErrorBoundary>}
        {view === 'alerts' && <ErrorBoundary viewName="Alerti"><AlertsView /></ErrorBoundary>}
        {view === 'listings' && <ErrorBoundary viewName="Oglasi"><ListingsView /></ErrorBoundary>}
        {view === 'iskalnik' && <ErrorBoundary viewName="Iskalnik"><IskalnikView /></ErrorBoundary>}
        {view === 'watchlist' && <ErrorBoundary viewName="Watchlist"><WatchlistView onNavigate={setView} /></ErrorBoundary>}
        {view === 'trades' && <ErrorBoundary viewName="Skladišče"><TradesView /></ErrorBoundary>}
        {view === 'inventory' && <ErrorBoundary viewName="Skladišče AI"><InventoryView /></ErrorBoundary>}
        {view === 'pricing' && <ErrorBoundary viewName="Cene AI"><PricingView /></ErrorBoundary>}
        {view === 'listing-opt' && <ErrorBoundary viewName="Oglasi AI"><ListingOptimizationView /></ErrorBoundary>}
        {view === 'risk' && <ErrorBoundary viewName="Tveganja AI"><RiskView /></ErrorBoundary>}
        {view === 'buyers' && <ErrorBoundary viewName="Kupci"><BuyersView /></ErrorBoundary>}
        {view === 'analytics' && <ErrorBoundary viewName="Analitika"><AnalyticsView /></ErrorBoundary>}
        {view === 'statistics' && <ErrorBoundary viewName="Statistike"><StatisticsView /></ErrorBoundary>}
        {view === 'notifications' && <ErrorBoundary viewName="Obvestila"><NotificationHistoryView /></ErrorBoundary>}
        {view === 'health' && <ErrorBoundary viewName="Zdravje"><HealthView /></ErrorBoundary>}
        {view === 'settings' && <ErrorBoundary viewName="Nastavitve"><SettingsView /></ErrorBoundary>}
        {view === 'ai-hub' && <ErrorBoundary viewName="AI Hub"><AIHubView /></ErrorBoundary>}
      </main>
      )}

      {/* Footer — v8.49: enhanced z live health + version + stats */}
      <footer className="border-t border-border bg-card/30 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-primary font-bold">markec-ai-firm</span>
              <span className="font-mono">{APP_VERSION}</span>
              <span className="hidden sm:inline">•</span>
              <span>local-first</span>
              <span className="hidden sm:inline">•</span>
              <span>zero-cloud</span>
              <span className="hidden sm:inline">•</span>
              <span>{STATS_LABEL}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-500 font-medium">HEALTHY</span>
                <span className="text-muted-foreground">85/100</span>
              </span>
              <span className="hidden sm:inline">•</span>
              <span>cron: <code className="text-amber-400">GET /api/cron/run-all</code></span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">⌘K za ukaze</span>
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
            className={`bg-card border border-border rounded-lg w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl ${helpTab === 'help' ? 'max-w-4xl' : 'max-w-2xl'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary terminal-glow uppercase flex items-center gap-2">
                <HelpCircle className="w-5 h-5" /> Pomoč
              </h2>
              <button onClick={() => setHelpOpen(false)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>

            {/* v8.82: Tab switcher */}
            <div className="flex gap-1 mb-4 border-b border-border">
              <button
                onClick={() => setHelpTab('quickstart')}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${helpTab === 'quickstart' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                🚀 Quick Start
              </button>
              <button
                onClick={() => setHelpTab('shortcuts')}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${helpTab === 'shortcuts' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                ⌨️ Bližnjice
              </button>
              <button
                onClick={() => setHelpTab('help')}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${helpTab === 'help' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                📚 Pomoč
              </button>
            </div>

            {/* Quick Start Tab */}
            {helpTab === 'quickstart' && (
              <div className="space-y-4 text-sm">
                {/* Setup checklist */}
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">📋 Setup Checklist</h3>
                  <div className="space-y-1.5">
                    {[
                      { step: '1', text: 'Nastavi AI provider', link: '/?view=settings', detail: 'Nastavitve → AI → Ollama (brezplačno) ali OpenAI' },
                      { step: '2', text: 'Ustvari prvi monitor', link: '/?view=monitors', detail: 'Monitorji → Nov monitor → Bolha/Vinted/etc URL' },
                      { step: '3', text: 'Nastavi zunanji cron', link: '', detail: 'Brez cron-a sistem ne deluje avtomatsko!' },
                      { step: '4', text: 'Poženi monitor', link: '/?view=monitors', detail: 'Monitorji → Poženi (ali počakaj na cron)' },
                      { step: '5', text: 'Omogoči Web Push', link: '/?view=settings', detail: 'Nastavitve → Web Push → Generiraj VAPID ključe' },
                      { step: '6', text: 'Shrani iskanje v Iskalniku', link: '/?view=iskalnik', detail: 'Iskalnik → išči → Shrani iskanje (auto-monitor)' },
                    ].map((s) => (
                      <a
                        key={s.step}
                        href={s.link || '#'}
                        onClick={s.link ? undefined : (e) => e.preventDefault()}
                        className="flex items-start gap-2 p-2 rounded-md border border-border/50 hover:bg-accent/30 transition-colors"
                      >
                        <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">{s.step}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium">{s.text}</div>
                          <div className="text-[10px] text-muted-foreground">{s.detail}</div>
                        </div>
                        {s.link && <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />}
                      </a>
                    ))}
                  </div>
                </div>

                {/* Workflow */}
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">🔄 Kako sistem deluje</h3>
                  <div className="bg-muted/20 rounded-lg p-3 text-[11px] space-y-1 font-mono">
                    <div>🔍 <b>Monitorji</b> → scrapajo oglase z Bolha/Vinted/Quoka (11 platform)</div>
                    <div>🧠 <b>AI</b> → oceni vsak oglas (score 1-10, risk, verdict PRILIKA/SUMNJIVO)</div>
                    <div>🛒 <b>Buy Score</b> → izračuna 0-100 ali naj kupiš (v8.68)</div>
                    <div>🔍 <b>Iskalnik</b> → išči po kriterijih, primerjaj, shrani za auto-monitor (v8.71-72)</div>
                    <div>📱 <b>Auto-cron</b> → vsakih 10min preveri saved searches → Push notification (v8.75-79)</div>
                    <div>💰 <b>Skladišče</b> → sledi buy/sell, Sell Priority (v8.65), Smart Price (v8.66)</div>
                    <div>🏆 <b>Outcome</b> → po prodaji: ali si prodal optimalno? (v8.67)</div>
                    <div>📊 <b>Dashboard</b> → Daily Briefing + 10 card-ov z vso inteligenco (v8.80)</div>
                    <div>🧠 <b>Decision Accuracy</b> → ali tvoji algoritmi delujejo? (v8.70)</div>
                  </div>
                </div>

                {/* Feature overview */}
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">🗺️ Ključni zavihki</h3>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {[
                      { v: 'dashboard', t: '📊 Dashboard', d: 'Daily Briefing + 10 intelligence card-ov' },
                      { v: 'monitors', t: '🔍 Monitorji', d: 'Ustvari iskalne monitorje za scraping' },
                      { v: 'listings', t: '📋 Oglasi', d: 'Vsi scraped oglasi z AI ocenami' },
                      { v: 'iskalnik', t: '🔎 Iskalnik', d: 'Išči po kriterijih + Compare + Save' },
                      { v: 'trades', t: '💰 Skladišče', d: 'Buy/Sell tracking + Priority + Smart Price' },
                      { v: 'ai-hub', t: '🤖 AI Hub', d: '432 AI funkcij + Notification Center' },
                    ].map(f => (
                      <button
                        key={f.v}
                        onClick={() => { setView(f.v as View); setHelpOpen(false); }}
                        className="text-left p-2 rounded-md border border-border/50 hover:border-primary/30 hover:bg-accent/30 transition-colors"
                      >
                        <div className="font-medium text-xs">{f.t}</div>
                        <div className="text-[10px] text-muted-foreground">{f.d}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cron command */}
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">⏰ Cron Setup (nujno!)</h3>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-2">
                    <p className="text-[10px] text-red-400 font-medium">⚠️ Brez cron-a se NE BO NIČ samodejno poganjalo!</p>
                  </div>
                  <pre className="text-[10px] bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground">
{`# Linux/Mac (crontab -e):
*/10 * * * * curl -s http://localhost:3000/api/cron/run-all > /dev/null

# Windows (Task Scheduler):
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/run-all" -Method POST`}
                  </pre>
                </div>
              </div>
            )}

            {/* Shortcuts Tab */}
            {helpTab === 'shortcuts' && (
              <div className="space-y-2 text-sm">
                <div className="text-xs font-bold text-muted-foreground uppercase mb-1">Navigacija</div>
                {[
                  { key: '1', desc: 'Dashboard' },
                  { key: '2', desc: 'Monitorji' },
                  { key: '3', desc: 'Alerti' },
                  { key: '4', desc: 'Oglasi' },
                  { key: '5', desc: 'Watchlist' },
                  { key: '6', desc: 'Skladišče' },
                  { key: '7', desc: 'Analitika' },
                  { key: '8', desc: 'Obvestila' },
                  { key: '9', desc: 'Zdravje' },
                  { key: '0', desc: 'Nastavitve' },
                  { key: 'B', desc: 'Kupci' },
                  { key: 'A', desc: 'AI Hub' },
                  { key: 'I', desc: 'Skladišče AI' },
                  { key: 'P', desc: 'Cene AI' },
                  { key: 'L', desc: 'Oglasi AI' },
                  { key: 'R', desc: 'Tveganja AI' },
                ].map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">{s.desc}</span>
                    <kbd className="px-2 py-0.5 bg-background border border-border rounded text-xs font-mono text-primary">{s.key}</kbd>
                  </div>
                ))}
                <div className="text-xs font-bold text-muted-foreground uppercase mb-1 mt-3">Akcije</div>
                {[
                  { key: 'Ctrl+K', desc: '⌘ Command Palette (v8.46)' },
                  { key: '?', desc: 'Ta pomoč' },
                ].map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">{s.desc}</span>
                    <kbd className="px-2 py-0.5 bg-background border border-border rounded text-xs font-mono text-primary">{s.key}</kbd>
                  </div>
                ))}
              </div>
            )}

            {/* v9.52: Help Center Tab — kategorizirani članki po vzoru Sellerboard */}
            {helpTab === 'help' && (
              <HelpCenterContent />
            )}

            {/* v8.82: Hint for '?' shortcut — skrij na help tab (ker si že tam) */}
            {helpTab !== 'help' && (
              <p className="text-[11px] text-muted-foreground mt-4 text-center">
                Pritisni <kbd className="px-1 py-0.5 bg-background border border-border rounded text-xs">?</kbd> za prikaz tega okna.
              </p>
            )}
          </div>
        </div>
      )}

      {/* v1.3: Global search modal */}
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} onNavigate={setView} />
      {/* v8.46: Command Palette (Cmd+K) — Raycast/Spotlight-style search */}
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} onNavigate={(v) => setView(v as View)} />
      {/* v9.55: AI Assistant — Natural Language Query modal (Cmd+J) */}
      <AiAssistant open={aiAssistantOpen} onOpenChange={setAiAssistantOpen} />

      {/* v8.50: First-Run Onboarding Wizard */}
      <OnboardingWizard open={onboardingOpen} onComplete={() => setOnboardingOpen(false)} />

      {/* v4.8: PWA install prompt */}
      <PwaInstallPrompt />

      {/* v6.92: Auth login modal — prikaže se, če APP_API_KEY zahteva avtentikacijo */}
      {needsAuth && <LoginModal onSuccess={() => window.location.reload()} />}

      {/* v8.45: Mobile bottom navigation — 5 most important sections.
          Fixed at bottom, md:hidden. Uses existing setView callback. */}
      <MobileBottomNav
        currentView={view}
        onNavigate={(v) => setView(v)}
        unreadAlerts={unreadAlerts}
      />

      {/* v8.45: Mobile floating action button — opens QuickAddTradeModal.
          Purple→primary gradient, pulsing glow, haptic on tap. md:hidden. */}
      <MobileFAB onAddTrade={() => setShowQuickAddTrade(true)} />

      {/* v8.45: Page-level QuickAddTradeModal — triggered by the MobileFAB.
          Separate from DashboardView's internal instance so the FAB works
          on every view (alerts, trades, settings, etc.), not just dashboard. */}
      <QuickAddTradeModal
        open={showQuickAddTrade}
        onOpenChange={setShowQuickAddTrade}
        onSaved={() => {
          haptic.success();
          toast.success('Trade dodan');
        }}
      />
    </div>
  );
}
