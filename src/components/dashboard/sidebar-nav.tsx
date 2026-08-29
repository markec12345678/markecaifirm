'use client';

/**
 * REORG-1: Sidebar Navigation — 7 kategorij s sub-views.
 *
 * Prej (v9.54): 4 primary + 3 collapsible skupine (Iskanje/AI Orodja/Analitika) + 5 sistemskih.
 * Zdaj (REORG-1): 7 kategorij s sub-views (Pregled/Monitorji/Oglasi/Skladišče/AI/Analitika/Sistem).
 *
 * Struktura:
 *   📊 Pregled      (1) — Dashboard
 *   🔍 Monitorji    (2) — Monitorji + Scraper Status
 *   📋 Oglasi        (4) — Vsi oglasi + Watchlist + Iskalnik + Oglasi AI
 *   📦 Skladišče     (3) — Trgovine + Inventar + Cene AI
 *   🤖 AI            (4) — AI Hub + Kupci + Tveganja + AI Asistent (modal)
 *   📈 Analitika    (3) — Analitika + Statistike + Predictive
 *   ⚙️ Sistem        (4) — Nastavitve + Zdravje + Alerti + Obvestila
 *
 * Lastnosti:
 * - Collapsible (širina 64px ikone / 240px full)
 * - Collapse state persisten v localStorage
 * - Aktivna kategorija avtomatsko razširjena
 * - Sub-views prikazani pod kategorijo (ko je razširjena)
 * - Badge za neprebrani alerti (na kategoriji Sistem)
 * - 'ai-assistant-modal' sub-view odpre modal (ne navigira)
 * - Hover efekt + focus ring
 * - Keyboard accessible
 */

import { useState, useEffect } from 'react';
import {
  Activity, ListPlus, LayoutGrid, TrendingUp,
  Package, DollarSign, FileText, Shield, Users,
  BarChart3, PieChart, Sparkles, RefreshCw, Zap,
  Bell, Eye, History, Heart, Settings,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navTitleWithShortcut } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useHaptic } from '@/hooks/use-haptic';

type View =
  | 'dashboard' | 'monitors' | 'scraper-status'
  | 'listings' | 'watchlist' | 'iskalnik' | 'listing-opt'
  | 'trades' | 'inventory' | 'pricing'
  | 'ai-hub' | 'decision-history' | 'buyers' | 'risk'
  | 'analytics' | 'statistics' | 'predictive'
  | 'settings' | 'alerts' | 'notifications' | 'health';

