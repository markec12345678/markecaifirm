'use client';

// v8.67: Trade Outcome Scorecard Summary Card
// "Of 19 sales: 8 PERFECT, 7 GOOD, 3 ACCEPTABLE, 1 LOSS.
//  Average left on table: 23€ per trade. Top lesson: ..."

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trophy, RefreshCw, TrendingUp, TrendingDown, Target, Lightbulb, Award, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OutcomeSummary {
  ok: boolean;
  totalSold: number;
  perfect: number;
  good: number;
  acceptable: number;
  suboptimal: number;
  loss: number;
  avgPricingScore: number;
  avgTimingScore: number;
  avgOutcomeScore: number;
  avgOverallScore: number;
  totalLeftOnTable: number;
  totalExtraGained: number;
  avgLeftOnTable: number;
  bestOutcome: any | null;
  worstOutcome: any | null;
  topLessons: string[];
}

const verdictMeta = {
  PERFECT: { label: 'Perfektno', color: 'text-emerald-500', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  GOOD: { label: 'Dobro', color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  ACCEPTABLE: { label: 'Sprejemljivo', color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/30' },
  SUBOPTIMAL: { label: 'Suboptimalno', color: 'text-muted-foreground', bg: 'bg-muted border-border' },
  LOSS: { label: 'Izguba', color: 'text-red-500', bg: 'bg-red-500/15 border-red-500/30' },
};

export function OutcomeSummaryCard() {
  const { data, loading, error, refetch } = useFetch<OutcomeSummary>('/api/analytics/outcome-score', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4 text-primary" /> 🏆 Outcome Scorecard</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4 text-primary" /> 🏆 Outcome Scorecard</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  if (data.totalSold === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Trophy className="w-4 h-4 text-primary" /> 🏆 Outcome Scorecard</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Trophy className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Še ni prodaj za analizo.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Po prvi prodaji boš videl, kako optimalno si prodal.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const verdicts = (['PERFECT', 'GOOD', 'ACCEPTABLE', 'SUBOPTIMAL', 'LOSS'] as const).map(v => ({
    verdict: v,
    count: data[v === 'PERFECT' ? 'perfect' : v === 'GOOD' ? 'good' : v === 'ACCEPTABLE' ? 'acceptable' : v === 'SUBOPTIMAL' ? 'suboptimal' : 'loss'],
  }));

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Trophy className="w-4 h-4 text-primary" /> 🏆 Outcome Scorecard</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Top: Overall score + verdict distribution */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" /> Povprečna ocena</div>
            <div className={cn(
              'text-xl font-bold',
              data.avgOverallScore >= 75 ? 'text-emerald-500' : data.avgOverallScore >= 50 ? 'text-amber-500' : 'text-red-500'
            )}>
              {data.avgOverallScore}/100
            </div>
            <div className="text-[10px] text-muted-foreground">{data.totalSold} prodaj analiziranih</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
              {data.totalLeftOnTable > data.totalExtraGained ? <TrendingDown className="w-3 h-3 text-red-500" /> : <TrendingUp className="w-3 h-3 text-emerald-500" />}
              Pustil na mizi
            </div>
            <div className={cn(
              'text-xl font-bold font-mono',
              data.totalLeftOnTable > 0 ? 'text-red-500' : 'text-emerald-500'
            )}>
              {data.totalLeftOnTable > 0 ? `-${data.totalLeftOnTable}€` : `+${Math.abs(data.totalExtraGained)}€`}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {data.totalExtraGained > 0 && `+${data.totalExtraGained}€ nad optimalno · `}
              avg {data.avgLeftOnTable.toFixed(0)}€/trade
            </div>
          </div>
        </div>

        {/* Verdict distribution bar */}
        <div>
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Porazdelitev outcome-ov</div>
          <div className="flex h-6 rounded-md overflow-hidden border border-border">
            {verdicts.map(({ verdict, count }) => {
              const pct = data.totalSold > 0 ? (count / data.totalSold) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={verdict}
                  className={cn('flex items-center justify-center text-[9px] font-bold', verdictMeta[verdict].bg, verdictMeta[verdict].color)}
                  style={{ width: `${pct}%` }}
                  title={`${verdict}: ${count} (${pct.toFixed(0)}%)`}
                >
                  {pct > 10 && count}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5 text-[9px]">
            {verdicts.filter(v => v.count > 0).map(({ verdict, count }) => (
              <span key={verdict} className="flex items-center gap-0.5">
                <span className={cn('inline-block w-2 h-2 rounded-sm', verdictMeta[verdict].bg)} />
                <span className={verdictMeta[verdict].color}>{verdictMeta[verdict].label}</span>
                <span className="text-muted-foreground">{count}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Sub-scores */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/20 rounded p-1.5">
            <div className="text-[9px] uppercase text-muted-foreground">Cena</div>
            <div className={cn('text-sm font-bold', data.avgPricingScore >= 75 ? 'text-emerald-500' : data.avgPricingScore >= 50 ? 'text-amber-500' : 'text-red-500')}>
              {data.avgPricingScore}
            </div>
          </div>
          <div className="bg-muted/20 rounded p-1.5">
            <div className="text-[9px] uppercase text-muted-foreground">Timing</div>
            <div className={cn('text-sm font-bold', data.avgTimingScore >= 75 ? 'text-emerald-500' : data.avgTimingScore >= 50 ? 'text-amber-500' : 'text-red-500')}>
              {data.avgTimingScore}
            </div>
          </div>
          <div className="bg-muted/20 rounded p-1.5">
            <div className="text-[9px] uppercase text-muted-foreground">Rezultat</div>
            <div className={cn('text-sm font-bold', data.avgOutcomeScore >= 75 ? 'text-emerald-500' : data.avgOutcomeScore >= 50 ? 'text-amber-500' : 'text-red-500')}>
              {data.avgOutcomeScore}
            </div>
          </div>
        </div>

        {/* Best/Worst */}
        {(data.bestOutcome || data.worstOutcome) && (
          <div className="grid grid-cols-2 gap-2">
            {data.bestOutcome && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Award className="w-3 h-3 text-emerald-500" /> Najboljša</div>
                <div className="text-xs font-medium truncate" title={data.bestOutcome.title}>{data.bestOutcome.title}</div>
                <div className="text-[11px] text-emerald-600 font-mono">{data.bestOutcome.overallScore}/100 · +{data.bestOutcome.profit.toFixed(0)}€</div>
              </div>
            )}
            {data.worstOutcome && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><AlertCircle className="w-3 h-3 text-red-500" /> Najslabša</div>
                <div className="text-xs font-medium truncate" title={data.worstOutcome.title}>{data.worstOutcome.title}</div>
                <div className="text-[11px] text-red-500 font-mono">{data.worstOutcome.overallScore}/100 · {data.worstOutcome.profit >= 0 ? '+' : ''}{data.worstOutcome.profit.toFixed(0)}€</div>
              </div>
            )}
          </div>
        )}

        {/* Top lessons */}
        {data.topLessons.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Lekcije za prihodnost</div>
            <div className="space-y-1">
              {data.topLessons.slice(0, 3).map((lesson, i) => (
                <div key={i} className="text-[11px] text-foreground/80 flex items-start gap-1.5">
                  <span className="text-primary mt-0.5">→</span>
                  <span className="flex-1">{lesson}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          <span>📊 {data.totalSold} prodaj</span>
          {data.totalLeftOnTable > 0 && <span className="text-red-500">-{data.totalLeftOnTable}€ na mizi</span>}
          {data.totalExtraGained > 0 && <span className="text-emerald-500">+{data.totalExtraGained}€ nad optimalno</span>}
        </div>
      </CardContent>
    </Card>
  );
}
