'use client';

// v8.96: SettingsAdvanced — AI analiza slik + Bolha Playwright fallback + Telegram inline tipke.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Zap, Cpu, MessageSquare } from 'lucide-react';
import type { Settings } from './types';

export interface SettingsAdvancedProps {
  settings: Settings;
  imageAnalysisEnabled: boolean;
  setImageAnalysisEnabled: (b: boolean) => void;
  playwrightEnabled: boolean;
  setPlaywrightEnabled: (b: boolean) => void;
  telegramInlineButtons: boolean;
  setTelegramInlineButtons: (b: boolean) => void;
  telegramWebhookSecret: string;
  setTelegramWebhookSecret: (s: string) => void;
}

export function SettingsAdvanced({
  settings,
  imageAnalysisEnabled,
  setImageAnalysisEnabled,
  playwrightEnabled,
  setPlaywrightEnabled,
  telegramInlineButtons,
  setTelegramInlineButtons,
  telegramWebhookSecret,
  setTelegramWebhookSecret,
}: SettingsAdvancedProps) {
  return (
    <>
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
    </>
  );
}
