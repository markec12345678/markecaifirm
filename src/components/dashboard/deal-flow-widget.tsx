'use client';
/** v7.32: Deal Flow Widget — ROI, win rate, money velocity, pipeline. */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Target, Zap, DollarSign, Package, Trophy, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings';

interface Metrics {
  roi: number; winRate: number; avgMargin: number; avgHoldDays: number; moneyVelocity: number;
  pipeline: { heldCount: number; heldValue: number; estProfit: number };
  cashFlow: { last30d: number; last90d: number; ytd: number };
  topCategories: Array<{ category: string; roi: number; profit: number; count: number }>;
}

export function DealFlowWidget({ onNavigate }: { onNavigate?: (v: View) => void }) {
  const [data, setData] = useState<{ ok: boolean; metrics: Metrics; totals?: { soldCount: number; totalProfit: number }; message?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => { try { const r = await fetch('/api/trades/deal-flow'); if (!cancelled && r.ok) setData(await r.json()); } catch { /* */ } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Card className="border-primary/20"><CardContent className="p-4 text-xs text-muted-foreground">Nalagam metrike...</CardContent></Card>;

  if (!data || !data.metrics || data.totals?.soldCount === 0) {
    return <Card className="border-primary/20"><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> DEAL FLOW</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground mb-2">{data?.message || 'Ni prodaj za analizo.'}</p>{onNavigate && <button onClick={() => onNavigate('trades')} className="text-xs text-primary hover:underline flex items-center gap-1">Dodaj prvo prodajo <ArrowUpRight className="w-3 h-3" /></button>}</CardContent></Card>;
  }

  const m = data.metrics;
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> DEAL FLOW</CardTitle><Badge variant="outline" className="text-[10px]">{data.totals?.soldCount ?? 0} prodaj</Badge></div></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Metric icon={<TrendingUp className="w-3 h-3" />} label="ROI" value={`${m.roi >= 0 ? '+' : ''}${m.roi}%`} positive={m.roi >= 0} />
          <Metric icon={<Target className="w-3 h-3" />} label="Win rate" value={`${m.winRate}%`} positive={m.winRate >= 50} />
          <Metric icon={<DollarSign className="w-3 h-3" />} label="Avg margin" value={`${m.avgMargin >= 0 ? '+' : ''}${m.avgMargin}€`} positive={m.avgMargin >= 0} />
          <Metric icon={<Zap className="w-3 h-3" />} label="Velocity" value={`${m.moneyVelocity}×/leto`} positive={m.moneyVelocity >= 4} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-background/30 rounded p-2"><div className="flex items-center gap-1 text-muted-foreground mb-1"><Package className="w-3 h-3" /><span className="uppercase text-[10px]">Pipeline</span></div><div className="font-mono font-bold text-amber-400">{m.pipeline.heldValue}€</div><div className="text-[10px] text-muted-foreground mt-0.5">{m.pipeline.heldCount} held • est. +{m.pipeline.estProfit}€</div></div>
          <div className="bg-background/30 rounded p-2"><div className="flex items-center gap-1 text-muted-foreground mb-1"><DollarSign className="w-3 h-3" /><span className="uppercase text-[10px]">Cash flow</span></div><div className={cn('font-mono font-bold', m.cashFlow.last30d >= 0 ? 'text-primary' : 'text-red-500')}>{m.cashFlow.last30d >= 0 ? '+' : ''}{m.cashFlow.last30d}€</div><div className="text-[10px] text-muted-foreground mt-0.5">30d • YTD: {m.cashFlow.ytd >= 0 ? '+' : ''}{m.cashFlow.ytd}€</div></div>
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center justify-between"><span>⏱ Hold: <span className="font-mono text-foreground">{m.avgHoldDays} dni</span></span><span>💰 Profit: <span className={cn('font-mono font-bold', (data.totals?.totalProfit ?? 0) >= 0 ? 'text-primary' : 'text-red-500')}>{data.totals?.totalProfit ?? 0}€</span></span></div>
        {Array.isArray(m.topCategories) && m.topCategories.length > 0 && (
          <div className="pt-2 border-t border-border/50"><div className="flex items-center gap-1 mb-1.5"><Trophy className="w-3 h-3 text-amber-400" /><span className="uppercase text-[10px] text-muted-foreground">Top kategorije</span></div><div className="space-y-1">{m.topCategories.slice(0, 3).map((c, i) => (<div key={i} className="flex items-center justify-between text-xs"><span className="truncate">{c.category}</span><span className={cn('font-mono', c.profit >= 0 ? 'text-primary' : 'text-red-500')}>{c.profit >= 0 ? '+' : ''}{c.profit}€<span className="text-muted-foreground ml-1">({c.count}×, {c.roi >= 0 ? '+' : ''}{c.roi}%)</span></span></div>))}</div></div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, value, positive }: { icon: React.ReactNode; label: string; value: string; positive: boolean }) {
  return <div className="bg-background/30 rounded p-2 text-center"><div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">{icon}<span className="uppercase text-[10px]">{label}</span></div><div className={cn('font-mono font-bold text-sm', positive ? 'text-primary' : 'text-red-500')}>{value}</div></div>;
}
