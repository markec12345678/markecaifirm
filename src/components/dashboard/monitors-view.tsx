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
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss';

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
  createdAt: string;
  _count?: { listings: number; alerts: number };
}

const SOURCE_LABELS: Record<Source, string> = {
  bolha: 'Bolha.com',
  nepremicnine: 'Nepremičnine.net (RSS)',
  avtonet: 'Avtonet.si',
  salomon: 'Salomon.si',
  'custom-rss': 'Custom RSS',
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
    }
  }, [editing, open]);

  const applyPreset = (preset: typeof SOURCE_PRESETS[number]) => {
    setSource(preset.source);
    setSourceUrl(preset.url);
    if (!name) setName(preset.label);
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
            <Label htmlFor="m-url" className="text-xs uppercase tracking-wider">URL iskanja / RSS *</Label>
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
