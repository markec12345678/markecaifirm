'use client';

// v9.80: OutcomeFormDialog — hiter vnos dejanskega rezultata (10-20s).
//
// Problem: outcome-evaluator.ts zahteva Trade v DB z status='sold' da izračuna dobiček.
// V realnosti uporabnik pogosto zbere naslednje:
//   ✓ sem kupil in prodal (vnese cene)
//   ✗ sem se odločil ne kupiti
//   ◯ nikoli nisem izvedel akcije
//   ⚠ napoved AI-ja je bila napačna
//
// Cilj: 4 velike gumbe v koraku 1, formo za cene v koraku 2 (samo za "sold"),
// avtomatski izračun dobička in ROIja, save button.
//
// Po save: status='outcome_recorded', wasCorrect je nastavljen glede na tip,
// dialog se zapre, dashboard se osveži.
//
// POMembno: wasCorrect=null (not_bought, not_executed) NE vpliva na Decision Accuracy %.

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Check, X, Circle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import { triggerGlobalRefresh } from '@/hooks/use-global-refresh';

export interface OutcomeSuggestion {
  id: string;
  type: string; // buy | sell | stop-monitor | restock | arbitrage | investigate
  title: string;
  description: string;
  expectedProfit?: number | null;
  expectedRoi?: number | null;
  actionData: {
    suggestedPrice?: number;
    buyPrice?: number;
    sellPrice?: number;
    [k: string]: unknown;
  };
}

type OutcomeType = 'sold' | 'not_bought' | 'not_executed' | 'wrong_prediction';

interface OutcomeFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestion: OutcomeSuggestion | null;
  onSaved?: () => void;
}

const OUTCOME_OPTIONS: Array<{
  type: OutcomeType;
  icon: typeof Check;
  label: string;
  sublabel: string;
  color: string;
  bg: string;
  border: string;
}> = [
  {
    type: 'sold',
    icon: Check,
    label: 'Uspešno prodano',
    sublabel: 'Sem kupil in prodal — vnesi cene',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/5 hover:bg-emerald-500/10',
    border: 'border-emerald-500/40',
  },
  {
    type: 'not_bought',
    icon: X,
    label: 'Nisem kupil',
    sublabel: 'Odločil sem se ne kupiti',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 hover:bg-muted/50',
    border: 'border-muted-foreground/30',
  },
  {
    type: 'not_executed',
    icon: Circle,
    label: 'Nisem izvedel',
    sublabel: 'Nikoli nisem izvedel akcije',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 hover:bg-muted/50',
    border: 'border-muted-foreground/30',
  },
  {
    type: 'wrong_prediction',
    icon: AlertTriangle,
    label: 'Napačna napoved',
    sublabel: 'AI se je zmotil',
    color: 'text-amber-500',
    bg: 'bg-amber-500/5 hover:bg-amber-500/10',
    border: 'border-amber-500/40',
  },
];

