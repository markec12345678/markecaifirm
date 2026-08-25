'use client';

// v8.43: Annual Summary Dashboard Card — yearly profit/loss overview for tax + dashboard.
//
// Compact dashboard widget showing:
//   - Year selector (current year - 1 to current year)
//   - Big profit number: "973€ (2026 YTD)" z color (green/red)
//   - Tax estimate: "📊 Est. davek: 214€ (22%)"
//   - Net after tax: "💰 Čist: 759€"
//   - Quarterly mini BarChart (4 bars Q1-Q4)
//   - Best/worst month: "Najboljši mesec: Julij (320€)"
//   - Win rate + avg ROI: "95% win rate · 35% avg ROI"
//   - Top trade: "iPhone 13 128GB +85€"
//   - "📄 Prenesi PDF" → opens /api/trades/tax-report-pdf?year=YYYY
//   - "📊 Celoten pregled" → navigate to Statistics view
//
// Auto-refresh every 60s. Empty state when no sales in year.
//
// Fetches from /api/trades/annual-summary?year=YYYY.

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  FileText,
  BarChart3,
  Trophy,
  Calendar,
  Receipt,
  Wallet,
  PieChart,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Cell,
} from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Types (mirror AnnualSummary from src/lib/trades/annual-summary.ts) ----

interface QuarterlyBreakdown {
  quarter: number;
  label: string;
  tradeCount: number;
  revenue: number;
  cost: number;
  profit: number;
  avgROI: number;
  winRate: number;
}

interface MonthlyBreakdown {
  month: number;
  label: string;
  shortLabel: string;
  tradeCount: number;
  profit: number;
  cumulativeProfit: number;
}

interface AnnualSummarySummary {
  totalTrades: number;
  soldTrades: number;
  heldTrades: number;
  cancelledTrades: number;
  totalRevenue: number;
  totalCost: number;
  totalBuyCost: number;
  totalFees: number;
  grossProfit: number;
  estimatedTax: number;
  netProfitAfterTax: number;
  taxRate: number;
  avgROI: number;
  winRate: number;
  avgHoldDays: number;
  avgProfitPerTrade: number;
  bestMonth: { month: string; profit: number } | null;
  worstMonth: { month: string; profit: number } | null;
  bestCategory: { category: string; profit: number; roi: number } | null;
}

interface AnnualSummaryData {
  ok: true;
  year: number;
  summary: AnnualSummarySummary;
  quarterly: QuarterlyBreakdown[];
  monthly: MonthlyBreakdown[];
  topTrades: Array<{
    title: string;
    profit: number;
    category: string;
    source: string;
    sellDate: string;
    roi: number;
  }>;
  worstTrades: Array<{
    title: string;
    profit: number;
    category: string;
    source: string;
    sellDate: string;
    roi: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    tradeCount: number;
    profit: number;
    revenue: number;
    cost: number;
    roi: number;
    winRate: number;
  }>;
  sourceBreakdown: Array<{
    source: string;
    tradeCount: number;
    profit: number;
    revenue: number;
    cost: number;
    roi: number;
    winRate: number;
  }>;
  source: 'v8.43-annual-summary';
}

interface ViewProps {
  onNavigate?: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings') => void;
}

// --- Helpers ---------------------------------------------------------------

function fmtEUR(n: number, sign = false): string {
  const v = Math.round(n);
  if (sign && v > 0) return `+${v}€`;
  return `${v}€`;
}

