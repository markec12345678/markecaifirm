'use client';

/**
 * v8.45: Mobile Bottom Navigation Bar
 *
 * A fixed bottom navigation bar that shows ONLY on mobile (md:hidden).
 * Provides quick access to the 5 most important sections:
 *   1. Dashboard (Activity)
 *   2. AI Hub (Sparkles)
 *   3. Trades (TrendingUp) — badge shows held count
 *   4. Alerts (Bell) — badge shows unread count
 *   5. Settings (Settings)
 *
 * Each button is 44x44px minimum touch target (Apple HIG + Material guidelines).
 * Taps trigger light haptic feedback (if supported).
 *
 * The full NAV (17 buttons) in page.tsx is too cramped on phone screens;
 * this bottom bar + the hamburger drawer cover mobile navigation needs.
 * Desktop continues to use the top tab bar.
 */

import { useEffect, useState } from 'react';
import { Activity, Sparkles, TrendingUp, Bell, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';

/** The 5 views exposed by the bottom nav. Subset of page.tsx View union. */
export type MobileNavView = 'dashboard' | 'ai-hub' | 'trades' | 'alerts' | 'settings';

interface MobileBottomNavProps {
  /** Currently active view (full View union from page.tsx). */
  currentView: string;
  /** Navigate callback — switches the main view in page.tsx. */
  onNavigate: (v: MobileNavView) => void;
  /** Unread alerts count (from page.tsx SSE state). */
  unreadAlerts: number;
}

interface NavItem {
  id: MobileNavView;
  label: string;
  icon: typeof Activity;
}

const ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'ai-hub', label: 'AI Hub', icon: Sparkles },
  { id: 'trades', label: 'Trades', icon: TrendingUp },
  { id: 'alerts', label: 'Alerti', icon: Bell },
  { id: 'settings', label: 'Nastavitve', icon: Settings },
];

export function MobileBottomNav({ currentView, onNavigate, unreadAlerts }: MobileBottomNavProps) {
  const haptic = useHaptic();
  const [heldCount, setHeldCount] = useState(0);

  // Fetch held trades count for the Trades badge. Cached 60s.
  useEffect(() => {
    let cancelled = false;
    const loadHeld = async () => {
      try {
        const res = await fetch('/api/trades/dashboard');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.heldCount === 'number') {
          setHeldCount(data.heldCount);
        }
      } catch {
        // Silent fail — badge is non-critical.
      }
    };
    loadHeld();
    const t = setInterval(loadHeld, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const handleClick = (id: MobileNavView) => {
    haptic.light();
    onNavigate(id);
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch justify-around max-w-md mx-auto">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          const badge =
            item.id === 'alerts'
              ? unreadAlerts
              : item.id === 'trades'
                ? heldCount
                : 0;
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-h-[56px] min-w-[44px] relative transition-colors',
                active
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground active:bg-card/50'
              )}
            >
              <span className="relative">
                <Icon
                  className={cn(
                    'transition-transform',
                    active ? 'w-5 h-5 scale-110' : 'w-5 h-5'
                  )}
                  strokeWidth={active ? 2.5 : 2}
                />
                {badge > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center',
                      item.id === 'alerts'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'text-[10px] leading-none transition-opacity',
                  active ? 'font-bold opacity-100' : 'opacity-70'
                )}
              >
                {item.label}
              </span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
