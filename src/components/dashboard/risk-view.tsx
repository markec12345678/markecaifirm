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
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Shield, Umbrella, Waves, Scale, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  status: string;
}

export function RiskView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  const [hedging, setHedging] = useState<any>(null);
  const [hedgingLoading, setHedgingLoading] = useState(false);
  const [insurance, setInsurance] = useState<any>(null);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [saturation, setSaturation] = useState<any>(null);
  const [saturationLoading, setSaturationLoading] = useState(false);
  const [parity, setParity] = useState<any>(null);
  const [parityLoading, setParityLoading] = useState(false);
  const [guardian, setGuardian] = useState<any>(null);
  const [guardianLoading, setGuardianLoading] = useState(false);

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

  const runHedging = async () => {
    setHedgingLoading(true); setHedging(null);
    try {
      const res = await fetch('/api/ai/risk-hedging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setHedging(data); toast.success('✓ Hedge strategije generirane'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setHedgingLoading(false); }
  };

  const runInsurance = async () => {
    setInsuranceLoading(true); setInsurance(null);
    try {
      const res = await fetch('/api/ai/insurance-optimizer-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setInsurance(data); toast.success('✓ Zavarovalna optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setInsuranceLoading(false); }
  };

  const runSaturation = async () => {
    setSaturationLoading(true); setSaturation(null);
    try {
      const res = await fetch('/api/ai/market-saturation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSaturation(data); toast.success('✓ Tržna saturacija analizirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setSaturationLoading(false); }
  };

  const runParity = async () => {
    setParityLoading(true); setParity(null);
    try {
      const res = await fetch('/api/ai/risk-parity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setParity(data); toast.success('✓ Risk parity analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setParityLoading(false); }
  };

  const runGuardian = async () => {
    setGuardianLoading(true); setGuardian(null);
    try {
      const res = await fetch('/api/ai/margin-guardian', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setGuardian(data); toast.success('✓ Margin guardian aktiviran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setGuardianLoading(false); }
  };

  const runAll = async () => {
    await Promise.all([runHedging(), runInsurance(), runSaturation(), runParity(), runGuardian()]);
  };

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
          <Button onClick={runAll} disabled={trades.length === 0} size="sm" className="gap-2">
            <Sparkles className="w-4 h-4" /> Generiraj vse
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-red-500" /> AI Risk Hedging</span>
              <Button size="sm" variant="outline" onClick={runHedging} disabled={hedgingLoading} className="h-6 text-xs gap-1.5">
                {hedgingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hedgingLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira 8 hedge strategij...</div>
            ) : hedging?.hedging ? (
              <div className="space-y-2 text-xs">
                {hedging.hedging.hedges?.slice(0, 4).map((h: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">{h.type || h.strategy}</Badge>
                      <span className="text-[9px] text-muted-foreground">{h.coveragePct ?? h.coverage ?? 0}% pokritost</span>
                    </div>
                    <div className="text-[10px] font-medium">{h.action || h.description}</div>
                  </div>
                ))}
                {hedging.hedging.recommendations?.slice(0, 2).map((r: any, i: number) => (
                  <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">💡 {r.recommendation || r.action}</div>
                ))}
                {hedging.hedging.insights && <div className="text-[9px] text-muted-foreground">💡 {hedging.hedging.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI predlaga 8 hedge strategij (diversifikacija, counterweight, likvidnost, sezonsko...).</p>
            )}
          </CardContent>
        </Card>

        {/* 2. Insurance Optimizer v2 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Umbrella className="w-4 h-4 text-blue-400" /> AI Insurance Optimizer v2</span>
              <Button size="sm" variant="outline" onClick={runInsurance} disabled={insuranceLoading} className="h-6 text-xs gap-1.5">
                {insuranceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Umbrella className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {insuranceLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira 4D risk matrix (7 kategorij)...</div>
            ) : insurance?.optimizer ? (
              <div className="space-y-2 text-xs">
                {insurance.optimizer.riskMatrix?.slice(0, 3).map((r: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium">{r.category}</span>
                      <Badge variant="outline" className={cn('text-[9px]',
                        (r.theftRisk ?? r.riskScore ?? 0) >= 70 ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                        Risk: {r.theftRisk ?? r.riskScore ?? 0}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      Krađa: {r.theftRisk ?? '?'} · Poškodba: {r.damageRisk ?? '?'} · Depreciacija: {r.depreciationRisk ?? '?'}
                    </div>
                  </div>
                ))}
                {insurance.optimizer.policies?.slice(0, 2).map((p: any, i: number) => (
                  <div key={i} className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-[10px]">
                    <b className="text-blue-400">{p.type || p.name}</b> — {p.coverage ?? p.description} · {p.premiumEur ?? p.cost ?? '?'}€/leto
                  </div>
                ))}
                {insurance.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {insurance.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI 4D risk matrix (7 kategorij: elektronika, telefoni, avto, nepremičnine...) + police.</p>
            )}
          </CardContent>
        </Card>

        {/* 3. Market Saturation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Waves className="w-4 h-4 text-cyan-400" /> AI Market Saturation</span>
              <Button size="sm" variant="outline" onClick={runSaturation} disabled={saturationLoading} className="h-6 text-xs gap-1.5">
                {saturationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Waves className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {saturationLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira saturacijo trga...</div>
            ) : saturation?.saturation ? (
              <div className="space-y-2 text-xs">
                {saturation.saturation.categories?.slice(0, 4).map((c: any, i: number) => (
                  <div key={i} className={cn('border rounded p-2',
                    c.level === 'saturated' ? 'bg-red-500/5 border-red-500/20' :
                    c.level === 'blue_ocean' ? 'bg-primary/10 border-primary/30' : 'bg-card/30 border-border')}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium">{c.category || c.name}</span>
                      <Badge variant="outline" className={cn('text-[9px]',
                        c.level === 'saturated' ? 'text-red-500 border-red-500/30' :
                        c.level === 'blue_ocean' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                        {c.level || c.saturationLevel}
                      </Badge>
                    </div>
                    {c.opportunityRate != null && <div className="text-[9px] text-muted-foreground">{c.opportunityRate}% priložnosti</div>}
                  </div>
                ))}
                {saturation.saturation.marketSignals?.slice(0, 2).map((s: any, i: number) => (
                  <div key={i} className="bg-cyan-400/5 border border-cyan-400/20 rounded p-2 text-[10px]">{s.signal || s.description}</div>
                ))}
                {saturation.saturation.insights && <div className="text-[9px] text-muted-foreground">💡 {saturation.saturation.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI zazna saturacijo trga (5 nivojev: saturated → blue_ocean).</p>
            )}
          </CardContent>
        </Card>

        {/* 4. Risk Parity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Scale className="w-4 h-4 text-amber-400" /> AI Risk Parity</span>
              <Button size="sm" variant="outline" onClick={runParity} disabled={parityLoading} className="h-6 text-xs gap-1.5">
                {parityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {parityLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI računa risk parity alokacijo...</div>
            ) : parity ? (
              <div className="space-y-2 text-xs">
                {parity.currentAllocation?.slice(0, 3).map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px]">{a.category}</span>
                    <span className="font-mono text-[10px] text-amber-400">{a.percentage ?? a.allocation ?? 0}%</span>
                  </div>
                ))}
                {parity.recommendedAllocation?.slice(0, 3).map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded p-1.5">
                    <span className="text-[10px]">{a.category}</span>
                    <span className="font-mono text-[10px] text-primary">{a.percentage ?? a.allocation ?? 0}%</span>
                  </div>
                ))}
                {parity.insights && <div className="text-[9px] text-muted-foreground">💡 {parity.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI alokacija z enakim riskom (risk-parity: vsaka kategorija enak prispevek k skupnemu tveganju).</p>
            )}
          </CardContent>
        </Card>

        {/* 5. Margin Guardian */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> AI Margin Guardian</span>
              <Button size="sm" variant="outline" onClick={runGuardian} disabled={guardianLoading} className="h-6 text-xs gap-1.5">
                {guardianLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {guardianLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI aktivira margin guardian...</div>
            ) : guardian?.guardian ? (
              <div className="space-y-2 text-xs">
                {guardian.guardian.alerts?.slice(0, 4).map((a: any, i: number) => (
                  <div key={i} className={cn('border rounded p-2',
                    a.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                    a.severity === 'high' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-card/30 border-border')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium truncate flex-1">{a.title || a.item}</span>
                      <Badge variant="outline" className={cn('text-[9px] ml-1',
                        a.severity === 'critical' ? 'text-red-500 border-red-500/30' :
                        a.severity === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                        {a.severity}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      Marža: {a.currentMargin ?? '?'}% → {a.targetMargin ?? '?'}% · {a.action || a.recommendation}
                    </div>
                  </div>
                ))}
                {guardian.guardian.insights && <div className="text-[9px] text-muted-foreground">💡 {guardian.guardian.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI avtomatsko spremlja marže in opozarja na iteme z nizko/zapadajočo maržo.
              </p>
            )}
          </CardContent>
        </Card>
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
