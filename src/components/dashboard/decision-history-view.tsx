'use client';

// v9.81: DecisionHistoryView — zgodovina AI odločitev z realnimi izidi.
//
// Prikazuje:
//   - KPI: Decision Accuracy, Financial Impact, avg time to outcome, avg confidence
//   - Breakdown by suggestion type
//   - Tabela zadnjih 50 zabeleženih izidov (AI napoved vs realnost)
//
// Backend: GET /api/ai/copilot/accuracy
// Vsak izid:
//   - tip (buy/sell/stop-monitor/restock/arbitrage)
//   - AI napoved (expectedProfit, expectedRoi)
//   - Realnost (actualProfit, actualRoi, actualBuyPrice, actualSellPrice, actualCosts)
//   - wasCorrect (true/false/null — null = "ne preverjeno")
//   - reason / feedback

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, Check, X, Circle, TrendingUp, TrendingDown, Clock,
  Sparkles, AlertCircle, ChevronDown, ChevronRight, Target, Wallet, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';

interface OutcomeRow {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: string;
  expectedOutcome: string;
  wasCorrect: boolean | null;
  outcome: 'profit' | 'loss' | 'neutral' | null;
  outcomeType: string | null; // sold | not_bought | not_executed | wrong_prediction
  actualProfit: number | null;
  actualRoi: number | null;
  actualBuyPrice: number | null;
  actualSellPrice: number | null;
  actualCosts: number | null;
  referencePoint: string | null;
  expectedProfit: number | null;
  expectedRoi: number | null;
  confidenceAtSuggestion: number | null;
  timeToOutcomeDays: number | null;
  wasCorrectRule: string | null;
  reason: string | null;
  feedback: string | null;
  executedAt: string | null;
  outcomeRecordedAt: string | null;
  createdAt: string;
}

interface AccuracyData {
  ok: true;
  totalOutcomes: number;
  correct: number;
  incorrect: number;
  decisionAccuracy: number | null;
  financialImpact: number;
  avgTimeToOutcomeDays: number | null;
  avgConfidenceAtSuggestion: number | null;
  byType: Record<string, { total: number; correct: number; incorrect: number; avgProfit: number; avgRoi: number }>;
  rulesUsed: Record<string, number>;
  recentOutcomes: OutcomeRow[];
  hasEnoughData: boolean;
}

const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  'buy': { label: 'Nakup', icon: '🛒' },
  'sell': { label: 'Prodaja', icon: '💰' },
  'stop-monitor': { label: 'Ustavi monitor', icon: '⏸️' },
  'restock': { label: 'Kupi več', icon: '🔄' },
  'arbitrage': { label: 'Arbitraža', icon: '🔀' },
  'investigate': { label: 'Preiskava', icon: '🔍' },
};

const OUTCOME_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  'sold': { label: 'Uspešno prodano', color: 'text-emerald-500' },
  'not_bought': { label: 'Nisem kupil', color: 'text-muted-foreground' },
  'not_executed': { label: 'Nisem izvedel', color: 'text-muted-foreground' },
  'wrong_prediction': { label: 'Napačna napoved', color: 'text-amber-500' },
};

