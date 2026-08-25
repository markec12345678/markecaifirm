'use client';

/**
 * v9.54: Sidebar Navigation — opcijska levo stranska navigacija.
 *
 * Navdih: Linear, Vercel, Stripe (gold standard SaaS dashboard-ov).
 * Alternativa top-nav-u za power user-je, ki imajo raje vedno-vidno navigacijo.
 *
 * Aktivira se z [data-layout="sidebar"] na <html> elementu.
 * Toggle: gumb v header-ju (LayoutGrid ikona).
 *
 * Struktura (ista kot top-nav, ampak vertikalno):
 *   🎯 GLAVNO (4)
 *   📂 AI Orodja (5)
 *   📊 Analitika (3)
 *   🔍 Iskanje (1)
 *   ⚙️ Sistem (5) — na dnu
 *
 * Lastnosti:
 * - Collapsible (širina 64px ikone / 240px full)
 * - Collapse state persisten v localStorage
 * - Aktivna skupina avtomatsko razširjena
 * - Badge za neprebrani alerti
 * - Hover efekt + focus ring
 * - Keyboard accessible
 */

import { useState, useEffect } from 'react';
import {
  Activity, ListPlus, LayoutGrid, TrendingUp, Search,
  Package, DollarSign, FileText, Shield, Users,
  BarChart3, PieChart, Sparkles,
  Bell, Eye, History, Heart, Settings,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navTitleWithShortcut } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useHaptic } from '@/hooks/use-haptic';

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'watchlist' | 'analytics' | 'statistics' | 'trades' | 'health' | 'notifications' | 'settings' | 'buyers' | 'ai-hub' | 'inventory' | 'pricing' | 'listing-opt' | 'risk' | 'iskalnik';

interface NavItem {
  id: View;
  label: string;
  icon: typeof Activity;
}

interface NavGroup {
  id: string;
  title: string;
  icon: typeof Activity;
  accent: string;
  items: NavItem[];
}

const NAV_PRIMARY: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'monitors', label: 'Monitorji', icon: ListPlus },
  { id: 'listings', label: 'Oglasi', icon: LayoutGrid },
  { id: 'trades', label: 'Skladišče', icon: TrendingUp },
];

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'iskanje',
    title: 'Iskanje',
    icon: Search,
    accent: 'text-emerald-500',
    items: [{ id: 'iskalnik', label: 'Iskalnik', icon: Search }],
  },
  {
    id: 'ai-orodja',
    title: 'AI Orodja',
    icon: Sparkles,
    accent: 'text-amber-500',
    items: [
      { id: 'inventory', label: 'Skladišče AI', icon: Package },
      { id: 'pricing', label: 'Cene AI', icon: DollarSign },
      { id: 'listing-opt', label: 'Oglasi AI', icon: FileText },
      { id: 'risk', label: 'Tveganja AI', icon: Shield },
      { id: 'buyers', label: 'Kupci', icon: Users },
    ],
  },
  {
    id: 'analitika',
    title: 'Analitika',
    icon: BarChart3,
    accent: 'text-sky-500',
    items: [
      { id: 'analytics', label: 'Analitika', icon: BarChart3 },
      { id: 'statistics', label: 'Statistike', icon: PieChart },
      { id: 'ai-hub', label: 'AI Hub', icon: Sparkles },
    ],
  },
];

const NAV_SYSTEM: NavItem[] = [
  { id: 'alerts', label: 'Alerti', icon: Bell },
  { id: 'watchlist', label: 'Watchlist', icon: Eye },
  { id: 'notifications', label: 'Obvestila', icon: History },
  { id: 'health', label: 'Zdravje', icon: Heart },
  { id: 'settings', label: 'Nastavitve', icon: Settings },
];

interface SidebarNavProps {
  currentView: View;
  onNavigate: (view: View) => void;
  unreadAlerts: number;
  /** Collapse state (controlled by parent). */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function SidebarNav({ currentView, onNavigate, unreadAlerts, collapsed, onToggleCollapse }: SidebarNavProps) {
  const haptic = useHaptic();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    iskanje: false,
    'ai-orodja': false,
    analitika: false,
  });

  // Auto-expand skupino, ki vsebuje aktivni view
  useEffect(() => {
    for (const g of NAV_GROUPS) {
      if (g.items.some((i) => i.id === currentView)) {
        setExpandedGroups((prev) => ({ ...prev, [g.id]: true }));
      }
    }
  }, [currentView]);

  const toggleGroup = (id: string) => {
    if (collapsed) return; // ne razširi v collapsed načinu
    haptic.light();
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNavigate = (view: View) => {
    haptic.light();
    onNavigate(view);
  };

  const isGroupActive = (group: NavGroup) => group.items.some((i) => i.id === currentView);
  const isSystemActive = NAV_SYSTEM.some((i) => i.id === currentView);

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

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {/* 🎯 GLAVNO — 4 primarni */}
        <div className="px-2 space-y-0.5">
          {NAV_PRIMARY.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                aria-label={item.label}
                title={navTitleWithShortcut(item.label, item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors',
                  collapsed && 'justify-center',
                  active
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border-l-2 border-transparent'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="uppercase tracking-wider text-xs">{item.label}</span>}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="my-2 mx-2 border-t border-border" />

        {/* 📂 Skupine (Iskanje + AI Orodja + Analitika) */}
        <div className="px-2 space-y-1">
          {NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const isActive = isGroupActive(group);
            const isExpanded = expandedGroups[group.id] || isActive;
            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  aria-label={`${group.title} — razširi/skrči`}
                  aria-expanded={isExpanded}
                  title={collapsed ? group.title : undefined}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors',
                    collapsed && 'justify-center',
                    isActive
                      ? cn(group.accent, 'bg-card/50')
                      : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                  )}
                >
                  <GroupIcon className="w-4 h-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="uppercase tracking-wider text-[10px] font-bold flex-1 text-left">
                        {group.title}
                      </span>
                      <ChevronRight className={cn('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
                    </>
                  )}
                </button>
                {!collapsed && isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = currentView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(item.id)}
                          aria-label={item.label}
                title={navTitleWithShortcut(item.label, item.id)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'w-full flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors',
                            active
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="uppercase tracking-wider">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Spacer — Sistem na dno */}
        <div className="flex-1 min-h-4" />

        {/* Divider */}
        <div className="my-2 mx-2 border-t border-border" />

        {/* ⚙️ SISTEM — na dnu */}
        <div className="px-2 space-y-0.5">
          {!collapsed && (
            <div className="text-[10px] uppercase text-muted-foreground/60 font-bold px-2 py-1">
              ⚙️ Sistem
            </div>
          )}
          {NAV_SYSTEM.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                aria-label={item.label}
                title={navTitleWithShortcut(item.label, item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors relative',
                  collapsed && 'justify-center',
                  active
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : isSystemActive
                      ? 'text-foreground border-l-2 border-muted-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card/50 border-l-2 border-transparent'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="uppercase tracking-wider text-xs flex-1 text-left">{item.label}</span>}
                {item.id === 'alerts' && unreadAlerts > 0 && (
                  <Badge variant="destructive" className={cn('px-1.5 py-0 text-xs', collapsed && 'absolute -top-1 -right-1')}>
                    {unreadAlerts}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
