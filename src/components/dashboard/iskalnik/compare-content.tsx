'use client';

// v9.06: CompareContent — extracted from iskalnik-view.tsx.

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, MapPin, Euro, Calendar, ExternalLink, Star, Shield, Save, Trash2, User, X, RefreshCw, TrendingDown, Filter, GitCompare, Check, Trophy, AlertTriangle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SearchResult } from './types';
import { sourceIcon, sourceColor, timeAgo } from './utils';

export function CompareContent({ data }: { data: { compared: SearchResult[]; winner?: SearchResult; cheapest?: SearchResult; bestAI?: SearchResult; advisorInsights?: Record<string, unknown>; summary?: Record<string, unknown> } }) {
  const { compared, winner, cheapest, bestAI, advisorInsights, summary } = data;

  // Rows for the comparison table
  const rows: { label: string; getValue: (c: SearchResult) => React.ReactNode; highlight?: (c: SearchResult) => boolean }[] = [
    { label: 'Cena', getValue: c => <span className="font-mono font-bold">{c.price ?? '?'}€</span>, highlight: c => c.id === cheapest?.id },
    { label: 'Buy Score', getValue: c => <span className={(c.buyScore ?? 0) >= 75 ? 'text-emerald-500 font-bold' : (c.buyScore ?? 0) >= 55 ? 'text-primary' : 'text-amber-500'}>{c.buyScore} ({c.buyVerdict})</span>, highlight: c => c.id === winner?.id },
    { label: 'AI Score', getValue: c => c.aiScore != null ? `⭐ ${c.aiScore}/10` : '—', highlight: c => c.id === bestAI?.id },
    { label: 'AI Risk', getValue: c => c.aiRisk != null ? <span className={c.aiRisk >= 6 ? 'text-red-500' : c.aiRisk >= 4 ? 'text-amber-500' : 'text-emerald-500'}>🛡 {c.aiRisk}/10</span> : '—' },
    { label: 'AI Verdict', getValue: c => c.aiVerdict || '—' },
    { label: 'AI Ocena vrednosti', getValue: c => c.aiEstimatedValue != null ? `${c.aiEstimatedValue}€` : '—' },
    { label: 'Discount pod oceno', getValue: c => c.discountPercent != null && c.discountPercent > 0 ? <span className="text-emerald-500">-{c.discountPercent.toFixed(0)}%</span> : '—' },
    { label: 'Pričakovan ROI', getValue: c => c.expectedROI != null ? <span className="text-emerald-500">+{c.expectedROI.toFixed(0)}%</span> : '—' },
    { label: 'Letnik', getValue: c => c.year ?? '—' },
    { label: 'Lokacija', getValue: c => <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{c.location || '—'}</span> },
    { label: 'Prodajalec', getValue: c => c.sellerName || '—' },
    { label: 'Vir', getValue: c => c.monitor?.source || '—' },
    { label: 'Padec cene', getValue: c => c.priceDroppedAt != null ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">Da</Badge> : 'Ne' },
  ];

  return (
    <div className="space-y-4">
      {/* v8.72.2: Best of bad warning — if all candidates are weak (<35) */}
      {(() => {
        const allWeak = compared.every((c: SearchResult) => (c.buyScore ?? 0) < 35);
        const allBelow55 = compared.every((c: SearchResult) => (c.buyScore ?? 0) < 55);
        if (allWeak) {
          return (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-red-500">⚠️ Vsi kandidati so šibki (buy score &lt; 35).</span>{' '}
                <span className="text-foreground/80">AI ne priporoča nakupa nobenega. Razširi kriterije iskanja ali počakaj na boljše oglase.</span>
              </div>
            </div>
          );
        }
        if (allBelow55) {
          return (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-amber-600">🟡 Noben kandidat ni "BUY" (≥55).</span>{' '}
                <span className="text-foreground/80">Winner je najboljši med zmernimi možnostmi — premisli ali nakup splača.</span>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* AI Advisor insights */}
      <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 space-y-1.5">
        <div className="text-xs uppercase text-primary font-bold flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" /> AI Buy Advisor
        </div>
        {(advisorInsights as unknown as string[]).map((insight: string, i: number) => {
          const isWarning = insight.includes('⚠️');
          return (
            <div key={i} className="text-xs flex items-start gap-1.5">
              {isWarning ? <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" /> : <span className="text-primary mt-0.5">→</span>}
              <span className="text-foreground/80">{insight}</span>
            </div>
          );
        })}
      </div>

      {/* Winner highlight — v8.72.2: distinguishes relative winner from absolute recommendation */}
      {winner && (() => {
        // v8.72.2: Absolute recommendation based on buy score threshold
        // Winner = "best among selected" (relative). Absolute = "should you actually buy?"
        const score = winner.buyScore;
        let absRec: { label: string; cls: string; icon: string };
        if ((score ?? 0) >= 75) {
          absRec = { label: 'STRONG BUY', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40', icon: '🟢' };
        } else if ((score ?? 0) >= 55) {
          absRec = { label: 'BUY', cls: 'bg-primary/10 text-primary border-primary/30', icon: '✓' };
        } else if ((score ?? 0) >= 35) {
          absRec = { label: 'BUY WITH CAUTION', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30', icon: '🟡' };
        } else {
          absRec = { label: 'AVOID — best of bad options', cls: 'bg-red-500/10 text-red-500 border-red-500/30', icon: '✗' };
        }
        // Confidence label
        const conf = (winner as unknown as Record<string, unknown>)?.confidenceLabel as string || "LOW";
        const confCls = conf === 'HIGH' ? 'text-emerald-500' : conf === 'MEDIUM' ? 'text-amber-500' : 'text-muted-foreground';
        // Winner card color depends on absolute recommendation
        const cardCls = (score ?? 0) >= 55
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : (score ?? 0) >= 35
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-red-500/10 border-red-500/30';
        return (
          <div className={cn('border rounded-lg p-3', cardCls)}>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className={(score ?? 0) >= 55 ? 'w-4 h-4 text-emerald-500' : (score ?? 0) >= 35 ? 'w-4 h-4 text-amber-500' : 'w-4 h-4 text-red-500'} />
                <span className="text-sm font-bold">
                  {(score ?? 0) >= 35 ? '🏆 Najboljša vrednost' : '⚠️ Najmanj slaba možnost'}
                </span>
              </div>
              {/* v8.72.2: Absolute Recommendation badge */}
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border', absRec.cls)}>
                {absRec.icon} {absRec.label}
              </span>
            </div>
            <div className="text-sm font-medium">{winner.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{winner.price}€ · buy score {winner.buyScore}/100 · {winner.location}</span>
              <span className={cn('text-[10px]', confCls)}>· Confidence: {conf}</span>
            </div>
            <p className="text-xs text-foreground/80 mt-1.5 italic">{(winner as unknown as Record<string, unknown>)?.recommendation as string ?? ""}</p>
            {/* v8.72.2: Clarification — relative vs absolute */}
            <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/30">
              ℹ️ "Winner" = najboljši med izbranimi kandidati. Absolutno priporočilo glede na buy score.
              {(score ?? 0) < 55 && ' To ni objektivno dober nakup — premisli ali sploh kupovati.'}
            </div>
          </div>
        );
      })()}

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-2 text-muted-foreground uppercase text-[10px]">Kriterij</th>
              {compared.map((c: SearchResult) => (
                <th key={c.id} className={cn(
                  'text-left p-2 min-w-[140px] align-top',
                  c.id === winner?.id && 'bg-emerald-500/10'
                )}>
                  <div className="flex items-start gap-1.5">
                    {c.imageUrl && <img src={c.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate" title={c.title}>{c.title}</div>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                        <ExternalLink className="w-2 h-2" /> Odpri
                      </a>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="p-2 text-muted-foreground text-[10px] uppercase">{row.label}</td>
                {compared.map((c: SearchResult) => (
                  <td key={c.id} className={cn(
                    'p-2',
                    row.highlight?.(c) && 'bg-emerald-500/10 font-medium'
                  )}>
                    {row.getValue(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Število</div>
          <div className="font-bold">{summary?.count as number ?? 0}</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Cena min</div>
          <div className="font-bold text-emerald-500">{(summary?.priceRange as Record<string, number>)?.min ?? 0}€</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Cena max</div>
          <div className="font-bold text-amber-500">{(summary?.priceRange as Record<string, number>)?.max ?? 0}€</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Avg buy score</div>
          <div className="font-bold text-primary">{(summary?.avgBuyScore as number)?.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

