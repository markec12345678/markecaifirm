'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, Save, Zap, Send, Cpu, Key, Bot, MessageSquare, AlertCircle, CheckCircle2, Download, Upload, Database, Trash2, Bell, Smartphone, SmartphoneCharging, Mail, Plus, X, FileText, Target, FileJson, Sparkles, Webhook, HardDriveDownload, Clock, History } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { QuickResponsesSection } from './settings/quick-responses-section';
import { WebhooksSection } from './settings/webhooks-section';
import { ProfitGoalSection } from './settings/profit-goal-section';
import { BackupSection } from './settings/backup-section';
import { CategoryNotificationsSection } from './settings/category-notifications-section';
import { ScrapingConfigSection } from './settings/scraping-config-section';
import { FullBackupSection } from './settings/full-backup-section';
import { SettingsAI } from './settings/settings-ai';
import { SettingsNotifications } from './settings/settings-notifications';
import { SettingsScoring } from './settings/settings-scoring';
import { SettingsAutomation } from './settings/settings-automation';
import { SettingsAdvanced } from './settings/settings-advanced';
import { SettingsPush } from './settings/settings-push';
import { PROVIDER_PRESETS, urlBase64ToUint8Array } from './settings/types';
import type { Provider, Settings } from './settings/types';

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
  // v2.7: Email
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailSmtpHost, setEmailSmtpHost] = useState('');
  const [emailSmtpPort, setEmailSmtpPort] = useState(587);
  const [emailSmtpUser, setEmailSmtpUser] = useState('');
  const [emailSmtpPassword, setEmailSmtpPassword] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; message: string } | null>(null);
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
  // v5.2: AI daily summary
  const [aiSummarySending, setAiSummarySending] = useState<'telegram' | 'email' | 'preview' | null>(null);
  const [aiSummaryPreview, setAiSummaryPreview] = useState<any>(null);
  // v2.2: Quiet hours
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStartHour, setQuietStartHour] = useState(22);
  const [quietEndHour, setQuietEndHour] = useState(7);
  // v2.2: Auto-cleanup
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(false);
  const [autoCleanupAlertsDays, setAutoCleanupAlertsDays] = useState(30);
  const [autoCleanupListingsDays, setAutoCleanupListingsDays] = useState(90);
  // v4.2: Profit goal
  const [monthlyProfitGoal, setMonthlyProfitGoal] = useState(0);
  const [heartbeatSending, setHeartbeatSending] = useState(false);

  // Test states
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // v4.4: Fallback AI test state
  const [testingFallbackAi, setTestingFallbackAi] = useState(false);
  const [fallbackAiTestResult, setFallbackAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
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
        setEmailEnabled(data.emailEnabled ?? false);
        setEmailSmtpHost(data.emailSmtpHost ?? '');
        setEmailSmtpPort(data.emailSmtpPort ?? 587);
        setEmailSmtpUser(data.emailSmtpUser ?? '');
        setEmailFrom(data.emailFrom ?? '');
        setEmailTo(data.emailTo ?? '');
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
        setMonthlyProfitGoal(data.monthlyProfitGoal ?? 0);
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
        // v2.7: Email
        emailEnabled,
        emailSmtpHost,
        emailSmtpPort,
        emailSmtpUser,
        emailFrom,
        emailTo,
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
        // v4.2: Profit goal
        monthlyProfitGoal,
      };
      if (apiKey) body.aiApiKey = apiKey;
      if (fallbackApiKey) body.fallbackApiKey = fallbackApiKey;
      if (telegramBotToken) body.telegramBotToken = telegramBotToken;
      if (emailSmtpPassword) body.emailSmtpPassword = emailSmtpPassword;
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

  // v4.4: Test fallback AI provider
  const testFallbackAi = async () => {
    if (!fallbackProvider || !fallbackModel) {
      toast.error('Najprej izberi fallback provider in model');
      return;
    }
    setTestingFallbackAi(true);
    setFallbackAiTestResult(null);
    try {
      const body: any = {
        action: 'test-fallback-ai',
        fallbackProvider,
        fallbackBaseUrl,
        fallbackModel,
      };
      if (fallbackApiKey) body.fallbackApiKey = fallbackApiKey;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setFallbackAiTestResult(data);
      if (data.ok) toast.success('Fallback AI povezava OK');
      else toast.error(`Fallback AI: ${data.message?.slice(0, 80)}`);
    } catch (e: any) {
      setFallbackAiTestResult({ ok: false, message: e?.message ?? 'napaka' });
      toast.error('Fallback AI test ni uspel');
    } finally {
      setTestingFallbackAi(false);
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

  // v2.7: Test Email
  const testEmailFn = async () => {
    setTestingEmail(true);
    setEmailTestResult(null);
    try {
      const body: any = { action: 'test-email' };
      if (emailSmtpHost) body.emailSmtpHost = emailSmtpHost;
      if (emailSmtpPort) body.emailSmtpPort = emailSmtpPort;
      if (emailSmtpUser) body.emailSmtpUser = emailSmtpUser;
      if (emailSmtpPassword) body.emailSmtpPassword = emailSmtpPassword;
      if (emailFrom) body.emailFrom = emailFrom;
      if (emailTo) body.emailTo = emailTo;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setEmailTestResult(data);
      if (data.ok) toast.success('Email test poslan');
      else toast.error(`Email: ${data.message?.slice(0, 80)}`);
    } catch (e: any) {
      setEmailTestResult({ ok: false, message: e?.message ?? 'napaka' });
    } finally {
      setTestingEmail(false);
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
        applicationServerKey: urlBase64ToUint8Array(info.vapidPublicKey).buffer as ArrayBuffer,
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

  // Helper: convert VAPID key (imported from ./settings/types)

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

      {/* AI Provider + AI Fallback — v8.96: imported from ./settings/settings-ai */}
      <SettingsAI
        settings={settings}
        provider={provider}
        setProvider={setProvider}
        baseUrl={baseUrl}
        setBaseUrl={setBaseUrl}
        apiKey={apiKey}
        setApiKey={setApiKey}
        model={model}
        setModel={setModel}
        onProviderChange={onProviderChange}
        currentPreset={currentPreset}
        testingAi={testingAi}
        aiTestResult={aiTestResult}
        onTestAI={testAi}
        fallbackProvider={fallbackProvider}
        setFallbackProvider={setFallbackProvider}
        fallbackBaseUrl={fallbackBaseUrl}
        setFallbackBaseUrl={setFallbackBaseUrl}
        fallbackApiKey={fallbackApiKey}
        setFallbackApiKey={setFallbackApiKey}
        fallbackModel={fallbackModel}
        setFallbackModel={setFallbackModel}
        testingFallbackAi={testingFallbackAi}
        fallbackAiTestResult={fallbackAiTestResult}
        onTestFallbackAI={testFallbackAi}
      />

      {/* Notifications — v8.96: imported from ./settings/settings-notifications */}
      <SettingsNotifications
        settings={settings}
        telegramBotToken={telegramBotToken}
        setTelegramBotToken={setTelegramBotToken}
        telegramChatId={telegramChatId}
        setTelegramChatId={setTelegramChatId}
        telegramEnabled={telegramEnabled}
        setTelegramEnabled={setTelegramEnabled}
        testingTg={testingTg}
        tgTestResult={tgTestResult}
        testTelegram={testTelegram}
        discordWebhookUrl={discordWebhookUrl}
        setDiscordWebhookUrl={setDiscordWebhookUrl}
        discordEnabled={discordEnabled}
        setDiscordEnabled={setDiscordEnabled}
        testingDc={testingDc}
        dcTestResult={dcTestResult}
        testDiscord={testDiscord}
        emailEnabled={emailEnabled}
        setEmailEnabled={setEmailEnabled}
        emailSmtpHost={emailSmtpHost}
        setEmailSmtpHost={setEmailSmtpHost}
        emailSmtpPort={emailSmtpPort}
        setEmailSmtpPort={setEmailSmtpPort}
        emailSmtpUser={emailSmtpUser}
        setEmailSmtpUser={setEmailSmtpUser}
        emailSmtpPassword={emailSmtpPassword}
        setEmailSmtpPassword={setEmailSmtpPassword}
        emailFrom={emailFrom}
        setEmailFrom={setEmailFrom}
        emailTo={emailTo}
        setEmailTo={setEmailTo}
        testingEmail={testingEmail}
        emailTestResult={emailTestResult}
        testEmailFn={testEmailFn}
      />

      {/* Scoring + Backup config — v8.96: imported from ./settings/settings-scoring */}
      <SettingsScoring
        minOpportunityScore={minOpportunityScore}
        setMinOpportunityScore={setMinOpportunityScore}
        maxRiskScore={maxRiskScore}
        setMaxRiskScore={setMaxRiskScore}
      />

      {/* Automation — v8.96: imported from ./settings/settings-automation */}
      <SettingsAutomation
        settings={settings}
        heartbeatEnabled={heartbeatEnabled}
        setHeartbeatEnabled={setHeartbeatEnabled}
        heartbeatHour={heartbeatHour}
        setHeartbeatHour={setHeartbeatHour}
        heartbeatSending={heartbeatSending}
        setHeartbeatSending={setHeartbeatSending}
        digestMode={digestMode}
        setDigestMode={setDigestMode}
        digestHour={digestHour}
        setDigestHour={setDigestHour}
        digestSending={digestSending}
        setDigestSending={setDigestSending}
        aiSummarySending={aiSummarySending}
        setAiSummarySending={setAiSummarySending}
        aiSummaryPreview={aiSummaryPreview}
        setAiSummaryPreview={setAiSummaryPreview}
        quietHoursEnabled={quietHoursEnabled}
        setQuietHoursEnabled={setQuietHoursEnabled}
        quietStartHour={quietStartHour}
        setQuietStartHour={setQuietStartHour}
        quietEndHour={quietEndHour}
        setQuietEndHour={setQuietEndHour}
        autoCleanupEnabled={autoCleanupEnabled}
        setAutoCleanupEnabled={setAutoCleanupEnabled}
        autoCleanupAlertsDays={autoCleanupAlertsDays}
        setAutoCleanupAlertsDays={setAutoCleanupAlertsDays}
        autoCleanupListingsDays={autoCleanupListingsDays}
        setAutoCleanupListingsDays={setAutoCleanupListingsDays}
      />

      {/* Advanced — v8.96: imported from ./settings/settings-advanced */}
      <SettingsAdvanced
        settings={settings}
        imageAnalysisEnabled={imageAnalysisEnabled}
        setImageAnalysisEnabled={setImageAnalysisEnabled}
        playwrightEnabled={playwrightEnabled}
        setPlaywrightEnabled={setPlaywrightEnabled}
        telegramInlineButtons={telegramInlineButtons}
        setTelegramInlineButtons={setTelegramInlineButtons}
        telegramWebhookSecret={telegramWebhookSecret}
        setTelegramWebhookSecret={setTelegramWebhookSecret}
      />

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

      {/* v8.42: Full System Backup & Restore (JSON) */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <HardDriveDownload className="w-4 h-4 text-primary" />
            💾 Full System Backup &amp; Restore (JSON) <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v8.42</Badge>
          </CardTitle>
          <CardDescription>
            Prenosljiv, človeku berljiv JSON backup VSEH 18 tabel (Profile, Settings, Trades, BrainSnapshots, ActionDrafts, Notifications, Monitors, Listings, Alerts, ...). Restore z 3 modi (zamenjaj / združi / preskoči). Avtomatski dnevni backup ob 02:00.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FullBackupSection />
        </CardContent>
      </Card>

      {/* Push — v8.96: imported from ./settings/settings-push */}
      <SettingsPush
        settings={settings}
        pushEnabled={pushEnabled}
        setPushEnabled={setPushEnabled}
        pushSupported={pushSupported}
        pushSubscribed={pushSubscribed}
        pushLoading={pushLoading}
        subscribePush={subscribePush}
        unsubscribePush={unsubscribePush}
        testPush={testPush}
      />

      {/* v4.2 / v8.39: Profit goal — enhanced with live preview + dedicated set endpoint */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Profit cilj <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.2</Badge>
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v8.39</Badge>
          </CardTitle>
          <CardDescription>
            Nastavi mesečni cilj profit-a. Goal Tracker card na Dashboard prikazuje progress bar, milestones in dnevno potrebnih EUR.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProfitGoalSection
            monthlyProfitGoal={monthlyProfitGoal}
            setMonthlyProfitGoal={setMonthlyProfitGoal}
            saving={saving}
          />
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

      {/* v5.5: Category notification preferences */}
      <CategoryNotificationsSection />

      {/* v5.8: Advanced scraping configuration */}
      <ScrapingConfigSection />

      {/* v5.4: Webhook integrations */}
      <WebhooksSection />

      <div className="text-[11px] text-muted-foreground text-center pb-4">
        Zadnja posodobitev nastavitev: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('sl-SI') : '—'}
      </div>
    </div>
  );
}

// v8.39: Profit Goal section — imported from ./settings/profit-goal-section

// v1.3: Backup section (incl. v4.7 JsonBackupControls) — imported from ./settings/backup-section

// v5.4: Webhook integrations section — imported from ./settings/webhooks-section

// v5.5: Category notification preferences section — imported from ./settings/category-notifications-section

// v5.8: Advanced scraping configuration section — imported from ./settings/scraping-config-section

// v8.42: Full System Backup & Restore — imported from ./settings/full-backup-section

