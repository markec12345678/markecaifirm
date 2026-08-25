'use client';

// v8.63: Tag Performance Card
// "Which tags make me the most money?"
// Shows per-tag stats: count, profit, ROI, win rate, verdict.
// Highlights suggested focus (STAR/SOLID) and suggested avoid (UNDERPERFORMER).

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tag, RefreshCw, TrendingUp, TrendingDown, Star, ThumbsUp, ThumbsDown, Trophy, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagStats {
  tag: string;
  totalCount: number;
  heldCount: number;
  soldCount: number;
  cancelledCount: number;
  totalInvested: number;
  totalRevenue: number;
  totalProfit: number;
  avgProfitPerTrade: number;
  avgROI: number;
  winRate: number;
  avgHoldDays: number;
  bestTrade: { title: string; profit: number } | null;
  worstTrade: { title: string; profit: number } | null;
  verdict: 'STAR' | 'SOLID' | 'MIXED' | 'UNDERPERFORMER' | 'INSUFFICIENT_DATA';
}
interface TagPerfData {
  ok: boolean;
  totalTags: number;
  totalTradesWithTags: number;
  tags: TagStats[];
  bestProfitTag: { tag: string; profit: number } | null;
  bestROITag: { tag: string; roi: number } | null;
  mostUsedTag: { tag: string; count: number } | null;
  suggestedFocus: string[];
  suggestedAvoid: string[];
}

const verdictMeta: Record<TagStats['verdict'], { label: string; cls: string; icon: React.ReactNode }> = {
  STAR: { label: 'ZVEZDA', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30', icon: <Star className="w-3 h-3" /> },
  SOLID: { label: 'TRDEN', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', icon: <ThumbsUp className="w-3 h-3" /> },
  MIXED: { label: 'MEŠANO', cls: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30', icon: <TrendingUp className="w-3 h-3" /> },
  UNDERPERFORMER: { label: 'ŠIBAK', cls: 'bg-red-500/15 text-red-500 border-red-500/30', icon: <ThumbsDown className="w-3 h-3" /> },
  INSUFFICIENT_DATA: { label: 'PREMALO', cls: 'bg-muted text-muted-foreground border-border', icon: <RefreshCw className="w-3 h-3" /> },
};

export function TagPerformanceCard() {
  const { data, loading, error, refetch } = useFetch<TagPerfData>('/api/analytics/tag-performance', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> 🏷️ Performance tagov</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> 🏷️ Performance tagov</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  // Empty state: no tags yet
  if (data.totalTags === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> 🏷️ Performance tagov</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Tag className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground mb-1">Še ni tagov.</p>
            <p className="text-xs text-muted-foreground/70">Odpri trade → dodaj tagove (npr. <span className="font-mono">flip</span>, <span className="font-mono">premium</span>, <span className="font-mono">restock</span>) za fleksibilno analitiko.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const topTags = data.tags.slice(0, 8);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> 🏷️ Performance tagov</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Highlights */}
        <div className="grid grid-cols-2 gap-2">
          {data.bestProfitTag && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
              <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Trophy className="w-3 h-3" /> Najprofitabilnejši</div>
              <a href={`/?view=trades&tag=${encodeURIComponent(data.bestProfitTag.tag)}`} className="font-bold text-sm hover:text-emerald-600 transition-colors" title="Prikaži v Skladišču">#{data.bestProfitTag.tag}</a>
              <div className="text-[11px] text-emerald-600 font-mono">+{data.bestProfitTag.profit.toFixed(0)}€</div>
            </div>
          )}
          {data.bestROITag && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
              <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Percent className="w-3 h-3" /> Najvišji ROI</div>
              <a href={`/?view=trades&tag=${encodeURIComponent(data.bestROITag.tag)}`} className="font-bold text-sm hover:text-amber-600 transition-colors" title="Prikaži v Skladišču">#{data.bestROITag.tag}</a>
              <div className="text-[11px] text-amber-600 font-mono">+{data.bestROITag.roi.toFixed(0)}%</div>
            </div>
          )}
        </div>

        {/* Suggestions */}
        {(data.suggestedFocus.length > 0 || data.suggestedAvoid.length > 0) && (
          <div className="space-y-1.5">
            {data.suggestedFocus.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <span className="text-muted-foreground">Nadaljuj z nakupom: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {data.suggestedFocus.map(t => (
                      <a key={t} href={`/?view=trades&tag=${encodeURIComponent(t)}`} className="hover:scale-105 transition-transform"><Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">#{t}</Badge></a>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {data.suggestedAvoid.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <TrendingDown className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <span className="text-muted-foreground">Izogibaj se: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {data.suggestedAvoid.map(t => (
                      <a key={t} href={`/?view=trades&tag=${encodeURIComponent(t)}`} className="hover:scale-105 transition-transform"><Badge className="bg-red-500/15 text-red-500 border-red-500/30">#{t}</Badge></a>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tag table — v8.64: rows are clickable links to Skladišče with tag filter */}
        <div className="space-y-1">
          {topTags.map(t => {
            const meta = verdictMeta[t.verdict];
            return (
              <a
                key={t.tag}
                href={`/?view=trades&tag=${encodeURIComponent(t.tag)}`}
                className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 text-xs rounded px-1 -mx-1 hover:bg-accent/50 transition-colors group"
                title={`Prikaži ${t.totalCount} trade-ov s tagom #${t.tag} v Skladišču`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono text-muted-foreground group-hover:text-primary">#</span>
                  <span className="font-medium truncate group-hover:text-primary">{t.tag}</span>
                  <span className="text-[10px] text-muted-foreground">({t.totalCount})</span>
                </div>
                <div className="flex items-center gap-2.5 text-muted-foreground shrink-0">
                  <span className={cn('font-mono', t.totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                    {t.totalProfit >= 0 ? '+' : ''}{t.totalProfit.toFixed(0)}€
                  </span>
                  <span className="font-mono">{t.avgROI >= 0 ? '+' : ''}{t.avgROI.toFixed(0)}%</span>
                  <span className="text-[10px]">{t.winRate.toFixed(0)}% win</span>
                  <Badge variant="outline" className={cn('text-[9px] gap-0.5 px-1', meta.cls)}>
                    {meta.icon} {meta.label}
                  </Badge>
                </div>
              </a>
            );
          })}
        </div>

        {/* Footer summary */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
          <span>🏷️ {data.totalTags} tagov</span>
          <span>📦 {data.totalTradesWithTags} označenih</span>
          {data.mostUsedTag && <span>🔥 Največ: #{data.mostUsedTag.tag} ({data.mostUsedTag.count})</span>}
        </div>
      </CardContent>
    </Card>
  );
}
