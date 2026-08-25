'use client';

// v5.8: Advanced scraping configuration section
// Izločeno iz settings-view.tsx (samostojna komponenta, brez props).

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Zap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export function ScrapingConfigSection() {
  const [proxyList, setProxyList] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [realisticHeaders, setRealisticHeaders] = useState(true);
  const [minDelay, setMinDelay] = useState(1000);
  const [maxDelay, setMaxDelay] = useState(5000);
  const [stealthMode, setStealthMode] = useState(false);
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [captchaApiKey, setCaptchaApiKey] = useState('');
  const [captchaProvider, setCaptchaProvider] = useState('2captcha');
  const [captchaApiKeyAnticaptcha, setCaptchaApiKeyAnticaptcha] = useState('');
  const [captchaApiKeyCapmonster, setCaptchaApiKeyCapmonster] = useState('');
  const [captchaCustomApiUrl, setCaptchaCustomApiUrl] = useState('');
  const [tlsFingerprinting, setTlsFingerprinting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setProxyList(data.proxyList || '[]');
        setProxyEnabled(data.proxyEnabled ?? false);
        setRealisticHeaders(data.realisticHeaders ?? true);
        setMinDelay(data.requestMinDelay ?? 1000);
        setMaxDelay(data.requestMaxDelay ?? 5000);
        setStealthMode(data.stealthMode ?? false);
        setCaptchaEnabled(data.captchaSolverEnabled ?? false);
        setCaptchaProvider(data.captchaProvider || '2captcha');
        setTlsFingerprinting(data.tlsFingerprinting ?? false);
        setCaptchaCustomApiUrl(data.captchaCustomApiUrl || '');
        setLoaded(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyList,
          proxyEnabled,
          realisticHeaders,
          requestMinDelay: minDelay,
          requestMaxDelay: maxDelay,
          stealthMode,
          captchaSolverEnabled: captchaEnabled,
          captchaProvider,
          tlsFingerprinting,
          captchaCustomApiUrl,
          ...(captchaApiKey ? { captchaApiKey } : {}),
          ...(captchaApiKeyAnticaptcha ? { captchaApiKeyAnticaptcha } : {}),
          ...(captchaApiKeyCapmonster ? { captchaApiKeyCapmonster } : {}),
        }),
      });
      toast.success('Scraping nastavitve shranjene');
    } catch { toast.error('Napaka'); }
    finally { setSaving(false); }
  };

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Napredno scrapanje (anti-detection)
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.8</Badge>
        </CardTitle>
        <CardDescription>
          Tehnike za boljše scrapanje: rotacija proxyjev, realistični headers, randomizacija timing-a, stealth mode, CAPTCHA reševanje.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">🔄 Rotacija proxyjev</Label>
            <Switch checked={proxyEnabled} onCheckedChange={setProxyEnabled} />
          </div>
          {proxyEnabled && (
            <div>
              <Label className="text-[11px] text-muted-foreground">Proxy seznam (JSON array)</Label>
              <Textarea
                value={proxyList}
                onChange={(e) => setProxyList(e.target.value)}
                placeholder={'[\n  {"url": "http://1.2.3.4:8080", "type": "http"},\n  {"url": "socks5://5.6.7.8:1080", "type": "socks5", "username": "user", "password": "pass"}\n]'}
                className="mt-1 text-[11px] font-mono min-h-[100px]"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Round-robin rotacija. Podpira HTTP in SOCKS5 z optional avtentikacijo. Priporočeno: Residential Proxies.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">🎭 Realistični headers</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">Rotacija User-Agent (9 različnih), Accept-Language, Referer, Sec-Fetch.</p>
          </div>
          <Switch checked={realisticHeaders} onCheckedChange={setRealisticHeaders} />
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">⏱️ Randomizacija timing-a</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min="0" value={minDelay} onChange={(e) => setMinDelay(parseInt(e.target.value, 10) || 0)} className="text-xs font-mono w-24" />
            <span className="text-xs text-muted-foreground">do</span>
            <Input type="number" min="0" value={maxDelay} onChange={(e) => setMaxDelay(parseInt(e.target.value, 10) || 0)} className="text-xs font-mono w-24" />
            <span className="text-xs text-muted-foreground">ms naključni delay</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">🥷 Stealth mode (Playwright)</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">Headless browser z anti-detection (override webdriver, plugins, chrome runtime).</p>
          </div>
          <Switch checked={stealthMode} onCheckedChange={setStealthMode} />
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">🔐 CAPTCHA reševanje (multi-provider)</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Podpora za 4 providerje z avtomatskim fallback chain.</p>
            </div>
            <Switch checked={captchaEnabled} onCheckedChange={setCaptchaEnabled} />
          </div>
          {captchaEnabled && (
            <div className="space-y-2">
              {/* Primary provider selector */}
              <div>
                <Label className="text-[11px] text-muted-foreground">Primarni provider</Label>
                <select
                  value={captchaProvider}
                  onChange={(e) => setCaptchaProvider(e.target.value)}
                  className="mt-1 w-full bg-card border border-border rounded px-2 py-1.5 text-xs"
                >
                  <option value="2captcha">2captcha (2captcha.com)</option>
                  <option value="anti-captcha">Anti-Captcha (anti-captcha.com)</option>
                  <option value="capmonster">CapMonster Cloud (capmonster.cloud)</option>
                  <option value="custom">Custom provider</option>
                </select>
              </div>

              {/* API keys for all providers */}
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">2captcha API ključ {captchaProvider === '2captcha' && '(primarni)'}</Label>
                  <Input type="password" value={captchaApiKey} onChange={(e) => setCaptchaApiKey(e.target.value)} placeholder={captchaProvider === '2captcha' ? '••••••••' : 'fallback (opcionalno)'} className="mt-1 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Anti-Captcha API ključ {captchaProvider === 'anti-captcha' && '(primarni)'}</Label>
                  <Input type="password" value={captchaApiKeyAnticaptcha} onChange={(e) => setCaptchaApiKeyAnticaptcha(e.target.value)} placeholder={captchaProvider === 'anti-captcha' ? '••••••••' : 'fallback (opcionalno)'} className="mt-1 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">CapMonster API ključ {captchaProvider === 'capmonster' && '(primarni)'}</Label>
                  <Input type="password" value={captchaApiKeyCapmonster} onChange={(e) => setCaptchaApiKeyCapmonster(e.target.value)} placeholder={captchaProvider === 'capmonster' ? '••••••••' : 'fallback (opcionalno)'} className="mt-1 text-xs font-mono" />
                </div>
                {captchaProvider === 'custom' && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Custom API URL</Label>
                    <Input type="text" value={captchaCustomApiUrl} onChange={(e) => setCaptchaCustomApiUrl(e.target.value)} placeholder="https://my-captcha-solver.com/api" className="mt-1 text-xs font-mono" />
                    <p className="text-[9px] text-muted-foreground mt-0.5">Mora podpirati /createTask in /getTaskResult (Anti-Captcha kompatibilen API).</p>
                  </div>
                )}
              </div>
              <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-[10px] text-blue-400">
                💡 <b>Fallback chain:</b> Če primarni provider odpove, avtomatsko preizkusi ostale z nastavljenimi ključi. Tako si odporen proti izpadom posameznega providerja.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            <Label className="text-xs uppercase tracking-wider flex items-center gap-1.5">🔒 TLS fingerprinting</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Custom TLS handshake z 3 profili (Chrome 120, Firefox 121, Safari 17).
              Mimicira cipher suites, ALPN, EC DH curves, signature algorithms, JA3 fingerprint.
            </p>
          </div>
          <Switch checked={tlsFingerprinting} onCheckedChange={setTlsFingerprinting} />
        </div>

        <Button size="sm" onClick={save} disabled={saving} className="gap-2 mt-2">
          {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          Shrani scraping nastavitve
        </Button>

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">📖 Priporočila</summary>
          <div className="mt-2 space-y-2 bg-background/30 rounded p-2">
            <p><b>🔴 Brez zaščite:</b> Samo osnovni User-Agent. Hitro blokirano.</p>
            <p><b>🟡 Osnovna:</b> Realistični headers + randomizacija. Dosti boljše.</p>
            <p><b>🟢 Polna:</b> Proxy + stealth + CAPTCHA. Najbolj zanesljivo (počasnejše, plačljivo).</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
