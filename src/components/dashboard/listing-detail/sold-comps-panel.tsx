'use client';

/**
 * v7.37/v9.71: SoldCompsPanel — poenostavljen za navadnega uporabnika.
 *
 * VSE funkcije ostanejo — samo prikaz je enostavnejši:
 *
 * 1. GLAVNA POVED (vedno vidna):
 *    "✅ KUPUJ! Podobni artikli se prodajo za ~65€. Ti plačaš 30€ = +35€ dobička."
 *    ali "✗ PREDRAGO. Podobni se prodajo za ~65€, ta stane 80€."
 *    ali "○ Še nimaš dovolj podatkov o prodajah podobnih artiklov."
 *
 * 2. ENOSTAVEN PRIKAZ (vedno vidna):
 *    ∼65€  povprečna prodajna cena
 *    30€   ta oglas
 *    +35€  dobiček
 *
 * 3. PODROBNOSTI (collapsible "Prikaži podrobnosti ▼"):
 *    - Vsi comps (title, cena, datum)
 *    - Market stats (min/avg/max/days to sell)
 *    - Confidence %
 *    - Risk factors
 *    - AI recommendation
 *
 * Avtomatsko fetch-a ko se odpre (ne čaka na gumb).
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Target, DollarSign, Sparkles, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SoldCompsData {
  ok: boolean;
  fairMarketValue: number;
  confidence: number;
  marginEur: number;
  marginPct: number;
  isRealDeal: boolean;
  marketStats: {
    avgSoldPriceEur: number;
    minSoldPriceEur: number;
    maxSoldPriceEur: number;
    sampleSize: number;
    avgDaysToSell: number;
  };
  comps: Array<{ title: string; soldPriceEur: number; daysAgo: number; similarity: number; platform: string }>;
  recommendation: string;
  riskFactors: string[];
}

export function SoldCompsPanel({ listingId, title, askingPrice }: {
  listingId: string;
  title: string;
  askingPrice: number | null;
}) {
  const [data, setData] = useState<SoldCompsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Auto-fetch ko se odpre
  useEffect(() => {
    fetchComps();
  }, []);

  async function fetchComps() {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics/sold-comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, askingPrice }),
      });
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // silent — ne moti uporabnika z error toast
    } finally {
      setLoading(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GLAVNA POVED — eno jasno sporočilo za navadnega uporabnika
  // ═══════════════════════════════════════════════════════════════════════
  function getMainMessage(): { icon: string; text: string; color: string } {
    if (!data) return { icon: '⏳', text: 'Preverjam prodajne cene...', color: 'text-muted-foreground' };

    const noComps = !data.comps || data.comps.length === 0;

    if (noComps) {
      return {
        icon: '○',
        text: 'Še nimaš dovolj podatkov o prodajah podobnih artiklov. Dodaj več trgovin za boljše napovedi.',
        color: 'text-muted-foreground',
      };
    }

    const avg = data.fairMarketValue;
    const price = askingPrice ?? 0;
    const margin = data.marginEur;

    if (data.isRealDeal && margin > 0) {
      return {
        icon: '✅',
        text: `KUPUJ! Podobni artikli se prodajo za ~${avg}€. Ti plačaš ${price}€ = +${margin}€ dobička.`,
        color: 'text-emerald-500',
      };
    }

    if (margin < 0) {
      return {
        icon: '✗',
        text: `PREDRAGO. Podobni artikli se prodajo za ~${avg}€, ampak ta stane ${price}€.`,
        color: 'text-red-500',
      };
    }

    if (margin > 0 && margin < 20) {
      return {
        icon: '△',
        text: `MEJNO. Podobni se prodajo za ~${avg}€. Dobiček ${margin}€ je majhen.`,
        color: 'text-amber-500',
      };
    }

    return {
      icon: '○',
      text: `Podobni artikli se prodajo za ~${avg}€.`,
      color: 'text-muted-foreground',
    };
  }

  const mainMessage = getMainMessage();

  return (
    <Card className={cn(
      'border',
      data?.isRealDeal ? 'border-emerald-500/30' : data?.comps?.length ? 'border-red-500/30' : 'border-border'
    )}>
      <CardContent className="p-3 space-y-2">
        {/* ═══ ENOSTAVEN NASLOV ═══ */}
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs uppercase tracking-wider text-primary font-bold">
            ZaNKolikoSeProdaja
          </span>
          {data && data.comps?.length > 0 && (
            <Badge variant="outline" className="text-[9px] ml-auto">
              {data.comps.length} {data.comps.length === 1 ? 'prodaja' : 'prodaje'}
            </Badge>
          )}
        </div>

        {/* ═══ GLAVNA POVED — velika in jasna ═══ */}
        <div className={cn('text-sm font-medium leading-relaxed', mainMessage.color)}>
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              Preverjam prodajne cene...
            </span>
          ) : (
            <span>{mainMessage.icon} {mainMessage.text}</span>
          )}
        </div>

        {/* ═══ ENOSTAVEN PRIKAZ — 3 številke ═══ */}
        {data && data.comps?.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {/* Povprečna prodajna cena */}
            <div className="text-center p-2 rounded bg-background/40 border border-border">
              <div className="text-[9px] uppercase text-muted-foreground">Se prodaja za</div>
              <div className="text-lg font-bold text-emerald-500">~{data.fairMarketValue}€</div>
            </div>
            {/* Ta oglas */}
            <div className="text-center p-2 rounded bg-background/40 border border-border">
              <div className="text-[9px] uppercase text-muted-foreground">Ta oglas</div>
              <div className="text-lg font-bold text-foreground">{askingPrice ?? '?'}€</div>
            </div>
            {/* Dobiček */}
            <div className="text-center p-2 rounded bg-background/40 border border-border">
              <div className="text-[9px] uppercase text-muted-foreground">Dobiček</div>
              <div className={cn(
                'text-lg font-bold',
                data.marginEur > 0 ? 'text-emerald-500' : data.marginEur < 0 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {data.marginEur > 0 ? '+' : ''}{data.marginEur}€
              </div>
            </div>
          </div>
        )}

        {/* ═══ PODROBNOSTI — collapsible ═══ */}
        {data && data.comps?.length > 0 && (
          <>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-between pt-1"
            >
              <span>{showDetails ? 'Skrij podrobnosti' : 'Prikaži podrobnosti'}</span>
              {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            {showDetails && (
              <div className="space-y-2 pt-1 border-t border-border/50">
                {/* Comps list */}
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase font-bold">
                    Podobni prodani artikli ({data.comps.length})
                  </div>
                  {data.comps.slice(0, 8).map((comp, i) => (
                    <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-background/30 rounded">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{comp.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {comp.daysAgo}d nazaj · {comp.platform}
                        </div>
                      </div>
                      <div className="font-mono font-bold shrink-0 ml-2 text-emerald-500">
                        {comp.soldPriceEur}€
                      </div>
                    </div>
                  ))}
                </div>

                {/* Market stats grid */}
                <div className="grid grid-cols-4 gap-1 text-xs">
                  <div className="bg-background/30 rounded p-1 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Min</div>
                    <div className="font-mono font-bold text-green-500">{data.marketStats.minSoldPriceEur}€</div>
                  </div>
                  <div className="bg-background/30 rounded p-1 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Ø</div>
                    <div className="font-mono font-bold">{data.marketStats.avgSoldPriceEur}€</div>
                  </div>
                  <div className="bg-background/30 rounded p-1 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Max</div>
                    <div className="font-mono font-bold text-red-500">{data.marketStats.maxSoldPriceEur}€</div>
                  </div>
                  <div className="bg-background/30 rounded p-1 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">Čas</div>
                    <div className="font-mono font-bold">{data.marketStats.avgDaysToSell}d</div>
                  </div>
                </div>

                {/* AI recommendation */}
                <div className={cn(
                  'p-2 rounded text-xs flex items-start gap-1.5',
                  data.isRealDeal ? 'bg-emerald-500/10' : 'bg-red-500/10'
                )}>
                  {data.isRealDeal
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  }
                  <span className="text-muted-foreground">{data.recommendation}</span>
                </div>

                {/* Confidence */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Zaupanje v oceno</span>
                  <span className="font-bold">{data.confidence}%</span>
                </div>

                {/* Risk factors */}
                {data.riskFactors.length > 0 && (
                  <div className="space-y-0.5">
                    {data.riskFactors.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px]">
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                <Button onClick={fetchComps} variant="ghost" size="sm" className="w-full text-xs">
                  ↻ Osveži
                </Button>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {data && (!data.comps || data.comps.length === 0) && !loading && (
          <div className="text-center py-3">
            <Button onClick={fetchComps} variant="ghost" size="sm" className="text-xs">
              ↻ Poskusi znova
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
