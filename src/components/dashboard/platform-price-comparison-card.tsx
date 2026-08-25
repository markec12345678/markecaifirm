'use client';

// v8.74: Cross-Platform Price Comparison Card
// "iPhone je na Bolha avg 450€, na Quoka avg 380€ — razlika 70€ (16%)"

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Globe, RefreshCw, TrendingDown, TrendingUp, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlatformPrice {
  source: string;
  label: string;
  icon: string;
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  stdDev: number;
  cheapestListing: { title: string; price: number } | null;
}

interface CrossPlatformData {
  ok: boolean;
  totalListings: number;
  totalPlatforms: number;
  platforms: PlatformPrice[];
  overallAvgPrice: number;
  cheapestPlatform: PlatformPrice | null;
  expensivePlatform: PlatformPrice | null;
  priceGap: number;
  priceGapPercent: number;
  days: number;
}

export function PlatformPriceComparisonCard() {
  const [data, setData] = useState<CrossPlatformData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: '30' });
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`/api/analytics/cross-platform-prices?${params.toString()}`);
      const d = await res.json();
      if (d.ok) {
        setData(d);
        setSearched(true);
      } else {
        setError(d.error || 'Napaka');
      }
    } catch {
      setError('Napaka pri nalaganju');
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" /> 🌍 Cross-Platform Price Comparison
          </span>
          {data && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search input */}
        <div className="flex gap-2">
          <Input
            placeholder="Vnesi artikel (npr. iPhone, Golf, MacBook)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" onClick={fetchData} disabled={loading} className="h-8 text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90">
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Primerjaj
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-red-500">{error}</div>
        )}

        {/* No data yet */}
        {!data && !loading && !searched && (
          <div className="text-center py-4">
            <Globe className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">
              Vnesi artikel in klikni "Primerjaj" za primerjavo cen med platformami.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          </div>
        )}

        {/* Results */}
        {data && !loading && data.totalPlatforms > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-emerald-500" /> Najcenejša platforma
                </div>
                <div className="text-sm font-bold">
                  {data.cheapestPlatform?.icon} {data.cheapestPlatform?.label}
                </div>
                <div className="text-[11px] text-emerald-600 font-mono">
                  avg {data.cheapestPlatform?.avgPrice}€ · {data.cheapestPlatform?.count} oglasov
                </div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-red-500" /> Najdražja platforma
                </div>
                <div className="text-sm font-bold">
                  {data.expensivePlatform?.icon} {data.expensivePlatform?.label}
                </div>
                <div className="text-[11px] text-red-500 font-mono">
                  avg {data.expensivePlatform?.avgPrice}€ · {data.expensivePlatform?.count} oglasov
                </div>
              </div>
            </div>

            {/* Price gap */}
            {data.priceGap > 0 && (
              <div className="bg-primary/5 border border-primary/30 rounded-lg p-2 text-center">
                <span className="text-[10px] uppercase text-muted-foreground">Razlika v ceni</span>
                <div className="text-lg font-bold text-primary font-mono">
                  {data.priceGap}€ ({data.priceGapPercent}%)
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Prihranek če kupiš na najcenejši platformi
                </div>
              </div>
            )}

            {/* Platform comparison table */}
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">
                {data.totalListings} oglasov na {data.totalPlatforms} platformah (zadnjih {data.days} dni)
              </div>
              {data.platforms.map((p, i) => (
                <div
                  key={p.source}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-md border text-xs',
                    i === 0
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : i === data.platforms.length - 1
                        ? 'bg-red-500/5 border-red-500/30'
                        : 'bg-card border-border'
                  )}
                >
                  <span className="text-base shrink-0">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.count} oglasov · min {p.minPrice}€ · max {p.maxPrice}€
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold font-mono">{p.avgPrice}€</div>
                    <div className="text-[9px] text-muted-foreground">median {p.medianPrice}€</div>
                  </div>
                  {i === 0 && <Badge variant="outline" className="text-[8px] border-emerald-500/40 text-emerald-500 shrink-0">NAJCENEJŠI</Badge>}
                  {i === data.platforms.length - 1 && data.platforms.length > 1 && (
                    <Badge variant="outline" className="text-[8px] border-red-500/40 text-red-500 shrink-0">NAJDRAŽJI</Badge>
                  )}
                </div>
              ))}
            </div>

            {/* Cheapest listing per platform */}
            {data.cheapestPlatform?.cheapestListing && (
              <div className="bg-muted/20 rounded-lg p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                  🏆 Najcenejši oglas na {data.cheapestPlatform.label}
                </div>
                <div className="text-xs font-medium truncate">
                  {data.cheapestPlatform.cheapestListing.title}
                </div>
                <div className="text-sm font-bold text-emerald-500 font-mono">
                  {data.cheapestPlatform.cheapestListing.price}€
                </div>
              </div>
            )}
          </>
        )}

        {/* No results */}
        {data && !loading && data.totalPlatforms === 0 && (
          <div className="text-center py-4">
            <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">
              Ni najdenih oglasov za "{query}" v zadnjih {data.days} dneh.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
