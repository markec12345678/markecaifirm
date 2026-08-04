'use client';

/**
 * v7.34: SellerIntelligencePanel — is this seller trustworthy?
 *
 * Shows:
 * - Seller reputation score (0-100)
 * - Total listings, avg price, categories
 * - AI verdict distribution (PRILIKA / SUMNJIVO / NEZANIMIVO)
 * - Risk level: LOW / MEDIUM / HIGH
 * - Trust factors (green flags + red flags)
 *
 * Helps decide: "Should I buy from this seller?"
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Shield, AlertTriangle, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SellerProfile {
  ok: boolean;
  seller: {
    name: string;
    totalListings: number;
    activeListings: number;
    avgPriceEur: number;
    minPrice: number;
    maxPrice: number;
    categories: string[];
    locations: string[];
    sources: string[];
    firstSeenAt: string;
    lastSeenAt: string;
    daysActive: number;
  };
  reputation: {
    score: number;
    level: 'platinum' | 'gold' | 'silver' | 'bronze' | 'risky' | 'unknown';
    riskLevel: 'low' | 'medium' | 'high';
  };
  aiDistribution: {
    prilika: number;
    sumnjivo: number;
    nezanimivo: number;
    unevaluated: number;
  };
  trustFactors: {
    green: string[];
    red: string[];
  };
  summary: string;
}

export function SellerIntelligencePanel({ sellerName }: { sellerName: string }) {
  const [data, setData] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sellerName) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sellers/${encodeURIComponent(sellerName)}/profile`);
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sellerName]);

  if (loading) {
    return <div className="text-xs text-muted-foreground p-3">Nalagam profil prodajalca...</div>;
  }

  if (!data || !data.ok) {
    return (
      <div className="text-xs text-muted-foreground p-3">
        Ni podatkov o prodajalcu "{sellerName}".
      </div>
    );
  }

  const { seller: s, reputation: r, aiDistribution: ai, trustFactors: tf } = data;
  const scoreColor = r.score >= 70 ? 'text-green-500' : r.score >= 40 ? 'text-amber-400' : 'text-red-500';
  const riskBadge = r.riskLevel === 'low' ? 'border-green-500/40 text-green-500 bg-green-500/10'
    : r.riskLevel === 'medium' ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
    : 'border-red-500/40 text-red-500 bg-red-500/10';

  return (
    <Card className="border-border/60">
      <CardContent className="p-3 space-y-3">
        {/* Header: name + reputation score */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium truncate max-w-[150px]">{s.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className={cn('w-4 h-4', scoreColor)} />
            <span className={cn('font-mono font-bold text-lg', scoreColor)}>{r.score}</span>
            <span className="text-[10px] text-muted-foreground">/100</span>
          </div>
        </div>

        {/* Risk level badge */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-[10px] border', riskBadge)}>
            {r.riskLevel === 'low' ? 'NIZKO TVEGANJE' : r.riskLevel === 'medium' ? 'SREDNJE TVEGANJE' : 'VISOKO TVEGANJE'}
          </Badge>
          <span className="text-[10px] text-muted-foreground uppercase">{r.level}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{s.daysActive}d aktivnosti</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Oglasi</div>
            <div className="font-mono font-bold">{s.totalListings}</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Ø Cena</div>
            <div className="font-mono font-bold">{s.avgPriceEur}€</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Razpon</div>
            <div className="font-mono font-bold text-[10px]">{s.minPrice}-{s.maxPrice}€</div>
          </div>
        </div>

        {/* AI verdict distribution */}
        {s.totalListings > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase">AI ocena oglasov</div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              {ai.prilika > 0 && <div className="bg-green-500" style={{ width: `${(ai.prilika / s.totalListings) * 100}%` }} title={`${ai.prilika} prilik`} />}
              {ai.sumnjivo > 0 && <div className="bg-red-500" style={{ width: `${(ai.sumnjivo / s.totalListings) * 100}%` }} title={`${ai.sumnjivo} sumljivih`} />}
              {ai.nezanimivo > 0 && <div className="bg-muted-foreground" style={{ width: `${(ai.nezanimivo / s.totalListings) * 100}%` }} title={`${ai.nezanimivo} nezanimivih`} />}
              {ai.unevaluated > 0 && <div className="bg-border" style={{ width: `${(ai.unevaluated / s.totalListings) * 100}%` }} title={`${ai.unevaluated} neocenjenih`} />}
            </div>
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              {ai.prilika > 0 && <span className="text-green-500">🎯 {ai.prilika}</span>}
              {ai.sumnjivo > 0 && <span className="text-red-500">⚠️ {ai.sumnjivo}</span>}
              {ai.nezanimivo > 0 && <span>• {ai.nezanimivo}</span>}
            </div>
          </div>
        )}

        {/* Trust factors */}
        <div className="space-y-1">
          {tf.green.length > 0 && (
            <div className="space-y-0.5">
              {tf.green.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{f}</span>
                </div>
              ))}
            </div>
          )}
          {tf.red.length > 0 && (
            <div className="space-y-0.5">
              {tf.red.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <XCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{f}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories */}
        {s.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.categories.slice(0, 4).map((c, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                {c}
              </Badge>
            ))}
            {s.categories.length > 4 && <span className="text-[10px] text-muted-foreground">+{s.categories.length - 4}</span>}
          </div>
        )}

        {/* Summary */}
        <p className="text-[11px] text-muted-foreground italic border-t border-border/30 pt-2">
          {data.summary}
        </p>
      </CardContent>
    </Card>
  );
}
