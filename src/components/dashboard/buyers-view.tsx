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
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, User, ShieldCheck, Map, Star, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  sellPrice: number | null;
  sellLocation: string;
  category: string;
  sellDate: string | null;
  status: string;
}

interface BuyersViewProps {
  onNavigate?: (v: string) => void;
}

export function BuyersView({ onNavigate }: BuyersViewProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBuyer, setSelectedBuyer] = useState<string>('');

  // AI results
  const [persona, setPersona] = useState<any>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [trustScore, setTrustScore] = useState<any>(null);
  const [trustLoading, setTrustLoading] = useState(false);
  const [journey, setJourney] = useState<any>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

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

  // ===== 1. Buyer Persona =====
  const runPersona = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setPersonaLoading(true);
    setPersona(null);
    try {
      const res = await fetch('/api/ai/buyer-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setPersona(data); toast.success('✓ Persona generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setPersonaLoading(false); }
  };

  // ===== 2. Buyer Trust Score =====
  const runTrust = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setTrustLoading(true);
    setTrustScore(null);
    try {
      const res = await fetch('/api/ai/buyer-trust-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setTrustScore(data); toast.success('✓ Trust score generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setTrustLoading(false); }
  };

  // ===== 3. Buyer Journey Optimizer =====
  const runJourney = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setJourneyLoading(true);
    setJourney(null);
    try {
      const res = await fetch('/api/ai/buyer-journey-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setJourney(data); toast.success('✓ Journey optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setJourneyLoading(false); }
  };

  // ===== 4. Buyer Review Generator =====
  const runReview = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setReviewLoading(true);
    setReview(null);
    try {
      const res = await fetch('/api/ai/buyer-review-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setReview(data); toast.success('✓ Review generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setReviewLoading(false); }
  };

  // ===== 5. Buyer Lifecycle Predictor =====
  const runLifecycle = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setLifecycleLoading(true);
    setLifecycle(null);
    try {
      const res = await fetch('/api/ai/buyer-lifecycle-predictor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setLifecycle(data); toast.success('✓ Lifecycle napoved generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setLifecycleLoading(false); }
  };

  const runAll = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    await Promise.all([runPersona(), runTrust(), runJourney(), runReview(), runLifecycle()]);
  };

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
            <Button onClick={runAll} disabled={!selectedBuyer} className="gap-2">
              <Sparkles className="w-4 h-4" />
              Generiraj vse
            </Button>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-400" />
                AI Buyer Persona
              </span>
              <Button size="sm" variant="outline" onClick={runPersona} disabled={personaLoading} className="h-6 text-xs gap-1.5">
                {personaLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <User className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {personaLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI kategorizira kupca...
              </div>
            ) : persona?.personas?.length > 0 ? (
              <div className="space-y-2 text-xs">
                {persona.personas.slice(0, 3).map((p: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40">{p.type || p.archetype}</Badge>
                      <span className="text-[9px] text-muted-foreground">{p.confidence || ''}%</span>
                    </div>
                    <div className="font-medium">{p.name || p.title}</div>
                    {p.description && <div className="text-[10px] text-muted-foreground mt-1">{p.description}</div>}
                    {p.preferredCategories?.length > 0 && (
                      <div className="text-[9px] text-muted-foreground mt-1">
                        📦 Kategorije: {p.preferredCategories.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI določi osebnost kupca (bargain hunter, collector, flipper...).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 2. Buyer Trust Score */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                AI Trust Score
              </span>
              <Button size="sm" variant="outline" onClick={runTrust} disabled={trustLoading} className="h-6 text-xs gap-1.5">
                {trustLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trustLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI ocenjuje zanesljivost kupca...
              </div>
            ) : trustScore?.scoring ? (
              <div className="space-y-2 text-xs">
                <div className={cn('border rounded p-2',
                  trustScore.scoring.tier === 'platinum' || trustScore.scoring.tier === 'gold' ? 'bg-primary/10 border-primary/30' :
                  trustScore.scoring.tier === 'risk' || trustScore.scoring.tier === 'blocked' ? 'bg-red-500/10 border-red-500/30' : 'bg-card/30 border-border')}>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                      trustScore.scoring.tier === 'platinum' ? 'text-primary border-primary/40' :
                      trustScore.scoring.tier === 'blocked' ? 'text-red-500 border-red-500/40' : 'text-muted-foreground')}>
                      {trustScore.scoring.tier}
                    </Badge>
                    <span className="font-mono font-bold">{trustScore.scoring.trustScore ?? '?'}/100</span>
                  </div>
                  {trustScore.scoring.reasoning && (
                    <p className="text-[10px] text-muted-foreground mt-1">{trustScore.scoring.reasoning}</p>
                  )}
                </div>
                {trustScore.scoring.recommendation && (
                  <div className="bg-card/30 border rounded p-2 text-[10px]">
                    💡 <b>Priporočilo:</b> {trustScore.scoring.recommendation}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI oceni zanesljivost (platinum → scammer, 6 tierjev).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 3. Buyer Journey Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Map className="w-4 h-4 text-purple-400" />
                AI Journey Optimizer
              </span>
              <Button size="sm" variant="outline" onClick={runJourney} disabled={journeyLoading} className="h-6 text-xs gap-1.5">
                {journeyLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Map className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {journeyLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI optimizira 8-stopnjsko pot kupca...
              </div>
            ) : journey?.optimizer ? (
              <div className="space-y-2 text-xs">
                {journey.optimizer.insights && (
                  <div className="bg-purple-500/5 border border-purple-500/20 rounded p-2 text-[10px]">
                    💡 {journey.optimizer.insights}
                  </div>
                )}
                {journey.optimizer.optimizations?.slice(0, 3).map((o: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="font-medium text-[10px]">{o.stage || o.touchpoint || `Optimizacija ${i + 1}`}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{o.action || o.recommendation || o.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI optimizira 8-stopnjsko pot (awareness → advocacy).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 4. Buyer Review Generator */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                AI Review Generator
              </span>
              <Button size="sm" variant="outline" onClick={runReview} disabled={reviewLoading} className="h-6 text-xs gap-1.5">
                {reviewLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reviewLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI generira review-e...
              </div>
            ) : review?.generator ? (
              <div className="space-y-2 text-xs">
                {review.generator.reviews?.slice(0, 3).map((r: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <Badge variant="outline" className="text-[9px] mb-1">{r.type || r.style || `Review ${i + 1}`}</Badge>
                    <div className="text-[10px] italic">"{r.text || r.content || r.message}"</div>
                  </div>
                ))}
                {review.generator.reviews?.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center">Ni review-ov.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI generira review-e (testimonial, referral, social proof...).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 5. Buyer Lifecycle Predictor */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                AI Lifecycle Predictor
              </span>
              <Button size="sm" variant="outline" onClick={runLifecycle} disabled={lifecycleLoading} className="h-6 text-xs gap-1.5">
                {lifecycleLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lifecycleLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI napoveduje 9 faz življenjskega cikla...
              </div>
            ) : lifecycle?.predictor ? (
              <div className="space-y-2 text-xs">
                {lifecycle.predictor.insights && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                    💡 {lifecycle.predictor.insights}
                  </div>
                )}
                {lifecycle.predictor.lifecycleStages?.slice(0, 5).map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-card/30 border rounded p-2">
                    <Badge variant="outline" className="text-[9px]">{s.stage || s.name}</Badge>
                    <span className="text-[10px] flex-1">{s.action || s.recommendation || s.description || ''}</span>
                    {s.probability != null && (
                      <span className="font-mono text-[10px] text-primary">{s.probability}%</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI napove 9 faz (prospect → first_time → loyal → advocate → churned → reactivated).
              </p>
            )}
          </CardContent>
        </Card>
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
