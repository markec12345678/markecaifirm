'use client';

/**
 * v9.51: Pinned KPI Row — "Tukaj je stanje sistema v 3 sekundah."
 *
 * Inspiracija: Sellerboard Tiles + Linear glanceable dashboard.
 * 4 KPI kartice na vrhu Pregled tab-a, ki uporabniku v 3 sekundah
 * pokažejo najpomembnejše številke:
 *
 *   💰 Profit    → net profit (YTD) + MoM trend %      → klik: Trgovine
 *   🚨 Alerti    → neprebrani alerti + total           → klik: Alerti (Sistem drawer)
 *   🎯 Cilj      → mesečni cilj % + € do cilja         → klik: Trgovine
 *   📊 Win Rate  → % dobičkonosnih trade-ov + trend    → klik: AI (Decision Accuracy)
 *
 * Design principi:
 * - Subtilne barve (emerald/amber/red z nizko saturacijo, ne agresivne)
 * - Vsaka kartica: glavna številka (2xl/3xl) + sekundarni signal (xs)
 * - Klikljive — navigacijski control layer, ne samo dekoracija
 * - Hover efekt (border + bg)
 * - Keyboard accessible (focus ring)
 * - Loading skeleton z min-height da ne skače layout
 * - Auto-refresh vsakih 60s
 *
 * Podatki:
 * - /api/trades/dashboard → profit + MoM trend
 * - /api/trades/goal-tracker → mesečni cilj
 * - /api/stats → alerti
 * - /api/trades?status=sold → za izračun win rate (profitable / total)
 */

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Bell, Target, Trophy, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardView } from './dashboard/types';

interface PinnedKpiRowProps {
  onNavigate: (view: DashboardView) => void;
  /** Pre-fetched unread alerts (from parent DashboardView, optional — avoids duplicate fetch). */
  unreadAlerts?: number;
  totalAlerts?: number;
}

interface KpiData {
  // Profit
  totalProfit: number;
  thisMonthProfit: number;
  lastMonthProfit: number;
  momTrendPercent: number; // +15 = +15% vs last month
  // Alerts (passed from parent or fetched)
  unreadAlerts: number;
  totalAlerts: number;
  // Goal
  goalPercent: number; // 104 = 104%
  currentProfit: number; // 521
  monthlyGoal: number; // 500
  goalAchieved: boolean;
  // Win rate
  winRate: number; // 95 = 95%
  soldCount: number;
  profitableCount: number;
  // Loading state
  loading: boolean;
  error: string | null;
}

const EMPTY: KpiData = {
  totalProfit: 0,
  thisMonthProfit: 0,
  lastMonthProfit: 0,
  momTrendPercent: 0,
  unreadAlerts: 0,
  totalAlerts: 0,
  goalPercent: 0,
  currentProfit: 0,
  monthlyGoal: 0,
  goalAchieved: false,
  winRate: 0,
  soldCount: 0,
  profitableCount: 0,
  loading: true,
  error: null,
};

/** Format currency as €1,234 (no decimals for large numbers). */
function formatEuro(n: number): string {
  if (Math.abs(n) >= 1000) {
    return `€${n.toLocaleString('sl-SI', { maximumFractionDigits: 0 })}`;
  }
  return `€${n.toFixed(0)}`;
}

