'use client';

/**
 * v7.00: BuyersView — NOV pogled za upravljanje kupcev.
 *
 * Backend ima 40+ buyer AI endpointov, a frontend do zdaj ni imel UI zanje.
 * Ta view integrira 5 najboljših:
 * 1. Buyer Persona — /api/ai/buyer-persona (kategorizacija kupca)
 * 2. Buyer Trust Score — /api/ai/buyer-trust-score (6 tierjev: platinum → scammer)
 * 3. Buyer Journey Optimizer — /api/ai/buyer-journey-optimizer (8-stopnjska pot)
 * 4. Buyer Review Generator — /api/ai/buyer-review-generator (6 tipov review-ov)
 * 5. Buyer Lifecycle Predictor — /api/ai/buyer-lifecycle-predictor (9 faz)
 *
 * Kupec je ekstrahiran iz soldTrades.sellLocation (kjer je bil item prodan).
 *
 * v9.09: 10 AI sekcij ekstraktiranih v ./buyers/ module (vsaka z lastnim state-om + fetch-om).
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Users, User, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Trade } from './buyers/types';
import { BuyerPersona } from './buyers/buyer-persona';
import { BuyerTrustScore } from './buyers/buyer-trust-score';
import { BuyerJourney } from './buyers/buyer-journey';
import { BuyerReview } from './buyers/buyer-review';
import { BuyerLifecycle } from './buyers/buyer-lifecycle';
import { BuyerMatchmaker } from './buyers/buyer-matchmaker';
import { BuyerClv } from './buyers/buyer-clv';
import { BuyerChurn } from './buyers/buyer-churn';
import { BuyerIntent } from './buyers/buyer-intent';
import { BuyerConversion } from './buyers/buyer-conversion';

interface BuyersViewProps {
  onNavigate?: (v: string) => void;
}

export function BuyersView({ onNavigate }: BuyersViewProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBuyer, setSelectedBuyer] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades?status=sold');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti prodaj');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Ekstrahiraj unikatne kupce iz sellLocation
  const buyers = Array.from(new Set(trades.map(t => t.sellLocation).filter(Boolean)));
  const buyerStats = buyers.map(name => {
    const buyerTrades = trades.filter(t => t.sellLocation === name);
    const totalSpent = buyerTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
    return { name, count: buyerTrades.length, totalSpent };
  }).sort((a, b) => b.totalSpent - a.totalSpent);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam prodaje...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Kupci
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Analiziraj kupce z AI — persona, trust score, journey, reviews, lifecycle.
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Osveži
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Skupaj kupcev</div>
            <div className="text-2xl font-bold font-mono text-primary">{buyers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Skupaj prodaj</div>
            <div className="text-2xl font-bold font-mono">{trades.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Skupni prihodek</div>
            <div className="text-2xl font-bold font-mono text-primary">
              {trades.reduce((s, t) => s + (t.sellPrice ?? 0), 0).toLocaleString('sl-SI')} €
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Povp. na kupca</div>
            <div className="text-2xl font-bold font-mono">
              {buyers.length > 0 ? Math.round(trades.length / buyers.length * 10) / 10 : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buyer selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            Izberi kupca za AI analizo
          </CardTitle>
          <CardDescription>
            Kupec je ekstrahiran iz `sellLocation` (kje je bil item prodan).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="buyer-select" className="text-xs">Kupec</Label>
              <Select value={selectedBuyer} onValueChange={setSelectedBuyer}>
                <SelectTrigger id="buyer-select" className="mt-1">
                  <SelectValue placeholder="— izberi kupca —" />
                </SelectTrigger>
                <SelectContent>
                  {buyerStats.map(b => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name} ({b.count} prodaj, {b.totalSpent.toLocaleString('sl-SI')} €)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedBuyer && (
            <div className="text-xs text-muted-foreground bg-card/30 border border-border rounded p-2">
              <b>{selectedBuyer}</b> — {buyerStats.find(b => b.name === selectedBuyer)?.count ?? 0} prodaj,
              skupno {buyerStats.find(b => b.name === selectedBuyer)?.totalSpent.toLocaleString('sl-SI') ?? 0} €
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Panels grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Buyer Persona */}
        <BuyerPersona selectedBuyer={selectedBuyer} />

        {/* 2. Buyer Trust Score */}
        <BuyerTrustScore selectedBuyer={selectedBuyer} />

        {/* 3. Buyer Journey Optimizer */}
        <BuyerJourney selectedBuyer={selectedBuyer} />

        {/* 4. Buyer Review Generator */}
        <BuyerReview selectedBuyer={selectedBuyer} />

        {/* 5. Buyer Lifecycle Predictor */}
        <BuyerLifecycle selectedBuyer={selectedBuyer} />
      </div>

      {/* v7.12: 5 novih buyer AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Buyer Matchmaker */}
        <BuyerMatchmaker />

        {/* 7. Buyer CLV Predictor */}
        <BuyerClv selectedBuyer={selectedBuyer} />

        {/* 8. Buyer Churn Prevention */}
        <BuyerChurn selectedBuyer={selectedBuyer} />

        {/* 9. Buyer Intent */}
        <BuyerIntent />

        {/* 10. Buyer Conversion Predictor */}
        <BuyerConversion selectedBuyer={selectedBuyer} />
      </div>

      {/* Footer info */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            📊 <b>Kupci</b> so ekstrahirani iz <code className="px-1 bg-card rounded">trade.sellLocation</code> (kje je bil item prodan).
            Backend ima še 35+ buyer AI endpointov (churn, CLV, engagement, intent, network...)
            ki jih lahko integriraš po potrebi. Glej <code className="px-1 bg-card rounded">AI_ENDPOINTS.md</code> za seznam.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
