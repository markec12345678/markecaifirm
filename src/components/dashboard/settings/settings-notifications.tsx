'use client';

// v8.96: SettingsNotifications — Telegram + Discord + Email sekcije.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Bell, Mail, RefreshCw, Send, Bot, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Settings } from './types';

interface TestResult {
  ok: boolean;
  message: string;
}

export interface SettingsNotificationsProps {
  settings: Settings;
  // Telegram
  telegramBotToken: string;
  setTelegramBotToken: (s: string) => void;
  telegramChatId: string;
  setTelegramChatId: (s: string) => void;
  telegramEnabled: boolean;
  setTelegramEnabled: (b: boolean) => void;
  testingTg: boolean;
  tgTestResult: TestResult | null;
  testTelegram: () => void;
  // Discord
  discordWebhookUrl: string;
  setDiscordWebhookUrl: (s: string) => void;
  discordEnabled: boolean;
  setDiscordEnabled: (b: boolean) => void;
  testingDc: boolean;
  dcTestResult: TestResult | null;
  testDiscord: () => void;
  // Email
  emailEnabled: boolean;
  setEmailEnabled: (b: boolean) => void;
  emailSmtpHost: string;
  setEmailSmtpHost: (s: string) => void;
  emailSmtpPort: number;
  setEmailSmtpPort: (n: number) => void;
  emailSmtpUser: string;
  setEmailSmtpUser: (s: string) => void;
  emailSmtpPassword: string;
  setEmailSmtpPassword: (s: string) => void;
  emailFrom: string;
  setEmailFrom: (s: string) => void;
  emailTo: string;
  setEmailTo: (s: string) => void;
  testingEmail: boolean;
  emailTestResult: TestResult | null;
  testEmailFn: () => void;
}

export function SettingsNotifications({
  settings,
  telegramBotToken,
  setTelegramBotToken,
  telegramChatId,
  setTelegramChatId,
  telegramEnabled,
  setTelegramEnabled,
  testingTg,
  tgTestResult,
  testTelegram,
  discordWebhookUrl,
  setDiscordWebhookUrl,
  discordEnabled,
  setDiscordEnabled,
  testingDc,
  dcTestResult,
  testDiscord,
  emailEnabled,
  setEmailEnabled,
  emailSmtpHost,
  setEmailSmtpHost,
  emailSmtpPort,
  setEmailSmtpPort,
  emailSmtpUser,
  setEmailSmtpUser,
  emailSmtpPassword,
  setEmailSmtpPassword,
  emailFrom,
  setEmailFrom,
  emailTo,
  setEmailTo,
  testingEmail,
  emailTestResult,
  testEmailFn,
}: SettingsNotificationsProps) {
  return (
    <>
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

          {/* v5.0: Bot commands setup */}
          <div className="border-t border-border pt-3 mt-3">
            <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5 mb-2">
              <Bot className="w-3.5 h-3.5" />
              Bot ukazi (v5.0)
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">NOVO</Badge>
            </h4>
            <p className="text-[11px] text-muted-foreground mb-2">
              Registriraj /ukaze pri Telegramu (da jih bo bot predlagal ko začneš tipkati /).
              Potrebujes nastavljen webhook URL.
            </p>
            <div className="flex items-center gap-2 mb-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/telegram/setup-commands', { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      toast.success(`✓ ${data.message}`);
                    } else {
                      toast.error(data.message ?? data.error ?? 'Napaka');
                    }
                  } catch (e: unknown) {
                    toast.error((e as Error)?.message ?? 'Napaka');
                  }
                }}
                className="gap-2 h-8"
              >
                <Bot className="w-3.5 h-3.5" />
                Registriraj ukaze
              </Button>
              <a
                href="https://core.telegram.org/bots/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:underline"
              >
                Kako nastaviti webhook?
              </a>
            </div>
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">📋 Razpoložljivi ukazi</summary>
              <div className="mt-2 space-y-1 bg-background/30 rounded p-2">
                <div><code className="text-primary">/help</code> — ta pomoč</div>
                <div><code className="text-primary">/status</code> — stanje sistema</div>
                <div><code className="text-primary">/run [id]</code> — poženi vse ali specifičen monitor</div>
                <div><code className="text-primary">/alerts [n]</code> — zadnjih N alertov</div>
                <div><code className="text-primary">/listings [n]</code> — zadnjih N oglasov</div>
                <div><code className="text-primary">/monitors</code> — seznam monitorjev</div>
                <div><code className="text-primary">/trades</code> — pregled skladišča</div>
                <div><code className="text-primary">/stats</code> — ključne statistike</div>
                <div><code className="text-primary">/ping</code> — preveri ali bot deluje</div>
              </div>
            </details>
          </div>
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

      {/* v2.7: Email card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Email (SMTP) <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.7</Badge>
          </CardTitle>
          <CardDescription>
            Pošiljaj alerte na email. Podpira Gmail, Outlook, ali custom SMTP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider">SMTP Host</Label>
              <Input value={emailSmtpHost} onChange={(e) => setEmailSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">SMTP Port</Label>
              <Input type="number" value={emailSmtpPort} onChange={(e) => setEmailSmtpPort(parseInt(e.target.value, 10) || 587)} placeholder="587" className="mt-1 font-mono text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider">SMTP Uporabnik</Label>
              <Input value={emailSmtpUser} onChange={(e) => setEmailSmtpUser(e.target.value)} placeholder="tvoj.email@gmail.com" className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">SMTP Geslo</Label>
              <Input type="password" value={emailSmtpPassword} onChange={(e) => setEmailSmtpPassword(e.target.value)} placeholder={settings?.emailSmtpPasswordSet ? 'shranjeno — pusti prazno' : 'app-specific password'} className="mt-1 font-mono text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider">Od (From)</Label>
              <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="tvoj.email@gmail.com" className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">Za (To)</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="tvoj.email@gmail.com" className="mt-1 font-mono text-xs" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Gmail: uporabi App Password (ne običajno geslo). Nastavi na myaccount.google.com → Security → App passwords.
          </p>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
              <p className="text-sm font-medium">Omogoči Email</p>
            </div>
            <Button size="sm" variant="outline" onClick={testEmailFn} disabled={testingEmail} className="gap-2">
              {testingEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </Button>
          </div>
          {emailTestResult && (
            <p className={cn('text-xs flex items-center gap-1.5', emailTestResult.ok ? 'text-primary' : 'text-destructive')}>
              {emailTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {emailTestResult.message}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
