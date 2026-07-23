'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Zap, AlertCircle, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss' | 'vinted';

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
  // v1.3
  consecutiveErrors: number;
  autoPauseThreshold: number;
  autoPausedAt: string | null;
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
];

export function MonitorsView() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/monitors');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMonitors(data);
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
        <Button
          size="sm"
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-3.5 h-3.5" />
          Nov monitor
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-card animate-pulse rounded" />
          ))}
        </div>
      ) : monitors.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground text-sm mb-4">Še ni monitorjev.</p>
            <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2">
              <Plus className="w-3.5 h-3.5" /> Dodaj prvi monitor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {monitors.map((m) => (
            <Card key={m.id} className={cn('bg-card/50 hover:bg-card transition-colors', !m.isActive && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-sm truncate">{m.name}</h3>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[m.source]}</Badge>
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
                  <p className="text-xs text-destructive mt-2 truncate">
                    ⚠ {m.lastError.slice(0, 100)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MonitorFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        editing={editing}
        onSaved={() => { setShowForm(false); load(); }}
      />
    </div>
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
  // v1.2: schedule window
  const [useSchedule, setUseSchedule] = useState(false);
  const [runStartHour, setRunStartHour] = useState(7);
  const [runEndHour, setRunEndHour] = useState(23);
  // v1.3: auto-pause
  const [autoPauseThreshold, setAutoPauseThreshold] = useState(5);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
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
      setUseSchedule(editing.runStartHour != null && editing.runEndHour != null);
      setRunStartHour(editing.runStartHour ?? 7);
      setRunEndHour(editing.runEndHour ?? 23);
      setAutoPauseThreshold(editing.autoPauseThreshold ?? 5);
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
      setUseSchedule(false);
      setRunStartHour(7);
      setRunEndHour(23);
      setAutoPauseThreshold(5);
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
        // v1.2: schedule window
        runStartHour: useSchedule ? runStartHour : null,
        runEndHour: useSchedule ? runEndHour : null,
        // v1.3: auto-pause threshold
        autoPauseThreshold,
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
              <Label htmlFor="m-kw" className="text-xs uppercase tracking-wider">Ključne besede (vejice)</Label>
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
            <Label htmlFor="m-prompt" className="text-xs uppercase tracking-wider">
              Dodatna AI navodila (izbirno)
            </Label>
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
              <Switch checked={useSchedule} onCheckedChange={setUseSchedule} />
            </div>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Shrani' : 'Dodaj monitor'}
          </Button>
        </DialogFooter>
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
