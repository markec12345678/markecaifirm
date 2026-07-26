'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag, Download, Sparkles, Check, Copy, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, LineChart, Line,
} from 'recharts';

interface Trade {
  id: string;
  listingId: string | null;
  title: string;
  category: string;
  imageUrl: string | null;
  url: string | null;
  buyPrice: number;
  buyDate: string;
  buyLocation: string;
  buyFees: number;
  sellPrice: number | null;
  sellDate: string | null;
  sellLocation: string;
  sellFees: number;
  status: string;
  notes: string;
  createdAt: string;
  listing?: { id: string; title: string; url: string; imageUrl: string | null; monitor?: { name: string } } | null;
}

interface TradeStats {
  totalTrades: number;
  heldCount: number;
  soldCount: number;
  realizedProfit: number;
  totalInvestedHeld: number;
  totalRealizedRevenue: number;
  totalRealizedCost: number;
  avgRoiPercent: number;
  byCategory: Array<{ category: string; count: number; profit: number; invested: number }>;
  byMonth: Array<{ month: string; profit: number; count: number }>;
  // v4.2: Profit goal
  thisMonthProfit: number;
  monthlyGoal: number;
  goalProgress: number;
}

const CATEGORIES = ['elektronika', 'avto', 'nepremičnina', 'pohištvo', 'oblačila', 'orodje', 'kolektorstvo', 'drugo'];

