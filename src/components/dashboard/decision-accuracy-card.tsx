'use client';

// v8.70: Decision Accuracy Card — meta-analysis that validates the intelligence suite.
// "Does my buy scoring actually work? Is high buy score predictive of good outcome?"

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, RefreshCw, TrendingUp, Target, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuyScoreBucket {
  range: string;
  count: number;
  avgOutcomeScore: number;
  avgProfit: number;
  winRate: number;
  verdict: string;
}

interface DecisionAccuracyData {
  ok: boolean;
  buyScoreAccuracy: {
    totalTradesWithBothScores: number;
    correlation: number;
    correlationLabel: string;
    accuracyPercent: number;
    buckets: BuyScoreBucket[];
    highScoreAvgOutcome: number;
    lowScoreAvgOutcome: number;
    verdict: string;
  };
  smartPriceAccuracy: {
    totalSoldWithBuyPrice: number;
    avgDeviationPercent: number;
    withinRange: number;
    tooHigh: number;
    tooLow: number;
    verdict: string;
  };
  overallHealth: {
    score: number;
    grade: string;
    insights: string[];
  };
}

const gradeColor = {
  A: 'text-emerald-500 bg-emerald-500/15 border-emerald-500/40',
  B: 'text-primary bg-primary/10 border-primary/30',
  C: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  D: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
  F: 'text-red-500 bg-red-500/15 border-red-500/40',
};

const corrColor = {
  STRONG: 'text-emerald-500',
  MODERATE: 'text-primary',
  WEAK: 'text-amber-500',
  NONE: 'text-muted-foreground',
  INVERTED: 'text-red-500',
};

export function DecisionAccuracyCard() {
  const { data, loading, error, refetch } = useFetch<DecisionAccuracyData>('/api/analytics/decision-accuracy', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> 🧠 Decision Accuracy</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> 🧠 Decision Accuracy</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  const { buyScoreAccuracy, smartPriceAccuracy, overallHealth } = data;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> 🧠 Decision Accuracy</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall Health Score */}
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-16 h-16 rounded-lg border flex flex-col items-center justify-center shrink-0',
            gradeColor[overallHealth.grade as keyof typeof gradeColor] || gradeColor.F
          )}>
            <span className="text-2xl font-bold leading-none">{overallHealth.grade}</span>
            <span className="text-[9px] uppercase opacity-80 mt-0.5">{overallHealth.score}/100</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase text-muted-foreground">Intelligence Health</div>
            <div className="text-sm font-medium truncate">
              {overallHealth.grade === 'A' && 'Odlična kalibracija'}
              {overallHealth.grade === 'B' && 'Dobra kalibracija'}
              {overallHealth.grade === 'C' && 'Zmerna kalibracija'}
              {overallHealth.grade === 'D' && 'Šibka kalibracija'}
              {overallHealth.grade === 'F' && 'Potrebna kalibracija'}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {buyScoreAccuracy.totalTradesWithBothScores} prodaj z buy score · {smartPriceAccuracy.totalSoldWithBuyPrice} za smart price
            </div>
          </div>
        </div>

        {/* Buy Score Accuracy */}
        <div className="bg-muted/20 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" /> Buy Score Accuracy</span>
            <span className={cn('text-xs font-bold', corrColor[buyScoreAccuracy.correlationLabel as keyof typeof corrColor] || 'text-muted-foreground')}>
              {buyScoreAccuracy.accuracyPercent}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-muted-foreground">Korelacija: </span>
              <span className={corrColor[buyScoreAccuracy.correlationLabel as keyof typeof corrColor] || 'text-muted-foreground'}>
                {buyScoreAccuracy.correlation > 0 ? '+' : ''}{buyScoreAccuracy.correlation} ({buyScoreAccuracy.correlationLabel})
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Visok vs nizek: </span>
              <span className="text-foreground">
                {buyScoreAccuracy.highScoreAvgOutcome} vs {buyScoreAccuracy.lowScoreAvgOutcome}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-foreground/80 italic line-clamp-2" title={buyScoreAccuracy.verdict}>
            {buyScoreAccuracy.verdict}
          </p>
          {/* Buckets mini-bar */}
          {buyScoreAccuracy.buckets.length > 0 && (
            <div className="space-y-0.5">
              {buyScoreAccuracy.buckets.map(b => (
                <div key={b.range} className="flex items-center gap-1.5 text-[9px]">
                  <span className="text-muted-foreground w-12 shrink-0">{b.range}</span>
                  <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-sm transition-all',
                        b.verdict === 'EXCELLENT' ? 'bg-emerald-500' :
                        b.verdict === 'GOOD' ? 'bg-primary' :
                        b.verdict === 'POOR' ? 'bg-amber-500' : 'bg-red-500'
                      )}
                      style={{ width: `${b.avgOutcomeScore}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-8 shrink-0 text-right">{b.count}x</span>
                  <span className="w-6 shrink-0 text-right font-mono">{b.avgOutcomeScore}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Smart Price Accuracy */}
        <div className="bg-muted/20 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Smart Price Accuracy</span>
            <span className={cn(
              'text-xs font-bold',
              smartPriceAccuracy.withinRange >= 60 ? 'text-emerald-500' :
              smartPriceAccuracy.withinRange >= 40 ? 'text-amber-500' : 'text-red-500'
            )}>
              {smartPriceAccuracy.withinRange}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
            <div>
              <div className="text-muted-foreground">V obsegu</div>
              <div className="font-mono font-bold text-emerald-500">{smartPriceAccuracy.withinRange}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Nad max</div>
              <div className="font-mono font-bold text-primary">{smartPriceAccuracy.tooHigh}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Pod min</div>
              <div className="font-mono font-bold text-red-500">{smartPriceAccuracy.tooLow}%</div>
            </div>
          </div>
          <p className="text-[10px] text-foreground/80 italic line-clamp-2" title={smartPriceAccuracy.verdict}>
            {smartPriceAccuracy.verdict}
          </p>
        </div>

        {/* Insights */}
        {overallHealth.insights.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Vpogledi</div>
            <div className="space-y-1">
              {overallHealth.insights.map((insight, i) => {
                const isWarning = insight.includes('⚠️');
                const isGood = insight.includes('✓');
                return (
                  <div key={i} className="text-[10px] flex items-start gap-1">
                    {isWarning ? <AlertTriangle className="w-2.5 h-2.5 text-amber-500 mt-0.5 shrink-0" /> :
                     isGood ? <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 mt-0.5 shrink-0" /> :
                     <span className="text-primary mt-0.5">→</span>}
                    <span className="flex-1 text-foreground/80">{insight}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
