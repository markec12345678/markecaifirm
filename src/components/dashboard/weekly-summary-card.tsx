'use client';

// v8.41: Weekly Summary Report Dashboard Card — comprehensive weekly digest.
//
// Shows last week's summary:
//   - Profit this week (big number) + MoM change (green/red arrow)
//   - Goal progress: "306€/500€ (61%)"
//   - Trades: "3 sold · 5 held · avg hold 22d · 95% win rate"
//   - Top 3 trades: list z profit + category + source
//   - Worst trade (if any)
//   - Brain health: "85/100 (A) — HEALTHY"
//   - Top 3 actionable insights (from v8.40)
//   - Recommendations for next week
//
// "📨 Pošlji zdaj" button → POST { action: 'send' } → sends to Telegram + Email.
// Auto-refresh every 60s.
//
// Fetches from /api/ai/brain/weekly-summary (GET preview, POST send).

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Send,
  Target,
  Package,
  Brain,
  Trophy,
  AlertTriangle,
  Lightbulb,
  Rocket,
  ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Types (mirror src/lib/brain/weekly-summary.ts) ------------------------

interface WeeklySummary {
  ok: true;
  period: { start: string; end: string };
  profit: {
    thisWeek: number;
    lastWeek: number;
    momChange: number;
    total30d: number;
    goalProgress: number;
    goalMonthly: number;
    goalRealized: number;
  };
  trades: {
    soldThisWeek: number;
    soldValue: number;
    heldCount: number;
    avgHoldDays: number;
    winRate: number;
  };
  topTrades: Array<{ title: string; profit: number; category: string; source: string }>;
  worstTrade: { title: string; profit: number; category: string } | null;
  brainHealth: {
    score: number;
    grade: string;
    riskLevel: string;
    topAction: string;
    conflictsCount: number;
  };
  insightsHighlights: string[];
  recommendations: string[];
  telegramMessage: string;
  emailSubject: string;
  emailHtml: string;
  source: string;
}

interface SendResult {
  ok: boolean;
  sentTelegram: boolean;
  sentEmail: boolean;
  error?: string | null;
}

// --- Helpers ---------------------------------------------------------------

function fmtEUR(n: number, sign = false): string {
  const v = Math.round(n);
  if (sign && v > 0) return `+${v}€`;
  return `${v}€`;
}

function fmtSlDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('sl-SI', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function healthColor(score: number): string {
  if (score >= 75) return 'text-primary';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-500';
}

function healthBg(score: number): string {
  if (score >= 75) return 'bg-primary/5 border-primary/40';
  if (score >= 50) return 'bg-amber-400/5 border-amber-400/40';
  return 'bg-red-500/5 border-red-500/40';
}

// --- Component -------------------------------------------------------------

export function WeeklySummaryCard() {
  const [data, setData] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/brain/weekly-summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as WeeklySummary;
      if (!json.ok) throw new Error('Napaka v odgovoru');
      setData(json);
    } catch (e: any) {
      // Silent fail — non-critical widget
      console.warn('[WeeklySummaryCard] load failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // v8.41: auto-refresh every 60s
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/ai/brain/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send' }),
      });
      const json = (await res.json()) as SendResult;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Napaka pri pošiljanju');
      }
      const channels: string[] = [];
      if (json.sentTelegram) channels.push('Telegram');
      if (json.sentEmail) channels.push('Email');
      if (channels.length === 0) {
        toast.success('📋 Povzetek shranjen v Notification Center', {
          description: 'Telegram in Email nista konfigurirana — povzetek je vseeno shranjen.',
        });
      } else {
        toast.success(`📋 Povzetek poslan preko ${channels.join(' + ')}`, {
          description: 'Preveri Notification Center za zgodovino.',
        });
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri pošiljanju');
    } finally {
      setSending(false);
    }
  };

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

  // --- Error/empty state ------------------------------------------------
  if (!data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Tedenski povzetek
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                v8.41
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

  // --- Main render -----------------------------------------------------
  const profitPositive = data.profit.thisWeek >= 0;
  const profitColor = profitPositive ? 'text-primary' : 'text-red-500';
  const momUp = data.profit.momChange > 0;
  const momDown = data.profit.momChange < 0;
  const momColor = momUp ? 'text-primary' : momDown ? 'text-red-500' : 'text-muted-foreground';
  const hasGoal = data.profit.goalMonthly > 0;
  const brainGood = data.brainHealth.score >= 75;
  const brainBad = data.brainHealth.score < 50;

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Tedenski povzetek
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.41
            </Badge>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {fmtSlDate(data.period.start)} – {fmtSlDate(data.period.end)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={load}
              title="Osveži"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              {sending ? 'Pošiljam…' : 'Pošlji zdaj'}
            </Button>
          </div>
        </div>

        {/* Big numbers row: this week profit + MoM */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-background/30 rounded p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Dobiček ta teden
            </div>
            <div className={cn('font-mono font-bold text-2xl', profitColor)}>
              {fmtEUR(data.profit.thisWeek, true)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              30d: <span className="font-mono">{fmtEUR(data.profit.total30d)}</span>
            </div>
          </div>
          <div className="bg-background/30 rounded p-2.5">
            <div className="text-[9px] text-muted-foreground uppercase">
              ↗️ MoM sprememba (vs prejšnji teden)
            </div>
            <div className={cn('font-mono font-bold text-2xl flex items-center gap-1', momColor)}>
              {momUp ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : momDown ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : null}
              {data.profit.momChange > 0 ? '+' : ''}
              {data.profit.momChange}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Prejšnji teden: <span className="font-mono">{fmtEUR(data.profit.lastWeek)}</span>
            </div>
          </div>
        </div>

        {/* Goal progress + trades metrics */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-background/30 rounded p-2.5 flex items-center gap-2">
            <Target className={cn('w-4 h-4 shrink-0', hasGoal ? 'text-primary' : 'text-muted-foreground')} />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Mesečni cilj</div>
              {hasGoal ? (
                <div className="font-mono font-bold text-sm">
                  <span className="text-primary">{data.profit.goalRealized}€</span>
                  <span className="text-muted-foreground">/{data.profit.goalMonthly}€</span>
                  <span className="text-muted-foreground text-[10px] ml-1">({data.profit.goalProgress}%)</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Ni nastavljen</div>
              )}
            </div>
          </div>
          <div className="bg-background/30 rounded p-2.5 flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-muted-foreground uppercase">Trades</div>
              <div className="font-mono font-bold text-sm">
                {data.trades.soldThisWeek}
                <span className="text-muted-foreground text-[10px] ml-1">prodanih</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {data.trades.heldCount} held · {data.trades.avgHoldDays}d · {data.trades.winRate}% win
              </div>
            </div>
          </div>
        </div>

        {/* Brain health */}
        <div className={cn('rounded p-2.5 mb-3 border flex items-center gap-2', healthBg(data.brainHealth.score))}>
          <Brain className={cn('w-4 h-4 shrink-0', healthColor(data.brainHealth.score))} />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase">Brain health (v8.22)</div>
            <div className={cn('font-mono font-bold text-sm', healthColor(data.brainHealth.score))}>
              {data.brainHealth.score}/100
              <span className="ml-1.5 text-foreground">({data.brainHealth.grade})</span>
              <span className="ml-1.5 text-muted-foreground text-[10px]">— {data.brainHealth.riskLevel}</span>
              {data.brainHealth.conflictsCount > 0 && (
                <span className="ml-2 text-amber-400 text-[10px]">
                  ⚠️ {data.brainHealth.conflictsCount} konfliktov
                </span>
              )}
            </div>
            {data.brainHealth.topAction && data.brainHealth.topAction !== '—' && (
              <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                Top akcija: {data.brainHealth.topAction}
              </div>
            )}
          </div>
        </div>

        {/* Top 3 trades */}
        {data.topTrades.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <Trophy className="w-3 h-3" />
              Top 3 trades
            </div>
            <div className="space-y-1">
              {data.topTrades.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-background/20 rounded p-1.5 text-xs"
                >
                  <span className="text-muted-foreground font-mono text-[10px] w-3">{i + 1}.</span>
                  <span className="flex-1 truncate" title={t.title}>
                    {t.title}
                  </span>
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">
                    {t.category}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] text-muted-foreground hidden sm:inline-flex">
                    {t.source}
                  </Badge>
                  <span
                    className={cn(
                      'font-mono font-bold text-xs',
                      t.profit >= 0 ? 'text-primary' : 'text-red-500',
                    )}
                  >
                    {fmtEUR(t.profit, true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Worst trade */}
        {data.worstTrade && data.worstTrade.profit < 0 && (
          <div className="mb-3 bg-red-500/5 border border-red-500/30 rounded p-2">
            <div className="text-[10px] uppercase tracking-wider text-red-500 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Najslabši trade
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate" title={data.worstTrade.title}>
                {data.worstTrade.title}
              </span>
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                {data.worstTrade.category}
              </Badge>
              <span className="font-mono font-bold text-red-500 text-xs">
                {fmtEUR(data.worstTrade.profit)}
              </span>
            </div>
          </div>
        )}

        {/* Insights highlights (v8.40) */}
        {data.insightsHighlights.length > 0 && (
          <div className="mb-3 bg-primary/5 border border-primary/20 rounded p-2">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-1.5 flex items-center gap-1">
              <Lightbulb className="w-3 h-3" />
              Top 3 insights (v8.40)
            </div>
            <ul className="space-y-1">
              {data.insightsHighlights.map((insight, i) => (
                <li key={i} className="text-[11px] text-foreground flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">•</span>
                  <span className="line-clamp-2">{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommendations for next week */}
        {data.recommendations.length > 0 && (
          <div className="bg-amber-400/5 border border-amber-400/30 rounded p-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1.5 flex items-center gap-1">
              <Rocket className="w-3 h-3" />
              Priporočila za naslednji teden
            </div>
            <ul className="space-y-1">
              {data.recommendations.map((rec, i) => (
                <li key={i} className="text-[11px] text-foreground flex gap-1.5">
                  <span className="text-amber-400 shrink-0 font-mono">{i + 1}.</span>
                  <span className="line-clamp-3">{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          📋 v8.41 Weekly Summary Report — avtomatsko poslano vsak ponedeljek ob 09:00 preko cron-a.
          Pošlji tudi ročno z gumbom zgoraj.
        </div>
      </CardContent>
    </Card>
  );
}
