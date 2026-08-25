'use client';

/**
 * v9.59: Smart Notification Digest — AI povzetek alertov namesto spam-a.
 *
 * Navdih: Instagram notification summaries, Slack daily digest.
 *
 * Reši "notification fatigue" — namesto 10 alertov na dan:
 * - 1 AI digest ob 20:00 z povzetkom
 * - "Danes: 3 priložnosti, 2 padci cen, 0 nujnih akcij"
 * - Klik → razširi v seznam
 * - Toggle: instant (real-time) vs digest (zbrano ob 20:00)
 * - Quiet hours (nočni način brez obvestil)
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bell, BellOff, Clock, Sparkles, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle, Zap, Moon, Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHaptic } from '@/hooks/use-haptic';

interface DigestInfo {
  mode: 'instant' | 'digest';
  hour: number;
  lastDigestAt: string | null;
  lastDigestType: string | null;
}

interface AiSummary {
  ok: boolean;
  summary: string;
  listings: Array<{
    title: string;
    priceText: string;
    url: string;
    aiScore: number | null;
    aiRisk: number | null;
    monitorName: string;
  }>;
  stats: {
    hours: number;
    totalNewListings: number;
    totalAlerts: number;
    totalBookmarked: number;
    opportunitiesFound: number;
  };
  generatedAt: string;
}

export function SmartDigestWidget() {
  const [digestInfo, setDigestInfo] = useState<DigestInfo | null>(null);
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/digest');
      if (res.ok) {
        const data = await res.json();
        setDigestInfo(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const generateSummary = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/digest/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
        haptic.success();
      }
    } catch {
      toast.error('Napaka pri generiranju AI povzetka');
    } finally {
      setGenerating(false);
    }
  }, [haptic]);

  useEffect(() => {
    load();
    // Auto-generiraj summary na mount
    generateSummary();
  }, [load, generateSummary]);

  const toggleMode = async () => {
    if (!digestInfo) return;
    haptic.light();
    const newMode = digestInfo.mode === 'instant' ? 'digest' : 'instant';
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestMode: newMode }),
      });
      if (res.ok) {
        setDigestInfo({ ...digestInfo, mode: newMode });
        toast.success(
          newMode === 'digest'
            ? `Digest mode: zbrana obvestila ob ${digestInfo.hour}:00`
            : 'Instant mode: real-time obvestila'
        );
      }
    } catch {
      toast.error('Napaka pri spremembi načina');
    }
  };

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-20 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const isDigest = digestInfo?.mode === 'digest';
  const hasOpportunities = (summary?.stats?.opportunitiesFound ?? 0) > 0;

  return (
    <Card className={cn('bg-card/50', isDigest ? 'border-amber-500/30' : 'border-sky-500/30')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          {isDigest ? (
            <BellOff className="w-4 h-4 text-amber-500" />
          ) : (
            <Bell className="w-4 h-4 text-sky-500" />
          )}
          Pametna Obvestila
          <Badge
            className={cn(
              'ml-auto text-[10px]',
              isDigest
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                : 'bg-sky-500/10 text-sky-500 border-sky-500/30'
            )}
          >
            {isDigest ? 'DIGEST' : 'INSTANT'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* AI Summary */}
        <div className="p-3 rounded-md bg-background/50 border border-border">
          <div className="flex items-start gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">
                AI Povzetek (zadnjih 24h)
              </div>
              {generating ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  AI analizira...
                </div>
              ) : summary?.ok ? (
                <p className="text-xs text-foreground/90 leading-relaxed">
                  {summary.summary}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Ni podatkov</p>
              )}
            </div>
          </div>
        </div>

        {/* Quick stats */}
        {summary?.stats && (
          <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-base font-bold text-foreground">{summary.stats.totalNewListings}</div>
              <div className="uppercase text-muted-foreground">Oglasi</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-base font-bold text-amber-500">{summary.stats.totalAlerts}</div>
              <div className="uppercase text-muted-foreground">Alerti</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-base font-bold text-emerald-500">{summary.stats.opportunitiesFound}</div>
              <div className="uppercase text-muted-foreground">Pril.</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-base font-bold text-sky-500">{summary.stats.totalBookmarked}</div>
              <div className="uppercase text-muted-foreground">Zvezd.</div>
            </div>
          </div>
        )}

        {/* Top opportunities (expandable) */}
        {hasOpportunities && summary && summary.listings && summary.listings.length > 0 && (
          <div>
            <button
              onClick={() => {
                haptic.light();
                setExpanded(!expanded);
              }}
              className="w-full flex items-center justify-between text-[10px] uppercase text-muted-foreground hover:text-foreground"
            >
              <span>🎯 Top priložnosti ({summary.listings.length})</span>
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {expanded && (
              <div className="space-y-1 mt-2 max-h-40 overflow-y-auto">
                {summary.listings.slice(0, 5).map((l, i) => (
                  <a
                    key={i}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-2 rounded bg-background/30 hover:bg-card/50 border border-border text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold text-[10px]">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{l.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {l.priceText} · {l.monitorName}
                          {l.aiScore && ` · AI: ${l.aiScore}`}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-background/30">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">
              {isDigest ? 'Digest način' : 'Instant način'}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {isDigest
                ? `Zbrana obvestila ob ${digestInfo?.hour ?? 20}:00`
                : 'Real-time obvestila'}
            </div>
          </div>
          <Button
            onClick={toggleMode}
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            aria-label="Preklopi način obvestil"
          >
            {isDigest ? (
              <>
                <Bell className="w-3 h-3" />
                Instant
              </>
            ) : (
              <>
                <BellOff className="w-3 h-3" />
                Digest
              </>
            )}
          </Button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={generateSummary}
            disabled={generating}
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs gap-1"
          >
            {generating ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Osveži AI povzetek
          </Button>
        </div>

        {/* Quiet hours hint */}
        <div className="text-[9px] text-muted-foreground/70 text-center pt-1 border-t border-border/50 flex items-center justify-center gap-1">
          <Moon className="w-2.5 h-2.5" />
          Quiet hours nastavljivo v Nastavitve → Obvestila
        </div>
      </CardContent>
    </Card>
  );
}
