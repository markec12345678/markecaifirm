'use client';

// v8.44: Smart Restock Recommendations Dashboard Card — "KAJ naj kupim
// naslednje za maksimalen profit?"
//
// Combines v8.40 Trade Insights (historical performance per category) with
// current held inventory to generate actionable "buy next" recommendations.
//
// Sections:
//   1. Top 5 "🛒 KAJ NAJ KUPIM NASLEDNJE?" — recommendation cards:
//        - Category name + action badge (🟢 RESTOCK / 🆕 NEW)
//        - Projected profit + ROI + hold days
//        - Suggested buy price range
//        - Best source (Bolha/Vinted/...)
//        - Confidence pill (HIGH/MEDIUM/LOW)
//        - Historical win rate
//   2. Category status table — all categories with action badges
//        (RESTOCK/MAINTAIN/REDUCE/AVOID) — color-coded
//   3. Inventory gaps (if any) — profitable categories with 0 held items
//   4. Overstock warnings (if any) — categories with >3 held items
//
// Fetches from: GET /api/ai/restock-smart (auto-refresh 60s)
// Empty state: "Dodaj več prodaj za priporočila."

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  Package,
  AlertTriangle,
  Sparkles,
  Store,
  Trophy,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── Types (mirror src/lib/trades/restock-recommendations.ts) ────────────────

interface CategoryRecommendation {
  category: string;
  historicalROI: number;
  historicalWinRate: number;
  avgHoldDays: number;
  totalTrades: number;
  totalProfit: number;
  heldCount: number;
  heldValue: number;
  action: 'RESTOCK' | 'MAINTAIN' | 'REDUCE' | 'AVOID' | 'NEW';
  reason: string;
  projectedProfit: number;
  projectedROI: number;
  projectedHoldDays: number;
  bestSource: string;
  bestSourceROI: number;
  suggestedBuyPriceRange: { min: number; max: number };
}

