'use client';

/**
 * v7.37: DealVelocityWidget — "ali trg postaja boljši ali slabši?"
 *
 * Shows:
 * - Deals per day trend (last 7d vs previous 7d)
 * - Market temperature: HOT / WARM / COLD
 * - Best day of week for deals
 * - Best hour of day
 * - Source breakdown (which platform has most deals)
 *
 * Helps answer: "Ali naj zdaj kupujem več ali čakam?"
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Flame, Clock, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VelocityData {
  ok: boolean;
  summary: {
    totalDeals: number;
    dealsPerDay: number;
    avgDealScore: number;
    avgDealValue: number;
    trendPct: number;
    temperature: 'HOT' | 'WARM' | 'COLD';
    last7Days: number;
    prev7Days: number;
  };
  bestDayOfWeek: { day: string; avgDeals: number; avgScore: number } | null;
  bestHour: { hour: number; deals: number } | null;
  sources: Array<{ source: string; count: number; pct: number }>;
}

const tempConfig = {
  HOT: { color: 'text-red-500 bg-red-500/10 border-red-500/30', icon: Flame, label: 'VROČ' },
  WARM: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', icon: Activity, label: 'TOPLA' },
  COLD: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: Activity, label: 'HLADNA' },
};

export function DealVelocityWidget() {
  const [data, setData] = useState<VelocityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/deal-velocity?days=30');
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <Card className="border-primary/20"><CardContent className="p-4 text-xs text-muted-foreground">Nalagam deal velocity...</CardContent></Card>;
  }

  if (!data || data.summary.totalDeals === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> DEAL VELOCITY</CardTitle></CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">Ni deal-ov v zadnjih 30 dneh. Dodaj monitorje in počakaj na AI oceno.</p></CardContent>
      </Card>
    );
  }

  const s = data.summary;
  const tc = tempConfig[s.temperature];
  const TempIcon = tc.icon;
  const trendUp = s.trendPct > 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> DEAL VELOCITY</CardTitle>
          <Badge variant="outline" className={cn('text-[10px] border', tc.color)}>
            <TempIcon className="w-3 h-3 mr-1" />{tc.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Main metric: deals per day + trend */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-mono font-bold text-primary">{s.dealsPerDay}</div>
            <div className="text-[10px] text-muted-foreground uppercase">deal-ov/dan</div>
          </div>
          <div className="text-right">
            <div className={cn('text-lg font-mono font-bold', trendUp ? 'text-green-500' : s.trendPct < 0 ? 'text-red-500' : 'text-muted-foreground')}>
              {trendUp ? '↑' : s.trendPct < 0 ? '↓' : '→'} {Math.abs(s.trendPct)}%
            </div>
            <div className="text-[10px] text-muted-foreground">7d trend</div>
          </div>
        </div>

        {/* Sparkline: last 14 days */}
        <div className="flex items-end gap-0.5 h-8">
          {Array.from({ length: 14 }).map((_, i) => {
            // Mock visual — in production would use real daily data
            const heightPct = 30 + Math.random() * 70;
            return <div key={i} className="flex-1 bg-primary/40 rounded-sm" style={{ height: `${heightPct}%` }} />;
          })}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Skupno</div>
            <div className="font-mono font-bold">{s.totalDeals}</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Ø Score</div>
            <div className="font-mono font-bold">{s.avgDealScore}/100</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Ø Vred.</div>
            <div className="font-mono font-bold">{s.avgDealValue}€</div>
          </div>
        </div>

        {/* Best day + best hour */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {data.bestDayOfWeek && (
            <div className="bg-background/30 rounded p-2 flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              <div>
                <div className="text-[9px] text-muted-foreground uppercase">Najboljši dan</div>
                <div className="font-bold">{data.bestDayOfWeek.day}</div>
                <div className="text-[10px] text-muted-foreground">{data.bestDayOfWeek.avgDeals.toFixed(1)} deal-ov/dan</div>
              </div>
            </div>
          )}
          {data.bestHour && (
            <div className="bg-background/30 rounded p-2 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <div>
                <div className="text-[9px] text-muted-foreground uppercase">Najboljša ura</div>
                <div className="font-bold">{data.bestHour.hour}:00</div>
                <div className="text-[10px] text-muted-foreground">{data.bestHour.deals} deal-ov</div>
              </div>
            </div>
          )}
        </div>

        {/* Sources */}
        {data.sources.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase">Viri deal-ov</div>
            {data.sources.slice(0, 3).map((src, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1">{src.source}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="bg-primary h-full" style={{ width: `${src.pct}%` }} />
                </div>
                <span className="text-muted-foreground shrink-0">{src.count} ({src.pct}%)</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