export function DecisionHistoryView() {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'correct' | 'incorrect' | 'unverified'>('all');
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/copilot/accuracy');
      if (!res.ok) throw new Error('napaka');
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      toast.error('Ne morem naložiti zgodovine');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam zgodovino...</span>
      </div>
    );
  }

  if (!data || data.totalOutcomes === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="w-6 h-6 text-primary" />
          Zgodovina odločitev
        </h2>
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-1">Še ni zabeleženih izidov</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Ko na Dashboardu zabeležiš prve izide (Uspešno prodano / Napačna napoved / Nisem kupil),
              se bodo tukaj prikazali s primerjavo AI napovedi in realnosti.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filtriraj izide glede na izbrani filter
  const filteredOutcomes = data.recentOutcomes.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'correct') return o.wasCorrect === true;
    if (filter === 'incorrect') return o.wasCorrect === false;
    if (filter === 'unverified') return o.wasCorrect === null;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="w-6 h-6 text-primary" />
            Zgodovina odločitev
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Realni izidi vsakega Copilot predloga — AI napoved vs realnost
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { haptic.light(); load(); }} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Osveži
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Decision Accuracy */}
        <Card className={cn(
          'border-2',
          data.decisionAccuracy !== null && data.decisionAccuracy >= 70
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-amber-500/40 bg-amber-500/5'
        )}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-[10px] uppercase text-muted-foreground font-bold">Decision Accuracy</span>
            </div>
            <div className={cn(
              'text-2xl font-bold',
              data.decisionAccuracy !== null && data.decisionAccuracy >= 70 ? 'text-emerald-500' : 'text-amber-500'
            )}>
              {data.decisionAccuracy !== null ? `${data.decisionAccuracy}%` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {data.correct}/{data.totalOutcomes} pravilnih
            </div>
          </CardContent>
        </Card>

        {/* Financial Impact */}
        <Card className="border-2 border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-[10px] uppercase text-muted-foreground font-bold">Financial Impact</span>
            </div>
            <div className={cn(
              'text-2xl font-bold',
              data.financialImpact >= 0 ? 'text-emerald-500' : 'text-red-500'
            )}>
              {data.financialImpact >= 0 ? '+' : ''}{data.financialImpact}€
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              vsota realnih dobičkov
            </div>
          </CardContent>
        </Card>

        {/* Avg Time to Outcome */}
        <Card className="border-2 border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-[10px] uppercase text-muted-foreground font-bold">Čas do izida</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {data.avgTimeToOutcomeDays !== null ? `${data.avgTimeToOutcomeDays}d` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              povprečno dni
            </div>
          </CardContent>
        </Card>

        {/* Avg Confidence */}
        <Card className="border-2 border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-[10px] uppercase text-muted-foreground font-bold">AI Confidence</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {data.avgConfidenceAtSuggestion !== null ? `${data.avgConfidenceAtSuggestion}%` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              povprečno ob predlogu
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown by type */}
      {Object.keys(data.byType).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Po tipu predloga
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(data.byType).map(([type, stats]) => {
                const label = TYPE_LABELS[type]?.label ?? type;
                const icon = TYPE_LABELS[type]?.icon ?? '❓';
                const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
                return (
                  <div key={type} className="border border-border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        <span className="text-base">{icon}</span>
                        {label}
                      </span>
                      <Badge variant="outline" className="text-[9px]">{stats.total}×</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[9px] uppercase text-muted-foreground">Natančnost</div>
                        <div className={cn(
                          'font-bold',
                          accuracy >= 70 ? 'text-emerald-500' : accuracy >= 50 ? 'text-amber-500' : 'text-red-500'
                        )}>
                          {accuracy}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase text-muted-foreground">Ø Dobiček</div>
                        <div className={cn(
                          'font-bold',
                          stats.avgProfit >= 0 ? 'text-emerald-500' : 'text-red-500'
                        )}>
                          {stats.avgProfit >= 0 ? '+' : ''}{stats.avgProfit}€
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filter:</span>
        {([
          { id: 'all', label: `Vsi (${data.totalOutcomes})` },
          { id: 'correct', label: `✓ Pravilni (${data.correct})` },
          { id: 'incorrect', label: `✗ Napačni (${data.incorrect})` },
          { id: 'unverified', label: `○ Nepreverjeni (${data.totalOutcomes - data.correct - data.incorrect})` },
        ] as const).map((opt) => (
          <button
            key={opt.id}
            onClick={() => { haptic.light(); setFilter(opt.id); }}
            className={cn(
              'px-2 py-1 text-[11px] rounded border transition-colors',
              filter === opt.id
                ? 'bg-primary/10 border-primary text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Outcomes list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            Zadnje ocenjene odločitve
            <Badge variant="outline" className="text-[10px] ml-auto">{filteredOutcomes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredOutcomes.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Ni izidov za ta filter.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto space-y-2">
              {filteredOutcomes.map((o) => {
                const isExpanded = expanded === o.id;
                const typeLabel = TYPE_LABELS[o.type] ?? { label: o.type, icon: '❓' };
                const outcomeLabel = o.outcomeType ? OUTCOME_TYPE_LABELS[o.outcomeType] : null;
                const isCorrect = o.wasCorrect === true;
                const isIncorrect = o.wasCorrect === false;
                const isUnverified = o.wasCorrect === null;
                const ageDays = o.outcomeRecordedAt
                  ? Math.floor((Date.now() - new Date(o.outcomeRecordedAt).getTime()) / (1000 * 60 * 60 * 24))
                  : null;

                return (
                  <div
                    key={o.id}
                    className={cn(
                      'border rounded-md p-3 text-xs',
                      isCorrect && 'border-emerald-500/30 bg-emerald-500/5',
                      isIncorrect && 'border-red-500/30 bg-red-500/5',
                      isUnverified && 'border-border bg-muted/20'
                    )}
                  >
                    {/* Header row */}
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-base">{typeLabel.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-foreground line-clamp-1">{o.title}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                          {typeLabel.label}
                          {ageDays !== null && (
                            <> · {ageDays === 0 ? 'danes' : ageDays === 1 ? 'včeraj' : `pred ${ageDays} dni`}</>
                          )}
                          {outcomeLabel && <> · {outcomeLabel.label}</>}
                        </div>
                      </div>
                      {/* wasCorrect badge */}
                      {isCorrect && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[9px] gap-0.5">
                          <Check className="w-2.5 h-2.5" /> PRAVILNO
                        </Badge>
                      )}
                      {isIncorrect && (
                        <Badge className="bg-red-500/10 text-red-500 border-red-500/30 text-[9px] gap-0.5">
                          <X className="w-2.5 h-2.5" /> NAPAČNO
                        </Badge>
                      )}
                      {isUnverified && (
                        <Badge className="bg-muted text-muted-foreground border-border text-[9px] gap-0.5">
                          <Circle className="w-2.5 h-2.5" /> NEPREVERJENO
                        </Badge>
                      )}
                    </div>

                    {/* AI napoved vs realnost — 2-column grid */}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {/* AI napoved */}
                      <div className="border border-primary/20 bg-primary/5 rounded p-2">
                        <div className="text-[9px] uppercase text-primary font-bold mb-1">AI napoved</div>
                        {o.expectedProfit != null && o.expectedProfit > 0 ? (
                          <div className="text-sm font-bold text-primary">+{o.expectedProfit}€</div>
                        ) : (
                          <div className="text-sm text-muted-foreground italic">brez številke</div>
                        )}
                        {o.expectedRoi != null && o.expectedRoi > 0 && (
                          <div className="text-[9px] text-muted-foreground">{o.expectedRoi}% donosnost</div>
                        )}
                        {o.confidenceAtSuggestion != null && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">confidence: {o.confidenceAtSuggestion}%</div>
                        )}
                      </div>

                      {/* Realnost */}
                      <div className={cn(
                        'border rounded p-2',
                        o.actualProfit != null && o.actualProfit >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
                      )}>
                        <div className="text-[9px] uppercase text-muted-foreground font-bold mb-1">Realnost</div>
                        {o.actualProfit != null ? (
                          <>
                            <div className={cn(
                              'text-sm font-bold',
                              o.actualProfit >= 0 ? 'text-emerald-500' : 'text-red-500'
                            )}>
                              {o.actualProfit >= 0 ? '+' : ''}{o.actualProfit.toFixed(2)}€
                            </div>
                            {o.actualRoi != null && (
                              <div className="text-[9px] text-muted-foreground">
                                {o.actualRoi >= 0 ? '+' : ''}{o.actualRoi.toFixed(1)}% ROI
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground italic">ni podatek</div>
                        )}
                      </div>
                    </div>

                    {/* Expand button */}
                    <button
                      onClick={() => { haptic.light(); setExpanded(isExpanded ? null : o.id); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {isExpanded ? 'Skrij podrobnosti' : 'Prikaži podrobnosti'}
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-2 p-2 rounded bg-background/50 space-y-1.5 text-[10px]">
                        {o.reason && (
                          <div>
                            <span className="text-muted-foreground font-bold uppercase">Zakaj: </span>
                            <span className="text-foreground/80">{o.reason}</span>
                          </div>
                        )}
                        {o.actualBuyPrice != null && o.actualSellPrice != null && (
                          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
                            <div>
                              <div className="text-muted-foreground uppercase">Kupna</div>
                              <div className="font-mono">{o.actualBuyPrice}€</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground uppercase">Prodajna</div>
                              <div className="font-mono">{o.actualSellPrice}€</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground uppercase">Stroški</div>
                              <div className="font-mono">{o.actualCosts ?? 0}€</div>
                            </div>
                          </div>
                        )}
                        {o.referencePoint && (
                          <div>
                            <span className="text-muted-foreground font-bold uppercase">Referenca: </span>
                            <span className="text-foreground/80">{o.referencePoint}</span>
                          </div>
                        )}
                        {o.feedback && (
                          <div>
                            <span className="text-muted-foreground font-bold uppercase">Opomba: </span>
                            <span className="text-foreground/80 italic">{o.feedback}</span>
                          </div>
                        )}
                        {o.timeToOutcomeDays != null && (
                          <div>
                            <span className="text-muted-foreground font-bold uppercase">Čas do izida: </span>
                            <span className="text-foreground/80">{o.timeToOutcomeDays} dni</span>
                          </div>
                        )}
                        {o.wasCorrectRule && (
                          <div>
                            <span className="text-muted-foreground font-bold uppercase">Pravilo: </span>
                            <code className="text-foreground/80 text-[9px]">{o.wasCorrectRule}</code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer — has enough data warning */}
      {!data.hasEnoughData && (
        <div className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <AlertCircle className="w-3 h-3" />
          Early data — priporočamo vsaj 10 izidov za smiselno statistiko (trenutno: {data.totalOutcomes})
        </div>
      )}
    </div>
  );
}