function fmtEURFull(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const fixed = abs.toFixed(0);
  const intWithSep = fixed.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${intWithSep} €`;
}

function fmtTooltip(n: number): string {
  return fmtEURFull(n);
}

// --- Component -------------------------------------------------------------

export function AnnualSummaryCard({ onNavigate }: ViewProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [data, setData] = useState<AnnualSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const load = useCallback(async (y: number) => {
    try {
      const res = await fetch(`/api/trades/annual-summary?year=${y}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnnualSummaryData;
      if (!json.ok) throw new Error('Napaka v odgovoru');
      setData(json);
    } catch (e: unknown) {
      // Silent fail — non-critical widget
      console.warn('[AnnualSummaryCard] load failed:', (e as Error)?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(year);
    // v8.43: auto-refresh every 60s
    const id = setInterval(() => load(year), 60_000);
    return () => clearInterval(id);
  }, [year, load]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      // window.open triggers browser download via Content-Disposition header
      window.open(`/api/trades/tax-report-pdf?year=${year}`, '_blank');
      toast.success(`Davčno poročilo ${year} se prenaša…`, {
        description: 'PDF z 6 sekcijami (povzetek, četrtletja, meseci, top transakcije, kategorije, viri).',
      });
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri prenosu PDF');
    } finally {
      // Brief delay so user sees the success state
      setTimeout(() => setDownloadingPdf(false), 1500);
    }
  };

  // Year options: current year - 1, current year, current year + 1 (for next-year planning)
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  // --- Loading state ----------------------------------------------------
  if (loading && !data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // --- Empty state ----------------------------------------------------------
  if (!data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Letno poročilo
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                v8.43
              </Badge>
            </h3>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground text-center py-6">
            Ni podatkov za leto {year} — poskusi osvežiti.
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Empty state for year with no sales ---------------------------------
  const hasSales = data.summary.soldTrades > 0;

  if (!hasSales) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Letno poročilo
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                v8.43
              </Badge>
            </h3>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground text-center py-6">
            Ni prodaj v letu {year}.
            <br />
            <span className="text-[10px]">Dobiček bo prikazan po prvi prodaji.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Main render -----------------------------------------------------
  const profit = data.summary.grossProfit;
  const profitPositive = profit >= 0;
  const profitColor = profitPositive ? 'text-primary' : 'text-red-500';
  const tax = data.summary.estimatedTax;
  const netAfterTax = data.summary.netProfitAfterTax;
  const winRate = data.summary.winRate;
  const avgROI = data.summary.avgROI;
  const topTrade = data.topTrades[0] ?? null;
  const bestMonth = data.summary.bestMonth;
  const worstMonth = data.summary.worstMonth;

  // Chart data for quarterly bar chart
  const quarterlyChart = data.quarterly.map((q) => ({
    name: `Q${q.quarter}`,
    profit: Math.round(q.profit),
    tradeCount: q.tradeCount,
    isBest: q.profit === Math.max(...data.quarterly.map((x) => x.profit)),
  }));

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Letno poročilo
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.43
            </Badge>
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs"
              title="Izberi leto"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => load(year)}
              title="Osveži"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Big numbers: profit + tax estimate + net */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-background/30 rounded p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Dobiček ({year})
            </div>
            <div className={cn('font-mono font-bold text-xl', profitColor)}>
              {fmtEUR(profit, true)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.summary.soldTrades} prodaj
            </div>
          </div>
          <div className="bg-background/30 rounded p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
              <Receipt className="w-3 h-3" />
              Est. davek
            </div>
            <div className="font-mono font-bold text-xl text-amber-400">
              {fmtEUR(tax)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.summary.taxRate}% stopnja
            </div>
          </div>
          <div className="bg-background/30 rounded p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
              <Wallet className="w-3 h-3" />
              Čist po davku
            </div>
            <div className={cn('font-mono font-bold text-xl', profitColor)}>
              {fmtEUR(netAfterTax)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.summary.totalRevenue > 0
                ? `${Math.round((netAfterTax / data.summary.totalRevenue) * 100)}% marža`
                : '—'}
            </div>
          </div>
        </div>

        {/* Quarterly mini BarChart */}
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            Četrtletni pregled (Q1–Q4)
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart
              data={quarterlyChart}
              margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: '#737373' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#737373' }}
                tickFormatter={(v: number) => `${v}€`}
                width={36}
              />
              <RTooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #404040',
                  borderRadius: '4px',
                  fontSize: 11,
                }}
                formatter={(v: number) => [fmtTooltip(v), 'Dobiček']}
                labelFormatter={(_, payload) => {
                  if (!payload || !payload[0]) return '';
                  const p = payload[0].payload;
                  return `${p.name} · ${p.tradeCount} prodaj`;
                }}
              />
              <Bar dataKey="profit" name="profit" radius={[2, 2, 0, 0]} maxBarSize={48}>
                {quarterlyChart.map((d, i) => (
                  <Cell
                    key={`q-${i}`}
                    fill={
                      d.isBest
                        ? '#10b981'
                        : d.profit < 0
                          ? '#ef4444'
                          : '#3f3f46'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Best/worst month + win rate */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-background/30 rounded p-2 flex items-center gap-2">
            <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Najboljši mesec</div>
              {bestMonth ? (
                <div className="font-mono font-bold text-xs text-primary truncate">
                  {bestMonth.month} · {fmtEUR(bestMonth.profit, true)}
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">—</div>
              )}
            </div>
          </div>
          <div className="bg-background/30 rounded p-2 flex items-center gap-2">
            <ArrowDown className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Najslabši mesec</div>
              {worstMonth ? (
                <div className={cn('font-mono font-bold text-xs truncate', worstMonth.profit >= 0 ? 'text-muted-foreground' : 'text-red-500')}>
                  {worstMonth.month} · {fmtEUR(worstMonth.profit)}
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">—</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-background/30 rounded p-2 flex items-center gap-2">
            <PieChart className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Win rate</div>
              <div className="font-mono font-bold text-xs">{winRate}%</div>
            </div>
          </div>
          <div className="bg-background/30 rounded p-2 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Povprečni ROI</div>
              <div className={cn('font-mono font-bold text-xs', avgROI >= 0 ? 'text-primary' : 'text-red-500')}>
                {avgROI}%
              </div>
            </div>
          </div>
        </div>

        {/* Top trade */}
        {topTrade && (
          <div className="bg-primary/5 border border-primary/20 rounded p-2 mb-3 flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] uppercase text-muted-foreground">Top trade ({year})</div>
              <div className="text-xs font-medium truncate" title={topTrade.title}>
                {topTrade.title}
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] text-muted-foreground hidden sm:inline-flex">
              {topTrade.category}
            </Badge>
            <span className={cn('font-mono font-bold text-xs', topTrade.profit >= 0 ? 'text-primary' : 'text-red-500')}>
              {fmtEUR(topTrade.profit, true)}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
          >
            {downloadingPdf ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {downloadingPdf ? 'Prenašam…' : 'Prenesi PDF'}
          </Button>
          {onNavigate && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => onNavigate('analytics')}
              title="Odpri Analitiko za podrobnosti"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Celoten pregled</span>
              <span className="sm:hidden">Več</span>
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Davek: 22% poenostavljena stopnja (ZDoh-2).
            {' '}
            <span className="hidden sm:inline">
              Vir: {data.sourceBreakdown.length} {data.sourceBreakdown.length === 1 ? 'platforma' : 'platforme'} ·{' '}
              {data.categoryBreakdown.length} {data.categoryBreakdown.length === 1 ? 'kategorija' : 'kategorije'}.
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
