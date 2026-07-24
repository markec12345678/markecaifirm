'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Save, Zap, Send, Cpu, Key, Bot, MessageSquare, AlertCircle, CheckCircle2, Download, Upload, Database, Trash2, Bell, Smartphone, SmartphoneCharging, Mail, Plus, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Provider = 'ollama' | 'openai' | 'anthropic' | 'openai-compatible';

interface Settings {
  aiProvider: Provider;
  aiBaseUrl: string;
  aiApiKeySet: boolean;
  aiApiKeyMasked: string;
  aiModel: string;
  // v2.6: AI fallback
  fallbackProvider: string;
  fallbackBaseUrl: string;
  fallbackApiKeySet: boolean;
  fallbackModel: string;
  telegramBotTokenSet: boolean;
  telegramChatId: string;
  telegramEnabled: boolean;
  // v1.4
  discordWebhookUrlSet: boolean;
  discordWebhookUrlMasked: string;
  discordEnabled: boolean;
  heartbeatEnabled: boolean;
  heartbeatHour: number;
  lastHeartbeatAt: string | null;
  minOpportunityScore: number;
  maxRiskScore: number;
  // v1.1
  imageAnalysisEnabled: boolean;
  playwrightEnabled: boolean;
  telegramInlineButtons: boolean;
  telegramWebhookSecretSet: boolean;
  // v1.5
  pushEnabled: boolean;
  vapidPublicKeySet: boolean;
  // v1.6: Digest
  digestMode: string;
  digestHour: number;
  quickResponseTemplatesSet: boolean;
  // v2.2: Quiet hours
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  // v2.2: Auto-cleanup
  autoCleanupEnabled: boolean;
  autoCleanupAlertsDays: number;
  autoCleanupListingsDays: number;
  updatedAt: string;
}

