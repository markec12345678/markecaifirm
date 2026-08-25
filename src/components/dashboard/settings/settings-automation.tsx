'use client';

// v8.96: SettingsAutomation — Heartbeat + Digest (z AI daily summary) + Tihe ure + Samodejni cleanup + Cron info.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).
// Inline onClick handlerji (fetch) so obdržani v komponenti po navodilih.

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Send, Bell, Trash2, Mail, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings } from './types';

type AiSummarySending = 'telegram' | 'email' | 'preview' | null;

export interface SettingsAutomationProps {
  settings: Settings;
  // Heartbeat
  heartbeatEnabled: boolean;
  setHeartbeatEnabled: (b: boolean) => void;
  heartbeatHour: number;
  setHeartbeatHour: (n: number) => void;
  heartbeatSending: boolean;
  setHeartbeatSending: (b: boolean) => void;
  // Digest
  digestMode: string;
  setDigestMode: (s: string) => void;
  digestHour: number;
  setDigestHour: (n: number) => void;
  digestSending: boolean;
  setDigestSending: (b: boolean) => void;
  // AI daily summary
  aiSummarySending: AiSummarySending;
  setAiSummarySending: (v: AiSummarySending) => void;
  aiSummaryPreview: { summary?: string; stats?: { opportunitiesFound?: number } } | null;
  setAiSummaryPreview: (v: { summary?: string; stats?: { opportunitiesFound?: number } } | null) => void;
  // Quiet hours
  quietHoursEnabled: boolean;
  setQuietHoursEnabled: (b: boolean) => void;
  quietStartHour: number;
  setQuietStartHour: (n: number) => void;
  quietEndHour: number;
  setQuietEndHour: (n: number) => void;
  // Auto-cleanup
  autoCleanupEnabled: boolean;
  setAutoCleanupEnabled: (b: boolean) => void;
  autoCleanupAlertsDays: number;
  setAutoCleanupAlertsDays: (n: number) => void;
  autoCleanupListingsDays: number;
  setAutoCleanupListingsDays: (n: number) => void;
}

export function SettingsAutomation({
  settings,
  heartbeatEnabled,
  setHeartbeatEnabled,
  heartbeatHour,
  setHeartbeatHour,
  heartbeatSending,
  setHeartbeatSending,
  digestMode,
  setDigestMode,
  digestHour,
  setDigestHour,
  digestSending,
  setDigestSending,
  aiSummarySending,
  setAiSummarySending,
  aiSummaryPreview,
  setAiSummaryPreview,
  quietHoursEnabled,
  setQuietHoursEnabled,
  quietStartHour,
  setQuietStartHour,
  quietEndHour,
  setQuietEndHour,
  autoCleanupEnabled,
  setAutoCleanupEnabled,
  autoCleanupAlertsDays,
  setAutoCleanupAlertsDays,
  autoCleanupListingsDays,
  setAutoCleanupListingsDays,
}: SettingsAutomationProps) {
  return (
    <>
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

          {/* v5.2: AI Daily Summary — AI generated report */}
          <div className="border-t border-border pt-3 mt-3">
            <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              AI dnevni povzetek
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.2</Badge>
            </h4>
            <p className="text-[11px] text-muted-foreground mb-3">
              AI analizira zadnje oglase in generira jedrnat povzetek s TOP 3 priložnostmi, trendi in priporočilom. Pošlje se na Telegram in/ali Email.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2 h-8"
                disabled={aiSummarySending === 'telegram'}
                onClick={async () => {
                  setAiSummarySending('telegram');
                  try {
                    const res = await fetch('/api/ai/daily-summary', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sendTelegram: true, hours: 24 }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      toast.success(`✓ AI povzetek poslan na Telegram (${data.stats.opportunitiesFound} priložnosti)`);
                    } else {
                      toast.error(data.error ?? 'Napaka');
                    }
                  } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                  finally { setAiSummarySending(null); }
                }}
              >
                {aiSummarySending === 'telegram' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Pošlji na Telegram
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 h-8"
                disabled={aiSummarySending === 'email'}
                onClick={async () => {
                  setAiSummarySending('email');
                  try {
                    const res = await fetch('/api/ai/daily-summary', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sendEmail: true, hours: 24 }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      toast.success(`✓ AI povzetek poslan na Email (${data.stats.opportunitiesFound} priložnosti)`);
                    } else {
                      toast.error(data.error ?? 'Napaka');
                    }
                  } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                  finally { setAiSummarySending(null); }
                }}
              >
                {aiSummarySending === 'email' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Pošlji na Email
              </Button>
            </div>
            <details className="mt-2 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">📋 Predogled povzetka</summary>
              <div className="mt-2 space-y-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[10px] gap-1"
                  disabled={aiSummarySending === 'preview'}
                  onClick={async () => {
                    setAiSummarySending('preview');
                    setAiSummaryPreview(null);
                    try {
                      const res = await fetch('/api/ai/daily-summary', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hours: 24 }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setAiSummaryPreview(data);
                      } else {
                        toast.error(data.error ?? 'Napaka');
                      }
                    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                    finally { setAiSummarySending(null); }
                  }}
                >
                  {aiSummarySending === 'preview' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Generiraj predogled
                </Button>
                {aiSummaryPreview && (
                  <div className="bg-background/30 border border-border rounded p-2 text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {aiSummaryPreview.summary}
                  </div>
                )}
              </div>
            </details>
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
    </>
  );
}
