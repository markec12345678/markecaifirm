'use client';

// v8.50: First-Run Onboarding Wizard — 4-step setup za novi uporabniki.
// Pokaže se samo ko je onboardingCompleted=false v Settings.
// Steps: (1) Dobrodošli, (2) Konfiguriraj AI, (3) Nastavi cilj, (4) Naloži demo podatke.

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Rocket, Settings, Target, Database, Check, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
}

const STEPS = [
  { id: 0, label: 'Dobrodošli', icon: Rocket },
  { id: 1, label: 'AI konfig', icon: Settings },
  { id: 2, label: 'Profit cilj', icon: Target },
  { id: 3, label: 'Demo podatki', icon: Database },
];

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [monthlyGoal, setMonthlyGoal] = useState('500');
  const [loading, setLoading] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const complete = async () => {
    setLoading(true);
    try {
      // Mark onboarding as completed
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingCompleted: true }),
      });
      toast.success('✓ Onboarding zaključen! Dobrodošel v Markec AI Firm.');
      onComplete();
    } catch {
      toast.error('Napaka pri zaključku onboarding-a');
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/brain/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const data = await res.json();
      if (data.ok) {
        setSeeded(true);
        toast.success(`✓ Naloženih ${data.created} demo trgovin!`);
      }
    } catch {
      toast.error('Napaka pri nalaganju demo podatkov');
    } finally {
      setLoading(false);
    }
  };

  const saveGoal = async () => {
    const goal = parseFloat(monthlyGoal) || 0;
    try {
      await fetch('/api/trades/goal-tracker/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyGoal: goal }),
      });
      toast.success(`✓ Mesečni cilj nastavljen: ${goal}€`);
    } catch {
      toast.error('Napaka pri nastavitvi cilja');
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === 0 && 'Dobrodošel v Markec AI Firm!'}
            {step === 1 && 'AI Konfiguracija'}
            {step === 2 && 'Nastavi Profit Cilj'}
            {step === 3 && 'Demo Podatki'}
          </DialogTitle>
          <DialogDescription>
            {step === 0 && 'Tvoj osebni AI trading firm za Bolha, Vinted, Avtonet in mobile.de.'}
            {step === 1 && 'Nastavi AI provider za analizo oglasov (lahko preskočiš).'}
            {step === 2 && 'Koliko želiš zaslužiti na mesec?'}
            {step === 3 && 'Naloži demo podatke za takojšen začetek.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                i < step && 'bg-emerald-500 text-white',
                i === step && 'bg-primary text-primary-foreground',
                i > step && 'bg-muted text-muted-foreground',
              )}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs hidden sm:block', i === step ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <div className={cn('w-4 h-px', i < step ? 'bg-emerald-500' : 'bg-border')} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[150px]">
          {step === 0 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                <span className="text-primary font-bold">Markec AI Firm</span> je local-first, zero-cloud sistem za:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-primary">🔍</span> Spremljanje oglasov na Bolha, Vinted, Avtonet, mobile.de
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">🧠</span> AI analiza priložnosti (431 AI funkcij)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">📊</span> Sledenje dobička, ROI, ciljev
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">🤖</span> Auto-pilot za LOW-risk akcije
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">📱</span> Telegram obvestila + PWA
                </li>
              </ul>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-bold">💡 Tip:</span> Pritisni <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-xs">⌘K</kbd> kadar koli za iskanje po vseh funkcijah.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Za AI analizo oglasov potrebuješ AI provider. Najlažje: <span className="text-primary">Ollama</span> (brezplačno, local).
              </p>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-xs text-amber-400 font-medium">⚠️ Brez AI provider-ja:</p>
                <ul className="text-xs text-muted-foreground mt-1 ml-3 list-disc">
                  <li>Oglasi se ne bodo AI-ocenjevali (score/risk/verdict)</li>
                  <li>AI Hub funkcije bodo uporabljale deterministic fallback</li>
                  <li>Brain sistem še vedno deluje (pure compute)</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                Lahko preskočiš ta korak — nastaviš kasneje v <span className="font-bold">⚙️ Nastavitve</span>.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="goal">Mesečni profit cilj (€)</Label>
                <Input
                  id="goal"
                  type="number"
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(e.target.value)}
                  placeholder="500"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sistem bo sledil napredek in priporočil akcije za doseg cilja.
                </p>
              </div>
              <div className="flex gap-2">
                {[200, 500, 1000, 2000].map(g => (
                  <Button
                    key={g}
                    variant={monthlyGoal === String(g) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMonthlyGoal(String(g))}
                  >
                    {g}€
                  </Button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Naloži <span className="font-bold text-primary">25 demo trgovin</span> (iPhone, Nike, Alu platišča, ...) za takojšen začetek.
              </p>
              {seeded ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">Demo podatki naloženi! Vsi Brain signali, Trade Insights in grafikonih so zdaj aktivni.</span>
                </div>
              ) : (
                <Button onClick={seedDemo} disabled={loading} className="w-full">
                  <Database className="w-4 h-4 mr-2" />
                  {loading ? 'Nalagam...' : 'Naloži 25 demo trgovin'}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Brez demo podatkov: sistem dela ampak prikazuje prazne grafe. Lahko dodaš svoje trgovine kasneje.
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Nazaj
            </Button>
          ) : <div />}

          {step < STEPS.length - 1 ? (
            <Button onClick={() => {
              if (step === 2) saveGoal();
              setStep(step + 1);
            }}>
              Naprej <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={complete} disabled={loading}>
              <Check className="w-4 h-4 mr-1" /> {loading ? 'Zaključujem...' : 'Začni'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