const PROVIDER_PRESETS: Record<Provider, { baseUrl: string; model: string; needsKey: boolean; label: string; help: string }> = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    needsKey: false,
    label: 'Ollama (lokalno)',
    help: 'Poženi Ollama CLI lokalno. Priporočam qwen2.5:7b ali 14b za slovenščino.',
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    needsKey: true,
    label: 'OpenAI',
    help: 'API key dobiš na platform.openai.com. Modeli: gpt-4o, gpt-4o-mini, o1-mini.',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-haiku-20241022',
    needsKey: true,
    label: 'Anthropic Claude',
    help: 'API key dobiš na console.anthropic.com. Modeli: claude-3-5-sonnet, claude-3-5-haiku.',
  },
  'openai-compatible': {
    baseUrl: 'https://api.groq.com/openai',
    model: 'llama-3.3-70b-versatile',
    needsKey: true,
    label: 'OpenAI-kompatibilni (Groq, OpenRouter, Together, DeepSeek, ...)',
    help: 'Kateri koli endpoint, ki podpira OpenAI /v1/chat/completions format. Pusti baseUrl prazen za privzeto.',
  },
};

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [provider, setProvider] = useState<Provider>('ollama');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('qwen2.5:7b');
  // v2.6: AI fallback
  const [fallbackProvider, setFallbackProvider] = useState<Provider | ''>('');
  const [fallbackBaseUrl, setFallbackBaseUrl] = useState('');
  const [fallbackApiKey, setFallbackApiKey] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  // v1.4: Discord
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [testingDc, setTestingDc] = useState(false);
  const [dcTestResult, setDcTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatHour, setHeartbeatHour] = useState(22);
  const [minOpportunityScore, setMinOpportunityScore] = useState(7);
  const [maxRiskScore, setMaxRiskScore] = useState(3);
  // v1.1
  const [imageAnalysisEnabled, setImageAnalysisEnabled] = useState(false);
  const [playwrightEnabled, setPlaywrightEnabled] = useState(false);
  const [telegramInlineButtons, setTelegramInlineButtons] = useState(true);
  const [telegramWebhookSecret, setTelegramWebhookSecret] = useState('');
  // v1.5: Push
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  // v1.6: Digest
  const [digestMode, setDigestMode] = useState('instant');
  const [digestHour, setDigestHour] = useState(20);
  const [digestSending, setDigestSending] = useState(false);
  // v2.2: Quiet hours
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStartHour, setQuietStartHour] = useState(22);
  const [quietEndHour, setQuietEndHour] = useState(7);
  // v2.2: Auto-cleanup
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(false);
  const [autoCleanupAlertsDays, setAutoCleanupAlertsDays] = useState(30);
  const [autoCleanupListingsDays, setAutoCleanupListingsDays] = useState(90);
  const [heartbeatSending, setHeartbeatSending] = useState(false);

  // Test states
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingTg, setTestingTg] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error();
        const data = await res.json();
        setSettings(data);
        setProvider(data.aiProvider);
        setBaseUrl(data.aiBaseUrl);
        setModel(data.aiModel);
        setFallbackProvider(data.fallbackProvider || '');
        setFallbackBaseUrl(data.fallbackBaseUrl || '');
        setFallbackModel(data.fallbackModel || '');
        setTelegramChatId(data.telegramChatId);
        setTelegramEnabled(data.telegramEnabled);
        setDiscordEnabled(data.discordEnabled);
        setHeartbeatEnabled(data.heartbeatEnabled);
        setHeartbeatHour(data.heartbeatHour);
        setMinOpportunityScore(data.minOpportunityScore);
        setMaxRiskScore(data.maxRiskScore);
        // v1.1
        setImageAnalysisEnabled(data.imageAnalysisEnabled ?? false);
        setPlaywrightEnabled(data.playwrightEnabled ?? false);
        setTelegramInlineButtons(data.telegramInlineButtons ?? true);
        setPushEnabled(data.pushEnabled ?? false);
        setDigestMode(data.digestMode ?? 'instant');
        setDigestHour(data.digestHour ?? 20);
        setQuietHoursEnabled(data.quietHoursEnabled ?? false);
        setQuietStartHour(data.quietStartHour ?? 22);
        setQuietEndHour(data.quietEndHour ?? 7);
        setAutoCleanupEnabled(data.autoCleanupEnabled ?? false);
        setAutoCleanupAlertsDays(data.autoCleanupAlertsDays ?? 30);
        setAutoCleanupListingsDays(data.autoCleanupListingsDays ?? 90);
      } catch {
        toast.error('Ne morem naložiti nastavitev');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // v1.5: Check push support + existing subscription
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushSupported(false);
      return;
    }
    setPushSupported(true);
    // Check existing subscription
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setPushSubscribed(!!existing);
      } catch { /* ignore */ }
    })();
  }, []);

  const onProviderChange = (p: Provider) => {
    setProvider(p);
    const preset = PROVIDER_PRESETS[p];
    // Only auto-fill if baseUrl is empty or matches another preset
    const isPresetUrl = Object.values(PROVIDER_PRESETS).some(x => x.baseUrl === baseUrl);
    if (isPresetUrl) setBaseUrl(preset.baseUrl);
    if (!model || Object.values(PROVIDER_PRESETS).some(x => x.model === model)) {
      setModel(preset.model);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: any = {
        aiProvider: provider,
        aiBaseUrl: baseUrl,
        aiModel: model,
        // v2.6: fallback
        fallbackProvider,
        fallbackBaseUrl,
        fallbackModel,
        telegramChatId,
        telegramEnabled,
        // v1.4
        discordEnabled,
        heartbeatEnabled,
        heartbeatHour,
        minOpportunityScore,
        maxRiskScore,
        // v1.1
        imageAnalysisEnabled,
        playwrightEnabled,
        telegramInlineButtons,
        // v1.5
        pushEnabled,
        // v1.6
        digestMode,
        digestHour,
        // v2.2
        quietHoursEnabled,
        quietStartHour,
        quietEndHour,
        autoCleanupEnabled,
        autoCleanupAlertsDays,
        autoCleanupListingsDays,
      };
      if (apiKey) body.aiApiKey = apiKey;
      if (fallbackApiKey) body.fallbackApiKey = fallbackApiKey;
      if (telegramBotToken) body.telegramBotToken = telegramBotToken;
      if (telegramWebhookSecret) body.telegramWebhookSecret = telegramWebhookSecret;
      // v1.4
      if (discordWebhookUrl) body.discordWebhookUrl = discordWebhookUrl;

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success('Nastavitve shranjene');
      setApiKey('');
      setTelegramBotToken('');
      // Reload settings
      const fresh = await fetch('/api/settings');
      if (fresh.ok) setSettings(await fresh.json());
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  const testAi = async () => {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const body: any = {
        action: 'test-ai',
        aiProvider: provider,
        aiBaseUrl: baseUrl,
        aiModel: model,
      };
      if (apiKey) body.aiApiKey = apiKey;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setAiTestResult(data);
      if (data.ok) toast.success('AI povezava OK');
      else toast.error(`AI test: ${data.message?.slice(0, 80)}`);
    } catch (e: any) {
      setAiTestResult({ ok: false, message: e?.message ?? 'napaka' });
      toast.error('AI test ni uspel');
    } finally {
      setTestingAi(false);
    }
  };

  const testTelegram = async () => {
    setTestingTg(true);
    setTgTestResult(null);
    try {
      const body: any = { action: 'test-telegram' };
      if (telegramBotToken) body.telegramBotToken = telegramBotToken;
      if (telegramChatId) body.telegramChatId = telegramChatId;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTgTestResult(data);
      if (data.ok) toast.success('Telegram test poslan');
      else toast.error(`Telegram: ${data.message?.slice(0, 80)}`);
    } catch (e: any) {
      setTgTestResult({ ok: false, message: e?.message ?? 'napaka' });
    } finally {
      setTestingTg(false);
    }
  };

  // v1.4: Test Discord webhook
  const testDiscord = async () => {
    setTestingDc(true);
    setDcTestResult(null);
    try {
      const body: any = { action: 'test-discord' };
      if (discordWebhookUrl) body.discordWebhookUrl = discordWebhookUrl;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setDcTestResult(data);
      if (data.ok) toast.success('Discord test poslan');
      else toast.error(`Discord: ${data.message?.slice(0, 80)}`);
    } catch (e: any) {
      setDcTestResult({ ok: false, message: e?.message ?? 'napaka' });
    } finally {
      setTestingDc(false);
    }
  };

  // v1.5: Subscribe to push notifications
  const subscribePush = async () => {
    setPushLoading(true);
    try {
      // 1. Get VAPID public key from server
      const infoRes = await fetch('/api/push/subscribe');
      const info = await infoRes.json();
      if (!info.vapidPublicKey) {
        toast.error('VAPID ključi še niso generirani. Shrani nastavitve z vklopljenim push.');
        return;
      }

      // 2. Subscribe via browser PushManager
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.vapidPublicKey),
      });

      // 3. Send subscription to server
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const subData = await subRes.json();
      if (subData.ok) {
        setPushSubscribed(true);
        toast.success('✅ Naprava registrirana za push obvestila');
      } else {
        toast.error(subData.error ?? 'Napaka pri registraciji');
      }
    } catch (e: any) {
      toast.error(`Napaka: ${e?.message ?? 'push ni podprt'}`);
    } finally {
      setPushLoading(false);
    }
  };

  const unsubscribePush = async () => {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const endpoint = existing.endpoint;
        await existing.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unsubscribe', endpoint }),
        });
      }
      setPushSubscribed(false);
      toast.success('Odjavljen od push obvestil');
    } catch (e: any) {
      toast.error(`Napaka: ${e?.message ?? 'napaka'}`);
    } finally {
      setPushLoading(false);
    }
  };

  const testPush = async () => {
    setPushLoading(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json();
      if (data.ok) toast.success(`Test poslan: ${data.message}`);
      else toast.error(data.message ?? 'Napaka');
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setPushLoading(false);
    }
  };

  // Helper: convert VAPID key
  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  if (loading || !settings) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const currentPreset = PROVIDER_PRESETS[provider];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Nastavitve
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            AI provider, Telegram, thresholdi za alerte.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Shrani
        </Button>
      </div>

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
                Ključ se shrani lokalno v SQLite. Nikoli se ne pošilje nikamor razen izbranemu providerju.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="outline" onClick={testAi} disabled={testingAi} className="gap-2">
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
            </>
          )}
        </CardContent>
      </Card>

      {/* Telegram card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Telegram obveščanje
          </CardTitle>
          <CardDescription>
            Pošilji alerte na Telegram bot. Bot token dobiš od <code>@BotFather</code>, chat ID od <code>@userinfobot</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="s-tg-token" className="text-xs uppercase tracking-wider">Bot Token</Label>
            <Input
              id="s-tg-token"
              type="password"
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
              placeholder={settings.telegramBotTokenSet ? 'shranjen — pusti prazno za ohranitev' : '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz'}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="s-tg-chat" className="text-xs uppercase tracking-wider">Chat ID</Label>
            <Input
              id="s-tg-chat"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="123456789"
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Pošlji sporočilo <code>/start</code> svojemu botu, nato obišči <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> in najdi <code>chat.id</code>.
            </p>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
              <div>
                <p className="text-sm font-medium">Omogoči Telegram</p>
                <p className="text-[11px] text-muted-foreground">Če izklopljeno, alerti pridejo samo na dashboard.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={testTelegram} disabled={testingTg} className="gap-2">
              {testingTg ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </Button>
          </div>
          {tgTestResult && (
            <p className={cn('text-xs flex items-center gap-1.5', tgTestResult.ok ? 'text-primary' : 'text-destructive')}>
              {tgTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {tgTestResult.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* v1.4: Discord card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Discord webhook <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.4</Badge>
          </CardTitle>
          <CardDescription>
            Alternativa Telegramu — alerti kot rich embed sporočila z barvami glede na verdikt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="s-dc-url" className="text-xs uppercase tracking-wider">Webhook URL</Label>
            <Input
              id="s-dc-url"
              type="password"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              placeholder={settings.discordWebhookUrlSet ? `shranjen (${settings.discordWebhookUrlMasked}) — pusti prazno za ohranitev` : 'https://discord.com/api/webhooks/...'}
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
              Za razliko od Telegrama, Discord ne zahteva expose-anja localhosta (webhook je pull, ne push).
            </p>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Switch checked={discordEnabled} onCheckedChange={setDiscordEnabled} />
              <div>
                <p className="text-sm font-medium">Omogoči Discord</p>
                <p className="text-[11px] text-muted-foreground">Alerti in heartbeat bodo šli tudi na Discord (poleg Telegrama, če je vklopljen).</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={testDiscord} disabled={testingDc} className="gap-2">
              {testingDc ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </Button>
          </div>
          {dcTestResult && (
            <p className={cn('text-xs flex items-center gap-1.5', dcTestResult.ok ? 'text-primary' : 'text-destructive')}>
              {dcTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {dcTestResult.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Thresholds card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            Thresholdi za alerte
          </CardTitle>
          <CardDescription>
            Samo oglasi, ki zadenejo oba pogoja, sprožijo alert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider">Min ocena prilike</Label>
              <Badge variant="outline" className="text-primary text-xs">{minOpportunityScore}/10</Badge>
            </div>
            <Slider
              value={[minOpportunityScore]}
              onValueChange={(v) => setMinOpportunityScore(v[0])}
              min={1}
              max={10}
              step={1}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              AI ocena priložnosti mora biti vsaj toliko. Višje = manj alertov, bolj selektivno.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider">Max ocena tveganja</Label>
              <Badge variant="outline" className="text-amber-400 text-xs">{maxRiskScore}/10</Badge>
            </div>
            <Slider
              value={[maxRiskScore]}
              onValueChange={(v) => setMaxRiskScore(v[0])}
              min={1}
              max={10}
              step={1}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              AI ocena tveganja (1=varno, 10=prevara) mora biti največ toliko.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Heartbeat card - v1.1 implemented */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Heartbeat <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.1</Badge>
          </CardTitle>
          <CardDescription>
            Dnevno poročilo o stanju sistema na Telegram. Pošlje se avtomatsko ob uri, ki jo nastaviš.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <Switch checked={heartbeatEnabled} onCheckedChange={setHeartbeatEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Dnevno poročilo ob {heartbeatHour}:00</p>
              <p className="text-[11px] text-muted-foreground">
                Pošlje povzetek na Telegram (št. preverjenih oglasov, alerti, napake).
                {settings.lastHeartbeatAt && (
                  <span className="block mt-0.5">Zadnje poslano: {new Date(settings.lastHeartbeatAt).toLocaleString('sl-SI')}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                value={heartbeatHour}
                onChange={(e) => setHeartbeatHour(parseInt(e.target.value, 10) || 22)}
                className="w-16 font-mono text-center"
              />
              <span className="text-xs text-muted-foreground">:00</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={heartbeatSending || !heartbeatEnabled}
            onClick={async () => {
              setHeartbeatSending(true);
              try {
                const res = await fetch('/api/heartbeats', { method: 'POST' });
                const data = await res.json();
                if (data.sent) toast.success('Heartbeat poslan');
                else toast.info(`Heartbeat ni poslan: ${data.reason}`);
              } catch {
                toast.error('Napaka pri pošiljanju heartbeat');
              } finally {
                setHeartbeatSending(false);
              }
            }}
            className="gap-2"
          >
            {heartbeatSending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Pošlji testni heartbeat
          </Button>
        </CardContent>
      </Card>

      {/* v1.1: Image analysis card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AI analiza slik <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.1</Badge>
          </CardTitle>
          <CardDescription>
            AI pregleda tudi sliko oglasa in oceni, ali je realna amaterska fotografija, sumljiva stock foto ali manjkajoča.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Switch checked={imageAnalysisEnabled} onCheckedChange={setImageAnalysisEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči analizo slik</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Za delovanje potrebuješ multimodalni model:
              </p>
              <ul className="text-[11px] text-muted-foreground mt-1 ml-3 list-disc space-y-0.5">
                <li><b>Ollama</b>: <code>llava:7b</code>, <code>minicpm-v:8b</code> — poženi z <code>ollama pull llava:7b</code></li>
                <li><b>OpenAI</b>: <code>gpt-4o</code>, <code>gpt-4o-mini</code> (oba podpirata slike)</li>
                <li><b>Anthropic</b>: <code>claude-3-5-sonnet</code>, <code>claude-3-5-haiku</code></li>
              </ul>
              <p className="text-[11px] text-amber-400 mt-2">
                ⚠️ Analiza slik poveča čas obdelave in porabo tokenov (~5-15s na oglas).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* v1.1: Bolha Playwright fallback */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            Bolha Playwright fallback <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.1</Badge>
          </CardTitle>
          <CardDescription>
            Ko cheerio scraping na Bolhi ne uspe zaradi Cloudflare, samodejno ponovi z browserjem (Playwright).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Switch checked={playwrightEnabled} onCheckedChange={setPlaywrightEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči Playwright fallback</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Zahteva nameščen paket (<code>bun add playwright</code>) in brskalnik (<code>bunx playwright install chromium</code>).
                Brez tega bo Bolha padla, če Cloudflare blokira.
              </p>
              <pre className="text-[11px] font-mono bg-background/70 p-2 rounded border border-border mt-2 overflow-x-auto">
{`bun add playwright
bunx playwright install chromium`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* v1.1: Telegram inline tipke */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Telegram inline tipke <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.1</Badge>
          </CardTitle>
          <CardDescription>
            Alerti na Telegramu dobijo tipke: "Odpri oglas", "Dashboard", "Arhiviraj", "Označi prevaro".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch checked={telegramInlineButtons} onCheckedChange={setTelegramInlineButtons} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči inline tipke</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                URL tipke (Odpri oglas, Dashboard) delujejo brez setupa.
                Callback tipke (Arhiviraj, Označi prevaro) zahtevajo webhook (glej spodaj).
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="s-wh-secret" className="text-xs uppercase tracking-wider">Webhook secret (izbirno)</Label>
            <Input
              id="s-wh-secret"
              type="password"
              value={telegramWebhookSecret}
              onChange={(e) => setTelegramWebhookSecret(e.target.value)}
              placeholder={settings.telegramWebhookSecretSet ? 'shranjen — pusti prazno za ohranitev' : 'naključni niz za zaščito webhooka'}
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Za aktivacijo callback tipk (Arhiviraj/Prevara) nastavi webhook:
            </p>
            <pre className="text-[11px] font-mono bg-background/70 p-2 rounded border border-border mt-1.5 overflow-x-auto">
{`# 1. Expose localhost (izberi eno):
ngrok http 3000
# ali: cloudflared tunnel --url http://localhost:3000

# 2. Set webhook (zamenjaj URL in dodaj ?secret=TVOJ_SECRET):
curl "https://api.telegram.org/bot<TOKEN>/setWebhook\\
?url=https://<tvoj-tunnel>/api/telegram/webhook?secret=TVOJ_SECRET"

# 3. V .env dodaj: TELEGRAM_WEBHOOK_SECRET=TVOJ_SECRET`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* v1.3: Database backup / restore */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Baza podatkov <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.3</Badge>
          </CardTitle>
          <CardDescription>
            Varnostno kopiraj ali obnovi SQLite bazo. Vključuje vse monitorje, oglase, alerte, zgodovino in nastavitve (vključno z API ključi).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BackupSection />
        </CardContent>
      </Card>

      {/* v1.5: PWA + Push notifications */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <SmartphoneCharging className="w-4 h-4 text-primary" />
            PWA + Push obvestila <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.5</Badge>
          </CardTitle>
          <CardDescription>
            Instaliraj aplikacijo na telefon/desktop in prejemaj push obvestila o novih priložnostih.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Push toggle */}
          <div className="flex items-start gap-3">
            <Switch checked={pushEnabled} onCheckedChange={setPushEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči push obvestila</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ko je omogočeno, vsak alert sproži tudi browser push notification (preko service workerja).
                {settings.vapidPublicKeySet
                  ? ' VAPID ključi so generirani.'
                  : ' VAPID ključi bodo generirani ob prvem shranjevanju.'}
              </p>
            </div>
          </div>

          {/* Subscription status + actions */}
          {!pushSupported ? (
            <div className="text-xs text-amber-400 p-2 bg-amber-400/5 border border-amber-400/20 rounded">
              ⚠ Ta brskalnik ne podpira push obvestil. Uporabi Chrome/Edge/Firefox ali mobilni brskalnik s podporo.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className={pushSubscribed ? 'text-primary' : 'text-muted-foreground'}>
                  {pushSubscribed ? '✅ Ta naprava je registrirana' : '⚪ Ta naprava ni registrirana'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!pushSubscribed ? (
                  <Button size="sm" variant="outline" onClick={subscribePush} disabled={pushLoading || !pushEnabled} className="gap-2">
                    {pushLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Smartphone className="w-3.5 h-3.5" />}
                    Registriraj to napravo
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={unsubscribePush} disabled={pushLoading} className="gap-2">
                    Odjavi napravo
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={testPush} disabled={pushLoading || !pushSubscribed} className="gap-2">
                  <Send className="w-3.5 h-3.5" /> Test push
                </Button>
              </div>
            </div>
          )}

          {/* PWA install info */}
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">📱 PWA instalacija</h4>
            <p className="text-[11px] text-muted-foreground mb-2">
              Aplikacija je PWA-kompatibilna. Lahko jo instaliraš kot native app:
            </p>
            <ul className="text-[11px] text-muted-foreground space-y-1 ml-3 list-disc">
              <li><b>Chrome/Edge (desktop)</b>: klikni ikono "Instaliraj" v naslovni vrstici</li>
              <li><b>Chrome (Android)</b>: menu → "Dodaj na domači zaslon"</li>
              <li><b>Safari (iOS)</b>: Share → "Dodaj na domači zaslon" (iOS 16.4+)</li>
              <li><b>Firefox (desktop)</b>: ikona "Instaliraj" v naslovni vrstici</li>
            </ul>
            <p className="text-[11px] text-amber-400 mt-2">
              ⚠ Push na iOS zahteva iOS 16.4+ in instalirano PWA (ne deluje v Safari browserju).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* v2.2: Quiet hours */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Tihe ure <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.2</Badge>
          </CardTitle>
          <CardDescription>
            Ne pošiljaj alertov (Telegram/Discord/Slack/Push) v določenih urah. Alerti se še vedno shranijo v bazo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <Switch checked={quietHoursEnabled} onCheckedChange={setQuietHoursEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči tihe ure</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {quietHoursEnabled
                  ? `Tihe ure: ${String(quietStartHour).padStart(2, '0')}:00 – ${String(quietEndHour).padStart(2, '0')}:00`
                  : 'Izklopljeno — alerti prihajajo 24/7'}
              </p>
            </div>
          </div>
          {quietHoursEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Od ure</Label>
                <Input type="number" min={0} max={23} value={quietStartHour} onChange={(e) => setQuietStartHour(parseInt(e.target.value, 10) || 0)} className="mt-1 font-mono text-center w-24" />
              </div>
              <div>
                <Label className="text-xs uppercase">Do ure</Label>
                <Input type="number" min={0} max={23} value={quietEndHour} onChange={(e) => setQuietEndHour(parseInt(e.target.value, 10) || 0)} className="mt-1 font-mono text-center w-24" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* v2.2: Auto-cleanup */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-primary" />
            Samodejni cleanup <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.2</Badge>
          </CardTitle>
          <CardDescription>
            Samodejno arhiviraj stare alerte in briši stare oglase. Bookmarked in v Skladišču ne bodo izbrisani.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <Switch checked={autoCleanupEnabled} onCheckedChange={setAutoCleanupEnabled} />
            <div className="flex-1">
              <p className="text-sm font-medium">Omogoči samodejni cleanup</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {autoCleanupEnabled
                  ? `Arhivira alerte >${autoCleanupAlertsDays} dni, briše oglase >${autoCleanupListingsDays} dni`
                  : 'Izklopljeno — ročno upravljanje'}
              </p>
            </div>
          </div>
          {autoCleanupEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Arhiviraj alerte po (dneh)</Label>
                <Input type="number" min={1} max={365} value={autoCleanupAlertsDays} onChange={(e) => setAutoCleanupAlertsDays(parseInt(e.target.value, 10) || 30)} className="mt-1 font-mono text-center w-24" />
              </div>
              <div>
                <Label className="text-xs uppercase">Briši oglase po (dneh)</Label>
                <Input type="number" min={1} max={365} value={autoCleanupListingsDays} onChange={(e) => setAutoCleanupListingsDays(parseInt(e.target.value, 10) || 90)} className="mt-1 font-mono text-center w-24" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* v1.9: Quick Responses */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Hitre predloge <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.9</Badge>
          </CardTitle>
          <CardDescription>
            Shranjena sporočila za kontakt prodajalcev — kopiraj v 1 klik.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuickResponsesSection />
        </CardContent>
      </Card>

      {/* v1.6: Digest mode */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Digest mode <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.6</Badge>
          </CardTitle>
          <CardDescription>
            Namesto instant alertov (vsak posebej) prejmi dnevni ali tedenski povzetek z top priložnostmi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider">Način</Label>
              <Select value={digestMode} onValueChange={setDigestMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">⚡ Instant (vsak alert posebej)</SelectItem>
                  <SelectItem value="daily">📊 Dnevni povzetek</SelectItem>
                  <SelectItem value="weekly">📅 Tedenski povzetek</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {digestMode !== 'instant' && (
              <div>
                <Label className="text-xs uppercase tracking-wider">Ura pošiljanja</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={digestHour}
                  onChange={(e) => setDigestHour(parseInt(e.target.value, 10) || 20)}
                  className="mt-1 font-mono text-center w-24"
                />
              </div>
            )}
          </div>
          {digestMode !== 'instant' && (
            <p className="text-[11px] text-muted-foreground">
              Povzetek se pošlje ob {digestHour}:00 ali ob naslednjem cron klicu po uri. Vsebuje: št. novih oglasov, št. alertov, top 5 priložnosti z AI razlogi.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={digestSending || digestMode === 'instant'}
              onClick={async () => {
                setDigestSending(true);
                try {
                  const res = await fetch('/api/digest?force=1', { method: 'POST' });
                  const data = await res.json();
                  if (data.ok && data.sent) toast.success('Digest poslan');
                  else toast.info('Digest ni poslan: ' + (data.reason ?? 'napaka'));
                } catch { toast.error('Napaka'); }
                finally { setDigestSending(false); }
              }}
              className="gap-2"
            >
              {digestSending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Pošlji testni digest
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cron info */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <h3 className="text-sm font-bold mb-2 text-primary uppercase tracking-wider">Avtomatsko poganjanje (cron)</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Da bodo monitorji tekli samodejno, nastavi zunanji cron, ki vsakih 5–10 minut pokliče:
          </p>
          <pre className="text-[11px] font-mono bg-background/70 p-3 rounded border border-border overflow-x-auto">
{`# Linux/Mac cron (vsakih 10 min):
*/10 * * * * curl -s http://localhost:3000/api/cron/run-all > /dev/null

# Windows Task Scheduler (PowerShell skripta):
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/run-all" -Method POST

# Ali z zaščito (nastavi env MONITOR_CRON_KEY=secret):
curl -s "http://localhost:3000/api/cron/run-all?key=secret"`}
          </pre>
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground text-center pb-4">
        Zadnja posodobitev nastavitev: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('sl-SI') : '—'}
      </div>
    </div>
  );
}

// v1.3: Backup section component
function BackupSection() {
  const [info, setInfo] = useState<{ sizeMb: string; lastModified: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInfo = async () => {
    try {
      const res = await fetch('/api/backup');
      if (res.ok) {
        const data = await res.json();
        setInfo({ sizeMb: data.sizeMb, lastModified: data.lastModified });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { loadInfo(); }, []);

  const download = () => {
    window.open('/api/backup?download=1', '_blank');
    toast.success('Prenos baze se začne');
  };

  const restore = async (file: File) => {
    if (!confirm(`Obnovim bazo iz "${file.name}"? TRENUTNI PODATKI BODO ZAMENJANI. Pred obnovitvijo se bo naredila varnostna kopija.`)) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('db', file);
      const res = await fetch('/api/backup', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message);
        await loadInfo();
      } else {
        toast.error(data.error ?? 'Napaka pri obnovi');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri obnovi');
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearAll = async () => {
    if (!confirm('Izbrišem VSE oglase, alerte, run loge in heartbeate? MONITORJI in NASTAVITVE bodo ohranjene. Tega ni mogoče razveljaviti.')) return;
    if (!confirm('ZADNJI POTRDITEV: resnično izbrišem vse podatke?')) return;
    try {
      const res = await fetch('/api/backup', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) toast.success(data.message);
      else toast.error(data.error ?? 'Napaka');
      await loadInfo();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    }
  };

  return (
    <div className="space-y-3">
      {info && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-background/50 border border-border rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Velikost</div>
            <div className="font-mono text-primary">{info.sizeMb} MB</div>
          </div>
          <div className="bg-background/50 border border-border rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Zadnja sprememba</div>
            <div className="font-mono text-primary text-[11px]">{new Date(info.lastModified).toLocaleString('sl-SI')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button size="sm" variant="outline" onClick={download} className="gap-2 h-8">
          <Download className="w-3.5 h-3.5" /> Prenesi .db
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={restoring}
          onClick={() => fileInputRef.current?.click()}
          className="gap-2 h-8"
        >
          {restoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Obnovi iz .db
        </Button>
        <Button size="sm" variant="outline" onClick={clearAll} className="gap-2 h-8 text-destructive hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" /> Počisti podatke
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".db,.sqlite,.sqlite3,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) restore(file);
        }}
      />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          <b>Prenesi .db</b>: varnostna kopija celotne baze (vključno z API ključi in Telegram tokenom — hranite varno!).
        </p>
        <p>
          <b>Obnovi iz .db</b>: naloži prejšnjo varnostno kopijo. Pred obnovitvijo se samodejno naredi backup trenutne baze. Po obnovitvi <b>priporočamo ponovni zagon aplikacije</b> (Prisma client cache).
        </p>
        <p>
          <b>Počisti podatke</b>: izbriše vse oglase, alerte, run loge in heartbeate. Monitorji in nastavitve (vključno z API ključi) ostanejo. Uporabno za "fresh start" pri testiranju.
        </p>
      </div>
    </div>
  );
}

// v1.9: Quick Responses section
function QuickResponsesSection() {
  const [templates, setTemplates] = useState<Array<{ name: string; text: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/quick-responses');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/quick-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      });
      if (res.ok) toast.success('Predloge shranjene');
      else toast.error('Napaka pri shranjevanju');
    } catch { toast.error('Napaka'); }
    finally { setSaving(false); }
  };

  const add = () => {
    if (!newName.trim() || !newText.trim()) {
      toast.error('Ime in besedilo sta obvezna');
      return;
    }
    setTemplates([...templates, { name: newName.trim(), text: newText.trim() }]);
    setNewName('');
    setNewText('');
    toast.success('Predloga dodana (shrani za uveljavitev)');
  };

  const remove = (idx: number) => {
    setTemplates(templates.filter((_, i) => i !== idx));
  };

  const copyText = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    toast.success('Kopirano');
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  if (loading) return <div className="h-20 animate-pulse bg-muted rounded" />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Shranite pogosto uporabljena sporočila za prodajalce. Kliknite za kopiranje v clipboard, nato prilepite v Bolha/FB sporočilo.
      </p>

      {/* Existing templates */}
      {templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((t, i) => (
            <div key={i} className="bg-background/50 border border-border rounded p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-bold text-primary">{t.name}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => copyText(t.text, i)} className="h-6 px-2 text-xs gap-1">
                    {copiedIdx === i ? <CheckCircle2 className="w-3 h-3 text-primary" /> : <FileText className="w-3 h-3" />}
                    {copiedIdx === i ? 'Kopirano' : 'Kopiraj'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} className="h-6 w-6 p-0 text-destructive">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{t.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add new template */}
      <div className="border-t border-border pt-3 space-y-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Ime (npr. 'Zacetno povprasovanje')"
          className="text-xs"
        />
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Pozdravljen, ali je oglas še na voljo? Zanima me stanje in ali bi prišlo do dogovora o ceni. LP"
          className="text-xs min-h-[60px]"
        />
        <Button size="sm" variant="outline" onClick={add} className="gap-1.5 h-7 text-xs">
          <Plus className="w-3 h-3" /> Dodaj predlogo
        </Button>
      </div>

      <Button size="sm" onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
        {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
        Shrani predloge
      </Button>
    </div>
  );
}