type CategoryId = 'dashboard' | 'monitors' | 'listings' | 'trades' | 'ai-hub' | 'analytics' | 'settings';

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
  subViews: SubView[];
  primaryView: View;
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'dashboard', label: 'Pregled', icon: Activity, primaryView: 'dashboard',
    subViews: [{ id: 'dashboard', label: 'Pregled', icon: Activity }],
  },
  {
    id: 'monitors', label: 'Monitorji', icon: ListPlus, primaryView: 'monitors',
    subViews: [
      { id: 'monitors', label: 'Monitorji', icon: ListPlus },
      { id: 'scraper-status', label: 'Status', icon: RefreshCw },
    ],
  },
  {
    id: 'listings', label: 'Oglasi', icon: LayoutGrid, primaryView: 'listings',
    subViews: [
      { id: 'listings', label: 'Vsi oglasi', icon: LayoutGrid },
      { id: 'watchlist', label: 'Watchlist', icon: Eye },
    ],
  },
  {
    id: 'settings', label: 'Nastavitve', icon: Settings, primaryView: 'settings',
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

interface SidebarNavProps {
  currentView: View;
  onNavigate: (view: View) => void;
  /** REORG-1: Callback za odprtje AI Assistant modala (ko klikneš 'AI Asistent' sub-view). */
  onOpenAiAssistant?: () => void;
  unreadAlerts: number;
  /** Collapse state (controlled by parent). */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function SidebarNav({
  currentView,
  onNavigate,
  onOpenAiAssistant,
  unreadAlerts,
  collapsed,
  onToggleCollapse,
}: SidebarNavProps) {
  const haptic = useHaptic();
  const activeCategory = getActiveCategory(currentView);
  const [expandedCategories, setExpandedCategories] = useState<Record<CategoryId, boolean>>({
    dashboard: false,
    monitors: false,
    listings: false,
    trades: false,
    'ai-hub': false,
    analytics: false,
    settings: false,
  });

  // Auto-expand aktivno kategorijo
  useEffect(() => {
    setExpandedCategories(prev => ({ ...prev, [activeCategory.id]: true }));
  }, [activeCategory.id]);

  const toggleCategory = (id: CategoryId) => {
    if (collapsed) {
      // V collapsed načinu — klik kategorije navigira na primaryView
      const cat = NAV_CATEGORIES.find(c => c.id === id);
      if (cat) {
        haptic.light();
        onNavigate(cat.primaryView);
      }
      return;
    }
    haptic.light();
    setExpandedCategories(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNavigate = (view: View) => {
    haptic.light();
    onNavigate(view);
  };

  const handleSubViewClick = (subViewId: SubViewId) => {
    if (subViewId === AI_ASSISTANT_MODAL_ID) {
      haptic.light();
      onOpenAiAssistant?.();
      return;
    }
    handleNavigate(subViewId);
  };

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card/30 transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
      aria-label="Stranska navigacija"
    >
      {/* Collapse toggle */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        {!collapsed && (
          <span className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider px-2">
            Navigacija
          </span>
        )}
        <button
          onClick={() => {
            haptic.light();
            onToggleCollapse();
          }}
          aria-label={collapsed ? 'Razširi sidebar' : 'Skrči sidebar'}
          className="p-1.5 rounded hover:bg-card/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Scrollable nav — 7 kategorij s sub-views */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <div className="px-2 space-y-0.5">
          {NAV_CATEGORIES.map((category) => {
            const CategoryIcon = category.icon;
            const isActiveCategory = activeCategory.id === category.id;
            const isExpanded = expandedCategories[category.id] || isActiveCategory;
            const hasMultipleSubViews = category.subViews.length > 1;
            const showBadge = category.id === 'settings' && unreadAlerts > 0;
            return (
              <div key={category.id}>
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  aria-label={category.label}
                  aria-expanded={isExpanded}
                  title={collapsed ? category.label : (hasMultipleSubViews ? `${category.label} — razširi/skrči` : category.label)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors',
                    collapsed && 'justify-center',
                    isActiveCategory
                      ? 'bg-primary/10 text-primary border-l-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border-l-2 border-transparent'
                  )}
                >
                  <CategoryIcon className="w-4 h-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="uppercase tracking-wider text-xs font-bold flex-1 text-left">
                        {category.label}
                      </span>
                      {showBadge && (
                        <Badge variant="destructive" className="px-1.5 py-0 text-xs">{unreadAlerts}</Badge>
                      )}
                      {hasMultipleSubViews && (
                        <ChevronRight className={cn('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
                      )}
                    </>
                  )}
                  {collapsed && showBadge && (
                    <Badge variant="destructive" className="absolute -top-1 -right-1 px-1.5 py-0 text-[9px]">{unreadAlerts}</Badge>
                  )}
                </button>
                {/* Sub-views — prikaži samo če je razširjeno in ima več sub-views */}
                {!collapsed && isExpanded && hasMultipleSubViews && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/50 pl-2">
                    {category.subViews.map((subView) => {
                      const Icon = subView.icon;
                      const isModalTrigger = subView.id === AI_ASSISTANT_MODAL_ID;
                      const isActiveSubView = !isModalTrigger && currentView === subView.id;
                      return (
                        <button
                          key={subView.id}
                          onClick={() => handleSubViewClick(subView.id)}
                          aria-label={subView.label}
                          title={isModalTrigger ? `${subView.label} (Ctrl+J)` : navTitleWithShortcut(subView.label, subView.id)}
                          aria-current={isActiveSubView ? 'page' : undefined}
                          className={cn(
                            'w-full flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors',
                            isActiveSubView
                              ? 'bg-primary/10 text-primary'
                              : isModalTrigger
                                ? 'text-amber-500 hover:text-amber-400 hover:bg-card/50'
                                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="uppercase tracking-wider flex-1 text-left">{subView.label}</span>
                          {isModalTrigger && (
                            <kbd className="text-[8px] bg-background/60 px-1 py-0.5 rounded border border-amber-500/30 font-mono">⌘J</kbd>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
