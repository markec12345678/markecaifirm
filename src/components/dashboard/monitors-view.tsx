'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Zap, AlertCircle, PauseCircle, Bell, Copy, Square, Tag, Sparkles, Check, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PROMPT_CATEGORIES, getPromptsByCategory } from '@/lib/ai-prompts';

// v3.4: Mini SVG sparkline component
function Sparkline({ data, width = 60, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length === 0 || data.every(d => d === 0)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const points = data.map((d, i) => `${i * step},${height - (d / max) * height}`).join(' ');
  const lastIdx = data.length - 1;
  const lastVal = data[lastIdx];
  const lastX = lastIdx * step;
  const lastY = height - (lastVal / max) * height;
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke="#4ade80" strokeWidth="1.5" />
      <circle cx={lastX} cy={lastY} r="1.5" fill="#4ade80" />
    </svg>
  );
}

type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss' | 'vinted' | 'mobile-de' | 'kleinanzeigen' | 'subito' | 'willhaben' | 'quoka';

interface Monitor {
  id: string;
  name: string;
  source: Source;
  sourceUrl: string;
  keywords: string;
  excludeKeywords: string;
  minPrice: number | null;
  maxPrice: number | null;
  intervalMinutes: number;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  customPrompt: string;
  runStartHour: number | null;
  runEndHour: number | null;
  // v1.3: auto-pause
  consecutiveErrors: number;
  autoPauseThreshold: number;
  autoPausedAt: string | null;
  // v2.2: notification channels
  notificationChannels: string;
  // v4.4: tags
  tags: string;
  createdAt: string;
  _count?: { listings: number; alerts: number };
}

const SOURCE_LABELS: Record<Source, string> = {
  bolha: 'Bolha.com',
  nepremicnine: 'Nepremičnine.net (RSS)',
  avtonet: 'Avtonet.si',
  salomon: 'Salomon.si',
  'custom-rss': 'Custom RSS',
  vinted: 'Vinted.si (API)',
  'mobile-de': 'Mobile.de (DE→SI arbitraža)',
  kleinanzeigen: 'Kleinanzeigen.de (Nemčija)',
  subito: 'Subito.it (Italija)',
  willhaben: 'Willhaben.at (Avstrija)',
  quoka: 'Quoka.de (Nemčija)',
};

const SOURCE_PRESETS: Array<{ source: Source; label: string; url: string; hint: string }> = [
  {
    source: 'nepremicnine',
    label: 'Nepremičnine — 2-sobna LJ do 200k',
    url: 'https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/stanovanje/2-sobno/cena-od-1-do-200-tisoč-evrov/?output=rss',
    hint: 'Po pripravi RSS URL-ja na spletni strani dodaj ?output=rss',
  },
  {
    source: 'bolha',
    label: 'Bolha — iPhone 13 Pro',
    url: 'https://www.bolha.com/index.php?ctl=search&A_3_1=iphone+13+pro&A_12_1=1&A_0_1=0&sort=new',
    hint: 'Iskanje po ključnih besedah na Bolhi',
  },
  {
    source: 'bolha',
    label: 'Bolha — orodje Bosch',
    url: 'https://www.bolha.com/orodja?query=bosch',
    hint: 'Kategorija + iskalni niz',
  },
  {
    source: 'vinted',
    label: 'Vinted — Nike Air Max',
    url: 'https://www.vinted.si/api/v2/catalog/items?search_text=nike%20air%20max&order_by=newest_first',
    hint: 'Vinted API — zamenjaj search_text param',
  },
  // v2.9: Additional templates
  {
    source: 'avtonet',
    label: 'Avtonet — VW Golf do 8000€',
    url: 'https://www.avto.net/adresults.asp?znamka=VOLKSWAGEN&model=GOLF&cenaMIN=0&cenaMAX=8000',
    hint: 'Avtonet iskanje — zamenjaj znamko/model/ceno',
  },
  {
    source: 'nepremicnine',
    label: 'Nepremičnine — hiša Bela krajina',
    url: 'https://www.nepremicnine.net/oglasi-prodaja/bela-krajina/hisa/?output=rss',
    hint: 'Hiše v Beli krajini',
  },
  {
    source: 'vinted',
    label: 'Vinted — Levi\'s jeans',
    url: 'https://www.vinted.si/api/v2/catalog/items?search_text=levis%20jeans&order_by=newest_first',
    hint: 'Vinted — iskanje oblačil',
  },
  {
    source: 'bolha',
    label: 'Bolha — PlayStation 5',
    url: 'https://www.bolha.com/index.php?ctl=search&A_3_1=playstation+5&sort=new',
    hint: 'Igranje konzol na Bolhi',
  },
  // v6.17: mobile.de presets (DE→SI cross-border arbitraža)
  {
    source: 'mobile-de',
    label: 'Mobile.de — BMW Series 3 do 10.000€ (DE→SI)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&make=BMW&model=SERIES_3&priceTo=10000&sortOption=price.asc',
    hint: 'Cross-border: kupi v DE (~15% cenejše), prodaj v SI. Shipping ~400€. Vklopi Playwright v nastavitvah za Cloudflare blokade.',
  },
  {
    source: 'mobile-de',
    label: 'Mobile.de — VW Golf 7 do 10.000€ (DE→SI)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&make=VOLKSWAGEN&model=GOLF&priceTo=10000&yearFrom=2012&sortOption=price.asc',
    hint: 'Najbolj prodajan avto v SI. V DE ~15% cenejši.',
  },
  {
    source: 'mobile-de',
    label: 'Mobile.de — EV avtomobili do 20.000€ (SI subvencija 4500€)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&fuel=ELECTRIC&priceTo=20000&sortOption=price.asc',
    hint: 'Slovenska subvencija 4500€ za EV! 18000€ v DE - 4500€ subvencija = 13900€ efektivno.',
  },
  // v6.18: Tujih trgov presets
  {
    source: 'kleinanzeigen',
    label: 'Kleinanzeigen.de — iPhone 13/14 Pro do 600€ (DE→SI)',
    url: 'https://www.kleinanzeigen.de/s-suchanfrage.html?keywords=iphone+13+pro&priceType:from=300&priceType:to=600',
    hint: 'iPhone v DE ~15% cenejši. Shipping DHL ~12€. Pazi "Ohne iCloud Sperre".',
  },
  {
    source: 'subito',
    label: 'Subito.it — Luxury torbe (Gucci/Prada) do 500€ (IT→SI)',
    url: 'https://www.subito.it/annunci-italia/vendita?q=gucci+borsa&prezzo=200-500',
    hint: 'Italija = domovina Gucci/Prada. Prihranek 30-50% za preprodajo.',
  },
  {
    source: 'willhaben',
    label: 'Willhaben.at — Smuči (Atomic/Head) do 400€ (AT→SI)',
    url: 'https://www.willhaben.at/iad/kaufen-und-verkaufen?keyword=atomic+head+ski&priceFrom=150&priceTo=400',
    hint: 'Avstrija = smučarska država. Atomic in Head sta avstrijski znamki (boljše cene).',
  },
];

