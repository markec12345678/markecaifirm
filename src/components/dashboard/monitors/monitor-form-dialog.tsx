'use client';

// v9.03: MonitorFormDialog — extracted from monitors-view.tsx.

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
import type { Source, Monitor } from './types';
import { SOURCE_LABELS, SOURCE_PRESETS, formatTimeAgo } from './utils';
import { PromptLibraryModal } from './prompt-library-modal';

export function MonitorFormDialog({
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


