'use client';

// v9.09: SmartRulesModal — extracted from watchlist-view.tsx.

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Eye, Target, Bookmark, TrendingDown, TrendingUp, MapPin, Clock, Sparkles, ShoppingCart, Trash2, Zap, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WatchlistItem, View } from './types';

export function SmartRulesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [monitors, setMonitors] = useState<any[]>([]);
  const [checkResults, setCheckResults] = useState<any[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ruleType, setRuleType] = useState<string>('price_threshold');
  const [monitorId, setMonitorId] = useState('');
  const [priceBelow, setPriceBelow] = useState('');
  const [minDealScore, setMinDealScore] = useState('');
  const [count, setCount] = useState('3');
  const [withinHours, setWithinHours] = useState('24');
  const [dropPct, setDropPct] = useState('20');
  const [minAiScore, setMinAiScore] = useState('7');
  const [maxAiRisk, setMaxAiRisk] = useState('3');
  const [hoursOld, setHoursOld] = useState('168');
  const [channels, setChannels] = useState<string[]>(['telegram', 'push']);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, monitorsRes] = await Promise.all([
        fetch('/api/smart-rules'),
        fetch('/api/monitors'),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules || []);
        setCheckResults(data.checkResults || []);
      }
      if (monitorsRes.ok) {
        setMonitors(await monitorsRes.json());
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {};
    if (monitorId) cfg.monitorId = monitorId;
    if (priceBelow) cfg.priceBelow = parseInt(priceBelow, 10);
    if (minDealScore) cfg.minDealScore = parseInt(minDealScore, 10);
    if (count) cfg.count = parseInt(count, 10);
    if (withinHours) cfg.withinHours = parseInt(withinHours, 10);
    if (dropPct) cfg.dropPct = parseFloat(dropPct);
    if (minAiScore) cfg.minAiScore = parseInt(minAiScore, 10);
    if (maxAiRisk) cfg.maxAiRisk = parseInt(maxAiRisk, 10);
    if (hoursOld) cfg.hoursOld = parseInt(hoursOld, 10);
    return cfg;
  };

  const createRule = async () => {
    if (!name.trim()) {
      toast.error('Ime je obvezno');
      return;
    }
    try {
      const res = await fetch('/api/smart-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          ruleType,
          config: buildConfig(),
          channels,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success('Smart pravilo ustvarjeno');
        setName('');
        setDescription('');
        setShowForm(false);
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/smart-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !isActive }),
      });
      await load();
    } catch { /* ignore */ }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Izbrišem to smart pravilo?')) return;
    try {
      await fetch(`/api/smart-rules?id=${id}`, { method: 'DELETE' });
      toast.success('Pravilo izbrisano');
      await load();
    } catch { /* ignore */ }
  };

  const runCheck = async () => {
    try {
      const res = await fetch('/api/smart-rules?check=1');
      const data = await res.json();
      setCheckResults(data.checkResults || []);
      if (data.checkResults?.length > 0) {
        toast.success(`✓ ${data.checkResults.length} pravil sproženih!`);
      } else {
        toast.info('Ni sproženih pravil');
      }
    } catch { /* ignore */ }
  };

  const toggleChannel = (ch: string) => {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  };

  const ruleTypeLabels: Record<string, string> = {
    price_threshold: '💰 Cena pod mejo',
    multiple_listings: '🔥 Več oglasov',
    price_drop_pct: '📉 Padec cene %',
    ai_verdict_combo: '🤖 AI kombinacija',
    time_based: '⏰ Starost oglasa',
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-6">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Smart pravila
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.3</Badge>
          </DialogTitle>
          <DialogDescription>
            Kompleksna pravila za alerte. Pravila se preverjajo ob vsakem poganjanju monitorjev.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-3">
          <Button size="sm" variant="outline" onClick={runCheck} className="gap-2 h-7 text-xs">
            <RefreshCw className="w-3 h-3" />
            Preveri zdaj
          </Button>
          <Button
            size="sm"
            className="gap-2 h-7 text-xs bg-primary text-primary-foreground"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            {showForm ? 'Prekliči' : 'Novo pravilo'}
          </Button>
        </div>

        {/* Check results */}
        {checkResults.length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded p-3 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-2">✓ Sprožena pravila ({checkResults.length})</div>
            {checkResults.map((r, i) => (
              <div key={i} className="text-xs mb-1">
                <span className="font-bold">{r.ruleName}:</span> {r.message}
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="bg-card/50 border border-border rounded p-3 space-y-3 mb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs uppercase">Ime pravila</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. iPhone pod 300€" className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Tip pravila</Label>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                  className="mt-1 w-full bg-card border border-border rounded px-2 py-1.5 text-xs"
                >
                  {Object.entries(ruleTypeLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase">Opis (opcionalno)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kratek opis" className="mt-1 text-xs" />
            </div>

            <div>
              <Label className="text-xs uppercase">Monitor (prazno = vsi)</Label>
              <select
                value={monitorId}
                onChange={(e) => setMonitorId(e.target.value)}
                className="mt-1 w-full bg-card border border-border rounded px-2 py-1.5 text-xs"
              >
                <option value="">Vsi monitorji</option>
                {monitors.map((m: { id: string; name: string; source: string; isActive: boolean }) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.source})</option>
                ))}
              </select>
            </div>

            {/* Rule-specific fields */}
            <div className="grid grid-cols-2 gap-2">
              {(ruleType === 'price_threshold' || ruleType === 'multiple_listings' || ruleType === 'time_based') && (
                <div>
                  <Label className="text-xs uppercase">Cena pod (€)</Label>
                  <Input type="number" value={priceBelow} onChange={(e) => setPriceBelow(e.target.value)} placeholder="300" className="mt-1 text-xs font-mono" />
                </div>
              )}
              {ruleType === 'price_threshold' && (
                <div>
                  <Label className="text-xs uppercase">Min deal score</Label>
                  <Input type="number" value={minDealScore} onChange={(e) => setMinDealScore(e.target.value)} placeholder="70" className="mt-1 text-xs font-mono" />
                </div>
              )}
              {ruleType === 'multiple_listings' && (
                <>
                  <div>
                    <Label className="text-xs uppercase">Št. oglasov</Label>
                    <Input type="number" value={count} onChange={(e) => setCount(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase">V koliko urah</Label>
                    <Input type="number" value={withinHours} onChange={(e) => setWithinHours(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                </>
              )}
              {ruleType === 'price_drop_pct' && (
                <>
                  <div>
                    <Label className="text-xs uppercase">Padec (%)</Label>
                    <Input type="number" value={dropPct} onChange={(e) => setDropPct(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase">V koliko urah</Label>
                    <Input type="number" value={withinHours} onChange={(e) => setWithinHours(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                </>
              )}
              {ruleType === 'ai_verdict_combo' && (
                <>
                  <div>
                    <Label className="text-xs uppercase">Min AI score</Label>
                    <Input type="number" min="1" max="10" value={minAiScore} onChange={(e) => setMinAiScore(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs uppercase">Max AI risk</Label>
                    <Input type="number" min="1" max="10" value={maxAiRisk} onChange={(e) => setMaxAiRisk(e.target.value)} className="mt-1 text-xs font-mono" />
                  </div>
                </>
              )}
              {ruleType === 'time_based' && (
                <div>
                  <Label className="text-xs uppercase">Starost (ur)</Label>
                  <Input type="number" value={hoursOld} onChange={(e) => setHoursOld(e.target.value)} className="mt-1 text-xs font-mono" />
                </div>
              )}
            </div>

            {/* Channels */}
            <div>
              <Label className="text-xs uppercase">Kanali obveščanja</Label>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {['telegram', 'discord', 'slack', 'push', 'email'].map(ch => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] border transition-colors',
                      channels.includes(ch)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <Button size="sm" className="w-full gap-2" onClick={createRule}>
              <Check className="w-3.5 h-3.5" />
              Ustvari pravilo
            </Button>
          </div>
        )}

        {/* Rules list */}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Nalagam...
          </div>
        ) : rules.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
            Ni smart pravil. Ustvari prvo z "Novo pravilo".
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((r: { id: string; monitorId: string; config: Record<string, unknown>; isActive?: boolean; lastTriggeredAt?: string | null; channels?: string[]; description?: string; triggerCount?: number; ruleType?: string; name?: string }) => (
              <div key={r.id} className={cn(
                'border rounded p-2 text-xs',
                (r?.isActive ?? false) ? 'bg-card/50 border-border' : 'bg-card/30 border-border opacity-60'
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="font-bold">{r.name}</span>
                      <Badge variant="outline" className="text-[9px]">{ruleTypeLabels[r.ruleType ?? "unknown"] || r.ruleType}</Badge>
                      {(r.triggerCount ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                          🔥 {(r.triggerCount ?? 0)}×
                        </Badge>
                      )}
                    </div>
                    {r.description && (
                      <div className="text-[10px] text-muted-foreground mb-1">{r.description}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {Object.entries(r.config).map(([k, v]: [string, unknown]) => `${k}=${v}`).join(', ')}
                    </div>
                    {(r.channels?.length ?? 0) > 0 && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        Kanali: {(r.channels ?? []).join(', ')}
                      </div>
                    )}
                    {r.lastTriggeredAt && (
                      <div className="text-[9px] text-primary mt-0.5">
                        Zadnjič sproženo: {new Date(r.lastTriggeredAt).toLocaleString('sl-SI')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(r.id, (r?.isActive ?? false))}
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border',
                        (r?.isActive ?? false)
                          ? 'border-primary/40 text-primary'
                          : 'border-border text-muted-foreground'
                      )}
                    >
                      {(r?.isActive ?? false) ? 'AKTIVNO' : 'IZKLOP'}
                    </button>
                    <button
                      onClick={() => deleteRule(r.id)}
                      className="text-muted-foreground hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border">
          💡 Pravila se preverjajo ob vsakem poganjanju monitorjev. Lahko jih tudi ročno preveriš z "Preveri zdaj".
        </div>
      </DialogContent>
    </Dialog>
  );

}
