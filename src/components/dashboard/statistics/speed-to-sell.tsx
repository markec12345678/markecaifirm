'use client';

// v9.01: Extracted from statistics-view.tsx — Speed-to-Sell Analytics (v6.4)

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SpeedToSell() {
  // v6.4: Speed-to-Sell
  const [speedData, setSpeedData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/stats/speed-to-sell').then(r => r.ok ? r.json() : null).then(d => d && setSpeedData(d)).catch(() => {});
  }, []);

  return (
    <>
      {/* v6.4: Speed-to-Sell Analytics */}
      {speedData?.overall && (
        <Card className="bg-card/50 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Hitrost prodaje (Speed-to-Sell)
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.4</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Povprečni čas prodaje po kategorijah in cenovnih rangih.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Overall stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Povp. dni</div>
                  <div className="font-mono font-bold text-primary text-lg">{speedData.overall.avgDays}</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Mediana</div>
                  <div className="font-mono font-bold">{speedData.overall.medianDays}d</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Min-Max</div>
                  <div className="font-mono text-[10px]">{speedData.overall.minDays}-{speedData.overall.maxDays}d</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">⚡ Hitre (&lt;7d)</div>
                  <div className="font-mono font-bold text-primary">{speedData.overall.fastFlips}</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">🔴 Počasne (&gt;30d)</div>
                  <div className="font-mono font-bold text-red-500">{speedData.overall.slowFlips}</div>
                </div>
              </div>

              {/* Fastest / Slowest */}
              {speedData.fastestCategory && speedData.slowestCategory && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                    <span className="text-primary font-bold">⚡ Najhitrejša: </span>
                    {speedData.fastestCategory.category} ({speedData.fastestCategory.avgDays}d povp)
                  </div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-xs">
                    <span className="text-red-500 font-bold">🔴 Najpočasnejša: </span>
                    {speedData.slowestCategory.category} ({speedData.slowestCategory.avgDays}d povp)
                  </div>
                </div>
              )}

              {/* By category */}
              {speedData.byCategory?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Po kategorijah</div>
                  <div className="space-y-1">
                    {speedData.byCategory.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-[11px]">
                        <Badge variant="outline" className="text-[9px] shrink-0">{c.category}</Badge>
                        <span className="font-mono font-bold w-12">{c.avgDays}d</span>
                        <span className="text-muted-foreground">{c.count} prodaj</span>
                        <span className={cn('font-mono', c.avgMargin > 0 ? 'text-primary' : 'text-red-500')}>
                          {c.avgMargin > 0 ? '+' : ''}{c.avgMargin}% marža
                        </span>
                        <span className="text-[9px] text-muted-foreground shrink-0">{c.speedLabel}</span>
                        {c.fastFlips > 0 && <Badge variant="outline" className="text-[8px] text-primary border-primary/40">⚡{c.fastFlips}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By price range */}
              {speedData.byPriceRange?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Po cenovnem rangu</div>
                  <div className="grid grid-cols-5 gap-1">
                    {speedData.byPriceRange.map((r: any, i: number) => (
                      <div key={i} className="bg-background/30 rounded p-1.5 text-center text-[10px]">
                        <div className="text-muted-foreground">{r.label}</div>
                        {r.count > 0 ? (
                          <>
                            <div className="font-mono font-bold">{r.avgDays}d</div>
                            <div className={cn('text-[9px]', r.avgMargin! > 0 ? 'text-primary' : 'text-red-500')}>
                              {r.avgMargin! > 0 ? '+' : ''}{r.avgMargin}%
                            </div>
                            <div className="text-[8px] text-muted-foreground">{r.count} prodaj</div>
                          </>
                        ) : (
                          <div className="text-muted-foreground">—</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
