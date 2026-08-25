'use client';

// v8.81: Enhanced Onboarding Wizard — 6 steps (was 4).
// FIXES critical UX gaps from v8.50:
//   - Step 1: AI Config now has ACTUAL input fields (was text-only)
//   - Step 2: NEW — Create first Monitor (core function was missing!)
//   - Step 4: NEW — Cron setup with copy-paste command (without cron, system is dead)
//   - Step 5: Enhanced — Demo data + "What's Next" checklist

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Rocket, Settings, Target, Database, Check, ChevronRight, ChevronLeft, Sparkles, Search, Clock, Copy, AlertCircle, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
}

const STEPS = [
  { id: 0, label: 'Dobrodošli', icon: Rocket },
  { id: 1, label: 'AI konfig', icon: Settings },
  { id: 2, label: 'Prvi monitor', icon: Monitor },
  { id: 3, label: 'Profit cilj', icon: Target },
  { id: 4, label: 'Auto-cron', icon: Clock },
  { id: 5, label: 'Demo + Next', icon: Database },
];

const MONITOR_SOURCES = [
  { value: 'bolha', label: '🇸🇮 Bolha.com' },
  { value: 'vinted', label: '👕 Vinted.si' },
  { value: 'avtonet', label: '🚗 Avtonet.si' },
  { value: 'nepremicnine', label: '🏠 Nepremičnine.net' },
  { value: 'mobile-de', label: '🇩🇪 Mobile.de' },
  { value: 'kleinanzeigen', label: '🇩🇪 Kleinanzeigen.de' },
  { value: 'quoka', label: '🇩🇪 Quoka.de' },
  { value: 'willhaben', label: '🇦🇹 Willhaben.at' },
  { value: 'subito', label: '🇮🇹 Subito.it' },
];

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [monthlyGoal, setMonthlyGoal] = useState('500');
  const [loading, setLoading] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // v8.81: AI Config state
  const [aiProvider, setAiProvider] = useState('ollama');
  const [aiBaseUrl, setAiBaseUrl] = useState('http://localhost:11434');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('qwen2.5:7b');
  const [aiSaved, setAiSaved] = useState(false);

  // v8.81: Monitor creation state
  const [monitorName, setMonitorName] = useState('');
  const [monitorSource, setMonitorSource] = useState('bolha');
  const [monitorUrl, setMonitorUrl] = useState('');
  const [monitorKeywords, setMonitorKeywords] = useState('');
  const [monitorCreated, setMonitorCreated] = useState(false);

  // v8.81: Cron copied state
  const [cronCopied, setCronCopied] = useState(false);

  const saveAiConfig = async () => {
    setLoading(true);
    try {
      const body: any = {
        aiProvider,
        aiBaseUrl,
        aiModel,
      };
      if (aiApiKey) body.aiApiKey = aiApiKey;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAiSaved(true);
        toast.success('✓ AI konfiguracija shranjena!');
      }
    } catch {
      toast.error('Napaka pri shranjevanju AI konfiguracije');
    } finally {
      setLoading(false);
    }
  };

  const createMonitor = async () => {
    if (!monitorName.trim() || !monitorUrl.trim()) {
      toast.error('Ime in URL sta obvezna');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: monitorName,
          source: monitorSource,
          sourceUrl: monitorUrl,
          keywords: monitorKeywords,
          intervalMinutes: 30,
        }),
      });
      if (res.ok) {
        setMonitorCreated(true);
        toast.success('✓ Monitor ustvarjen! Poženi ga v zavihku Monitorji.');
      }
    } catch {
      toast.error('Napaka pri ustvarjanju monitorja');
    } finally {
      setLoading(false);
    }
  };

  const copyCronCommand = () => {
    const cmd = `# Linux/Mac cron (vsakih 10 min):
*/10 * * * * curl -s http://localhost:3000/api/cron/run-all > /dev/null

# Windows Task Scheduler:
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/run-all" -Method POST`;
    navigator.clipboard.writeText(cmd);
    setCronCopied(true);
    toast.success('✓ Cron ukaz kopiran!');
  };

  const complete = async () => {
    setLoading(true);
    try {
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === 0 && 'Dobrodošel v Markec AI Firm!'}
            {step === 1 && 'AI Konfiguracija'}
            {step === 2 && 'Ustvari Prvi Monitor'}
            {step === 3 && 'Nastavi Profit Cilj'}
            {step === 4 && 'Omogoči Auto-Monitoring'}
            {step === 5 && 'Demo Podatki & Naslednji Koraki'}
          </DialogTitle>
          <DialogDescription>
            {step === 0 && 'Tvoj osebni AI trading firm za Bolha, Vinted, Avtonet in mobile.de.'}
            {step === 1 && 'Nastavi AI provider za analizo oglasov (lahko preskočiš).'}
            {step === 2 && 'Ustvari prvi iskalni monitor — brez tega sistem ne scrapa oglasov!'}
            {step === 3 && 'Koliko želiš zaslužiti na mesec?'}
            {step === 4 && 'Brez cron-a se NE bo NIČ samodejno poganjalo!'}
            {step === 5 && 'Naloži demo podatke in si oglej kaj je naslednje.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-1">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                i < step && 'bg-emerald-500 text-white',
                i === step && 'bg-primary text-primary-foreground',
                i > step && 'bg-muted text-muted-foreground',
              )}>
                {i < step ? <Check className="w-3 h-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={cn('w-3 h-px', i < step ? 'bg-emerald-500' : 'bg-border')} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[150px]">

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                <span className="text-primary font-bold">Markec AI Firm</span> je local-first, zero-cloud sistem za:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2"><span className="text-primary">🔍</span> Spremljanje oglasov na 11 platformah (Bolha, Vinted, Avtonet, mobile.de, Quoka, ...)</li>
                <li className="flex items-start gap-2"><span className="text-primary">🧠</span> AI analiza priložnosti (432 AI funkcij)</li>
                <li className="flex items-start gap-2"><span className="text-primary">📊</span> Sledenje dobička, ROI, ciljev</li>
                <li className="flex items-start gap-2"><span className="text-primary">🛒</span> Iskalnik s Buy Score + Compare + AI Advisor</li>
                <li className="flex items-start gap-2"><span className="text-primary">📱</span> Web Push obvestila + Telegram</li>
                <li className="flex items-start gap-2"><span className="text-primary">🤖</span> Auto-pilot + cron auto-monitoring</li>
              </ul>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-bold">💡 Tip:</span> Pritisni <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-xs">⌘K</kbd> kadar koli za iskanje po vseh funkcijah.
                </p>
              </div>
            </div>
          )}

          {/* Step 1: AI Config — v8.81: ACTUAL input fields */}
          {step === 1 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Za AI analizo oglasov potrebuješ AI provider. Najlažje: <span className="text-primary">Ollama</span> (brezplačno, local).
              </p>
              {aiSaved ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">AI konfiguracija shranjena! Model: {aiModel}</span>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">AI Provider</Label>
                      <select
                        value={aiProvider}
                        onChange={(e) => setAiProvider(e.target.value)}
                        className="mt-1 w-full h-9 text-sm bg-card border border-border rounded px-2"
                      >
                        <option value="ollama">Ollama (local, brezplačno)</option>
                        <option value="openai">OpenAI (API key)</option>
                        <option value="anthropic">Anthropic Claude (API key)</option>
                        <option value="openrouter">OpenRouter (API key)</option>
                        <option value="gemini">Google Gemini (API key)</option>
                        <option value="openai-compatible">OpenAI-compatible (custom)</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Base URL</Label>
                      <Input
                        value={aiBaseUrl}
                        onChange={(e) => setAiBaseUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">API Key {aiProvider === 'ollama' && '(neobvezno za Ollama)'}</Label>
                      <Input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder={aiProvider === 'ollama' ? 'Ollama ne rabi ključa' : 'sk-...'}
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Model</Label>
                      <Input
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="qwen2.5:7b"
                        className="mt-1 text-sm font-mono"
                      />
                    </div>
                  </div>
                  <Button onClick={saveAiConfig} disabled={loading} size="sm" className="w-full">
                    {loading ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Shrani AI konfiguracijo
                  </Button>
                </>
              )}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                <p className="text-[10px] text-amber-400">
                  ⚠️ Brez AI provider-ja: oglasi se ne AI-ocenjujejo, ampak sistem deluje (Brain = pure compute).
                  Lahko preskočiš — nastaviš kasneje v ⚙️ Nastavitve.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: First Monitor — v8.81: NEW! Core function was missing */}
          {step === 2 && (
            <div className="space-y-3 text-sm">
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  BREZ MONITORJA SE NIČ NE BO SCRAPALO!
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Monitor = iskalni URL na Bolha/Vinted/etc. Sistem ga preverja vsakih 30min in išče nove oglase.
                </p>
              </div>
              {monitorCreated ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <div>
                    <span className="text-emerald-500 font-medium">Monitor "{monitorName}" ustvarjen!</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Poženi ga v zavihku Monitorji → klikni "Poženi". lahko dodaš še več kasneje.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Ime monitorja</Label>
                      <Input
                        value={monitorName}
                        onChange={(e) => setMonitorName(e.target.value)}
                        placeholder="npr. iPhone 13 Pro na Bolha"
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Platforma</Label>
                      <select
                        value={monitorSource}
                        onChange={(e) => setMonitorSource(e.target.value)}
                        className="mt-1 w-full h-9 text-sm bg-card border border-border rounded px-2"
                      >
                        {MONITOR_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Iskalni URL *</Label>
                      <Input
                        value={monitorUrl}
                        onChange={(e) => setMonitorUrl(e.target.value)}
                        placeholder="https://www.bolha.com/iskanje?q=iphone+13+pro"
                        className="mt-1 text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Pojdi na Bolha.com, išči artikel, kopiraj URL iskanja.
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs">Ključne besede (neobvezno)</Label>
                      <Input
                        value={monitorKeywords}
                        onChange={(e) => setMonitorKeywords(e.target.value)}
                        placeholder="iphone, 13, pro"
                        className="mt-1 text-sm"
                      />
                    </div>
                  </div>
                  <Button onClick={createMonitor} disabled={loading || !monitorName.trim() || !monitorUrl.trim()} size="sm" className="w-full">
                    {loading ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Monitor className="w-3.5 h-3.5" />}
                    Ustvari monitor
                  </Button>
                </>
              )}
              <p className="text-[10px] text-muted-foreground">
                Lahko preskočiš — ustvariš kasneje v zavihku Monitorji.
              </p>
            </div>
          )}

          {/* Step 3: Profit Goal */}
          {step === 3 && (
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
              <div className="flex gap-2 flex-wrap">
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

          {/* Step 4: Cron Setup — v8.81: NEW! Without cron, system is dead */}
          {step === 4 && (
            <div className="space-y-3 text-sm">
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  BREZ CRON-A SE NE BO NIČ SAMODEJNO POGANJALO!
                </p>
                <ul className="text-[10px] text-muted-foreground mt-1.5 ml-3 list-disc space-y-0.5">
                  <li>Monitorji ne bodo scrapali oglasov</li>
                  <li>Saved searches ne bodo iskale ujemanj (v8.75)</li>
                  <li>Ne bo Web Push notificationov (v8.79)</li>
                  <li>Ne bo dnevnih snapshotov ali digestov</li>
                </ul>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs font-medium mb-1.5">📋 Nastavi zunanji cron (vsakih 10 min):</p>
                <pre className="text-[10px] bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground">
{`# Linux/Mac (crontab -e):
*/10 * * * * curl -s http://localhost:3000/api/cron/run-all > /dev/null

# Windows (Task Scheduler):
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/run-all" -Method POST`}
                </pre>
                <Button onClick={copyCronCommand} size="sm" variant="outline" className="mt-2 w-full gap-1.5">
                  <Copy className="w-3 h-3" />
                  {cronCopied ? '✓ Kopirano!' : 'Kopiraj ukaz'}
                </Button>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                <p className="text-[10px] text-muted-foreground">
                  <span className="text-emerald-500 font-medium">Po nastavitvi cron-a:</span> monitorji se samodejno poganjajo, saved searches iščejo ujemanja, push notificationi delujejo — vse avtomatsko!
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Lahko preskočiš — cron lahko nastaviš kadar koli. Brez cron-a lahko ročno poženeš monitorje v zavihku Monitorji.
              </p>
            </div>
          )}

          {/* Step 5: Demo Data + Next Steps */}
          {step === 5 && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground mb-2">
                  Naloži <span className="font-bold text-primary">25 demo trgovin</span> za takojšen začetek:
                </p>
                {seeded ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500 text-xs font-medium">Demo podatki naloženi!</span>
                  </div>
                ) : (
                  <Button onClick={seedDemo} disabled={loading} size="sm" variant="outline" className="w-full">
                    <Database className="w-3.5 h-3.5 mr-1.5" />
                    {loading ? 'Nalagam...' : 'Naloži 25 demo trgovin'}
                  </Button>
                )}
              </div>

              {/* v8.81: Next Steps Checklist */}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="text-xs font-bold text-primary mb-2">📋 Kaj naprej?</p>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className={aiSaved ? 'text-emerald-500' : 'text-muted-foreground'}>{aiSaved ? '✓' : '○'}</span>
                    <span className={aiSaved ? 'line-through text-muted-foreground' : ''}>Nastavi AI provider (Nastavitve → AI)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={monitorCreated ? 'text-emerald-500' : 'text-muted-foreground'}>{monitorCreated ? '✓' : '○'}</span>
                    <span className={monitorCreated ? 'line-through text-muted-foreground' : ''}>Ustvari monitor (Monitorji → Nov monitor)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cronCopied ? 'text-emerald-500' : 'text-muted-foreground'}>{cronCopied ? '✓' : '○'}</span>
                    <span className={cronCopied ? 'line-through text-muted-foreground' : ''}>Nastavi cron (zunanji, vsakih 10min)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">○</span>
                    <span>Poženi monitor (Monitorji → Poženi)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">○</span>
                    <span>Omogoči Push (Nastavitve → Web Push)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">○</span>
                    <span>Shrani iskanje v Iskalniku (auto-monitor)</span>
                  </div>
                </div>
              </div>
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
              if (step === 1 && !aiSaved && aiApiKey) saveAiConfig();
              if (step === 2) { /* monitor optional */ }
              if (step === 3) saveGoal();
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
