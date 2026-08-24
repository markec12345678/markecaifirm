'use client';

// v8.37: Deal Calculator Widget — hitra ROI kalkulacija na Dashboard.
//
// Use case: uporabnik vidi oglas na Bolha (npr. iPhone 13 za 280€) ampak nima
// hitrega kalkulatorja ki bi povedal "če prodaš za 380€, profit je 85€ (30% ROI)
// po 15€ fee". Ta widget odgovori na to vprašanje z LIVE calculation (klikaš
// vnose — rezultat se takoj posodobi).
//
// Izhod:
//   - Net profit (velika številka, zelena/amber/rdeča glede na priporočilo)
//   - ROI % + margin %
//   - Break-even cena
//   - Daily/weekly/monthly profit projekcija
//   - Recommendation pill: BUY (zelena) / MARGINAL (amber) / PASS (rdeča)
//   - Risk factors list (če obstajajo)
//   - "💾 Shrani kot trade" button → POST /api/trades (status: 'held', note
//     vsebuje deal calc projekcijo za poznejšo analizo)
//
// Pure client-side — kliče calculateDeal() iz lib-a (brez API klica za same
// kalkulacije). API se kliče samo ob save.

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Calculator, Save, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { calculateDeal } from '@/lib/trades/deal-calculator';

// Helper: parse a number from text input — supports both `.` and `,` decimal
// separators (Slovenian locale). Returns 0 if invalid/empty.
function parseNumInput(v: string): number {
  const s = v.trim().replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const REC_STYLES: Record<'BUY' | 'MARGINAL' | 'PASS', { bg: string; text: string; label: string; emoji: string }> = {
  BUY: { bg: 'bg-primary/15 border-primary/40', text: 'text-primary', label: 'BUY', emoji: '✅' },
  MARGINAL: { bg: 'bg-amber-400/15 border-amber-400/40', text: 'text-amber-400', label: 'MARGINAL', emoji: '⚠️' },
  PASS: { bg: 'bg-red-500/15 border-red-500/40', text: 'text-red-500', label: 'PASS', emoji: '❌' },
};

const RISK_STYLES: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'text-primary',
  MEDIUM: 'text-amber-400',
  HIGH: 'text-red-500',
};

