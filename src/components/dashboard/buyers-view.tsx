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
import { Users, User, ShieldCheck, Map, Star, RefreshCw, Sparkles, TrendingUp, Heart, Crosshair, GitBranch, Target } from 'lucide-react';
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
  // v7.12: 5 novih buyer AI funkcij
  const [matchmaker, setMatchmaker] = useState<any>(null);
  const [matchmakerLoading, setMatchmakerLoading] = useState(false);
  const [clv, setClv] = useState<any>(null);
  const [clvLoading, setClvLoading] = useState(false);
  const [churn, setChurn] = useState<any>(null);
  const [churnLoading, setChurnLoading] = useState(false);
  const [intent, setIntent] = useState<any>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [conversion, setConversion] = useState<any>(null);
  const [conversionLoading, setConversionLoading] = useState(false);

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

  // v7.12: 6-10. Pet novih buyer AI funkcij
  const runMatchmaker = async () => { setMatchmakerLoading(true); setMatchmaker(null); try { const r = await fetch('/api/ai/buyer-matchmaker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setMatchmaker(d); toast.success('✓ Matchmaker generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setMatchmakerLoading(false); } };
  const runClv = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setClvLoading(true); setClv(null); try { const r = await fetch('/api/ai/buyer-clv-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setClv(d); toast.success('✓ CLV napoved generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setClvLoading(false); } };
  const runChurn = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setChurnLoading(true); setChurn(null); try { const r = await fetch('/api/ai/buyer-churn-prevention-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setChurn(d); toast.success('✓ Churn strategija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setChurnLoading(false); } };
  const runIntent = async () => { setIntentLoading(true); setIntent(null); try { const r = await fetch('/api/ai/buyer-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setIntent(d); toast.success('✓ Intent analiza generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setIntentLoading(false); } };
  const runConversion = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setConversionLoading(true); setConversion(null); try { const r = await fetch('/api/ai/buyer-conversion-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setConversion(d); toast.success('✓ Conversion napoved generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setConversionLoading(false); } };

  const runAll = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    await Promise.all([runPersona(), runTrust(), runJourney(), runReview(), runLifecycle(), runMatchmaker(), runClv(), runChurn(), runIntent(), runConversion()]);
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

      {/* v7.12: 5 novih buyer AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Buyer Matchmaker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Crosshair className="w-4 h-4 text-primary" /> AI Buyer Matchmaker</span>
              <Button size="sm" variant="outline" onClick={runMatchmaker} disabled={matchmakerLoading} className="h-6 text-xs gap-1.5">
                {matchmakerLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {matchmakerLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI išče match-e med kupci in inventarjem...</div>
            ) : matchmaker?.matches?.length > 0 ? (
              <div className="space-y-2 text-xs">
                {matchmaker.matches.slice(0, 4).map((m: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px] truncate flex-1">{m.buyerName || m.name || `Match ${i+1}`}</span>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{m.matchScore ?? m.score ?? '?'}%</Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">{m.reason || m.rationale || m.description}</div>
                  </div>
                ))}
                {matchmaker.insights && <div className="text-[9px] text-muted-foreground">💡 {matchmaker.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI poišče match-e med kupci in held inventarjem (channel-specific outreach).</p>
            )}
          </CardContent>
        </Card>

        {/* 7. Buyer CLV Predictor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> AI CLV Predictor</span>
              <Button size="sm" variant="outline" onClick={runClv} disabled={clvLoading} className="h-6 text-xs gap-1.5">
                {clvLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {clvLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje Customer Lifetime Value...</div>
            ) : clv?.predictor ? (
              <div className="space-y-2 text-xs">
                <div className="bg-primary/10 border border-primary/30 rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase text-primary font-bold">Pričakovan CLV</span>
                    <span className="font-mono font-bold text-primary text-lg">{clv.predictor.clv ?? clv.predictor.lifetimeValue ?? '?'}€</span>
                  </div>
                </div>
                {clv.predictor.tier && <div className="text-[10px]"><Badge variant="outline" className="text-[9px]">{clv.predictor.tier}</Badge></div>}
                {clv.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {clv.predictor.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI napove Customer Lifetime Value (napoved dolgoročne vrednosti kupca).</p>
            )}
          </CardContent>
        </Card>

        {/* 8. Buyer Churn Prevention */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Heart className="w-4 h-4 text-red-500" /> AI Churn Prevention</span>
              <Button size="sm" variant="outline" onClick={runChurn} disabled={churnLoading} className="h-6 text-xs gap-1.5">
                {churnLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {churnLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja strategijo proti izgubi kupca...</div>
            ) : churn?.strategist ? (
              <div className="space-y-2 text-xs">
                {churn.strategist.churnRisk != null && (
                  <div className={cn('border rounded p-2', churn.strategist.churnRisk >= 70 ? 'bg-red-500/10 border-red-500/30' : churn.strategist.churnRisk >= 40 ? 'bg-amber-400/10 border-amber-400/30' : 'bg-primary/10 border-primary/30')}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold">Tveganje izgube</span>
                      <span className="font-mono font-bold">{churn.strategist.churnRisk}%</span>
                    </div>
                  </div>
                )}
                {churn.strategist.strategies?.slice(0, 3).map((s: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="text-[10px] font-medium">{s.strategy || s.action || s.name}</div>
                    <div className="text-[9px] text-muted-foreground">{s.description || s.detail}</div>
                  </div>
                ))}
                {churn.strategist.insights && <div className="text-[9px] text-muted-foreground">💡 {churn.strategist.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI predlaga strategijo za preprečitev izgube kupca (churn prevention).</p>
            )}
          </CardContent>
        </Card>

        {/* 9. Buyer Intent */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" /> AI Buyer Intent</span>
              <Button size="sm" variant="outline" onClick={runIntent} disabled={intentLoading} className="h-6 text-xs gap-1.5">
                {intentLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {intentLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira nakupne namene kupcev...</div>
            ) : intent?.intent ? (
              <div className="space-y-2 text-xs">
                {intent.intent.buyers?.slice(0, 4).map((b: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px] font-medium truncate flex-1">{b.name || b.buyerName}</span>
                    <Badge variant="outline" className={cn('text-[9px]', (b.intentScore ?? b.score ?? 0) >= 70 ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                      {b.intentScore ?? b.score ?? '?'}%
                    </Badge>
                  </div>
                ))}
                {intent.intent.insights && <div className="text-[9px] text-muted-foreground">💡 {intent.intent.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI analizira nakupne namene kupcev (kdo bo verjetno kupil znova).</p>
            )}
          </CardContent>
        </Card>

        {/* 10. Buyer Conversion Predictor */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-blue-400" /> AI Conversion Predictor</span>
              <Button size="sm" variant="outline" onClick={runConversion} disabled={conversionLoading} className="h-6 text-xs gap-1.5">
                {conversionLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conversionLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje verjetnost konverzije...</div>
            ) : conversion?.predictor ? (
              <div className="space-y-2 text-xs">
                <div className={cn('border rounded p-2',
                  (conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? 0) >= 70 ? 'bg-primary/10 border-primary/30' :
                  (conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? 0) >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase text-[10px]">Verjetnost konverzije</span>
                    <Badge variant="outline" className="text-[9px] font-mono font-bold text-primary border-primary/40">
                      {conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? '?'}%
                    </Badge>
                  </div>
                  {conversion.predictor.reasoning && <p className="text-[10px] text-muted-foreground mt-1">{conversion.predictor.reasoning}</p>}
                </div>
                {conversion.predictor.factors?.slice(0, 3).map((f: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-card/30 border rounded p-1.5">
                    <span className={cn('font-bold w-3', f.impact === 'positive' ? 'text-primary' : f.impact === 'negative' ? 'text-red-500' : 'text-muted-foreground')}>
                      {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '○'}
                    </span>
                    <span className="text-[10px] font-medium">{f.factor || f.name}</span>
                    <span className="text-[9px] text-muted-foreground ml-auto">({f.weight ?? f.score}/10)</span>
                  </div>
                ))}
                {conversion.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {conversion.predictor.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI napove verjetnost konverzije (ali bo kupec kupil znova) z analizo faktorjev.</p>
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
