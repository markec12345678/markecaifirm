'use client';

/**
 * v9.62: AI Copilot — Decision Learning Loop z jasnim UX.
 *
 * UX JASNOST (critical fix):
 *   "Potrdi predlog" = uporabnik se strinja (NE izvede akcije)
 *   "Izvedi akcijo" = dejansko izvede (doda trade, ustavi monitor)
 *
 * LIFECYCLE:
 *   pending → [Potrdi predlog] → approved → [Izvedi akcijo] → executed → outcome_recorded
 *                  ↓
 *              [Zavrni] → rejected
 *
 * DECISION ACCURACY:
 *   "Od zadnjih X odločitev je bilo Y% pravilnih."
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles, Check, X, ExternalLink, RefreshCw,
  AlertCircle, ChevronDown, ChevronRight, Play, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHaptic } from '@/hooks/use-haptic';
import type { DashboardView } from './dashboard/types';

interface Suggestion {
  id: string;
  type: string;
  priority: string;
  title: string;
  description: string;
  reason: string;
  expectedOutcome: string;
  riskLevel: string;
  actionData: {
    listingId?: string;
    tradeId?: string;
    monitorId?: string;
    url?: string;
    category?: string;
    suggestedPrice?: number;
    suggestedAction?: string;
  };
  icon: string;
  category: string;
  autoExecutable: boolean;
  status: string;
  createdAt: string;
}

interface AccuracyStats {
  totalDecided: number;
  approved: number;
  rejected: number;
  executed: number;
  outcomeRecorded: number;
  correct: number;
  decisionAccuracy: number | null;
}

interface CopilotData {
  ok: true;
  suggestions: Suggestion[];
  accuracy: AccuracyStats;
}

const PRIORITY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  high: { bg: 'bg-red-500/5', border: 'border-red-500/40', text: 'text-red-500', icon: '🔴' },
  medium: { bg: 'bg-amber-500/5', border: 'border-amber-500/40', text: 'text-amber-500', icon: '🟡' },
  low: { bg: 'bg-sky-500/5', border: 'border-sky-500/40', text: 'text-sky-500', icon: '🔵' },
};

interface CopilotWidgetProps {
  onNavigate?: (view: DashboardView) => void;
}

export function CopilotWidget({ onNavigate }: CopilotWidgetProps) {
  const [data, setData] = useState<CopilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/copilot');
      if (res.ok) {
        const json = await res.json();
        if (json.ok) setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleApprove = async (suggestion: Suggestion) => {
    haptic.light();
    setProcessing(suggestion.id);
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: suggestion.id, action: 'approve' }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.info(`✓ Predlog potrjen`, {
          description: 'Akcijska še NI izvedena. Klikni "Izvedi akcijo" za dejansko izvedbo.',
        });
        setApprovedIds((prev) => new Set(prev).add(suggestion.id));
      } else {
        toast.error(json.error || 'Napaka');
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setProcessing(null);
    }
  };

  const handleExecute = async (suggestion: Suggestion) => {
    haptic.medium();
    setProcessing(suggestion.id);
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: suggestion.id, action: 'execute' }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`✓ Akcija izvedena`, {
          description: json.message,
        });
        haptic.success();
        setDismissed((prev) => new Set(prev).add(suggestion.id));
        setApprovedIds((prev) => {
          const next = new Set(prev);
          next.delete(suggestion.id);
          return next;
        });
        // Reload da dobimo posodobljene accuracy stats
        setTimeout(() => load(), 1000);
      } else {
        toast.error(json.error || 'Napaka pri izvedbi');
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (suggestion: Suggestion) => {
    haptic.light();
    setProcessing(suggestion.id);
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: suggestion.id, action: 'reject' }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.info(`✕ Predlog zavrnjen`, {
          description: 'AI se bo naučil iz tvoje odločitve.',
        });
        setDismissed((prev) => new Set(prev).add(suggestion.id));
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-24 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const visibleSuggestions = data.suggestions.filter((s) => !dismissed.has(s.id));
  const accuracy = data.accuracy;

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Copilot
          {visibleSuggestions.length > 0 && (
            <Badge className="ml-auto bg-primary/10 text-primary border-primary/30 text-[10px]">
              {visibleSuggestions.length} predlogov
            </Badge>
          )}
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          AI predlaga · Ti potrdiš · Nato izvedeš
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Decision Accuracy banner — v9.63.1: vedno prikaži sample size + early data warning */}
        {accuracy.outcomeRecorded > 0 && (
          <div className={cn(
            'p-2 rounded-md border text-center',
            accuracy.decisionAccuracy !== null && accuracy.decisionAccuracy >= 70
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-amber-500/5 border-amber-500/30'
          )}>
            <div className="text-[10px] uppercase text-muted-foreground font-bold mb-0.5">
              🎯 Decision Accuracy
            </div>
            <div className={cn(
              'text-xl font-bold',
              accuracy.decisionAccuracy !== null && accuracy.decisionAccuracy >= 70
                ? 'text-emerald-500'
                : 'text-amber-500'
            )}>
              {accuracy.decisionAccuracy !== null ? `${accuracy.decisionAccuracy}%` : '—'}
              <span className="text-[10px] font-normal text-muted-foreground ml-1">
                · {accuracy.correct}/{accuracy.outcomeRecorded}
              </span>
            </div>
            {/* Early data warning — vedno prikaži ko je <10 outcomes */}
            {accuracy.outcomeRecorded < 10 && (
              <div className="text-[9px] text-amber-500 mt-0.5 flex items-center justify-center gap-0.5">
                <AlertCircle className="w-2 h-2" />
                Early data — limited sample
              </div>
            )}
          </div>
        )}
        {/* Honest empty state — ko ni še nobenega outcome-a */}
        {accuracy.outcomeRecorded === 0 && (
          <div className="p-2 rounded-md border border-border bg-background/30 text-center">
            <div className="text-[10px] uppercase text-muted-foreground font-bold mb-0.5">
              🎯 Decision Accuracy
            </div>
            <div className="text-sm text-muted-foreground italic">
              N/A — premalo podatkov
            </div>
            <div className="text-[9px] text-muted-foreground/70 mt-0.5">
              Čakamo na prve rezultate (potrebno ≥10 odločitev)
            </div>
          </div>
        )}

        {/* Suggestions */}
        {visibleSuggestions.length === 0 ? (
          <div className="text-center py-6">
            <Check className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
            <p className="text-sm text-muted-foreground">
              Ni aktivnih predlogov.
              <br />
              <span className="text-[10px]">AI bo pripravil nove ko najde priložnosti.</span>
            </p>
          </div>
        ) : (
          <>
          {(showAll ? visibleSuggestions : visibleSuggestions.slice(0, 5)).map((suggestion) => {
            const prio = PRIORITY_COLORS[suggestion.priority] ?? PRIORITY_COLORS.medium;
            const isExpanded = expanded === suggestion.id;
            const hasUrl = !!suggestion.actionData.url;
            const isApproved = approvedIds.has(suggestion.id);

            return (
              <div
                key={suggestion.id}
                className={cn('rounded-md border p-3 text-xs', prio.bg, prio.border)}
              >
                {/* Title row */}
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="text-base">{suggestion.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={cn('font-bold', prio.text)}>{suggestion.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {suggestion.description}
                    </div>
                  </div>
                  <Badge className={cn('text-[9px] px-1.5 py-0 shrink-0', prio.bg, prio.border, prio.text)}>
                    {suggestion.priority}
                  </Badge>
                </div>

                {/* Expand button */}
                <button
                  onClick={() => {
                    haptic.light();
                    setExpanded(isExpanded ? null : suggestion.id);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1.5"
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {isExpanded ? 'Skrij podrobnosti' : 'Prikaži podrobnosti'}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="space-y-1.5 mb-2 p-2 rounded bg-background/30">
                    <div>
                      <span className="text-[9px] uppercase text-muted-foreground font-bold">Zakaj: </span>
                      <span className="text-foreground/80">{suggestion.reason}</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase text-muted-foreground font-bold">Pričakovani izid: </span>
                      <span className="text-emerald-500">{suggestion.expectedOutcome}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span>Tveganje: <span className={prio.text}>{suggestion.riskLevel}</span></span>
                      <span>·</span>
                      <span>Avtopilot: {suggestion.autoExecutable ? '✓ bi naredil' : '✗ potrebuje potrditev'}</span>
                    </div>
                  </div>
                )}

                {/* Status indicator za approved */}
                {isApproved && (
                  <div className="mb-2 p-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-500 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Predlog potrjen — akcija še ni izvedena</span>
                  </div>
                )}

                {/* Action buttons — JASNO RAZLOČENO */}
                <div className="flex gap-1.5 mt-2">
                  {!isApproved ? (
                    <>
                      {/* Step 1: Potrdi predlog (samo strinjanje) */}
                      <Button
                        onClick={() => handleApprove(suggestion)}
                        disabled={processing === suggestion.id}
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 flex-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                        title="Strinjam se s predlogom — akcija še ne bo izvedena"
                        aria-label="Potrdi predlog (ne izvede akcije)"
                      >
                        {processing === suggestion.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Potrdi predlog
                      </Button>

                      {/* Zavrni */}
                      <Button
                        onClick={() => handleReject(suggestion)}
                        disabled={processing === suggestion.id}
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                        aria-label="Zavrni predlog"
                      >
                        <X className="w-3 h-3" />
                        Zavrni
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* Step 2: Izvedi akcijo (dejansko izvede) */}
                      <Button
                        onClick={() => handleExecute(suggestion)}
                        disabled={processing === suggestion.id}
                        size="sm"
                        className="h-7 text-[10px] gap-1 flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                        title="Dejansko izvede akcijo (doda trade, ustavi monitor)"
                        aria-label="Izvedi akcijo — dejansko izvede"
                      >
                        {processing === suggestion.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Izvedi akcijo
                      </Button>

                      {/* Še vedno može Zavrni po approve */}
                      <Button
                        onClick={() => handleReject(suggestion)}
                        disabled={processing === suggestion.id}
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                        aria-label="Zavrni predlog"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </>
                  )}

                  {/* Odpri original oglas — vedno na voljo če ima URL */}
                  {hasUrl && (
                    <Button
                      onClick={() => {
                        haptic.light();
                        if (suggestion.actionData.url) {
                          window.open(suggestion.actionData.url, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] gap-1 border-sky-500/40 text-sky-500 hover:bg-sky-500/10"
                      title="Odpri originalni oglas na portalu"
                      aria-label="Odpri originalni oglas"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Odpri
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {/* v9.75: "Prikaži vseh" gumb ko je več predlogov kot prikazanih */}
          {!showAll && visibleSuggestions.length > 5 && (
            <button
              onClick={() => { haptic.light(); setShowAll(true); }}
              className="w-full text-[10px] text-primary hover:underline py-1"
            >
              Prikaži vseh {visibleSuggestions.length} predlogov ▼
            </button>
          )}
          {showAll && visibleSuggestions.length > 5 && (
            <button
              onClick={() => { haptic.light(); setShowAll(false); }}
              className="w-full text-[10px] text-muted-foreground hover:text-foreground py-1"
            >
              Prikaži 5 najpomembnejših ▲
            </button>
          )}
          </>
        )}

        {/* Stats footer */}
        {accuracy.totalDecided > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-center text-[9px]">
            <div>
              <div className="text-base font-bold text-emerald-500">{accuracy.approved}</div>
              <div className="uppercase text-muted-foreground">Potrjeni</div>
            </div>
            <div>
              <div className="text-base font-bold text-muted-foreground">{accuracy.rejected}</div>
              <div className="uppercase text-muted-foreground">Zavrnjeni</div>
            </div>
            <div>
              <div className="text-base font-bold text-sky-500">{accuracy.executed}</div>
              <div className="uppercase text-muted-foreground">Izvedeni</div>
            </div>
          </div>
        )}

        {/* Avtopilot vs Copilot hint */}
        <div className="text-[9px] text-muted-foreground/70 text-center pt-1 border-t border-border/50 flex items-center justify-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Copilot predlaga · Avtopilot izvaja sam (v nastavitvah)
        </div>
      </CardContent>
    </Card>
  );
}