export function DealCalculatorWidget() {
  // Input state
  const [buyPrice, setBuyPrice] = useState('280');
  const [expectedSellPrice, setExpectedSellPrice] = useState('380');
  const [buyFees, setBuyFees] = useState('0');
  const [sellFees, setSellFees] = useState('15');
  const [shippingCost, setShippingCost] = useState('0');
  const [refurbCost, setRefurbCost] = useState('0');
  const [avgHoldDays, setAvgHoldDays] = useState(14);
  const [saving, setSaving] = useState(false);

  // Live calculation — pure client-side
  const result = calculateDeal({
    buyPrice: parseNumInput(buyPrice),
    expectedSellPrice: parseNumInput(expectedSellPrice),
    buyFees: parseNumInput(buyFees),
    sellFees: parseNumInput(sellFees),
    shippingCost: parseNumInput(shippingCost),
    refurbCost: parseNumInput(refurbCost),
    avgHoldDays,
  });

  const rec = REC_STYLES[result.recommendation];
  const hasInputs = parseNumInput(buyPrice) > 0 && parseNumInput(expectedSellPrice) > 0;

  const handleReset = () => {
    setBuyPrice('280');
    setExpectedSellPrice('380');
    setBuyFees('0');
    setSellFees('15');
    setShippingCost('0');
    setRefurbCost('0');
    setAvgHoldDays(14);
  };

  const handleSaveAsTrade = async () => {
    if (!hasInputs) {
      toast.error('Vnesi buyPrice in expectedSellPrice');
      return;
    }
    setSaving(true);
    try {
      const bp = parseNumInput(buyPrice);
      const esp = parseNumInput(expectedSellPrice);
      const bf = parseNumInput(buyFees);
      const sf = parseNumInput(sellFees);
      const sc = parseNumInput(shippingCost);
      const rc = parseNumInput(refurbCost);

      const notesParts = [
        `v8.37 Deal Calculator`,
        `pričakovana prodajna ${esp}€`,
        `sellFees ${sf}€`,
        sc > 0 ? `shipping ${sc}€` : null,
        rc > 0 ? `refurb ${rc}€` : null,
        `ROI ${result.roiPct}%`,
        `marža ${result.marginPct}%`,
        `break-even ${result.breakEvenPrice}€`,
        `recommendation ${result.recommendation}`,
        `hold ${avgHoldDays} dni`,
      ].filter(Boolean);

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Deal calc: ${bp}€ → ${esp}€`,
          category: 'drugo',
          buyPrice: bp,
          buyFees: bf,
          buyLocation: 'Deal calc',
          status: 'held',
          notes: notesParts.join(' · '),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success('✓ Trade shranjen (v skladišču)');
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Deal Calculator
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.37
            </Badge>
          </h3>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={handleReset}
            title="Ponastavi na privzete vrednosti"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </Button>
        </div>

        {/* Form — 2-column grid on desktop, single column on mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Kupna cena (€) *
            </Label>
            <Input
              type="number"
              step="0.01"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pričakovana prodajna (€) *
            </Label>
            <Input
              type="number"
              step="0.01"
              value={expectedSellPrice}
              onChange={(e) => setExpectedSellPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pristojbine nakup (€)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={buyFees}
              onChange={(e) => setBuyFees(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pristojbine prodaja (€)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={sellFees}
              onChange={(e) => setSellFees(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Dostava (€, opt)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Popravilo/čiščenje (€, opt)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={refurbCost}
              onChange={(e) => setRefurbCost(e.target.value)}
              placeholder="0.00"
              className="mt-1 font-mono h-8 text-sm"
            />
          </div>
        </div>

        {/* Hold days slider */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Povprečni hold (dni)
            </Label>
            <span className="text-xs font-mono font-bold text-primary">{avgHoldDays}</span>
          </div>
          <Slider
            value={[avgHoldDays]}
            min={1}
            max={60}
            step={1}
            onValueChange={(v) => setAvgHoldDays(v[0] ?? 14)}
            className="w-full"
          />
        </div>

        {/* Result panel */}
        {hasInputs ? (
          <div className="space-y-3">
            {/* Big profit + recommendation */}
            <div className={cn('rounded border p-3 flex items-center justify-between gap-3', rec.bg)}>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Net profit
                </div>
                <div className={cn('text-3xl font-bold font-mono leading-none', rec.text)}>
                  {result.netProfit >= 0 ? '+' : ''}
                  {result.netProfit.toFixed(0)}€
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                  ROI {result.roiPct >= 0 ? '+' : ''}{result.roiPct.toFixed(1)}% · Marža {result.marginPct >= 0 ? '+' : ''}{result.marginPct.toFixed(1)}%
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn('text-xs font-bold px-3 py-1.5 shrink-0', rec.bg, rec.text)}
              >
                <span className="mr-1">{rec.emoji}</span>
                {rec.label}
              </Badge>
            </div>

            {/* Mini stats row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Break-even</div>
                <div className="text-sm font-bold font-mono">
                  {result.breakEvenPrice.toFixed(0)}€
                </div>
                <div
                  className={cn(
                    'text-[10px] font-mono',
                    result.breakEvenMargin >= 0 ? 'text-primary' : 'text-red-500',
                  )}
                >
                  {result.breakEvenMargin >= 0 ? '+' : ''}
                  {result.breakEvenMargin.toFixed(0)}€ marža
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Na dan</div>
                <div
                  className={cn(
                    'text-sm font-bold font-mono',
                    result.dailyProfit >= 0 ? 'text-primary' : 'text-red-500',
                  )}
                >
                  {result.dailyProfit >= 0 ? '+' : ''}
                  {result.dailyProfit.toFixed(2)}€
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  ~{avgHoldDays} dni
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Teden</div>
                <div
                  className={cn(
                    'text-sm font-bold font-mono',
                    result.weeklyProfit >= 0 ? 'text-primary' : 'text-red-500',
                  )}
                >
                  {result.weeklyProfit >= 0 ? '+' : ''}
                  {result.weeklyProfit.toFixed(0)}€
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  / Mesec: {result.monthlyProfit >= 0 ? '+' : ''}
                  {result.monthlyProfit.toFixed(0)}€
                </div>
              </div>
            </div>

            {/* Risk + recommendation reason */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Tveganje:</span>
                <span className={cn('font-bold', RISK_STYLES[result.riskLevel])}>
                  {result.riskLevel === 'LOW' ? '🟢' : result.riskLevel === 'MEDIUM' ? '🟡' : '🔴'} {result.riskLevel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground italic">
                {rec.label === 'BUY' && <TrendingUp className="inline w-3 h-3 mr-1" />}
                {rec.label === 'PASS' && <TrendingDown className="inline w-3 h-3 mr-1" />}
                {result.recommendationReason}
              </p>
            </div>

            {/* Risk factors list */}
            {result.riskFactors.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase tracking-wider text-red-500 mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Dejavniki tveganja ({result.riskFactors.length})
                </div>
                <ul className="space-y-0.5">
                  {result.riskFactors.map((f, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground">
                      • {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Save button */}
            <Button
              onClick={handleSaveAsTrade}
              disabled={saving || !hasInputs}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              size="sm"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? 'Shranjujem...' : '💾 Shrani kot trade (held)'}
            </Button>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Calculator className="w-5 h-5 mx-auto mb-2 opacity-30" />
            Vnesi kupno in pričakovano prodajno ceno za izračun.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