/** Format with sign: +€1,234 or -€234 */
function formatSignedEuro(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}€${Math.abs(n).toLocaleString('sl-SI', { maximumFractionDigits: 0 })}`;
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  secondary?: React.ReactNode;
  accent: 'profit' | 'alerts' | 'goal' | 'winrate';
  onClick: () => void;
  ariaLabel: string;
  loading?: boolean;
}

function KpiCard({ icon, label, value, secondary, accent, onClick, ariaLabel, loading }: KpiCardProps) {
  const accentColors: Record<string, { border: string; icon: string; hover: string; ring: string }> = {
    profit: {
      border: 'border-emerald-500/20',
      icon: 'text-emerald-500',
      hover: 'hover:border-emerald-500/40 hover:bg-emerald-500/5',
      ring: 'focus-visible:ring-emerald-500/40',
    },
    alerts: {
      border: 'border-amber-500/20',
      icon: 'text-amber-500',
      hover: 'hover:border-amber-500/40 hover:bg-amber-500/5',
      ring: 'focus-visible:ring-amber-500/40',
    },
    goal: {
      border: 'border-primary/20',
      icon: 'text-primary',
      hover: 'hover:border-primary/40 hover:bg-primary/5',
      ring: 'focus-visible:ring-primary/40',
    },
    winrate: {
      border: 'border-sky-500/20',
      icon: 'text-sky-500',
      hover: 'hover:border-sky-500/40 hover:bg-sky-500/5',
      ring: 'focus-visible:ring-sky-500/40',
    },
  };
  const c = accentColors[accent];

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'group relative text-left p-4 rounded-lg border bg-card/50 backdrop-blur-sm transition-all',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        c.border, c.hover, c.ring,
        'min-h-[110px] flex flex-col justify-between'
      )}
    >
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={cn('opacity-70 group-hover:opacity-100 transition-opacity', c.icon)}>
          {icon}
        </span>
      </div>

      {/* Main value */}
      {loading ? (
        <div className="h-8 w-24 bg-muted/40 rounded animate-pulse" />
      ) : (
        <div className="text-2xl sm:text-3xl font-bold font-mono leading-none mt-2">
          {value}
        </div>
      )}

      {/* Secondary signal */}
      <div className="text-[11px] text-muted-foreground mt-1.5 min-h-[16px]">
        {loading ? <span className="opacity-40">—</span> : secondary}
      </div>
    </button>
  );
}

/** Trend pill: green ↑ / red ↓ / gray — */
function TrendPill({ percent, suffix = 'vs prejšnji mesec' }: { percent: number; suffix?: string }) {
  const isPositive = percent > 0;
  const isNeutral = percent === 0;
  const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;
  const color = isNeutral ? 'text-muted-foreground' : isPositive ? 'text-emerald-500' : 'text-red-500';
  const sign = isPositive ? '↑' : isNeutral ? '→' : '↓';
  return (
    <span className={cn('inline-flex items-center gap-1', color)}>
      <Icon className="w-3 h-3" />
      <span className="font-medium">{sign}{Math.abs(percent)}%</span>
      <span className="text-muted-foreground/70 font-normal">· {suffix}</span>
    </span>
  );
}

export function PinnedKpiRow({ onNavigate, unreadAlerts: passedUnread, totalAlerts: passedTotal }: PinnedKpiRowProps) {
  const [data, setData] = useState<KpiData>(EMPTY);

  const load = useCallback(async () => {
    try {
      // Parallel fetch vseh 4 podatkovnih virov
      const [dashRes, goalRes, statsRes, soldRes] = await Promise.all([
        fetch('/api/trades/dashboard'),
        fetch('/api/trades/goal-tracker'),
        fetch('/api/stats'),
        fetch('/api/trades?status=sold&limit=100'),
      ]);

      const dash = dashRes.ok ? await dashRes.json() : null;
      const goal = goalRes.ok ? await goalRes.json() : null;
      const stats = statsRes.ok ? await statsRes.json() : null;
      const sold = soldRes.ok ? await soldRes.json() : null;

      // Izračunaj win rate iz sold trades
      const soldTrades = Array.isArray(sold) ? sold : (sold?.items ?? []);
      const profitableCount = soldTrades.filter((t: { sellPrice?: number | null; buyPrice: number; buyFees?: number | null; sellFees?: number | null }) => {
        const cost = t.buyPrice + (t.buyFees ?? 0);
        const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        return revenue - cost > 0;
      }).length;
      const winRate = soldTrades.length > 0 ? Math.round((profitableCount / soldTrades.length) * 100) : 0;

      // MoM trend (iz trades/dashboard)
      const thisMonth = dash?.thisMonthProfit ?? 0;
      const lastMonth = dash?.lastMonthProfit ?? 0;
      const momTrend = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);

      setData({
        totalProfit: dash?.totalRealizedProfit ?? 0,
        thisMonthProfit: thisMonth,
        lastMonthProfit: lastMonth,
        momTrendPercent: momTrend,
        unreadAlerts: passedUnread ?? stats?.unreadAlerts ?? 0,
        totalAlerts: passedTotal ?? stats?.totalAlerts ?? 0,
        goalPercent: goal?.goal?.goalPct ?? 0,
        currentProfit: goal?.current?.realizedProfit ?? thisMonth,
        monthlyGoal: goal?.goal?.monthlyGoal ?? 0,
        goalAchieved: goal?.goal?.achieved ?? false,
        winRate,
        soldCount: soldTrades.length,
        profitableCount,
        loading: false,
        error: null,
      });
    } catch (err) {
      setData(prev => ({ ...prev, loading: false, error: (err as Error).message }));
    }
  }, [passedUnread, passedTotal]);

  useEffect(() => {
    load();
    // Auto-refresh vsakih 60s
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Sync alerts če se parent state spremeni
  useEffect(() => {
    if (passedUnread !== undefined && data.unreadAlerts !== passedUnread && !data.loading) {
      setData(prev => ({ ...prev, unreadAlerts: passedUnread, totalAlerts: passedTotal ?? prev.totalAlerts }));
    }
  }, [passedUnread, passedTotal, data.unreadAlerts, data.loading]);

  const { loading } = data;

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      role="region"
      aria-label="Pinned KPI — ključne metrike sistema"
    >
      {/* 💰 PROFIT */}
      <KpiCard
        icon={<TrendingUp className="w-4 h-4" />}
        label="Profit"
        value={loading ? '' : formatSignedEuro(data.totalProfit)}
        accent="profit"
        onClick={() => onNavigate('trades')}
        ariaLabel={`Profit: ${formatSignedEuro(data.totalProfit)} skupaj, ${data.momTrendPercent}% glede na prejšnji mesec. Klik za podrobnosti trgovin.`}
        loading={loading}
        secondary={
          <TrendPill percent={data.momTrendPercent} suffix="vs prejšnji mesec" />
        }
      />

      {/* 🚨 ALERTI */}
      <KpiCard
        icon={<Bell className="w-4 h-4" />}
        label="Alerti"
        value={loading ? '' : `${data.unreadAlerts}`}
        accent="alerts"
        onClick={() => onNavigate('alerts')}
        ariaLabel={`Alerti: ${data.unreadAlerts} neprebranih od ${data.totalAlerts} skupaj. Klik za podrobnosti.`}
        loading={loading}
        secondary={
          <span className={cn('inline-flex items-center gap-1', data.unreadAlerts > 0 ? 'text-amber-500' : 'text-muted-foreground')}>
            {data.unreadAlerts > 0 ? <AlertCircle className="w-3 h-3" /> : <Bell className="w-3 h-3 opacity-50" />}
            <span>{data.unreadAlerts > 0 ? `${data.unreadAlerts} neprebranih` : 'vse prebrano'}</span>
            <span className="text-muted-foreground/70 font-normal">· {data.totalAlerts} skupaj</span>
          </span>
        }
      />

      {/* 🎯 CILJ */}
      <KpiCard
        icon={<Target className="w-4 h-4" />}
        label="Cilj"
        value={loading ? '' : `${data.goalPercent}%`}
        accent="goal"
        onClick={() => onNavigate('trades')}
        ariaLabel={`Mesečni cilj: ${data.goalPercent}% realizirano. ${formatEuro(data.currentProfit)} od ${formatEuro(data.monthlyGoal)}. Klik za podrobnosti.`}
        loading={loading}
        secondary={
          <span className={cn('inline-flex items-center gap-1', data.goalAchieved ? 'text-emerald-500' : 'text-muted-foreground')}>
            {data.goalAchieved ? <Trophy className="w-3 h-3" /> : <Target className="w-3 h-3" />}
            <span>{formatEuro(data.currentProfit)} / {formatEuro(data.monthlyGoal)}</span>
          </span>
        }
      />

      {/* 📊 WIN RATE */}
      <KpiCard
        icon={<Trophy className="w-4 h-4" />}
        label="Win Rate"
        value={loading ? '' : `${data.winRate}%`}
        accent="winrate"
        onClick={() => onNavigate('ai-hub')}
        ariaLabel={`Win rate: ${data.winRate}% dobičkonosnih trade-ov (${data.profitableCount} od ${data.soldCount}). Klik za AI analizo.`}
        loading={loading}
        secondary={
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Trophy className="w-3 h-3 text-sky-500" />
            <span>{data.profitableCount}/{data.soldCount} dobičkonosnih</span>
          </span>
        }
      />
    </div>
  );
}
