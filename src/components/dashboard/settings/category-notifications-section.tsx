'use client';

// v5.5: Category notification preferences section
// Izločeno iz settings-view.tsx (samostojna komponenta, brez props).

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CategoryNotificationsSection() {
  const [config, setConfig] = useState<Record<string, Record<string, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const categories = [
    { id: 'avto', label: '🚗 Avto', icon: '🚗' },
    { id: 'elektronika', label: '📱 Elektronika', icon: '📱' },
    { id: 'nepremicnine', label: '🏠 Nepremičnine', icon: '🏠' },
    { id: 'orodje', label: '🔧 Orodje', icon: '🔧' },
    { id: 'moda', label: '👕 Moda', icon: '👕' },
    { id: 'sport', label: '⚽ Šport', icon: '⚽' },
    { id: 'pohistvo', label: '🪑 Pohištvo', icon: '🪑' },
    { id: 'zbirateljstvo', label: '🏺 Zbirateljstvo', icon: '🏺' },
    { id: 'drugo', label: '📦 Drugo', icon: '📦' },
  ];

  const channels = [
    { id: 'telegram', label: 'Telegram', icon: '💬' },
    { id: 'discord', label: 'Discord', icon: '🎮' },
    { id: 'push', label: 'Push', icon: '🔔' },
    { id: 'email', label: 'Email', icon: '✉️' },
  ];

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        try {
          setConfig(JSON.parse(data.categoryNotifications || '{}'));
        } catch { setConfig({}); }
        setLoaded(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleChannel = (category: string, channel: string) => {
    setConfig(prev => {
      const next = { ...prev };
      if (!next[category]) next[category] = {};
      next[category][channel] = !next[category][channel];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryNotifications: JSON.stringify(config) }),
      });
      toast.success('Nastavitve shranjene');
    } catch { toast.error('Napaka'); }
    finally { setSaving(false); }
  };

  // Get effective channel for a category (falls back to global = all enabled)
  const getChannels = (cat: string) => {
    const catConfig = config[cat];
    if (!catConfig) return {}; // No override = use global
    return catConfig;
  };

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          Obvestila po kategorijah
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.5</Badge>
        </CardTitle>
        <CardDescription>
          Nastavi katere kanale obveščanja uporabiti za posamezno kategorijo oglasov. Prazno = uporabi globalne nastavitve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nalagam...</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {categories.map(cat => {
                const channels_ = getChannels(cat.id);
                const hasOverride = Object.keys(channels_).length > 0;
                return (
                  <div key={cat.id} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-xs">
                    <span className="w-28 shrink-0 font-medium">{cat.label}</span>
                    <div className="flex items-center gap-1 flex-1">
                      {channels.map(ch => {
                        const isEnabled = channels_[ch.id] === true;
                        const isDisabled = channels_[ch.id] === false;
                        return (
                          <button
                            key={ch.id}
                            onClick={() => toggleChannel(cat.id, ch.id)}
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                              isEnabled
                                ? 'border-primary bg-primary/10 text-primary'
                                : isDisabled
                                  ? 'border-red-500/30 text-red-500/50 line-through'
                                  : 'border-border text-muted-foreground hover:text-foreground'
                            )}
                            title={isEnabled ? `${ch.label}: VKLOPLJENO` : isDisabled ? `${ch.label}: IZKLOPLJENO` : `${ch.label}: globalno`}
                          >
                            {ch.icon} {ch.label}
                          </button>
                        );
                      })}
                    </div>
                    {hasOverride && (
                      <button
                        onClick={() => setConfig(prev => { const next = { ...prev }; delete next[cat.id]; return next; })}
                        className="text-[9px] text-muted-foreground hover:text-red-500 shrink-0"
                      >
                        reset
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-[10px] text-muted-foreground bg-background/30 rounded p-2">
              💡 <b>VKLOPLJENO</b> = vedno pošlji na ta kanal za to kategorijo<br/>
              <b>IZKLOPLJENO</b> = nikoli ne pošlji na ta kanal za to kategorijo<br/>
              <b>Globalno</b> = uporabi nastavitve iz zgornjih sekcij (Telegram/Discord/Push/Email)
            </div>

            <Button size="sm" onClick={save} disabled={saving} className="gap-2">
              {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Shrani nastavitve
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