export function MonitorsView() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // v4.6: Templates modal
  const [showTemplates, setShowTemplates] = useState(false);
  // v3.4: Sparkline data
  const [sparklines, setSparklines] = useState<Record<string, { sparkline: number[]; totalNew: number; totalAlerts: number; successRate: number }>>({});
  // v4.4: Tag filter
  const [activeTag, setActiveTag] = useState<string>('all');

  // v4.4: Collect all unique tags from monitors
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of monitors) {
      if (m.tags) {
        for (const t of m.tags.split(',').map(s => s.trim()).filter(Boolean)) {
          set.add(t);
        }
      }
    }
    return Array.from(set).sort();
  }, [monitors]);

  // v4.4: Filtered monitors by active tag
  const filteredMonitors = useMemo(() => {
    if (activeTag === 'all') return monitors;
    return monitors.filter(m => {
      if (!m.tags) return false;
      return m.tags.split(',').map(s => s.trim()).includes(activeTag);
    });
  }, [monitors, activeTag]);

  const load = useCallback(async () => {
    try {
      const [res, sparkRes] = await Promise.all([
        fetch('/api/monitors'),
        fetch('/api/monitors/sparkline'),
      ]);
      if (res.ok) setMonitors(await res.json());
      if (sparkRes.ok) {
        const sparkData = await sparkRes.json();
        const map: Record<string, any> = {};
        for (const s of sparkData.sparklines || []) {
          map[s.id] = s;
        }
        setSparklines(map);
      }
    } catch {
      toast.error('Ne morem naložiti monitorjev');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runMonitor = async (id: string) => {
    setRunningIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/monitors/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result.status === 'error') {
        toast.error(`Napaka: ${result.error?.slice(0, 80) ?? 'neznana'}`);
      } else if (result.status === 'empty') {
        toast.info('Ni najdenih oglasov (morda blokada ali narobe URL)');
      } else {
        toast.success(`OK: ${result.newListings} novih, ${result.alertsSent} alertov`);
      }
      await load();
    } catch {
      toast.error('Napaka pri poganjanju');
    } finally {
      setRunningIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const toggleActive = async (m: Monitor) => {
    try {
      // When reactivating, isActive: true triggers reset of consecutiveErrors and autoPausedAt in API
      await fetch(`/api/monitors/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const deleteMonitor = async (m: Monitor) => {
    if (!confirm(`Izbrišem monitor "${m.name}"? Vsi pripadajoči oglasi in alerti bodo izbrisani.`)) return;
    try {
      await fetch(`/api/monitors/${m.id}`, { method: 'DELETE' });
      toast.success('Monitor izbrisan');
      await load();
    } catch {
      toast.error('Napaka pri brisanju');
    }
  };

  // v3.2: Clone monitor
  const cloneMonitor = async (m: Monitor) => {
    try {
      const res = await fetch(`/api/monitors/${m.id}/clone`, { method: 'POST' });
      if (res.ok) {
        toast.success(`Monitor kloniran: "${m.name} (kopija)" — aktiviraj v seznamu`);
        await load();
      } else {
        toast.error('Napaka pri kloniranju');
      }
    } catch {
      toast.error('Napaka');
    }
  };

  // v3.2: Batch run selected monitors
  const batchRun = async () => {
    if (selectedIds.size === 0) return;
    setBatchRunning(true);
    try {
      const res = await fetch('/api/monitors/batch-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        const ok = data.results.filter((r: any) => r.status === 'ok').length;
        const err = data.results.filter((r: any) => r.status === 'error').length;
        toast.success(`Pognano ${ok} monitorjev${err > 0 ? `, ${err} napak` : ''}`);
        setSelectedIds(new Set());
        await load();
      }
    } catch {
      toast.error('Napaka pri batch poganjanju');
    } finally {
      setBatchRunning(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Monitorji
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Konfigurirana iskanja na slovenskih trgih.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v3.7: Pause all / Resume all */}
          {monitors.some(m => m.isActive) && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const activeIds = monitors.filter(m => m.isActive).map(m => m.id);
                if (activeIds.length === 0) return;
                try {
                  await fetch('/api/monitors/batch-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: activeIds, active: false }),
                  });
                  toast.success(`${activeIds.length} monitorjev pavziranih`);
                  await load();
                } catch { toast.error('Napaka'); }
              }}
              className="gap-2 text-xs h-8"
            >
              <PauseCircle className="w-3.5 h-3.5" /> Pavziraj vse
            </Button>
          )}
          {monitors.some(m => !m.isActive) && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const pausedIds = monitors.filter(m => !m.isActive).map(m => m.id);
                if (pausedIds.length === 0) return;
                try {
                  await fetch('/api/monitors/batch-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: pausedIds, active: true }),
                  });
                  toast.success(`${pausedIds.length} monitorjev aktiviranih`);
                  await load();
                } catch { toast.error('Napaka'); }
              }}
              className="gap-2 text-xs h-8 border-primary/40 text-primary hover:bg-primary/10"
            >
              <Play className="w-3.5 h-3.5" /> Aktiviraj vse
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            Nov monitor
          </Button>
          {/* v4.6: Templates button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTemplates(true)}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Predloge
          </Button>
        </div>
      </div>

      {/* v3.2: Batch run toolbar */}
      {selectedIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-primary">{selectedIds.size} izbranih</span>
              <Button size="sm" onClick={batchRun} disabled={batchRunning} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-7">
                {batchRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Zaženi izbrane ({selectedIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7 text-xs">
                Počisti
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-card animate-pulse rounded" />
          ))}
        </div>
      ) : monitors.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8">
            <EmptyState
              icon={<ListPlus className="w-12 h-12" />}
              title="Še ni monitorjev"
              description="Monitorji samodejno preverjajo Bolha, Vinted, Quoka in druge platforme za nove oglase. Ustvari svoj prvi monitor z iskalnim URL-jem."
              action={{
                label: 'Ustvari prvi monitor',
                onClick: () => { setEditing(null); setShowForm(true); },
                icon: <Plus className="w-3.5 h-3.5" />,
              }}
              helpLink="/?view=monitors"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* v4.4: Tag filter chips */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Tag className="w-3 h-3" /> Filter:
              </span>
              <button
                onClick={() => setActiveTag('all')}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                  activeTag === 'all'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                Vsi ({monitors.length})
              </button>
              {allTags.map(tag => {
                const count = monitors.filter(m =>
                  m.tags && m.tags.split(',').map(s => s.trim()).includes(tag)
                ).length;
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      activeTag === tag
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    )}
                  >
                    {tag} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {filteredMonitors.length === 0 ? (
            <Card className="bg-card/50">
              <CardContent className="p-6 text-center text-xs text-muted-foreground">
                Noben monitor nima taga "{activeTag}".
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredMonitors.map((m) => (
                <Card key={m.id} className={cn('bg-card/50 hover:bg-card transition-colors', !m.isActive && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-sm truncate">{m.name}</h3>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[m.source]}</Badge>
                      {/* v4.4: tag badges */}
                      {m.tags && m.tags.split(',').map(s => s.trim()).filter(Boolean).map(tag => (
                        <button
                          key={tag}
                          onClick={() => setActiveTag(tag)}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                            activeTag === tag
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-primary/30 text-primary/70 hover:border-primary/60'
                          )}
                          title={`Filtriraj po: ${tag}`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary/70 hover:text-primary truncate block max-w-full"
                    >
                      <ExternalLink className="w-3 h-3 inline mr-1" />
                      {m.sourceUrl.length > 60 ? m.sourceUrl.slice(0, 60) + '...' : m.sourceUrl}
                    </a>
                  </div>
                  <Switch checked={m.isActive} onCheckedChange={() => toggleActive(m)} />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mb-3">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> vsakih {m.intervalMinutes}min
                  </span>
                  {m.runStartHour != null && m.runEndHour != null && (
                    <span className="text-primary">
                      • {String(m.runStartHour).padStart(2, '0')}:00–{String(m.runEndHour).padStart(2, '0')}:00
                    </span>
                  )}
                  {m.minPrice != null && <span>min {m.minPrice}€</span>}
                  {m.maxPrice != null && <span>max {m.maxPrice}€</span>}
                  {m.keywords && <span className="text-amber-400">+{m.keywords.split(',').length} kw</span>}
                  {m._count && (
                    <>
                      <span>•</span>
                      <span>{m._count.listings} oglasov</span>
                      <span>{m._count.alerts} alertov</span>
                    </>
                  )}
                </div>

                {/* v3.4: Sparkline + stats */}
                {sparklines[m.id] && (
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <Sparkline data={sparklines[m.id].sparkline} />
                    <span>{sparklines[m.id].totalNew} novih v 14d</span>
                    {sparklines[m.id].totalAlerts > 0 && (
                      <span className="text-primary">{sparklines[m.id].totalAlerts} alertov</span>
                    )}
                    <span className={cn(
                      'text-[10px]',
                      sparklines[m.id].successRate >= 0.9 ? 'text-primary' :
                      sparklines[m.id].successRate >= 0.7 ? 'text-amber-400' : 'text-destructive'
                    )}>
                      {Math.round(sparklines[m.id].successRate * 100)}% uspeh
                    </span>
                    {/* v4.3: Next run preview */}
                    {m.isActive && m.lastRunAt && (() => {
                      const lastRun = new Date(m.lastRunAt);
                      const nextRun = new Date(lastRun.getTime() + m.intervalMinutes * 60 * 1000);
                      const now = new Date();
                      const isOverdue = nextRun < now;
                      if (isOverdue) {
                        return <span className="text-amber-400 text-[10px]">⚡ zapadlo</span>;
                      }
                      const minsLeft = Math.round((nextRun.getTime() - now.getTime()) / 60000);
                      if (minsLeft < 60) {
                        return <span className="text-[10px]">⏱ čez {minsLeft}min</span>;
                      }
                      const hoursLeft = Math.floor(minsLeft / 60);
                      const remMins = minsLeft % 60;
                      return <span className="text-[10px]">⏱ čez {hoursLeft}h{remMins > 0 ? `${remMins}m` : ''}</span>;
                    })()}
                  </div>
                )}

                {/* v1.3: auto-paused warning */}
                {m.autoPausedAt && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-400 mb-2 p-2 bg-amber-400/5 border border-amber-400/20 rounded">
                    <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Auto-paused {formatTimeAgo(m.autoPausedAt)} po {m.consecutiveErrors} zaporednih napakah.
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleActive(m); }}
                        className="ml-1 underline hover:text-amber-300"
                      >
                        Reaktiviraj
                      </button>
                    </span>
                  </div>
                )}
                {!m.autoPausedAt && m.consecutiveErrors > 0 && m.autoPauseThreshold > 0 && (
                  <div className="text-[10px] text-amber-400/70 mb-2">
                    ⚠ {m.consecutiveErrors}/{m.autoPauseThreshold} zaporednih napak
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* v3.2: Batch select checkbox */}
                    <button
                      onClick={() => toggleSelect(m.id)}
                      className={cn(
                        'w-4 h-4 rounded border shrink-0 transition-colors',
                        selectedIds.has(m.id) ? 'bg-primary border-primary' : 'border-border hover:border-primary'
                      )}
                    >
                      {selectedIds.has(m.id) && <CheckCircle2 className="w-3 h-3 text-primary-foreground mx-auto" />}
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      {m.lastStatus === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                      {m.lastStatus === 'error' && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                      {m.lastStatus === 'empty' && <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                      {m.lastStatus === null && <span className="text-muted-foreground text-[11px]">še ni pognan</span>}
                      {m.lastRunAt && (
                        <span className="text-muted-foreground text-[11px]">
                          {formatTimeAgo(m.lastRunAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runMonitor(m.id)}
                      disabled={runningIds.has(m.id)}
                      className="h-7 px-2 gap-1 text-xs"
                    >
                      {runningIds.has(m.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Poženi
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cloneMonitor(m)}
                      className="h-7 w-7 p-0"
                      title="Kloniraj monitor"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditing(m); setShowForm(true); }}
                      className="h-7 px-2"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMonitor(m)}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                {m.lastError && (
                  <div className="text-xs text-destructive mt-2">
                    <details className="cursor-pointer">
                      <summary className="truncate select-none hover:text-destructive/80">
                        ⚠ {m.lastError.slice(0, 80)}{m.lastError.length > 80 ? '...' : ''}
                      </summary>
                      <div className="mt-1 p-2 bg-destructive/5 border border-destructive/20 rounded text-[11px] font-mono whitespace-pre-wrap break-all">
                        {m.lastError}
                      </div>
                    </details>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
            </div>
          )}
        </>
      )}

      <MonitorFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        editing={editing}
        onSaved={() => { setShowForm(false); load(); }}
      />

      {/* v4.6: Templates modal */}
      <TemplateModal
        open={showTemplates}
        onOpenChange={setShowTemplates}
        onCreated={() => { setShowTemplates(false); load(); }}
      />
    </div>
  );
}

// v4.6: Template modal — pick from pre-configured monitors
function TemplateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/monitors/from-template');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const createFromTemplate = async (tpl: any) => {
    setCreating(tpl.id);
    try {
      const res = await fetch('/api/monitors/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tpl.id }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Monitor ustvarjen: ${data.monitor.name}`);
        onCreated();
      } else {
        if (data.existingId) {
          toast.error(`Monitor s tem imenom/URL že obstaja`);
        } else {
          toast.error(data.error ?? 'Napaka');
        }
      }
    } catch {
      toast.error('Napaka pri ustvarjanju');
    } finally {
      setCreating(null);
    }
  };

  if (!open) return null;

  const categories = [
    { id: 'all', label: 'Vse', icon: '📋' },
    { id: 'elektronika', label: 'Elektronika', icon: '📱' },
    { id: 'avto', label: 'Avto', icon: '🚗' },
    { id: 'nepremicnine', label: 'Nepremičnine', icon: '🏠' },
    { id: 'moda', label: 'Moda', icon: '👕' },
    { id: 'orodje', label: 'Orodje', icon: '🔧' },
    { id: 'sport', label: 'Sport', icon: '⚽' },
    { id: 'drugo', label: 'Drugo', icon: '📦' },
  ];

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Knjižnica predlog monitorjev
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.6</Badge>
          </DialogTitle>
          <DialogDescription>
            Prednastavljeni monitorji za običajne scenarije. Vsaka predloga vsebuje vir, filtre, cene in AI navodila.
          </DialogDescription>
        </DialogHeader>

        {/* Category tabs */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'px-2 py-1 rounded text-xs border transition-colors',
                activeCategory === c.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              )}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Nalagam predloge...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            V tej kategoriji ni predlog.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map(tpl => (
              <div
                key={tpl.id}
                className="bg-card/50 border border-border rounded p-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="text-2xl shrink-0">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm">{tpl.name}</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <Badge variant="outline" className="text-[9px]">{tpl.source}</Badge>
                  {tpl.minPrice != null && tpl.maxPrice != null && (
                    <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30">
                      {tpl.minPrice}–{tpl.maxPrice}€
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">
                    vsakih {tpl.intervalMinutes}min
                  </Badge>
                  {tpl.tags && tpl.tags.split(',').slice(0, 2).map((tag: string) => (
                    <span key={tag} className="text-[9px] text-primary/70">#{tag.trim()}</span>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  onClick={() => createFromTemplate(tpl)}
                  disabled={creating === tpl.id}
                >
                  {creating === tpl.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Ustvari monitor
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border">
          💡 Po ustvarjanju lahko monitor urediš (URL, cene, AI navodila) v standardni formi.
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MonitorFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Monitor | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('bolha');
  const [sourceUrl, setSourceUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [customPrompt, setCustomPrompt] = useState('');
  // v4.9: AI prompt library modal
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  // v5.1: AI scheduler suggestion
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSuggestion, setScheduleSuggestion] = useState<any>(null);
  // v5.2: AI filter suggestion
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterSuggestion, setFilterSuggestion] = useState<any>(null);
  // v4.4: tags
  const [tags, setTags] = useState('');
  // v1.2: schedule window
  const [useSchedule, setUseSchedule] = useState(false);
  const [runStartHour, setRunStartHour] = useState(7);
  const [runEndHour, setRunEndHour] = useState(23);
  // v1.3: auto-pause
  const [autoPauseThreshold, setAutoPauseThreshold] = useState(5);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  // v2.5: notification channels
  const [useCustomChannels, setUseCustomChannels] = useState(false);
  const [chanTelegram, setChanTelegram] = useState(true);
  const [chanDiscord, setChanDiscord] = useState(true);
  const [chanSlack, setChanSlack] = useState(true);
  const [chanPush, setChanPush] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setSource(editing.source);
      setSourceUrl(editing.sourceUrl);
      setKeywords(editing.keywords);
      setExcludeKeywords(editing.excludeKeywords);
      setMinPrice(editing.minPrice?.toString() ?? '');
      setMaxPrice(editing.maxPrice?.toString() ?? '');
      setIntervalMinutes(editing.intervalMinutes);
      setCustomPrompt(editing.customPrompt);
      setTags(editing.tags ?? '');
      setUseSchedule(editing.runStartHour != null && editing.runEndHour != null);
      setRunStartHour(editing.runStartHour ?? 7);
      setRunEndHour(editing.runEndHour ?? 23);
      setAutoPauseThreshold(editing.autoPauseThreshold ?? 5);
      setScheduleSuggestion(null); // v5.1: reset AI suggestion
      setFilterSuggestion(null); // v5.2: reset filter suggestion
      // v2.5: Load notification channels
      try {
        const ch = JSON.parse(editing.notificationChannels || '{}');
        const hasCustom = Object.keys(ch).length > 0;
        setUseCustomChannels(hasCustom);
        setChanTelegram(ch.telegram ?? true);
        setChanDiscord(ch.discord ?? true);
        setChanSlack(ch.slack ?? true);
        setChanPush(ch.push ?? true);
      } catch {
        setUseCustomChannels(false);
      }
    } else {
      setName('');
      setSource('bolha');
      setSourceUrl('');
      setKeywords('');
      setExcludeKeywords('');
      setMinPrice('');
      setMaxPrice('');
      setIntervalMinutes(30);
      setCustomPrompt('');
      setTags('');
      setUseSchedule(false);
      setRunStartHour(7);
      setRunEndHour(23);
      setAutoPauseThreshold(5);
      setScheduleSuggestion(null); // v5.1: reset AI suggestion
      setFilterSuggestion(null); // v5.2: reset filter suggestion
      setUseCustomChannels(false);
      setChanTelegram(true);
      setChanDiscord(true);
      setChanSlack(true);
      setChanPush(true);
    }
    setDryRunResult(null);
  }, [editing, open]);

  const applyPreset = (preset: typeof SOURCE_PRESETS[number]) => {
    setSource(preset.source);
    setSourceUrl(preset.url);
    if (!name) setName(preset.label);
  };

  // v1.3: dry-run — test scraping without saving or AI
  const dryRun = async () => {
    if (!sourceUrl.trim()) {
      toast.error('Vnesi URL za test');
      return;
    }
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const res = await fetch('/api/monitors/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          sourceUrl: sourceUrl.trim(),
          keywords,
          excludeKeywords,
          minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
          maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
        }),
      });
      const data = await res.json();
      setDryRunResult(data);
      if (data.ok) {
        toast.success(`OK: ${data.count} oglasov najdenih v ${data.durationMs}ms`);
      } else {
        toast.error(`Napaka: ${data.error?.slice(0, 80)}`);
      }
    } catch (e: any) {
      setDryRunResult({ ok: false, error: e?.message ?? 'Napaka' });
      toast.error('Dry-run ni uspel');
    } finally {
      setDryRunLoading(false);
    }
  };

  const save = async () => {
    if (!name.trim() || !sourceUrl.trim()) {
      toast.error('Ime in URL sta obvezna');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        source,
        sourceUrl: sourceUrl.trim(),
        keywords: keywords.trim(),
        excludeKeywords: excludeKeywords.trim(),
        minPrice: minPrice ? parseInt(minPrice, 10) : null,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : null,
        intervalMinutes,
        customPrompt: customPrompt.trim(),
        // v4.4: tags
        tags: tags.trim(),
        // v1.2: schedule window
        runStartHour: useSchedule ? runStartHour : null,
        runEndHour: useSchedule ? runEndHour : null,
        // v1.3: auto-pause threshold
        autoPauseThreshold,
        // v2.5: notification channels
        notificationChannels: useCustomChannels
          ? JSON.stringify({ telegram: chanTelegram, discord: chanDiscord, slack: chanSlack, push: chanPush })
          : '{}',
      };
      const res = await fetch(
        editing ? `/api/monitors/${editing.id}` : '/api/monitors',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'napaka');
      }
      toast.success(editing ? 'Monitor posodobljen' : 'Monitor dodan');
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Uredi monitor' : 'Nov monitor'}</DialogTitle>
          <DialogDescription>
            Konfiguriraj vir, filtre in AI navodila za ta monitor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Presets */}
          {!editing && (
            <div>
              <Label className="text-xs uppercase tracking-wider">Hitri prednastavitve</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {SOURCE_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant="outline"
                    onClick={() => applyPreset(p)}
                    className="text-xs h-7"
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="m-name" className="text-xs uppercase tracking-wider">Ime *</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="npr. iPhone 13 Pro na Bolhi"
              className="mt-1 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-source" className="text-xs uppercase tracking-wider">Vir *</Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger id="m-source" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="m-interval" className="text-xs uppercase tracking-wider">Interval (min)</Label>
              <Input
                id="m-interval"
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10) || 30)}
                className="mt-1 font-mono"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="m-url" className="text-xs uppercase tracking-wider flex items-center justify-between">
              <span>URL iskanja / RSS *</span>
              <Button
                size="sm"
                variant="outline"
                onClick={dryRun}
                disabled={dryRunLoading}
                className="h-6 px-2 text-[10px] gap-1"
              >
                {dryRunLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Test URL
              </Button>
            </Label>
            <Input
              id="m-url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.bolha.com/...  ali  https://www.nepremicnine.net/.../?output=rss"
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Za Nepremičnine: obišči stran z rezultati iskanja, nastavi filtre, kopiraj URL in dodaj <code>?output=rss</code> na konec.
            </p>
            {dryRunResult && (
              <div className={cn(
                'mt-2 p-2 rounded border text-xs',
                dryRunResult.ok
                  ? 'border-primary/30 bg-primary/5 text-primary'
                  : 'border-amber-400/30 bg-amber-400/5 text-amber-400'
              )}>
                {dryRunResult.ok ? (
                  <>
                    ✓ Najdenih <b>{dryRunResult.count}</b> oglasov v {dryRunResult.durationMs}ms.
                    {dryRunResult.sample?.length > 0 && (
                      <ul className="mt-1 ml-3 list-disc text-[10px] text-muted-foreground">
                        {dryRunResult.sample.slice(0, 3).map((s: any, i: number) => (
                          <li key={i} className="truncate">{s.title} — {s.priceText}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>⚠ {dryRunResult.error}</>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="m-kw" className="text-xs uppercase tracking-wider">Ključne besede (vejice)</Label>
                {/* v5.2: AI filter suggestion */}
                {editing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 text-[10px] gap-1 text-primary px-1"
                    disabled={filterLoading}
                    onClick={async () => {
                      if (!editing) return;
                      setFilterLoading(true);
                      setFilterSuggestion(null);
                      try {
                        const res = await fetch('/api/ai/suggest-filters', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ monitorId: editing.id }),
                        });
                        const data = await res.json();
                        if (data.ok) {
                          setFilterSuggestion(data);
                          toast.success('AI predlog generiran');
                        } else {
                          toast.error(data.error ?? 'Napaka');
                        }
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setFilterLoading(false); }
                    }}
                  >
                    {filterLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    AI filtri
                  </Button>
                )}
              </div>
              <Input
                id="m-kw"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="iphone,13,pro"
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="m-exkw" className="text-xs uppercase tracking-wider">Izključi besede</Label>
              <Input
                id="m-exkw"
                value={excludeKeywords}
                onChange={(e) => setExcludeKeywords(e.target.value)}
                placeholder="pokvarjen,reklama"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          {/* v5.2: AI Filter Suggestion display */}
          {filterSuggestion && (
            <div className="bg-primary/5 border border-primary/20 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-primary flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI predlog filtrov
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                    {filterSuggestion.suggestions.confidence}% zaupanje
                  </Badge>
                </span>
                <button
                  onClick={() => setFilterSuggestion(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >×</button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Trenutni keywords</div>
                  <div className="font-mono text-[11px]">{filterSuggestion.currentKeywords || '(prazno)'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-primary uppercase">Predlog keywords</div>
                  <div className="font-mono text-[11px] text-primary">{filterSuggestion.suggestions.keywords || '(brez sprememb)'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Trenutni exclude</div>
                  <div className="font-mono text-[11px]">{filterSuggestion.currentExcludeKeywords || '(prazno)'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-primary uppercase">Predlog exclude</div>
                  <div className="font-mono text-[11px] text-primary">{filterSuggestion.suggestions.excludeKeywords || '(brez sprememb)'}</div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground italic mb-2">"{filterSuggestion.suggestions.reasoning}"</p>
              {filterSuggestion.analyzedListings != null && (
                <p className="text-[10px] text-muted-foreground mb-2">
                  📊 Analiziranih {filterSuggestion.analyzedListings} oglasov iz tega monitorja.
                </p>
              )}
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs gap-1 w-full"
                onClick={() => {
                  if (filterSuggestion.suggestions.keywords) {
                    setKeywords(filterSuggestion.suggestions.keywords);
                  }
                  if (filterSuggestion.suggestions.excludeKeywords) {
                    setExcludeKeywords(filterSuggestion.suggestions.excludeKeywords);
                  }
                  toast.success('AI predlog filtrov apliciran');
                  setFilterSuggestion(null);
                }}
              >
                <Check className="w-3 h-3" />
                Uporabi predlog
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-min" className="text-xs uppercase tracking-wider">Min cena (€)</Label>
              <Input
                id="m-min"
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="m-max" className="text-xs uppercase tracking-wider">Max cena (€)</Label>
              <Input
                id="m-max"
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="10000"
                className="mt-1 font-mono"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="m-prompt" className="text-xs uppercase tracking-wider">
                Dodatna AI navodila (izbirno)
              </Label>
              {/* v4.9: AI Prompt Library picker */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] gap-1 text-primary"
                onClick={() => setShowPromptLibrary(true)}
              >
                <Sparkles className="w-3 h-3" />
                Knjižnica promptov
              </Button>
            </div>
            <Textarea
              id="m-prompt"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="npr. Posebeš pazi na oglase, ki vsebujejo 'nujna prodaja' — pogosto so podcenjeni. Za iPhone preveri, da ima original embalaža."
              className="mt-1 text-xs min-h-[80px]"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Ta navodila se dodajo AI promptu samo za ta monitor.
            </p>
          </div>

          {/* v4.4: Tags */}
          <div>
            <Label htmlFor="m-tags" className="text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-3 h-3" />
              Oznake (tags) <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.4</Badge>
            </Label>
            <Input
              id="m-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="npr. avto, ljubljana, investicija"
              className="mt-1 text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Loči z vejicami. Uporabne za grupiranje in filtriranje v seznamu monitorjev.
            </p>
          </div>

          {/* v1.2: Schedule window */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label className="text-xs uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Urnik delovanja <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.2</Badge>
                </Label>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Omeji delovanje monitorja na določene ure — prihrani AI klice v nočnem času.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* v5.1: AI Scheduler suggestion */}
                {editing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] gap-1 text-primary"
                    disabled={scheduleLoading}
                    onClick={async () => {
                      if (!editing) return;
                      setScheduleLoading(true);
                      setScheduleSuggestion(null);
                      try {
                        const res = await fetch('/api/ai/suggest-schedule', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ monitorId: editing.id }),
                        });
                        const data = await res.json();
                        if (data.ok && data.suggestions?.[0]) {
                          setScheduleSuggestion(data.suggestions[0]);
                          toast.success('AI predlog generiran');
                        } else {
                          toast.error(data.error ?? 'Napaka');
                        }
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Napaka');
                      } finally {
                        setScheduleLoading(false);
                      }
                    }}
                  >
                    {scheduleLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    AI predlog
                  </Button>
                )}
                <Switch checked={useSchedule} onCheckedChange={setUseSchedule} />
              </div>
            </div>

            {/* v5.1: AI Scheduler suggestion display */}
            {scheduleSuggestion && (
              <div className="bg-primary/5 border border-primary/20 rounded p-3 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-primary flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI predlog urnika
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                      {scheduleSuggestion.confidence}% zaupanje
                    </Badge>
                  </span>
                  <button
                    onClick={() => setScheduleSuggestion(null)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >×</button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Trenutno</div>
                    <div className="font-mono">
                      {scheduleSuggestion.currentInterval}min • {scheduleSuggestion.currentWindow}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-primary uppercase">Predlog</div>
                    <div className="font-mono text-primary">
                      {scheduleSuggestion.suggestedInterval}min • {scheduleSuggestion.suggestedWindow}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
                  <div className="bg-background/30 rounded p-1.5 text-center">
                    <div className="text-muted-foreground">Pričakovani novi/dan</div>
                    <div className="font-mono font-bold text-primary">~{scheduleSuggestion.expectedNewListingsPerDay}</div>
                  </div>
                  <div className="bg-background/30 rounded p-1.5 text-center">
                    <div className="text-muted-foreground">AI klici/dan</div>
                    <div className="font-mono">{scheduleSuggestion.aiCallsPerDay}</div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground italic mb-2">"{scheduleSuggestion.reasoning}"</p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs gap-1 w-full"
                  onClick={() => {
                    setIntervalMinutes(scheduleSuggestion.suggestedInterval);
                    if (scheduleSuggestion.suggestedWindow && scheduleSuggestion.suggestedWindow !== '24/7') {
                      const match = scheduleSuggestion.suggestedWindow.match(/(\d+)-(\d+)/);
                      if (match) {
                        setUseSchedule(true);
                        setRunStartHour(parseInt(match[1], 10));
                        setRunEndHour(parseInt(match[2], 10));
                      }
                    } else {
                      setUseSchedule(false);
                    }
                    toast.success('AI predlog apliciran');
                    setScheduleSuggestion(null);
                  }}
                >
                  <Check className="w-3 h-3" />
                  Uporabi predlog
                </Button>
              </div>
            )}
            {useSchedule && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <Label htmlFor="m-start" className="text-xs uppercase">Od ure</Label>
                  <Input
                    id="m-start"
                    type="number"
                    min={0}
                    max={23}
                    value={runStartHour}
                    onChange={(e) => setRunStartHour(parseInt(e.target.value, 10) || 0)}
                    className="mt-1 font-mono text-center"
                  />
                </div>
                <div>
                  <Label htmlFor="m-end" className="text-xs uppercase">Do ure</Label>
                  <Input
                    id="m-end"
                    type="number"
                    min={0}
                    max={23}
                    value={runEndHour}
                    onChange={(e) => setRunEndHour(parseInt(e.target.value, 10) || 0)}
                    className="mt-1 font-mono text-center"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground col-span-2">
                  {runStartHour <= runEndHour
                    ? `Deluje ${String(runStartHour).padStart(2, '0')}:00–${String(runEndHour).padStart(2, '0')}:00.`
                    : `Deluje ${String(runStartHour).padStart(2, '0')}:00–${String(runEndHour).padStart(2, '0')}:00 (čez polnoč).`}
                  {' '}Preostali čas se preskoči brez napake.
                </p>
              </div>
            )}
          </div>
          {/* v1.3: Auto-pause threshold */}
          <div className="border-t border-border pt-4">
            <Label className="text-xs uppercase tracking-wider flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              Auto-pause po napakah <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.3</Badge>
            </Label>
            <p className="text-[11px] text-muted-foreground mt-1 mb-2">
              Samodejno onemogoči monitor po N zaporednih napakah (prepreči log spam in zapravljanje AI tokenov).
              0 = onemogočeno.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={autoPauseThreshold}
                onChange={(e) => setAutoPauseThreshold(parseInt(e.target.value, 10) || 0)}
                className="w-20 font-mono text-center"
              />
              <span className="text-xs text-muted-foreground">
                zaporednih napakah → auto-pause
              </span>
            </div>
          </div>
          {/* v2.5: Notification channels */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label className="text-xs uppercase tracking-wider flex items-center gap-2">
                  <Bell className="w-3 h-3" />
                  Notifikacijski kanali <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.5</Badge>
                </Label>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pošiljaj alerte tega monitorja na specifične kanale. Pusti izklopljeno za globalne nastavitve.
                </p>
              </div>
              <Switch checked={useCustomChannels} onCheckedChange={setUseCustomChannels} />
            </div>
            {useCustomChannels && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border cursor-pointer hover:border-primary/30">
                  <Switch checked={chanTelegram} onCheckedChange={setChanTelegram} />
                  <span className="text-xs">Telegram</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border cursor-pointer hover:border-primary/30">
                  <Switch checked={chanDiscord} onCheckedChange={setChanDiscord} />
                  <span className="text-xs">Discord</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border cursor-pointer hover:border-primary/30">
                  <Switch checked={chanSlack} onCheckedChange={setChanSlack} />
                  <span className="text-xs">Slack</span>
                </label>
                <label className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border cursor-pointer hover:border-primary/30">
                  <Switch checked={chanPush} onCheckedChange={setChanPush} />
                  <span className="text-xs">Push</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Shrani' : 'Dodaj monitor'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* v4.9: AI Prompt Library Modal */}
      <PromptLibraryModal
        open={showPromptLibrary}
        onOpenChange={setShowPromptLibrary}
        onPick={(prompt) => {
          setCustomPrompt(prompt);
          setShowPromptLibrary(false);
          toast.success('Prompt vstavljen — po potrebi uredi');
        }}
      />
    </Dialog>
  );
}

// v4.9: AI Prompt Library Modal — pick from pre-built prompts
function PromptLibraryModal({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (prompt: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState('all');

  if (!open) return null;

  const templates = getPromptsByCategory(activeCategory);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto mx-4 sm:mx-6">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Knjižnica AI promptov
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.9</Badge>
          </DialogTitle>
          <DialogDescription>
            Prednastavljeni AI prompti za različne kategorije oglasov. Klikni za vstavljanje v polje "Dodatna AI navodila".
          </DialogDescription>
        </DialogHeader>

        {/* Category tabs */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {PROMPT_CATEGORIES.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'px-2 py-1 rounded text-xs border transition-colors',
                activeCategory === c.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              )}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {/* Templates grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {templates.map((tpl: any) => (
            <div
              key={tpl.id}
              className="bg-card/50 border border-border rounded p-3 hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => onPick(tpl.prompt)}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <span className="text-2xl shrink-0">{tpl.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm">{tpl.name}</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground bg-background/30 rounded p-2 max-h-24 overflow-y-auto line-clamp-4">
                {tpl.prompt}
              </div>
              <Button size="sm" className="w-full mt-2 h-7 text-xs gap-1">
                <Sparkles className="w-3 h-3" />
                Uporabi ta prompt
              </Button>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border">
          💡 Prompt bo dodan k obstoječemu besedilu. Po potrebi ga uredi.
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `pred ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `pred ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `pred ${h}h`;
  return d.toLocaleDateString('sl-SI');
}