interface RestockRecommendation {
  rank: number;
  category: string;
  action: 'RESTOCK' | 'NEW';
  title: string;
  reason: string;
  suggestedBuyPriceRange: { min: number; max: number };
  projectedProfit: number;
  projectedROI: number;
  projectedHoldDays: number;
  bestSource: string;
  historicalWinRate: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface RestockResult {
  ok: true;
  recommendations: RestockRecommendation[];
  categoryStatus: CategoryRecommendation[];
  inventoryGaps: string[];
  overstockWarnings: string[];
  summary: {
    totalCategories: number;
    restockRecommended: number;
    maintainCount: number;
    reduceCount: number;
    avoidCount: number;
    newOpportunities: number;
  };
  source: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEUR(n: number, sign = false): string {
  const v = Math.round(n);
  if (sign && v > 0) return `+${v}€`;
  return `${v}€`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function fmtDays(n: number): string {
  const v = Math.round(n);
  if (v === 1) return '1 dan';
  return `${v} dni`;
}

function actionStyle(action: CategoryRecommendation['action']): {
  badge: string;
  label: string;
  icon: typeof TrendingUp;
  row: string;
} {
  switch (action) {
    case 'RESTOCK':
      return {
        badge: 'bg-primary/15 text-primary border-primary/40',
        label: '🟢 RESTOCK',
        icon: TrendingUp,
        row: 'bg-primary/5',
      };
    case 'NEW':
      return {
        badge: 'bg-primary/15 text-primary border-primary/40',
        label: '🆕 NEW',
        icon: Sparkles,
        row: 'bg-primary/5',
      };
    case 'MAINTAIN':
      return {
        badge: 'bg-blue-500/15 text-blue-500 border-blue-500/40',
        label: '🔵 MAINTAIN',
        icon: Minus,
        row: 'bg-blue-500/5',
      };
    case 'REDUCE':
      return {
        badge: 'bg-amber-400/15 text-amber-400 border-amber-400/40',
        label: '🟡 REDUCE',
        icon: TrendingDown,
        row: 'bg-amber-400/5',
      };
    case 'AVOID':
      return {
        badge: 'bg-red-500/15 text-red-500 border-red-500/40',
        label: '🔴 AVOID',
        icon: AlertCircle,
        row: 'bg-red-500/5',
      };
  }
}

function confidenceStyle(c: RestockRecommendation['confidence']): string {
  switch (c) {
    case 'HIGH':
      return 'bg-primary/15 text-primary border-primary/40';
    case 'MEDIUM':
      return 'bg-amber-400/15 text-amber-400 border-amber-400/40';
    case 'LOW':
      return 'bg-muted text-muted-foreground border-border/60';
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function RestockRecommendationsCard() {
  const [data, setData] = useState<RestockResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/restock-smart');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RestockResult;
      if (!json.ok) throw new Error('Napaka v odgovoru');
      setData(json);
    } catch (e: any) {
      // Silent fail — non-critical widget
      console.warn('[RestockRecommendationsCard] load failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // v8.44: auto-refresh every 60s
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // ─── Error / empty state ──────────────────────────────────────────
  if (!data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Kaj naj kupim naslednje?
              <Badge
                variant="outline"
                className="text-[10px] text-primary border-primary/40"
              >
                v8.44
              </Badge>
            </h3>
          </div>
          <div className="text-xs text-muted-foreground text-center py-6">
            Ni podatkov — poskusi osvežiti.
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Empty state: not enough trade history ────────────────────────
  const hasRecommendations = data.recommendations.length > 0;
  const hasCategories = data.summary.totalCategories > 0;

  if (!hasCategories) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <Header onRefresh={load} />
          <div className="text-xs text-muted-foreground text-center py-8 flex flex-col items-center gap-2">
            <ShoppingCart className="w-8 h-8 opacity-40" />
            <div>Dodaj več prodaj za priporočila.</div>
            <div className="text-[10px] text-muted-foreground/70">
              Need vsaj 1 sold trade zgornej kategorije za analizo.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        <Header onRefresh={load} />

        {/* Summary chips */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Badge
            variant="outline"
            className="text-[10px] bg-primary/5 border-primary/40 text-primary"
          >
            🟢 RESTOCK: {data.summary.restockRecommended}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] bg-blue-500/5 border-blue-500/40 text-blue-500"
          >
            🔵 MAINTAIN: {data.summary.maintainCount}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] bg-amber-400/5 border-amber-400/40 text-amber-400"
          >
            🟡 REDUCE: {data.summary.reduceCount}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] bg-red-500/5 border-red-500/40 text-red-500"
          >
            🔴 AVOID: {data.summary.avoidCount}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] bg-muted/50 text-muted-foreground"
          >
            📦 Skupaj: {data.summary.totalCategories}
          </Badge>
        </div>

        {/* Top section: KAJ NAJ KUPIM NASLEDNJE? */}
        <div className="mb-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground/80 mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-primary" />
            🛒 KAJ NAJ KUPIM NASLEDNJE?
          </h4>

          {!hasRecommendations ? (
            <div className="bg-muted/30 border border-border/50 rounded p-3 text-center">
              <div className="text-xs text-muted-foreground">
                🎯 Trenutno ni kategorij z RESTOCK priporočilom.
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                Vse profitable kategorije imajo dovolj stocka ali pa ni
                prostora za novo nalogo.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.recommendations.map((rec) => (
                <RecommendationCard key={rec.rank} rec={rec} />
              ))}
            </div>
          )}
        </div>

        {/* Inventory gaps */}
        {data.inventoryGaps.length > 0 && (
          <div className="mb-3 bg-primary/5 border border-primary/30 rounded p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Inventory gaps — profitable kategorije z 0 held
            </div>
            <div className="text-[11px] text-foreground">
              {data.inventoryGaps.map((c, i) => (
                <span key={c}>
                  {i > 0 && <span className="text-muted-foreground mx-1">·</span>}
                  <span className="font-medium">{c}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Overstock warnings */}
        {data.overstockWarnings.length > 0 && (
          <div className="mb-3 bg-amber-400/5 border border-amber-400/30 rounded p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Overstock — preveč held items (aging risk)
            </div>
            <div className="text-[11px] text-foreground">
              {data.overstockWarnings.map((c, i) => (
                <span key={c}>
                  {i > 0 && <span className="text-muted-foreground mx-1">·</span>}
                  <span className="font-medium">{c}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Category status table */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground/80 mb-2 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-muted-foreground" />
            Status kategorij
          </h4>
          <div className="border border-border/50 rounded overflow-hidden">
            <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.7fr_0.7fr_1.1fr] gap-2 px-2 py-1.5 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <div>Kategorija</div>
              <div className="text-right">Akcija</div>
              <div className="text-right">Held</div>
              <div className="text-right">ROI</div>
              <div className="text-right">Win%</div>
              <div className="text-right">Vir (best)</div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {data.categoryStatus.map((c) => {
                const st = actionStyle(c.action);
                const Icon = st.icon;
                return (
                  <div
                    key={c.category}
                    className={cn(
                      'grid grid-cols-[1.6fr_0.8fr_0.8fr_0.7fr_0.7fr_1.1fr] gap-2 px-2 py-1.5 border-t border-border/30 text-xs items-center',
                      st.row,
                    )}
                  >
                    <div className="truncate font-medium" title={c.category}>
                      {c.category}
                    </div>
                    <div className="flex justify-end">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider',
                          st.badge,
                        )}
                      >
                        <Icon className="w-2.5 h-2.5" />
                        {c.action}
                      </span>
                    </div>
                    <div className="text-right font-mono text-foreground">
                      {c.heldCount}
                      <span className="text-[9px] text-muted-foreground ml-1">
                        ({fmtEUR(c.heldValue)})
                      </span>
                    </div>
                    <div
                      className={cn(
                        'text-right font-mono',
                        c.historicalROI > 0
                          ? 'text-primary'
                          : c.historicalROI < 0
                            ? 'text-red-500'
                            : 'text-muted-foreground',
                      )}
                    >
                      {fmtPct(c.historicalROI)}
                    </div>
                    <div className="text-right font-mono text-foreground">
                      {fmtPct(c.historicalWinRate)}
                    </div>
                    <div className="text-right text-[10px] text-muted-foreground truncate" title={c.bestSource}>
                      {c.bestSource} ({fmtPct(c.bestSourceROI)})
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          🛒 v8.44 Smart Restock Recommendations — kombinira v8.40 Trade Insights
          z current inventory za "buy next" priporočila. Auto-refresh vsakih 60s.
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Header({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
        <ShoppingCart className="w-4 h-4" />
        Kaj naj kupim naslednje?
        <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
          v8.44
        </Badge>
      </h3>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          onRefresh();
          toast.success('🛒 Restock priporočila osvežena');
        }}
      >
        <RefreshCw className="w-3 h-3 mr-1" />
        Osveži
      </Button>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: RestockRecommendation }) {
  const actionBadge =
    rec.action === 'RESTOCK'
      ? 'bg-primary/15 text-primary border-primary/40'
      : 'bg-primary/15 text-primary border-primary/40';

  return (
    <div className="border border-primary/30 bg-primary/5 rounded p-2.5 flex flex-col gap-1.5">
      {/* Header: rank + category + action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
            {rec.rank}
          </span>
          <span className="font-bold text-xs truncate" title={rec.category}>
            {rec.category}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider',
            actionBadge,
          )}
        >
          {rec.action === 'RESTOCK' ? '🟢 RESTOCK' : '🆕 NEW'}
        </span>
      </div>

      {/* Projected metrics */}
      <div className="grid grid-cols-3 gap-1.5 text-[10px]">
        <div className="bg-background/60 rounded p-1.5 text-center">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            Profit
          </div>
          <div className="font-mono font-bold text-primary text-xs">
            {fmtEUR(rec.projectedProfit, true)}
          </div>
        </div>
        <div className="bg-background/60 rounded p-1.5 text-center">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            ROI
          </div>
          <div className="font-mono font-bold text-xs">{fmtPct(rec.projectedROI)}</div>
        </div>
        <div className="bg-background/60 rounded p-1.5 text-center">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
            Hold
          </div>
          <div className="font-mono font-bold text-xs">{fmtDays(rec.projectedHoldDays)}</div>
        </div>
      </div>

      {/* Buy price range + best source */}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-1 text-muted-foreground min-w-0">
          <span className="text-[9px] uppercase tracking-wider">Nakup:</span>
          <span className="font-mono font-medium text-foreground">
            {fmtEUR(rec.suggestedBuyPriceRange.min)}–{fmtEUR(rec.suggestedBuyPriceRange.max)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Store className="w-3 h-3" />
          <span className="font-medium text-foreground truncate" title={rec.bestSource}>
            {rec.bestSource}
          </span>
        </div>
      </div>

      {/* Win rate + confidence */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <div className="flex items-center gap-1 text-[10px]">
          <Trophy className="w-3 h-3 text-primary" />
          <span className="text-muted-foreground">Win:</span>
          <span className="font-mono font-bold text-foreground">
            {fmtPct(rec.historicalWinRate)}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider',
            confidenceStyle(rec.confidence),
          )}
        >
          {rec.confidence}
        </span>
      </div>

      {/* Reason */}
      <div className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border/40">
        {rec.reason}
      </div>
    </div>
  );
}
