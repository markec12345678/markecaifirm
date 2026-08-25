'use client';

/**
 * v9.61: AI Copilot — AI predlogi akcij s potrditvijo.
 *
 * RAZLIKA OD AVTOPILOTA:
 * - Avtopilot: samodejno izvaja LOW/MEDIUM akcije brez potrditve
 * - Copilot: AI PREDLAGA, uporabnik potrdi/zavrne
 *
 * Predlogi:
 * - 🛒 Buy (kupi artikel)
 * - 💰 Sell (prodaj/reprice zastarele)
 * - ⏸️ Stop monitor (ustavi neaktivne)
 * - 🔄 Restock (najboljša kategorija)
 * - 🔍 Investigate (anomalije)
 *
 * Vsak predlog ima:
 * - [Potrdi] gumb → izvedi akcijo
 * - [Zavrni] gumb → zavrni + feedback
 * - "Odpri original oglas" gumb če ima URL
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles, Check, X, ExternalLink, RefreshCw,
  AlertCircle, Zap, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHaptic } from '@/hooks/use-haptic';
import type { DashboardView } from './dashboard/types';

interface CopilotSuggestion {
  id: string;
  type: 'buy' | 'sell' | 'reprice' | 'stop-monitor' | 'start-monitor' | 'restock' | 'investigate';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  reason: string;
  expectedOutcome: string;
  riskLevel: 'low' | 'medium' | 'high';
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
  category: 'opportunity' | 'warning' | 'optimization' | 'investigation';
  requiresConfirmation: boolean;
  autoExecutable: boolean;
}

interface CopilotData {
  ok: true;
  suggestions: CopilotSuggestion[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    opportunities: number;
    warnings: number;
  };
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
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const handleApprove = async (suggestion: CopilotSuggestion) => {
    haptic.medium();
    setProcessing(suggestion.id);
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: suggestion.id, action: 'approve' }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`✓ ${suggestion.icon} ${suggestion.title}`, {
          description: json.message,
        });
        haptic.success();
        setDismissed((prev) => new Set(prev).add(suggestion.id));
      } else {
        toast.error(json.error || 'Napaka pri potrditvi');
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (suggestion: CopilotSuggestion) => {
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

  if (!data) {
    return null;
  }

  const visibleSuggestions = data.suggestions.filter((s) => !dismissed.has(s.id));

  if (visibleSuggestions.length === 0) {
    return (
      <Card className="bg-card/50 border-emerald-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            AI Copilot
            <Badge className="ml-auto bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px]">
              Vse opravljeno
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-6">
          <Check className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
          <p className="text-sm text-muted-foreground">
            Ni aktivnih predlogov.
            <br />
            <span className="text-[10px]">AI bo pripravil nove ko najde priložnosti.</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Copilot
          <Badge className="ml-auto bg-primary/10 text-primary border-primary/30 text-[10px]">
            {visibleSuggestions.length} predlogov
          </Badge>
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          AI predlaga akcije — ti potrdiš ali zavrneš
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleSuggestions.slice(0, 5).map((suggestion) => {
          const prio = PRIORITY_COLORS[suggestion.priority];
          const isExpanded = expanded === suggestion.id;
          const hasUrl = !!suggestion.actionData.url;

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

              {/* Action buttons */}
              <div className="flex gap-1.5 mt-2">
                <Button
                  onClick={() => handleApprove(suggestion)}
                  disabled={processing === suggestion.id}
                  size="sm"
                  className="h-7 text-[10px] gap-1 flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                  aria-label="Potrdi predlog"
                >
                  {processing === suggestion.id ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Potrdi
                </Button>
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

        {/* Avtopilot vs Copilot hint */}
        <div className="text-[9px] text-muted-foreground/70 text-center pt-1 border-t border-border/50 flex items-center justify-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Copilot predlaga · Avtopilot izvaja sam (v nastavitvah)
        </div>
      </CardContent>
    </Card>
  );
}
