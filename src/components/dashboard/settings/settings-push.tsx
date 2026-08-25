'use client';

// v8.96: SettingsPush — PWA + Push notifications card.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Send, Smartphone, SmartphoneCharging } from 'lucide-react';
import type { Settings } from './types';

export interface SettingsPushProps {
  settings: Settings;
  pushEnabled: boolean;
  setPushEnabled: (b: boolean) => void;
  pushSupported: boolean;
  pushSubscribed: boolean;
  pushLoading: boolean;
  subscribePush: () => void;
  unsubscribePush: () => void;
  testPush: () => void;
}

export function SettingsPush({
  settings,
  pushEnabled,
  setPushEnabled,
  pushSupported,
  pushSubscribed,
  pushLoading,
  subscribePush,
  unsubscribePush,
  testPush,
}: SettingsPushProps) {
  return (
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
  );
}
