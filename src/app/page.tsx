'use client';

import { useEffect, useState, useRef, memo } from 'react';
import dynamic from 'next/dynamic';
import { Activity, Bell, Settings, ListPlus, Zap, RefreshCw, LayoutGrid, BarChart3, Search, Heart, TrendingUp, History, Eye, PieChart, Menu, X, Users, Sparkles, Package, DollarSign, FileText, Shield, HelpCircle, ExternalLink, ChevronRight, PanelLeft } from 'lucide-react';
// REORG-1: ScraperMonitorWidget + PredictiveAnalyticsWidget kot samostojna sub-view-a
import { ScraperMonitorWidget } from '@/components/dashboard/scraper-monitor-widget';
import { PredictiveAnalyticsWidget } from '@/components/dashboard/predictive-analytics-widget';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
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
// v9.81: DecisionHistoryView — zgodovina Copilot odločitev z realnimi izidi
const DecisionHistoryView = memo(dynamic(() => import('@/components/dashboard/decision-history-view').then(m => ({ default: m.DecisionHistoryView })), { ssr: false, loading: () => <LoadingFallback /> }));
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

// REORG-1: 7 kategorij s sub-tabs (zamenjava za 4 primary + 3 groups + 5 system = 18 razpršenih view-ov).
//
// Prej (v9.49): 3-nivojski vmesnik (4 primary + Več dropdown + Sistem drawer).
// Zdaj (REORG-1): 7 kategorij v glavni vrstici, s sub-tab vrstico pod njim.
// Vsi 20 views (18 obstoječih + 2 novi: scraper-status, predictive) so dostopni prek 7 kategorij.
//
// Kategorije:
//   1. Pregled      (1)  — Dashboard
//   2. Monitorji    (2)  — Monitorji + Scraper Status (widget)
//   3. Oglasi        (4)  — Vsi oglasi + Watchlist + Iskalnik + Oglasi AI
//   4. Skladišče     (3)  — Trgovine + Inventar + Cene AI
//   5. AI            (4)  — AI Hub + Kupci + Tveganja + AI Asistent (modal)
//   6. Analitika    (3)  — Analitika + Statistike + Predictive (widget)
//   7. Sistem        (4)  — Nastavitve + Zdravje + Alerti + Obvestila
type View = 'dashboard' | 'monitors' | 'scraper-status' | 'listings' | 'watchlist' | 'iskalnik' | 'listing-opt' | 'trades' | 'inventory' | 'pricing' | 'ai-hub' | 'decision-history' | 'buyers' | 'risk' | 'analytics' | 'statistics' | 'predictive' | 'settings' | 'alerts' | 'notifications' | 'health';

// ID-ji kategorij (za tip-svarnost)
type CategoryId = 'dashboard' | 'monitors' | 'listings' | 'trades' | 'ai-hub' | 'analytics' | 'settings';

// Specialni ID za sub-tab, ki ne preklopi view-a ampak odpre modal
const AI_ASSISTANT_MODAL_ID = 'ai-assistant-modal' as const;
type SubViewId = View | typeof AI_ASSISTANT_MODAL_ID;

interface SubView {
  id: SubViewId;
  label: string;
  icon: typeof Activity;
}

interface NavCategory {
  id: CategoryId;
  label: string;
  icon: typeof Activity;
  /** Sub-views te kategorije (prvi je tudi primary view). */
  subViews: SubView[];
  /** Privzeti view, ko uporabnik klikne kategorijo. */
  primaryView: View;
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'dashboard',
    label: 'Pregled',
    icon: Activity,
    primaryView: 'dashboard',
    subViews: [
      { id: 'dashboard', label: 'Pregled', icon: Activity },
    ],
  },
  {
    id: 'monitors',
    label: 'Monitorji',
    icon: ListPlus,
    primaryView: 'monitors',
    subViews: [
      { id: 'monitors', label: 'Monitorji', icon: ListPlus },
      { id: 'scraper-status', label: 'Status', icon: RefreshCw },
    ],
  },
  {
    id: 'listings',
    label: 'Oglasi',
    icon: LayoutGrid,
    primaryView: 'listings',
    subViews: [
      { id: 'listings', label: 'Vsi oglasi', icon: LayoutGrid },
      { id: 'watchlist', label: 'Watchlist', icon: Eye },
    ],
  },
  {
    id: 'settings',
    label: 'Nastavitve',
    icon: Settings,
    primaryView: 'settings',
    subViews: [
      { id: 'settings', label: 'Nastavitve', icon: Settings },
      { id: 'alerts', label: 'Alerti', icon: Bell },
    ],
  },
];

