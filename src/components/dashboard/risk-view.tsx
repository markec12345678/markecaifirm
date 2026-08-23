'use client';

/**
 * v7.06: RiskView — nov pogled za AI analizo tveganj.
 *
 * Backend ima 10+ risk AI endpointov, a frontend jih ni imel v dedicated UI.
 *
 * Integrira 5 najboljših:
 * 1. Risk Hedging — /api/ai/risk-hedging (8 tipov hedge strategij)
 * 2. Insurance Optimizer v2 — /api/ai/insurance-optimizer-v2 (4D risk matrix, 7 kategorij)
 * 3. Market Saturation — /api/ai/market-saturation (5 nivojev: saturated → blue_ocean)
 * 4. Risk Parity — /api/ai/risk-parity (alokacija z enakim riskom)
 * 5. Margin Guardian — /api/ai/margin-guardian (avtomatski margin alerti)
 *
 * v9.09: 10 AI sekcij ekstraktiranih v ./risk/ module (vsaka z lastnim state-om + fetch-om).
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './risk/types';
import { RiskHedging } from './risk/risk-hedging';
import { InsuranceOptimizer } from './risk/insurance-optimizer';
import { MarketSaturation } from './risk/market-saturation';
import { RiskParity } from './risk/risk-parity';
import { MarginGuardian } from './risk/margin-guardian';
import { InsuranceClaim } from './risk/insurance-claim';
import { AnomalyDetection } from './risk/anomaly-detection';
import { InventoryRiskAssessor } from './risk/inventory-risk-assessor';
import { QualityPredictor } from './risk/quality-predictor';
import { QualityAggregator } from './risk/quality-aggregator';

export function RiskView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti tradeov');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const heldTrades = trades.filter(t => t.status === 'held');
  const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
  const categories = Array.from(new Set(heldTrades.map(t => t.category).filter(Boolean)));
  const topCategory = categories.length > 0
    ? categories.reduce((best, cat) => {
        const catValue = heldTrades.filter(t => t.category === cat).reduce((s, t) => s + t.buyPrice, 0);
        return catValue > best.value ? { cat, value: catValue } : best;
      }, { cat: '', value: 0 })
    : { cat: '—', value: 0 };
  const concentrationPct = totalValue > 0 ? Math.round((topCategory.value / totalValue) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-red-500" />
            Tveganja AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI analiza tveganj — hedging, zavarovanje, saturacija, parity, margin guardian.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Osveži
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Vezana vrednost</div>
            <div className="text-2xl font-bold font-mono">{totalValue.toLocaleString('sl-SI')} €</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Koncentracija</div>
            <div className={cn('text-2xl font-bold font-mono', concentrationPct > 50 ? 'text-red-500' : concentrationPct > 30 ? 'text-amber-400' : 'text-primary')}>
              {concentrationPct}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Top kategorija</div>
            <div className="text-lg font-bold font-mono truncate">{topCategory.cat}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Kategorij skupaj</div>
            <div className="text-2xl font-bold font-mono">{categories.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* AI Panels */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Risk Hedging */}
        <RiskHedging />

        {/* 2. Insurance Optimizer v2 */}
        <InsuranceOptimizer />

        {/* 3. Market Saturation */}
        <MarketSaturation />

        {/* 4. Risk Parity */}
        <RiskParity />

        {/* 5. Margin Guardian */}
        <MarginGuardian />
      </div>

      {/* v7.16: 5 novih risk AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Insurance Claim */}
        <InsuranceClaim />

        {/* 7. Detect Anomalies */}
        <AnomalyDetection />

        {/* 8. Inventory Risk Assessor */}
        <InventoryRiskAssessor />

        {/* 9. Quality Predictor */}
        <QualityPredictor />

        {/* 10. Quality Aggregator */}
        <QualityAggregator />
      </div>

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            🛡️ <b>Tveganja AI</b> integrira 5 AI funkcij za upravljanje tveganj.
            Backend ima še 5+ risk AI endpointov (insurance-claim, insurance-optimizer v1, fraud-detection,
            fake-detection...) — vse najdeš v AI Hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