export function OutcomeFormDialog({ open, onOpenChange, suggestion, onSaved }: OutcomeFormDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [outcomeType, setOutcomeType] = useState<OutcomeType | null>(null);
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [costs, setCosts] = useState('');
  const [referencePoint, setReferencePoint] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // v9.82: Sold comps pre-fill — predlagana prodajna cena iz zgodovine
  const [compsHint, setCompsHint] = useState<{ avg: number; count: number } | null>(null);
  const haptic = useHaptic();

  // Reset ko se dialog odpre
  useEffect(() => {
    if (open && suggestion) {
      setStep(1);
      setOutcomeType(null);
      setCompsHint(null);
      // Pre-fill iz suggestion actionData
      const suggested = suggestion.actionData.suggestedPrice ?? suggestion.actionData.buyPrice ?? null;
      setBuyPrice(suggested ? String(suggested) : '');
      setSellPrice(suggestion.actionData.sellPrice ? String(suggestion.actionData.sellPrice) : '');
      setCosts('');
      setReferencePoint('');
      setNote('');

      // v9.82: Async fetch sold comps za predlagano prodajno ceno.
      // Če je suggestion povezan z listingom (buy predlog) in listing ima sold comps,
      // predlagaj povprečno prodajno ceno iz zgodovine podobnih artiklov.
      const listingId = (suggestion.actionData as { listingId?: string }).listingId;
      if (listingId) {
        fetch(`/api/listings/${listingId}/sold-comps`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.ok && data.summary && typeof data.summary.avgSellPrice === 'number' && data.summary.avgSellPrice > 0) {
              const count = Array.isArray(data.comps) ? data.comps.length : 0;
              setCompsHint({ avg: data.summary.avgSellPrice, count });
              // Pre-fill sellPrice samo če še ni nastavljen
              setSellPrice((prev) => prev || String(data.summary.avgSellPrice));
              // Pre-fill referencePoint z informacijo o comps
              setReferencePoint((prev) => prev || `${count} podobnih prodaj, povprečje ${data.summary.avgSellPrice}€`);
            }
          })
          .catch(() => { /* silent — non-critical */ });
      }
    }
  }, [open, suggestion]);

  // Auto-izračun profit + ROI (live prikaz)
  const computed = useMemo(() => {
    const b = parseFloat(buyPrice);
    const s = parseFloat(sellPrice);
    const c = parseFloat(costs) || 0;
    if (!Number.isFinite(b) || !Number.isFinite(s) || b <= 0) return null;
    const profit = s - b - c;
    const roi = b > 0 ? (profit / b) * 100 : 0;
    return { profit, roi };
  }, [buyPrice, sellPrice, costs]);

  const handlePick = (type: OutcomeType) => {
    haptic.light();
    setOutcomeType(type);
    setStep(2);
  };

  const handleSave = async () => {
    if (!suggestion || !outcomeType) return;

    // Validacija za "sold"
    if (outcomeType === 'sold') {
      if (!buyPrice || !sellPrice) {
        toast.error('Vnesi kupno in prodajno ceno');
        return;
      }
      const b = parseFloat(buyPrice);
      const s = parseFloat(sellPrice);
      if (!Number.isFinite(b) || !Number.isFinite(s) || b <= 0 || s <= 0) {
        toast.error('Cene morajo biti pozitivna števila');
        return;
      }
    }

    setSaving(true);
    haptic.medium();
    try {
      const body: Record<string, unknown> = { outcomeType };
      if (outcomeType === 'sold') {
        body.actualBuyPrice = parseFloat(buyPrice);
        body.actualSellPrice = parseFloat(sellPrice);
        body.actualCosts = parseFloat(costs) || 0;
        if (referencePoint.trim()) body.referencePoint = referencePoint.trim();
      }
      if (note.trim()) body.note = note.trim();

      const res = await fetch(`/api/ai/copilot/${suggestion.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        haptic.success();
        const msg = outcomeType === 'sold' && computed
          ? `Zabeleženo: ${computed.profit >= 0 ? '+' : ''}${computed.profit.toFixed(2)}€ (${computed.roi.toFixed(1)}%)`
          : outcomeType === 'wrong_prediction'
            ? 'Označeno kot napačna napoved'
            : 'Zabeleženo';
        toast.success(`✓ ${msg}`, {
          description: 'Decision Accuracy se je posodobil.',
        });
        triggerGlobalRefresh('copilot-outcome-recorded');
        onSaved?.();
        onOpenChange(false);
      } else {
        toast.error(json.error || 'Napaka pri shranjevanju');
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setSaving(false);
    }
  };

  if (!suggestion) return null;

  // Pripravi expected profit za prikaz
  const expectedProfitText = suggestion.expectedProfit != null && suggestion.expectedProfit > 0
    ? `AI napoved: +${suggestion.expectedProfit}€`
    : null;
  const expectedRoiText = suggestion.expectedRoi != null && suggestion.expectedRoi > 0
    ? `${suggestion.expectedRoi}% donosnost`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-base">📝</span>
            Zabeleži izid
          </DialogTitle>
          <DialogDescription className="text-xs">
            Kaj se je dejansko zgodilo s tem predlogom?
          </DialogDescription>
        </DialogHeader>

        {/* Suggestion context */}
        <div className="bg-muted/30 border border-border rounded p-2.5 text-xs">
          <div className="font-semibold text-foreground line-clamp-1">{suggestion.title}</div>
          <div className="text-muted-foreground line-clamp-2 mt-0.5">{suggestion.description}</div>
          {(expectedProfitText || expectedRoiText) && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px]">
              {expectedProfitText && (
                <span className="text-emerald-500 font-medium">{expectedProfitText}</span>
              )}
              {expectedRoiText && (
                <span className="text-muted-foreground">· {expectedRoiText}</span>
              )}
            </div>
          )}
        </div>

        {/* STEP 1: pick outcome */}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-2 py-2">
            {OUTCOME_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.type}
                  onClick={() => handlePick(opt.type)}
                  className={cn(
                    'flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors',
                    opt.bg, opt.border, opt.color
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <div className="text-xs font-semibold text-foreground">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.sublabel}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* STEP 2: details based on outcome */}
        {step === 2 && outcomeType && (
          <div className="space-y-3 py-2">
            {/* Back button + selected outcome label */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { haptic.light(); setStep(1); setOutcomeType(null); }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Nazaj
              </button>
              <div className="text-[10px] text-muted-foreground">
                {OUTCOME_OPTIONS.find(o => o.type === outcomeType)?.label}
              </div>
            </div>

            {/* SOLD: form for prices */}
            {outcomeType === 'sold' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase">Kupna cena (€) *</Label>
                    <Input
                      type="number" step="0.01" inputMode="decimal"
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 font-mono h-9"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase">
                      Prodajna cena (€) *
                      {compsHint && (
                        <span className="ml-2 normal-case text-sky-500 font-normal">
                          📊 predlagano iz {compsHint.count} prodaj
                        </span>
                      )}
                    </Label>
                    <Input
                      type="number" step="0.01" inputMode="decimal"
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                      placeholder={compsHint ? String(compsHint.avg) : "0.00"}
                      className="mt-1 font-mono h-9"
                    />
                    {compsHint && (
                      <button
                        type="button"
                        onClick={() => { haptic.light(); setSellPrice(String(compsHint.avg)); }}
                        className="text-[9px] text-sky-500 hover:underline mt-0.5"
                      >
                        ↻ Uporabi povprečje {compsHint.avg}€
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase">Stroški (fees + poštnina, €)</Label>
                  <Input
                    type="number" step="0.01" inputMode="decimal"
                    value={costs}
                    onChange={(e) => setCosts(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 font-mono h-9"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase">Referenčna točka (opcijsko)</Label>
                  <Input
                    value={referencePoint}
                    onChange={(e) => setReferencePoint(e.target.value)}
                    placeholder="npr. Konkurenca 80€, povprečje 95€"
                    className="mt-1 h-9 text-xs"
                  />
                </div>

                {/* Live profit + ROI preview */}
                {computed && (
                  <div className={cn(
                    'rounded-md border p-3 flex items-center justify-between',
                    computed.profit >= 0
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-red-500/5 border-red-500/30'
                  )}>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground font-bold">
                        Dobiček
                      </div>
                      <div className={cn(
                        'text-lg font-bold flex items-center gap-1',
                        computed.profit >= 0 ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {computed.profit >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {computed.profit >= 0 ? '+' : ''}{computed.profit.toFixed(2)}€
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase text-muted-foreground font-bold">
                        ROI
                      </div>
                      <div className={cn(
                        'text-lg font-bold',
                        computed.roi >= 0 ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {computed.roi >= 0 ? '+' : ''}{computed.roi.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Comparison with AI prediction */}
                {computed && suggestion.expectedProfit != null && suggestion.expectedProfit > 0 && (
                  <div className="text-[10px] text-muted-foreground text-center">
                    AI napoved: <span className="text-emerald-500 font-medium">+{suggestion.expectedProfit}€</span>
                    {' · '}
                    {(() => {
                      const diff = computed.profit - suggestion.expectedProfit;
                      if (diff >= 0) {
                        return <span className="text-emerald-500">realnost +{diff.toFixed(2)}€ nad napovedjo ✓</span>;
                      }
                      return <span className="text-amber-500">realnost {diff.toFixed(2)}€ pod napovedjo</span>;
                    })()}
                  </div>
                )}
              </>
            )}

            {/* WRONG_PREDICTION: optional note */}
            {outcomeType === 'wrong_prediction' && (
              <div className="bg-amber-500/5 border border-amber-500/30 rounded p-2.5 text-[11px] text-amber-500">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                AI napoved se označi kot napačna. <code className="text-[10px]">wasCorrect=false</code>.
              </div>
            )}

            {/* Optional note (for not_bought, not_executed, wrong_prediction) */}
            {outcomeType !== 'sold' && (
              <div>
                <Label className="text-[10px] uppercase">Opomba (opcijsko)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={outcomeType === 'wrong_prediction' ? 'Zakaj je bila napoved napačna?' : 'Zakaj nisi izvedel akcije?'}
                  className="mt-1 text-xs min-h-[60px]"
                />
              </div>
            )}

            {/* Save hint */}
            <div className="text-[9px] text-muted-foreground text-center pt-1">
              {outcomeType === 'sold' && 'Bo vplival na Decision Accuracy in Financial Impact.'}
              {outcomeType === 'wrong_prediction' && 'Bo zmanjšal Decision Accuracy (wasCorrect=false).'}
              {(outcomeType === 'not_bought' || outcomeType === 'not_executed') && 'Ne vpliva na Decision Accuracy % (ne preverjeno).'}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="text-xs h-9">
            Prekliči
          </Button>
          {step === 2 && (
            <Button
              onClick={handleSave}
              disabled={saving || (outcomeType === 'sold' && (!buyPrice || !sellPrice))}
              className="text-xs h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Shranjujem...' : 'Shrani izid'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
