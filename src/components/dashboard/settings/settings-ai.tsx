'use client';

// v8.96: SettingsAI — AI Provider + AI Fallback sekciji.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Zap, Cpu, Key, Bot, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROVIDER_PRESETS } from './types';
import type { Provider, Settings } from './types';

interface TestResult {
  ok: boolean;
  message: string;
}

export interface SettingsAIProps {
  settings: Settings;
  // AI Provider state
  provider: Provider;
  setProvider: (p: Provider) => void;
  baseUrl: string;
  setBaseUrl: (s: string) => void;
  apiKey: string;
  setApiKey: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  onProviderChange: (p: Provider) => void;
  currentPreset: { baseUrl: string; model: string; needsKey: boolean; label: string; help: string };
  testingAi: boolean;
  aiTestResult: TestResult | null;
  onTestAI: () => void;
  // AI Fallback state
  fallbackProvider: Provider | '';
  setFallbackProvider: (p: Provider | '') => void;
  fallbackBaseUrl: string;
  setFallbackBaseUrl: (s: string) => void;
  fallbackApiKey: string;
  setFallbackApiKey: (s: string) => void;
  fallbackModel: string;
  setFallbackModel: (s: string) => void;
  testingFallbackAi: boolean;
  fallbackAiTestResult: TestResult | null;
  onTestFallbackAI: () => void;
}

export function SettingsAI({
  settings,
  provider,
  setProvider: _setProvider,
  baseUrl,
  setBaseUrl,
  apiKey,
  setApiKey,
  model,
  setModel,
  onProviderChange,
  currentPreset,
  testingAi,
  aiTestResult,
  onTestAI,
  fallbackProvider,
  setFallbackProvider,
  fallbackBaseUrl,
  setFallbackBaseUrl,
  fallbackApiKey,
  setFallbackApiKey,
  fallbackModel,
  setFallbackModel,
  testingFallbackAi,
  fallbackAiTestResult,
  onTestFallbackAI,
}: SettingsAIProps) {
  return (
    <>
      {/* AI Provider card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            AI Provider
          </CardTitle>
          <CardDescription>
            Izberi provider, vnesi API ključ (kjer potreben) in ime modela.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider">Provider</Label>
            <Select value={provider} onValueChange={(v) => onProviderChange(v as Provider)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_PRESETS) as Provider[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_PRESETS[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1.5">{currentPreset.help}</p>
          </div>

          <div>
            <Label htmlFor="s-baseurl" className="text-xs uppercase tracking-wider flex items-center gap-2">
              <Bot className="w-3 h-3" /> Base URL
            </Label>
            <Input
              id="s-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 font-mono text-xs"
            />
            {provider === 'ollama' && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Privzeto <code>http://localhost:11434</code>. Če Ollama teče drugje, spremeni.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="s-model" className="text-xs uppercase tracking-wider">Model</Label>
            <Input
              id="s-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={currentPreset.model}
              className="mt-1 font-mono text-xs"
            />
            {provider === 'ollama' && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Priporočeni: <code>qwen2.5:7b</code> (hitro), <code>qwen2.5:14b</code> (natančneje), <code>llama3.1:8b</code>. Poženi z <code>ollama pull qwen2.5:7b</code>.
              </p>
            )}
          </div>

          {currentPreset.needsKey && (
            <div>
              <Label htmlFor="s-key" className="text-xs uppercase tracking-wider flex items-center gap-2">
                <Key className="w-3 h-3" /> API ključ
              </Label>
              <Input
                id="s-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.aiApiKeySet ? `shranjen (${settings.aiApiKeyMasked}) — pusti prazno za ohranitev` : 'vnesi API ključ'}
                className="mt-1 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Ključ se shrani lokalno v SQLite. Nikoli se ne pošilja nikamor razen izbranemu providerju.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="outline" onClick={onTestAI} disabled={testingAi} className="gap-2">
              {testingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Testiraj povezavo
            </Button>
            {aiTestResult && (
              <span className={cn('flex items-center gap-1.5 text-xs', aiTestResult.ok ? 'text-primary' : 'text-destructive')}>
                {aiTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                <span className="truncate max-w-md">{aiTestResult.message}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* v2.6: AI Fallback card */}
      <Card className="bg-card/50 border-primary/20">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            AI Fallback <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.6</Badge>
          </CardTitle>
          <CardDescription>
            Ko primarni AI provider odpove (npr. Ollama offline), samodejno preklopi na backup providerja.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider">Fallback provider</Label>
            <Select value={fallbackProvider || 'none'} onValueChange={(v) => setFallbackProvider(v === 'none' ? '' : v as Provider)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Izklopljeno</SelectItem>
                <SelectItem value="ollama">Ollama (lokalno)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-kompatibilni</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="gemini">Google Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fallbackProvider && (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wider">Base URL</Label>
                <Input value={fallbackBaseUrl} onChange={(e) => setFallbackBaseUrl(e.target.value)} placeholder="https://api.openai.com" className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider">Model</Label>
                <Input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} placeholder="gpt-4o-mini" className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3 h-3" /> API ključ
                </Label>
                <Input type="password" value={fallbackApiKey} onChange={(e) => setFallbackApiKey(e.target.value)} placeholder={settings?.fallbackApiKeySet ? 'shranjen — pusti prazno za ohranitev' : 'vnesi API ključ'} className="mt-1 font-mono text-xs" />
              </div>
              <p className="text-[11px] text-amber-400">
                ⚠️ Fallback se aktivira samo ko primarni provider vrne napako. V normalnih razmerah se ne uporablja.
              </p>

              {/* v4.4: Test fallback AI button */}
              <div className="pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={onTestFallbackAI} disabled={testingFallbackAi} className="gap-2">
                  {testingFallbackAi ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Testiraj fallback povezavo
                </Button>
                {fallbackAiTestResult && (
                  <div className={cn(
                    'mt-2 p-2 rounded text-xs border',
                    fallbackAiTestResult.ok
                      ? 'border-primary/40 bg-primary/5 text-primary'
                      : 'border-red-500/40 bg-red-500/5 text-red-500'
                  )}>
                    {fallbackAiTestResult.ok ? '✓' : '✗'} {fallbackAiTestResult.message}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