export function TradesView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  // v5.4: Portfolio AI
  const [portfolioAI, setPortfolioAI] = useState<any>(null);
  const [portfolioAILoading, setPortfolioAILoading] = useState(false);
  // v6.3: Auto-reprice
  const [repriceData, setRepriceData] = useState<any>(null);
  const [repriceLoading, setRepriceLoading] = useState(false);
  // v6.3: Auto-listing generator
  const [generatedListing, setGeneratedListing] = useState<any>(null);
  const [genListingLoading, setGenListingLoading] = useState<string | null>(null);
  // v6.5: Multi-platform sync
  const [syncData, setSyncData] = useState<any>(null);
  const [syncLoading, setSyncLoading] = useState<string | null>(null);
  // v6.7: Aging alerts + Restock
  const [agingData, setAgingData] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(false);
  const [restockData, setRestockData] = useState<any>(null);
  const [restockLoading, setRestockLoading] = useState(false);
  // v5.7: Bulk trade operations
  const [bulkTradeIds, setBulkTradeIds] = useState<Set<string>>(new Set());
  const [bulkTradeLoading, setBulkTradeLoading] = useState(false);
  const [bulkSellPrice, setBulkSellPrice] = useState('');

  const load = useCallback(async () => {
    try {
      const [tradesRes, statsRes] = await Promise.all([
        fetch('/api/trades'),
        fetch('/api/trades/stats'),
      ]);
      if (tradesRes.ok) setTrades(await tradesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      toast.error('Ne morem naložiti tradov');
    } finally {
      setLoading(false);
    }
  }, []);

  // v5.4: Load AI portfolio analysis
  const loadPortfolioAI = useCallback(async () => {
    setPortfolioAILoading(true);
    try {
      const res = await fetch('/api/trades/portfolio-ai');
      if (res.ok) {
        setPortfolioAI(await res.json());
      }
    } catch { /* ignore */ }
    finally { setPortfolioAILoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // v5.7: Bulk trade operations
  const bulkSell = async () => {
    if (bulkTradeIds.size === 0 || !bulkSellPrice.trim()) {
      toast.error('Izberi tradee in vnesi prodajno ceno');
      return;
    }
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sell',
          tradeIds: Array.from(bulkTradeIds),
          data: { sellPrice: parseInt(bulkSellPrice, 10) },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Prodanih ${data.updated} tradeov`);
        setBulkTradeIds(new Set());
        setBulkSellPrice('');
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const bulkCategorize = async () => {
    if (bulkTradeIds.size === 0) return;
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'categorize', tradeIds: Array.from(bulkTradeIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Kategoriziranih ${data.updated} tradeov`);
        setBulkTradeIds(new Set());
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const bulkDelete = async () => {
    if (bulkTradeIds.size === 0) return;
    if (!confirm(`Izbrišem ${bulkTradeIds.size} tradeov?`)) return;
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', tradeIds: Array.from(bulkTradeIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Izbrisanih ${data.updated} tradeov`);
        setBulkTradeIds(new Set());
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const toggleBulkTrade = (id: string) => {
    setBulkTradeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteTrade = async (t: Trade) => {
    if (!confirm(`Izbrišem trade "${t.title}"?`)) return;
    try {
      await fetch(`/api/trades/${t.id}`, { method: 'DELETE' });
      toast.success('Trade izbrisan');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Skladišče
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sledi kupljene in prodane oglase — izračunaj profit in ROI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v5.4: AI Portfolio button */}
          <Button
            size="sm"
            variant="outline"
            onClick={loadPortfolioAI}
            disabled={portfolioAILoading}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            title="AI analiza portfolia — kdaj prodati, kdaj držati"
          >
            {portfolioAILoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI Portfolio
          </Button>
          {/* v6.3: Auto-reprice button */}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              setRepriceLoading(true); setRepriceData(null);
              try {
                const res = await fetch('/api/trades/auto-reprice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setRepriceData(data); toast.success(`✓ ${data.needsReprice} od ${data.totalHeld} potrebuje reprice`); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setRepriceLoading(false); }
            }}
            disabled={repriceLoading}
            className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            title="AI predlagaj cene za neprodane tradee"
          >
            {repriceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingDown className="w-3.5 h-3.5" />}
            Auto-reprice
          </Button>
          {/* v6.7: Aging alerts */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-red-500/40 text-red-500 hover:bg-red-500/10"
            disabled={agingLoading}
            onClick={async () => {
              setAgingLoading(true);
              try {
                const res = await fetch('/api/trades/aging-alerts');
                const data = await res.json();
                if (data.ok) { setAgingData(data); toast.success(`✓ ${data.summary.critical} kritičnih, ${data.summary.high} visokih`); }
                else toast.error(data.error ?? 'Napaka');
              } catch { toast.error('Napaka'); }
              finally { setAgingLoading(false); }
            }}
            title="AI aging alerts — kateri itemi izgubljajo vrednost?"
          >
            {agingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            Aging alerti
          </Button>
          {/* v6.7: Restock recommendations */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-green-400/40 text-green-400 hover:bg-green-400/10"
            disabled={restockLoading}
            onClick={async () => {
              setRestockLoading(true);
              try {
                const res = await fetch('/api/ai/restock');
                const data = await res.json();
                if (data.ok) { setRestockData(data); toast.success(`✓ ${data.recommendations.length} priporočil, ${data.totalOpportunities} priložnosti`); }
                else toast.error(data.error ?? 'Napaka');
              } catch { toast.error('Napaka'); }
              finally { setRestockLoading(false); }
            }}
            title="AI restock — kaj ponovno kupiti za preprodajo?"
          >
            {restockLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            AI Restock
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/api/trades?format=csv`, '_blank')}
            className="gap-2"
            title="Izvozi v CSV za Excel/računovodstvo"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-3.5 h-3.5" /> Nov trade
          </Button>
        </div>
      </div>

      {/* v5.4: AI Portfolio Analysis */}
      {portfolioAI && !portfolioAILoading && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Portfolio analiza
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.4</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setPortfolioAI(null)} className="h-6 text-xs">
                ×
              </Button>
            </div>

            {/* AI Overview */}
            {portfolioAI.portfolioSummary?.aiOverview && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs mb-2">
                <div className="text-[10px] uppercase tracking-wider text-primary mb-1">📊 Pregled</div>
                <p>{portfolioAI.portfolioSummary.aiOverview}</p>
              </div>
            )}

            {/* Strategy */}
            {portfolioAI.portfolioSummary?.aiStrategy && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs mb-3">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">💡 Strategija</div>
                <p>{portfolioAI.portfolioSummary.aiStrategy}</p>
              </div>
            )}

            {/* Recommendations */}
            {portfolioAI.recommendations?.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Priporočila za vsak trade ({portfolioAI.recommendations.length})
                </div>
                {portfolioAI.recommendations.map((rec: any, i: number) => {
                  const actionConfig: Record<string, { color: string; icon: string; label: string }> = {
                    sell: { color: 'text-primary border-primary/40', icon: '💰', label: 'PRODAJ' },
                    hold: { color: 'text-muted-foreground border-border', icon: '✋', label: 'DRŽI' },
                    reduce: { color: 'text-amber-400 border-amber-400/40', icon: '📉', label: 'ZNIŽAJ' },
                    monitor: { color: 'text-blue-400 border-blue-400/40', icon: '👀', label: 'SPREMLJAJ' },
                  };
                  const cfg = actionConfig[rec.action] || actionConfig.hold;
                  return (
                    <div key={i} className="flex items-start gap-2 p-2 bg-background/30 rounded text-xs">
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', cfg.color)}>
                        {cfg.icon} {cfg.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{rec.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {rec.buyPrice}€ kupljeno • {rec.daysHeld} dni v skladišču
                          {rec.suggestedSellPrice && (
                            <span className="text-primary ml-1">→ predlagana prodajna: {rec.suggestedSellPrice}€</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground italic mt-0.5">{rec.reasoning}</div>
                      </div>
                      {rec.urgency === 'high' && (
                        <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40 shrink-0">
                          🔥 NUJNO
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.3: Auto-reprice results */}
      {repriceData && !repriceLoading && (
        <Card className="bg-amber-400/5 border-amber-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                AI Auto-Reprice — {repriceData.needsReprice} od {repriceData.totalHeld} potrebuje popust
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.3</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRepriceData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {repriceData.repricing.filter((r: any) => r.needsReprice).map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-background/30 rounded text-xs border border-amber-400/20">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.currentPrice}€ → <span className="text-amber-400 font-bold">{r.suggestedPrice}€</span>
                      {' '}({r.dropPct > 0 ? '-' : '+'}{Math.abs(r.dropPct)}%)
                      {' • '}{r.daysHeld}d v skladišču
                      {r.marketAvg && ` • tržno povp: ${r.marketAvg}€`}
                    </div>
                    <div className="text-[10px] italic text-muted-foreground mt-0.5">{r.reason}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 shrink-0"
                    onClick={async () => {
                      try {
                        await fetch('/api/trades', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: r.tradeId, sellPrice: r.suggestedPrice }),
                        });
                        toast.success(`Cena posodobljena: ${r.suggestedPrice}€`);
                        await load();
                      } catch { toast.error('Napaka'); }
                    }}
                  >
                    <Check className="w-3 h-3" /> Uporabi
                  </Button>
                </div>
              ))}
              {repriceData.repricing.filter((r: any) => r.needsReprice).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">✅ Vsi tradei imajo ustrezno ceno — reprice ni potreben.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.3: Auto-listing generator result */}
      {generatedListing && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Generiran oglas za preprodajo
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.3</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setGeneratedListing(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Naslov</div>
                <div className="font-bold">{generatedListing.title}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Cena</div>
                  <div className="font-mono font-bold text-primary">{generatedListing.price}€</div>
                </div>
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Marža</div>
                  <div className="font-mono font-bold text-primary">{generatedListing.marginPct > 0 ? '+' : ''}{generatedListing.marginPct}%</div>
                </div>
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Čas prodaje</div>
                  <div className="font-mono font-bold">~{generatedListing.expectedSellTimeDays}d</div>
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Opis</div>
                <p className="whitespace-pre-wrap text-[11px]">{generatedListing.description}</p>
              </div>
              {generatedListing.tags?.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {generatedListing.tags.map((t: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">#{t}</Badge>
                  ))}
                </div>
              )}
              {generatedListing.tips?.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-primary">💡 Nasveti za prodajo ({generatedListing.tips.length})</summary>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {generatedListing.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ul>
                </details>
              )}
              <Button
                size="sm"
                className="w-full gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(`${generatedListing.title}\n\n${generatedListing.description}\n\nCena: ${generatedListing.price}€`);
                  toast.success('Oglas kopiran — prilepi na Bolha/Vinted');
                }}
              >
                <Copy className="w-3 h-3" /> Kopiraj oglas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.5: Multi-Platform Sync results */}
      {syncData && (
        <Card className="bg-blue-400/5 border-blue-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Multi-Platform oglasi (AI sinhronizirani)
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.5</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setSyncData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2">
              {syncData.listings?.map((l: any, i: number) => (
                <div key={i} className="bg-background/30 rounded p-2 border border-blue-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40 uppercase">{l.platform}</Badge>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-primary">{l.price}€</span>
                      <span className={cn('font-mono', l.marginPct > 0 ? 'text-primary' : 'text-red-500')}>
                        {l.marginPct > 0 ? '+' : ''}{l.marginPct}%
                      </span>
                    </div>
                  </div>
                  <div className="font-bold text-xs mb-1">{l.title}</div>
                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{l.description}</p>
                  {l.tips?.length > 0 && (
                    <details className="text-[11px] mt-1">
                      <summary className="cursor-pointer text-blue-400">💡 Nasveti za {l.platform} ({l.tips.length})</summary>
                      <ul className="mt-0.5 list-disc list-inside space-y-0.5">
                        {l.tips.map((t: string, j: number) => <li key={j}>{t}</li>)}
                      </ul>
                    </details>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-1 h-6 text-[10px] gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(`${l.title}\n\n${l.description}\n\nCena: ${l.price}€`);
                      toast.success(`${l.platform} oglas kopiran`);
                    }}
                  >
                    <Copy className="w-3 h-3" /> Kopiraj
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.7: Aging Alerts */}
      {agingData && !agingLoading && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-red-500 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Aging Alerti — {agingData.summary.critical}🚨 {agingData.summary.high}🔴 {agingData.summary.medium}🟡
                <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setAgingData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs mb-2">
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Skupna izguba</div><div className="font-mono font-bold text-red-500">{agingData.summary.totalValueLoss}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Holding cost</div><div className="font-mono font-bold text-amber-400">{agingData.summary.totalHoldingCost}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Investirano</div><div className="font-mono font-bold">{agingData.summary.totalInvested}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Itemi</div><div className="font-mono font-bold">{agingData.summary.totalItems}</div></div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {agingData.alerts.filter((a: any) => a.urgency !== 'low').map((a: any, i: number) => (
                <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded text-xs border',
                  a.urgency === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                  a.urgency === 'high' ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-400/5 border-amber-400/20')}>
                  <span className={cn('font-bold shrink-0 text-[10px]', a.color)}>{a.urgencyLabel}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-[9px] text-muted-foreground">
                      {a.daysHeld}d • {a.buyPrice}€ → ~{a.estimatedCurrentValue}€ ({a.valueLossPct}% izguba) • holding: {a.totalHoldingCost}€
                    </div>
                    <div className="text-[9px] text-muted-foreground italic">{a.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.7: Restock Recommendations */}
      {restockData && !restockLoading && (
        <Card className="bg-green-400/5 border-green-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-green-400 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                AI Restock — {restockData.recommendations.length} priporočil, {restockData.totalOpportunities} priložnosti
                <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRestockData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {restockData.recommendations.map((r: any, i: number) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-green-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-green-400 border-green-400/40">{r.category}</Badge>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-primary font-mono font-bold">{r.avgRoi > 0 ? '+' : ''}{r.avgRoi}% ROI</span>
                      <span className="text-muted-foreground">{r.soldCount} prodaj</span>
                      <span className="text-muted-foreground">~{r.avgDaysToSell}d</span>
                      <span className="text-primary font-mono">+{r.avgProfit}€ skupno</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1">{r.reason}</p>
                  <div className="space-y-0.5">
                    {r.opportunities.map((o: any, j: number) => (
                      <a key={j} href={o.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 p-1 hover:bg-card/50 rounded text-[10px]">
                        <span className="truncate flex-1">{o.title}</span>
                        <span className="font-mono text-amber-400 shrink-0">{o.priceText}</span>
                        {o.dealScore != null && <Badge variant="outline" className="text-[8px] text-primary border-primary/40 shrink-0">🎯{o.dealScore}</Badge>}
                        <span className="font-mono text-green-400 shrink-0">+{o.potentialProfit}€</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats overview */}
      {stats && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox
            icon={<Wallet className="w-4 h-4" />}
            label="Realiziran profit"
            value={`${stats.realizedProfit >= 0 ? '+' : ''}${stats.realizedProfit.toFixed(2)} €`}
            color={stats.realizedProfit >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<Target className="w-4 h-4" />}
            label="Povprečni ROI"
            value={`${stats.avgRoiPercent >= 0 ? '+' : ''}${stats.avgRoiPercent}%`}
            color={stats.avgRoiPercent >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<ShoppingCart className="w-4 h-4" />}
            label="V skladišču"
            value={`${stats.heldCount} (${stats.totalInvestedHeld.toFixed(0)} €)`}
            color="text-amber-400"
          />
          <StatBox
            icon={<TrendingUp className="w-4 h-4" />}
            label="Prodani"
            value={`${stats.soldCount} (${stats.totalRealizedRevenue.toFixed(0)} €)`}
            color="text-primary"
          />
        </div>

        {/* v3.8: Profit chart */}
        {stats.byMonth.some(m => m.count > 0) && (
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Profit po mesecih
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={stats.byMonth}>
                  <defs>
                    <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                  <RTooltip
                    contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                    labelStyle={{ color: '#d4d4d4' }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} €`, 'Profit']}
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="#4ade80"
                    strokeWidth={2}
                    fill="url(#profitGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* v3.8: Profit by category */}
        {stats.byCategory.length > 0 && (
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Profit po kategorijah
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.byCategory
                  .sort((a, b) => b.profit - a.profit)
                  .map(cat => (
                    <div key={cat.category} className="flex items-center justify-between p-2 bg-background/30 rounded text-xs">
                      <div>
                        <div className="font-medium">{cat.category || 'brez kategorije'}</div>
                        <div className="text-[10px] text-muted-foreground">{cat.count} tradev • {cat.invested.toFixed(0)}€ investirano</div>
                      </div>
                      <div className={cn('font-bold font-mono', cat.profit >= 0 ? 'text-primary' : 'text-destructive')}>
                        {cat.profit >= 0 ? '+' : ''}{cat.profit.toFixed(2)} €
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
        </>
      )}

        {/* v4.1: This month P&L card + v4.2: Goal progress */}
        {stats.byMonth.length > 0 && (() => {
          const now = new Date();
          const thisMonthKey = now.toISOString().slice(0, 7);
          const lastMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
          const thisMonth = stats.byMonth.find(m => m.month === thisMonthKey);
          const lastMonth = stats.byMonth.find(m => m.month === lastMonthKey);
          const monthName = now.toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });
          return (
            <Card className={cn(
              'bg-card/50 border',
              (thisMonth?.profit ?? 0) >= 0 ? 'border-primary/20' : 'border-destructive/20'
            )}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ta mesec — {monthName}</p>
                    <p className={cn(
                      'text-2xl font-bold font-mono mt-1',
                      (thisMonth?.profit ?? 0) >= 0 ? 'text-primary terminal-glow' : 'text-destructive'
                    )}>
                      {(thisMonth?.profit ?? 0) >= 0 ? '+' : ''}{(thisMonth?.profit ?? 0).toFixed(2)} €
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {thisMonth?.count ?? 0} prodanih tradev
                      {lastMonth && (
                        <span className="ml-2">
                          • Prejšnji mesec: {lastMonth.profit >= 0 ? '+' : ''}{lastMonth.profit.toFixed(2)} €
                          {thisMonth && lastMonth.profit !== 0 && thisMonth.profit !== 0 && (
                            <span className={cn(
                              'ml-1 font-bold',
                              thisMonth.profit > lastMonth.profit ? 'text-primary' : 'text-destructive'
                            )}>
                              ({thisMonth.profit > lastMonth.profit ? '↑' : '↓'} {Math.abs(thisMonth.profit - lastMonth.profit).toFixed(2)} €)
                            </span>
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                  <TrendingUp className={cn('w-8 h-8', (thisMonth?.profit ?? 0) >= 0 ? 'text-primary' : 'text-destructive')} />
                </div>
                {/* v4.2: Goal progress bar */}
                {stats.monthlyGoal > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground uppercase tracking-wider">Cilj: {stats.monthlyGoal}€</span>
                      <span className={cn('font-bold', stats.goalProgress >= 100 ? 'text-primary' : 'text-amber-400')}>
                        {stats.goalProgress}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          stats.goalProgress >= 100 ? 'bg-primary' :
                          stats.goalProgress >= 50 ? 'bg-primary/70' : 'bg-amber-400/70'
                        )}
                        style={{ width: `${Math.min(100, stats.goalProgress)}%` }}
                      />
                    </div>
                    {stats.goalProgress >= 100 ? (
                      <p className="text-[10px] text-primary mt-1">🎉 Cilj dosežen!</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Še {(stats.monthlyGoal - stats.thisMonthProfit).toFixed(2)}€ do cilja
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* v4.3: Cumulative profit timeline */}
        {stats.byMonth.some(m => m.count > 0) && (() => {
          let cumulative = 0;
          const cumulativeData = stats.byMonth.map(m => {
            cumulative += m.profit;
            return { month: m.month, cumulative: Math.round(cumulative * 100) / 100, monthly: m.profit };
          });
          return (
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Kumulativni profit (zadnjih 12 mesecev)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <RTooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                      formatter={(value: any, name: any) => [
                        `${Number(value).toFixed(2)} €`,
                        name === 'cumulative' ? 'Kumulativno' : 'Mesečno'
                      ]}
                    />
                    <Line type="monotone" dataKey="cumulative" stroke="#4ade80" strokeWidth={2} dot={{ fill: '#4ade80', r: 3 }} />
                    <Line type="monotone" dataKey="monthly" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block" /> Kumulativni profit</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" style={{borderTop: '1px dashed'}} /> Mesečni profit</span>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'held', 'sold', 'cancelled'].map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className={cn('h-7 text-xs uppercase', filter === f && 'bg-primary text-primary-foreground')}
          >
            {f === 'all' ? 'Vsi' : f === 'held' ? 'V skladišču' : f === 'sold' ? 'Prodani' : 'Preklicani'}
          </Button>
        ))}
      </div>

      {/* Trades list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-card animate-pulse rounded" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Še ni tradov. Dodaj prvi trade z gumbom "Nov trade".</p>
            <p className="text-xs text-muted-foreground mt-1">Ko v Listings klikneš "Kupi", se bo samodejno dodal sem.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* v5.7: Bulk trade toolbar */}
          {bulkTradeIds.size > 0 && (
            <Card className="bg-primary/5 border-primary/30">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-medium text-primary">{bulkTradeIds.size} izbranih</span>
                  <Input
                    type="number"
                    value={bulkSellPrice}
                    onChange={(e) => setBulkSellPrice(e.target.value)}
                    placeholder="Prodajna cena (€)"
                    className="h-7 w-32 text-xs font-mono"
                  />
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={bulkSell} disabled={bulkTradeLoading}>
                    {bulkTradeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                    Prodaj vse
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={bulkCategorize} disabled={bulkTradeLoading}>
                    <Tag className="w-3 h-3" /> Kategoriziraj
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-500" onClick={bulkDelete} disabled={bulkTradeLoading}>
                    <Trash2 className="w-3 h-3" /> Izbriši
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkTradeIds(new Set())}>
                    Počisti
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {filtered.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bulkTradeIds.has(t.id)}
                onChange={() => toggleBulkTrade(t.id)}
                className="w-4 h-4 rounded border-border shrink-0"
              />
              <div className="flex-1 min-w-0">
                <TradeRow trade={t} onEdit={() => { setEditing(t); setShowForm(true); }} onDelete={() => deleteTrade(t)} onSync={async (tradeId) => {
                  setSyncLoading(tradeId);
                  try {
                    const res = await fetch('/api/trades/sync-listing', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tradeId, platforms: ['bolha', 'vinted'] }),
                    });
                    const data = await res.json();
                    if (data.ok) { setSyncData(data); toast.success(`✓ ${data.listings.length} platformnih oglasov generiranih`); }
                    else toast.error(data.error ?? 'Napaka');
                  } catch { toast.error('Napaka'); }
                  finally { setSyncLoading(null); }
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <TradeFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} onSaved={() => { setShowForm(false); load(); }} />
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Card className="bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={color}>{icon}</span>
        </div>
        <div className={cn('text-lg font-bold font-mono', color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade, onEdit, onDelete, onSync }: { trade: Trade; onEdit: () => void; onDelete: () => void; onSync?: (tradeId: string) => void }) {
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
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeFormDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Trade | null; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('elektronika');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [buyLocation, setBuyLocation] = useState('Bolha');
  const [buyFees, setBuyFees] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState('');
  const [sellLocation, setSellLocation] = useState('');
  const [sellFees, setSellFees] = useState('');
  const [status, setStatus] = useState('held');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setCategory(editing.category || 'elektronika');
      setBuyPrice(String(editing.buyPrice));
      setBuyDate(editing.buyDate ? new Date(editing.buyDate).toISOString().slice(0, 10) : '');
      setBuyLocation(editing.buyLocation || 'Bolha');
      setBuyFees(String(editing.buyFees || ''));
      setSellPrice(editing.sellPrice != null ? String(editing.sellPrice) : '');
      setSellDate(editing.sellDate ? new Date(editing.sellDate).toISOString().slice(0, 10) : '');
      setSellLocation(editing.sellLocation || '');
      setSellFees(String(editing.sellFees || ''));
      setStatus(editing.status);
      setNotes(editing.notes);
    } else {
      setTitle(''); setCategory('elektronika'); setBuyPrice('');
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyLocation('Bolha'); setBuyFees('');
      setSellPrice(''); setSellDate(''); setSellLocation(''); setSellFees('');
      setStatus('held'); setNotes('');
    }
  }, [editing, open]);

  const save = async () => {
    if (!title.trim() || !buyPrice) {
      toast.error('Ime in kupna cena sta obvezna');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        category,
        buyPrice: parseFloat(buyPrice),
        buyDate: buyDate ? new Date(buyDate).toISOString() : undefined,
        buyLocation: buyLocation.trim(),
        buyFees: buyFees ? parseFloat(buyFees) : 0,
        sellPrice: sellPrice ? parseFloat(sellPrice) : null,
        sellDate: sellDate ? new Date(sellDate).toISOString() : null,
        sellLocation: sellLocation.trim(),
        sellFees: sellFees ? parseFloat(sellFees) : 0,
        status,
        notes: notes.trim(),
      };
      const res = await fetch(
        editing ? `/api/trades/${editing.id}` : '/api/trades',
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error();
      toast.success(editing ? 'Trade posodobljen' : 'Trade dodan');
      onSaved();
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Uredi trade' : 'Nov trade'}</DialogTitle>
          <DialogDescription>Sledi nakup, morebitno prodajo in profit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs uppercase">Ime artikla *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="npr. iPhone 13 Pro 256GB" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase">Kategorija</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="held">V skladišču</SelectItem>
                  <SelectItem value="sold">Prodano</SelectItem>
                  <SelectItem value="cancelled">Preklicano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-amber-400 mb-2">Kupna stran</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Kupna cena (€) *</Label>
                <Input type="number" step="0.01" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum nakupa</Label>
                <Input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija nakupa</Label>
                <Input value={buyLocation} onChange={e => setBuyLocation(e.target.value)} placeholder="Bolha, FB, trgovina" className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine nakupa (€)</Label>
                <Input type="number" step="0.01" value={buyFees} onChange={e => setBuyFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-primary mb-2">Prodajna stran (izpolni ob prodaji)</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Prodajna cena (€)</Label>
                <Input type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="prazno = ni še prodano" className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum prodaje</Label>
                <Input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija prodaje</Label>
                <Input value={sellLocation} onChange={e => setSellLocation(e.target.value)} placeholder="Bolha, FB..." className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine prodaje (€)</Label>
                <Input type="number" step="0.01" value={sellFees} onChange={e => setSellFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase">Opombe</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Stanje, dodatna oprema, kontakt prodajalca..." className="mt-1 text-xs min-h-[60px]" />
          </div>
          {buyPrice && sellPrice && (
            <div className="bg-primary/5 border border-primary/30 rounded p-3 text-sm">
              <span className="text-muted-foreground">Profit: </span>
              <span className="text-primary font-bold">
                +{(parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)).toFixed(2)} €
              </span>
              <span className="text-muted-foreground ml-2">ROI: </span>
              <span className="text-primary font-bold">
                {(((parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)) / parseFloat(buyPrice)) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Shrani' : 'Dodaj trade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