/** Vrne kategorijo, ki vsebuje trenutni view. */
function getActiveCategory(view: View): NavCategory {
  return NAV_CATEGORIES.find(c => c.subViews.some(sv => sv.id === view)) ?? NAV_CATEGORIES[0];
}

// Vsi views (za kompatibilnost s PWA shortcut handlerjem in search modal-om)
const NAV: { id: View; label: string; icon: typeof Activity }[] = NAV_CATEGORIES.flatMap(c =>
  c.subViews
    .filter((sv): sv is SubView & { id: View } => sv.id !== AI_ASSISTANT_MODAL_ID)
    .map(sv => ({ id: sv.id, label: sv.label, icon: sv.icon }))
);

// v9.64: Keyboard shortcut map — za tooltip hints na nav gumbih
// (imported from shared format utility)
import { navTitleWithShortcut as navTitle } from '@/lib/format';

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

  // REORG-1: Aktivna kategorija (izpeljana iz view-a, brez dodatnega state-a)
  const activeCategory = getActiveCategory(view);
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

  // v9.78: Fetch real health status from /api/health (ne hardkodirano 85/100)
  const [healthStatus, setHealthStatus] = useState<'ok' | 'warn' | 'error' | 'loading'>('loading');
  useEffect(() => {
    const loadHealth = () => {
      fetch('/api/health').then(r => r.ok ? r.json() : null).then(h => {
        if (h?.overall) setHealthStatus(h.overall);
        else setHealthStatus('loading');
      }).catch(() => setHealthStatus('loading'));
    };
    loadHealth();
    const t = setInterval(loadHealth, 60_000); // osveži vsako minuto
    return () => clearInterval(t);
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
      const validViews: View[] = ['dashboard', 'monitors', 'scraper-status', 'listings', 'iskalnik', 'watchlist', 'trades', 'inventory', 'pricing', 'listing-opt', 'risk', 'buyers', 'analytics', 'statistics', 'predictive', 'notifications', 'health', 'settings', 'alerts', 'ai-hub', 'decision-history'];
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

  // REORG-1: handleSubTabClick — upravlja sub-tab navigacijo (vključno z modal triggerjem)
  const handleSubTabClick = (subViewId: SubViewId) => {
    if (subViewId === AI_ASSISTANT_MODAL_ID) {
      setAiAssistantOpen(true);
      return;
    }
    setView(subViewId);
  };

  // REORG-1: handleCategoryClick — klik kategorije nastavi view na primaryView
  // (če uporabnik že je v tej kategoriji, ne naredi ničesar — naj uporabi sub-tabs)
  const handleCategoryClick = (category: NavCategory) => {
    if (category.subViews.some(sv => sv.id === view)) return;
    setView(category.primaryView);
  };

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
              {/* v9.76: Simplified status — samo en indikator (SSE connection) */}
              <span
                className="flex items-center gap-1.5"
                title={sseConnected ? 'Aplikacija je povezana in deluje' : 'Real-time povezava prekinjena'}
              >
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                )} />
                <span className={cn(
                  'text-xs font-medium',
                  sseConnected ? 'text-emerald-500' : 'text-red-500'
                )}>
                  {sseConnected ? '🟢 Online' : '🔴 Brez povezave'}
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

      {/* Nav tabs — desktop only — REORG-1: 7 kategorij + sub-tabs row.
          v9.54: Skrij ko je layoutMode='sidebar' (stranska navigacija prevzame) */}
      {layoutMode === 'top' && (
      <nav className="hidden md:block border-b border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 overflow-x-auto">
            {/* REORG-1: 7 kategorij v glavni vrstici */}
            {NAV_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const isActiveCategory = activeCategory.id === category.id;
              const showBadge = category.id === 'settings' && unreadAlerts > 0;
              return (
                <button
                  key={category.id}
                  onClick={() => handleCategoryClick(category)}
                  aria-label={category.label}
                  aria-current={isActiveCategory ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 px-3 lg:px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap relative',
                    isActiveCategory
                      ? 'border-primary text-primary terminal-glow'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="uppercase tracking-wider">{category.label}</span>
                  {showBadge && (
                    <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
                  )}
                </button>
              );
            })}
          </div>
          {/* REORG-1: Sub-tabs row — prikazan samo če ima aktivna kategorija >1 sub-view */}
          {activeCategory.subViews.length > 1 && (
            <div className="flex items-center gap-0 border-t border-border/50 bg-background/30 overflow-x-auto">
              {activeCategory.subViews.map((subView) => {
                const Icon = subView.icon;
                const isModalTrigger = subView.id === AI_ASSISTANT_MODAL_ID;
                const isActiveSubView = !isModalTrigger && view === subView.id;
                return (
                  <button
                    key={subView.id}
                    onClick={() => handleSubTabClick(subView.id)}
                    aria-label={subView.label}
                    title={isModalTrigger ? `${subView.label} (Ctrl+J)` : navTitle(subView.label, subView.id)}
                    aria-current={isActiveSubView ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 px-3 lg:px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                      isActiveSubView
                        ? 'border-primary/70 text-primary'
                        : isModalTrigger
                          ? 'border-transparent text-amber-400 hover:text-amber-300 hover:border-amber-400/40'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="uppercase tracking-wider">{subView.label}</span>
                    {isModalTrigger && (
                      <kbd className="text-[9px] bg-background/60 px-1 py-0.5 rounded border border-amber-400/30 font-mono">⌘J</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>
      )}

      {/* v9.54: Sidebar layout — ko je layoutMode='sidebar', prikaži stransko navigacijo + main v flex row */}
      {layoutMode === 'sidebar' && (
        <div className="hidden md:flex flex-1 min-h-0">
          <SidebarNav
            currentView={view}
            onNavigate={setView}
            onOpenAiAssistant={() => setAiAssistantOpen(true)}
            unreadAlerts={unreadAlerts}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          />
          <main className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-20 md:pb-6">
            {view === 'dashboard' && <ErrorBoundary viewName="Dashboard"><DashboardView onNavigate={setView} /></ErrorBoundary>}
            {view === 'monitors' && <ErrorBoundary viewName="Monitorji"><MonitorsView /></ErrorBoundary>}
            {/* REORG-1: Scraper Status kot samostojen sub-view */}
            {view === 'scraper-status' && <ErrorBoundary viewName="Scraper Status"><ScraperMonitorWidget /></ErrorBoundary>}
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
            {/* REORG-1: Predictive Analytics kot samostojen sub-view */}
            {view === 'predictive' && <ErrorBoundary viewName="Predictive"><PredictiveAnalyticsWidget onNavigate={setView as (v: import('@/components/dashboard/dashboard/types').DashboardView) => void} /></ErrorBoundary>}
            {view === 'notifications' && <ErrorBoundary viewName="Obvestila"><NotificationHistoryView /></ErrorBoundary>}
            {view === 'health' && <ErrorBoundary viewName="Zdravje"><HealthView /></ErrorBoundary>}
            {view === 'settings' && <ErrorBoundary viewName="Nastavitve"><SettingsView /></ErrorBoundary>}
            {view === 'ai-hub' && <ErrorBoundary viewName="AI Hub"><AIHubView /></ErrorBoundary>}
            {view === 'decision-history' && <ErrorBoundary viewName="Zgodovina odločitev"><DecisionHistoryView /></ErrorBoundary>}
          </main>
        </div>
      )}

      {/* REORG-1: Sistem drawer je bil odstranjen — Sistem je zdaj ena od 7 kategorij v glavni vrstici. */}

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
              {/* REORG-1: 7 kategorij s sub-views (collapsible) */}
              {NAV_CATEGORIES.map((category) => {
                const CategoryIcon = category.icon;
                const isActiveCategory = activeCategory.id === category.id;
                return (
                  <div key={category.id}>
                    {/* Category header — klik vodi do primaryView */}
                    <button
                      onClick={() => { handleCategoryClick(category); setMobileNavOpen(false); }}
                      aria-label={category.label}
                      aria-current={isActiveCategory ? 'page' : undefined}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors mt-1',
                        isActiveCategory
                          ? 'bg-primary/10 text-primary border border-primary/30'
                          : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent'
                      )}
                    >
                      <CategoryIcon className="w-4 h-4" />
                      <span className="uppercase tracking-wider flex-1 text-left font-bold">{category.label}</span>
                      {category.id === 'settings' && unreadAlerts > 0 && (
                        <Badge variant="destructive" className="px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
                      )}
                    </button>
                    {/* Sub-views — prikaži samo, če je kategorija aktivna in ima >1 sub-view */}
                    {isActiveCategory && category.subViews.length > 1 && (
                      <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/50 pl-2">
                        {category.subViews.map((subView) => {
                          const Icon = subView.icon;
                          const isModalTrigger = subView.id === AI_ASSISTANT_MODAL_ID;
                          const isActiveSubView = !isModalTrigger && view === subView.id;
                          return (
                            <button
                              key={subView.id}
                              onClick={() => {
                                if (isModalTrigger) {
                                  setAiAssistantOpen(true);
                                } else {
                                  handleSubTabClick(subView.id);
                                }
                                setMobileNavOpen(false);
                              }}
                              aria-label={subView.label}
                              title={isModalTrigger ? `${subView.label} (Ctrl+J)` : navTitle(subView.label, subView.id)}
                              aria-current={isActiveSubView ? 'page' : undefined}
                              className={cn(
                                'w-full flex items-center gap-2 px-2 py-2 rounded text-xs transition-colors',
                                isActiveSubView
                                  ? 'bg-primary/5 text-primary'
                                  : isModalTrigger
                                    ? 'text-amber-400 hover:text-amber-300 hover:bg-card/50'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                              )}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              <span className="uppercase tracking-wider flex-1 text-left">{subView.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
        {/* REORG-1: Scraper Status kot samostojen sub-view */}
        {view === 'scraper-status' && <ErrorBoundary viewName="Scraper Status"><ScraperMonitorWidget /></ErrorBoundary>}
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
        {/* REORG-1: Predictive Analytics kot samostojen sub-view */}
        {view === 'predictive' && <ErrorBoundary viewName="Predictive"><PredictiveAnalyticsWidget onNavigate={setView as (v: import('@/components/dashboard/dashboard/types').DashboardView) => void} /></ErrorBoundary>}
        {view === 'notifications' && <ErrorBoundary viewName="Obvestila"><NotificationHistoryView /></ErrorBoundary>}
        {view === 'health' && <ErrorBoundary viewName="Zdravje"><HealthView /></ErrorBoundary>}
        {view === 'settings' && <ErrorBoundary viewName="Nastavitve"><SettingsView /></ErrorBoundary>}
        {view === 'ai-hub' && <ErrorBoundary viewName="AI Hub"><AIHubView /></ErrorBoundary>}
        {view === 'decision-history' && <ErrorBoundary viewName="Zgodovina odločitev"><DecisionHistoryView /></ErrorBoundary>}
      </main>
      )}

      {/* Footer — REORG-1: očiščeno, samo bistvene informacije. */}
      <footer className="border-t border-border bg-card/30 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-primary font-bold">markec-ai-firm</span>
              <span className="font-mono">{APP_VERSION}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* v9.78: Dejansko stanje iz /api/health (ne hardkodirano 85/100) */}
              <span
                className="flex items-center gap-1"
                title="Sistemsko zdravje — dejansko stanje vseh komponent iz /api/health"
              >
                {healthStatus === 'ok' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-500 font-medium">🟢 Sistem: Zdrav</span>
                  </>
                )}
                {healthStatus === 'warn' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-amber-500 font-medium">🟡 Sistem: Delno</span>
                  </>
                )}
                {healthStatus === 'error' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-red-500 font-medium">🔴 Sistem: Težave</span>
                  </>
                )}
                {healthStatus === 'loading' && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
                    <span className="text-muted-foreground font-medium">Preverjam...</span>
                  </>
                )}
              </span>
              <span className="hidden sm:inline">•</span>
              <span>⌘K za ukaze</span>
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
