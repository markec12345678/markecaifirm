'use client';

// v8.99: TradeRow — extracted from trades-view.tsx.

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag, Download, Sparkles, Check, Copy, AlertTriangle, Boxes, Flame, FileText, Receipt, Network, Clock, Type, Users, Globe, Activity, Upload, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { FlipChecklist } from '@/components/dashboard/flip-checklist';
import { TagsInput } from '@/components/ui/tags-input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';
import { parseTagsLocal } from './utils';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useHaptic } from '@/hooks/use-haptic';
import { triggerGlobalRefresh } from '@/hooks/use-global-refresh';


export function TradeRow({ trade, onEdit, onDelete, onSync, onExit, onTagClick, priority, priceHint, outcome }: {
  trade: Trade;
  onEdit: () => void;
  onDelete: () => void;
  onSync?: (tradeId: string) => void;
  onExit?: (tradeId: string) => void;
  onTagClick?: (tag: string) => void;
  priority?: { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW'; daysHeld: number; reasons: string[]; recommendedAction: string } | null;
  priceHint?: { suggestedMin: number; suggestedMax: number; suggestedOptimal: number; expectedProfit: number; expectedROI: number; confidence: number; confidenceLabel: 'HIGH' | 'MEDIUM' | 'LOW'; reasoning: string[]; comparablesCount: number } | null;
  outcome?: { overallScore: number; verdict: 'PERFECT' | 'GOOD' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'LOSS'; leftOnTable: number; pricingScore: number; timingScore: number; outcomeScore: number; lessons: string[]; reasoning: string[] } | null;
}) {
  const [showFlipChecklist, setShowFlipChecklist] = useLocalStorage<boolean>('trade-flip-expanded', false);
  // v8.62: Quick Sell inline form
  const [showQuickSell, setShowQuickSell] = useState(false);
  const [qsPrice, setQsPrice] = useState('');
  const [qsFees, setQsFees] = useState('');
  const [qsLocation, setQsLocation] = useState(trade.buyLocation || '');
  const [qsSaving, setQsSaving] = useState(false);
  const haptic = useHaptic();

  const totalCost = trade.buyPrice + (trade.buyFees || 0);
  const revenue = trade.sellPrice != null ? trade.sellPrice - (trade.sellFees || 0) : null;
  const profit = revenue != null ? revenue - totalCost : null;
  const roi = (profit != null && totalCost > 0) ? (profit / totalCost) * 100 : null;

  const statusBadge =
    trade.status === 'held' ? { text: 'V SKLADIŠČU', cls: 'border-amber-400/40 text-amber-400' } :
    trade.status === 'sold' ? { text: 'PRODANO', cls: 'border-primary/40 text-primary' } :
    { text: 'PREKlicano', cls: 'border-muted text-muted-foreground' };

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {trade.imageUrl ? (
            <img src={trade.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-muted shrink-0" loading="lazy" />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className={cn('text-[10px] uppercase', statusBadge.cls)}>{statusBadge.text}</Badge>
              {trade.category && <Badge variant="outline" className="text-[10px]">{trade.category}</Badge>}
              {/* v8.65: Sell Priority badge — only for held trades with priority data */}
              {trade.status === 'held' && priority && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                    priority.level === 'HIGH'
                      ? 'bg-red-500/10 text-red-500 border-red-500/30'
                      : priority.level === 'MEDIUM'
                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                  )}
                  title={`🔥 Sell Priority: ${priority.score}/100\n${priority.reasons.map(r => `• ${r}`).join('\n')}\n\nPriporočilo: ${priority.recommendedAction}`}
                >
                  {priority.level === 'HIGH' ? '🔥' : priority.level === 'MEDIUM' ? '🟡' : '🟢'} {priority.score}
                  <span className="text-[9px] opacity-70 ml-0.5">{priority.daysHeld}d</span>
                </span>
              )}
              {/* v8.66: Smart Price badge — only for held trades with price hint */}
              {trade.status === 'held' && priceHint && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  title={`💡 Pametna cena: ${priceHint.suggestedOptimal}€\nObseg: ${priceHint.suggestedMin}€ - ${priceHint.suggestedMax}€\nPričakovan ROI: ${priceHint.expectedROI.toFixed(0)}% (+${priceHint.expectedProfit.toFixed(0)}€)\nZaupanje: ${priceHint.confidenceLabel} (${priceHint.confidence}%)\n${priceHint.comparablesCount > 0 ? `Na podlagi ${priceHint.comparablesCount} podobnih prodaj` : 'Brez comparable podatkov'}\n\nRazlogi:\n${priceHint.reasoning.map(r => `• ${r}`).join('\n')}`}
                >
                  💡 {priceHint.suggestedOptimal}€
                  <span className="text-[9px] opacity-70 ml-0.5">{priceHint.confidenceLabel === 'HIGH' ? '★' : priceHint.confidenceLabel === 'MEDIUM' ? '●' : '○'}</span>
                </span>
              )}
              {/* v8.67: Outcome badge — only for sold trades with outcome data */}
              {trade.status === 'sold' && outcome && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                    outcome.verdict === 'PERFECT'
                      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
                      : outcome.verdict === 'GOOD'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : outcome.verdict === 'ACCEPTABLE'
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          : outcome.verdict === 'LOSS'
                            ? 'bg-red-500/15 text-red-500 border-red-500/40'
                            : 'bg-muted text-muted-foreground border-border'
                  )}
                  title={`🏆 Outcome: ${outcome.verdict} (${outcome.overallScore}/100)\nCena: ${outcome.pricingScore}/100 · Timing: ${outcome.timingScore}/100 · Rezultat: ${outcome.outcomeScore}/100\n${outcome.leftOnTable > 0 ? `⚠️ Pustil ${outcome.leftOnTable.toFixed(0)}€ na mizi` : outcome.leftOnTable < 0 ? `✓ +${Math.abs(outcome.leftOnTable).toFixed(0)}€ nad optimalno` : '✓ Optimalna cena'}\n\nLekcije:\n${outcome.lessons.map(l => `• ${l}`).join('\n')}`}
                >
                  {outcome.verdict === 'PERFECT' ? '🏆' : outcome.verdict === 'GOOD' ? '✓' : outcome.verdict === 'ACCEPTABLE' ? '○' : outcome.verdict === 'LOSS' ? '✗' : '△'} {outcome.overallScore}
                  {outcome.leftOnTable > 0 && <span className="text-[9px] opacity-70 ml-0.5">-{outcome.leftOnTable.toFixed(0)}€</span>}
                </span>
              )}
              {/* v8.69: Original Buy Score badge — persisted at purchase time (shows how good the buy decision was) */}
              {trade.buyScore != null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                    trade.buyVerdict === 'STRONG_BUY'
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                      : trade.buyVerdict === 'BUY'
                        ? 'bg-primary/5 text-primary border-primary/20'
                        : trade.buyVerdict === 'CONSIDER'
                          ? 'bg-amber-500/5 text-amber-600 border-amber-500/20'
                          : 'bg-muted text-muted-foreground border-border'
                  )}
                  title={`🛒 Buy Score ob nakupu: ${trade.buyScore}/100${trade.buyVerdict ? ` (${trade.buyVerdict})` : ''}${trade.buyScoreAt ? `\nIzračunano: ${new Date(trade.buyScoreAt).toLocaleDateString('sl-SI')}` : ''}\n\nKontekst za outcome (v8.67): ${outcome ? `outcome ${outcome.overallScore}/100 — ${outcome.verdict}` : 'še ni prodano'}`}
                >
                  🛒 {trade.buyScore}
                </span>
              )}
              {/* v8.63: Tag chips — v8.64: clickable, sets filterTag */}
              {(trade.tagsArray ?? parseTagsLocal(trade.tags)).map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick?.(tag);
                  }}
                  className="inline-flex items-center rounded-md border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:border-primary/40 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title={`Filtriraj po #${tag}`}
                >
                  #{tag}
                </button>
              ))}
              {trade.listing && (
                <a href={trade.listing.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> izvirni oglas
                </a>
              )}
            </div>
            <h3 className="font-bold text-sm truncate">{trade.title}</h3>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
              <span className="text-amber-400">Kupljeno: {trade.buyPrice} €</span>
              <span>• {new Date(trade.buyDate).toLocaleDateString('sl-SI')}</span>
              {trade.sellPrice != null && (
                <>
                  <span className="text-primary">Prodano: {trade.sellPrice} €</span>
                  {profit != null && (
                    <span className={profit >= 0 ? 'text-primary font-bold' : 'text-destructive font-bold'}>
                      {profit >= 0 ? '+' : ''}{profit.toFixed(2)} € ({roi?.toFixed(0)}% ROI)
                    </span>
                  )}
                </>
              )}
            </div>
            {trade.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{trade.notes}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
            {/* v6.3: Generate listing for resale */}
            {trade.status === 'held' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-primary"
                title="AI generiraj oglas za preprodajo"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/ai/generate-listing', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tradeId: trade.id }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      // Copy to clipboard
                      navigator.clipboard.writeText(`${data.listing.title}\n\n${data.listing.description}\n\nCena: ${data.listing.price}€`);
                      toast.success(`✓ Oglas generiran (${data.listing.marginPct > 0 ? '+' : ''}${data.listing.marginPct}% marže, kopirano v odložišče)`);
                    } else { toast.error(data.error ?? 'Napaka'); }
                  } catch { toast.error('Napaka'); }
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* v6.5: Multi-Platform Sync */}
            {trade.status === 'held' && onSync && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-blue-400"
                title="AI generiraj oglase za Bolha + Vinted"
                onClick={() => onSync(trade.id)}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* v6.9: AI Exit Strategy */}
            {trade.status === 'held' && onExit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-amber-400"
                title="AI izhodna strategija — kdaj in kako prodati"
                onClick={() => onExit(trade.id)}
              >
                <Target className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* v8.62: Quick Sell button */}
            {trade.status === 'held' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-emerald-500"
                title="💰 Hitra prodaja"
                onClick={() => {
                  setShowQuickSell(!showQuickSell);
                  // v8.66: Use smart price if available, fallback to buyPrice×1.3
                  if (!showQuickSell) {
                    const suggested = priceHint?.suggestedOptimal ?? Math.round(trade.buyPrice * 1.3);
                    setQsPrice(String(suggested));
                    haptic.light();
                  }
                }}
              >
                <DollarSign className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        </div>

        {/* v8.62: Quick Sell inline form */}
        {trade.status === 'held' && showQuickSell && (
          <div className="mt-2 p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-emerald-500">💰 Hitra prodaja</span>
              <button onClick={() => setShowQuickSell(false)} className="ml-auto text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase">Prodajna cena (€)</label>
                <Input
                  type="number"
                  value={qsPrice}
                  onChange={(e) => setQsPrice(e.target.value)}
                  placeholder="380"
                  className="h-7 text-xs"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase">Pristojbine (€)</label>
                <Input
                  type="number"
                  value={qsFees}
                  onChange={(e) => setQsFees(e.target.value)}
                  placeholder="0"
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase">Kraj prodaje</label>
                <Input
                  value={qsLocation}
                  onChange={(e) => setQsLocation(e.target.value)}
                  placeholder="Bolha"
                  className="h-7 text-xs"
                />
              </div>
              <div className="flex flex-col justify-end">
                <Button
                  size="sm"
                  className="h-7 bg-emerald-500 hover:bg-emerald-600 text-white"
                  disabled={qsSaving || !qsPrice || parseFloat(qsPrice) <= 0}
                  onClick={async () => {
                    setQsSaving(true);
                    haptic.medium();
                    try {
                      const res = await fetch(`/api/trades/${trade.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          status: 'sold',
                          sellPrice: parseFloat(qsPrice),
                          sellFees: parseFloat(qsFees || '0'),
                          sellLocation: qsLocation || trade.buyLocation,
                          sellDate: new Date().toISOString(),
                        }),
                      });
                      if (res.ok) {
                        const sellPrice = parseFloat(qsPrice);
                        const sellFees = parseFloat(qsFees || '0');
                        const profit = sellPrice - sellFees - totalCost;
                        const roiPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;
                        toast.success(`✓ Prodano! ${profit >= 0 ? '+' : ''}${profit.toFixed(0)}€ (${roiPct.toFixed(0)}% ROI)`);
                        haptic.success();
                        triggerGlobalRefresh('quick-sell');
                        setShowQuickSell(false);
                      } else {
                        toast.error('Napaka pri prodaji');
                        haptic.error();
                      }
                    } catch {
                      toast.error('Napaka');
                      haptic.error();
                    } finally {
                      setQsSaving(false);
                    }
                  }}
                >
                  {qsSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  <span className="ml-1">Prodaj</span>
                </Button>
              </div>
            </div>
            {/* Live profit preview */}
            {qsPrice && parseFloat(qsPrice) > 0 && (
              <div className="mt-2 flex items-center gap-3 text-xs">
                {(() => {
                  const sp = parseFloat(qsPrice);
                  const sf = parseFloat(qsFees || '0');
                  const p = sp - sf - totalCost;
                  const r = totalCost > 0 ? (p / totalCost) * 100 : 0;
                  return (
                    <>
                      <span className="text-muted-foreground">Prihodki: <span className="text-foreground font-mono">{(sp - sf).toFixed(0)}€</span></span>
                      <span className={p >= 0 ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                        Profit: {p >= 0 ? '+' : ''}{p.toFixed(0)}€ ({r.toFixed(0)}% ROI)
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* v8.54: Flip Checklist for held trades */}
        {trade.status === 'held' && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-[11px] text-muted-foreground hover:text-primary w-full justify-between"
              onClick={() => setShowFlipChecklist(!showFlipChecklist)}
            >
              <span className="flex items-center gap-1.5">
                <span>🔄 Flip Checklist</span>
              </span>
              {showFlipChecklist ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            {showFlipChecklist && (
              <div className="mt-1.5">
                <FlipChecklist
                  tradeId={trade.id}
                  tradeTitle={trade.title}
                  initialChecklist={(() => { try { return JSON.parse(trade.flipChecklist || '[]'); } catch { return []; } })()}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


