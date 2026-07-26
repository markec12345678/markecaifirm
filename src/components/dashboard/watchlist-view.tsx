'use client';

// v4.6: Watchlist — oglasi, ki jih uporabnik spremlja
// Prikaz bookmarkov + listingov s targetPrice, z live preview cen in距ljen do cilja

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Eye, Target, Bookmark, TrendingDown, TrendingUp, MapPin, Clock, Sparkles, ShoppingCart, Trash2, Zap, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface WatchlistItem {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  imageUrl: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  dealScoreReason: string | null;
  isBookmarked: boolean;
  bookmarkedAt: string | null;
  targetPrice: number | null;
  targetPriceSetAt: string | null;
  targetPriceAlertSent: boolean;
  distanceToTarget: number | null;
  distancePct: number | null;
  targetHit: boolean;
  lowestEver: number | null;
  highestEver: number | null;
  priceHistoryCount: number;
  contactStatus: string;
  monitor: { name: string; source: string };
}

interface WatchlistStats {
  total: number;
  withTarget: number;
  bookmarked: number;
  targetsHit: number;
  targetsAbove: number;
  priceDropPending: number;
  totalPotentialSavings: number;
  totalValue: number;
}

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'watchlist' | 'analytics' | 'trades' | 'health' | 'notifications' | 'settings';

export function WatchlistView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<{ watchlist: WatchlistItem[]; stats: WatchlistStats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'recent' | 'target' | 'price' | 'score'>('recent');
  // v5.3: Smart Rules modal
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/listings/watchlist?sort=${sort}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error('Ne morem naložiti watchlista');
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => { load(); }, [load]);

  const removeBookmark = async (id: string) => {
    try {
      await fetch('/api/listings/bookmark', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isBookmarked: false }),
      });
      toast.success('Odstranjeno iz watchlista');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const clearTarget = async (id: string) => {
    try {
      await fetch(`/api/listings/${id}/target`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: null }),
      });
      toast.success('Ciljna cena odstranjena');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-card animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const stats = data?.stats;
  const items = data?.watchlist ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Watchlist
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Oglasi, ki jih spremljaš — z shranjenimi zaznamki ali nastavljeno ciljno ceno.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="text-xs bg-card border border-border rounded px-2 py-1.5"
          >
            <option value="recent">Najnovejši</option>
            <option value="target">Najbližji cilju</option>
            <option value="price">Cena (najnižja)</option>
            <option value="score">AI ocena (najvišja)</option>
          </select>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
          {/* v5.3: Smart Rules button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRules(true)}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Zap className="w-3.5 h-3.5" />
            Smart pravila
          </Button>
        </div>
      </div>

      {/* v5.3: Smart Rules Modal */}
      <SmartRulesModal open={showRules} onOpenChange={setShowRules} />

      {/* Stats cards */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Skupaj</div>
              <div className="text-2xl font-bold font-mono">{stats.total}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.bookmarked} shranjenih • {stats.withTarget} s ciljem
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Cilj dosežen</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.targetsHit}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.targetsAbove} še čaka
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Vrednost</div>
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.totalValue.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                skupna vrednost watchlista
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Potencialni prihranek</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.totalPotentialSavings.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                če vsi dosežejo cilj
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Eye className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm mb-4">
              Watchlist je prazen. Dodaj oglase z:
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Bookmark className="w-3.5 h-3.5" />
                Shrani oglas
              </Button>
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Target className="w-3.5 h-3.5" />
                Nastavi ciljno ceno
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <WatchlistItemCard
              key={item.id}
              item={item}
              onRemoveBookmark={removeBookmark}
              onClearTarget={clearTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistItemCard({
  item,
  onRemoveBookmark,
  onClearTarget,
}: {
  item: WatchlistItem;
  onRemoveBookmark: (id: string) => void;
  onClearTarget: (id: string) => void;
}) {
  const targetHit = item.targetHit;
  const distanceToTarget = item.distanceToTarget;
  const distancePct = item.distancePct;
  const hasTarget = item.targetPrice != null;
  const hasBookmarked = item.isBookmarked;

  // Price trend (lowest/highest)
  const priceRange = item.lowestEver != null && item.highestEver != null && item.lowestEver !== item.highestEver;

  return (
    <Card className={cn(
      'bg-card/50 hover:bg-card transition-colors',
      targetHit && 'border-primary/40 bg-primary/5'
    )}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title}
              className="w-16 h-16 object-cover rounded bg-background shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-16 h-16 bg-background rounded shrink-0 flex items-center justify-center">
              <Eye className="w-5 h-5 text-muted-foreground opacity-30" />
            </div>
          )}

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm hover:text-primary truncate flex-1"
                title={item.title}
              >
                {item.title}
              </a>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary p-1"
                  title="Odpri oglas"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 flex-wrap">
              <span className="font-mono text-amber-400 font-bold">{item.priceText}</span>
              <span>•</span>
              <span>{item.monitor?.name}</span>
              {item.location && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-0.5">
                    <MapPin className="w-3 h-3" />
                    {item.location}
                  </span>
                </>
              )}
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {hasBookmarked && (
                <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-400 gap-0.5">
                  <Bookmark className="w-2.5 h-2.5" />
                  Shranjeno
                </Badge>
              )}
              {hasTarget && (
                <Badge variant="outline" className={cn(
                  'text-[10px] gap-0.5',
                  targetHit
                    ? 'border-primary/40 text-primary'
                    : 'border-amber-400/40 text-amber-400'
                )}>
                  <Target className="w-2.5 h-2.5" />
                  {targetHit ? 'Cilj dosežen' : `Cilj ${item.targetPrice}€`}
                </Badge>
              )}
              {item.aiVerdict && (
                <Badge variant="outline" className={cn(
                  'text-[10px]',
                  item.aiVerdict === 'PRILIKA' && 'border-primary/40 text-primary',
                  item.aiVerdict === 'SUMNJIVO' && 'border-amber-400/40 text-amber-400',
                  item.aiVerdict === 'NEZANIMIVO' && 'border-muted text-muted-foreground',
                )}>{item.aiVerdict}</Badge>
              )}
              {item.dealScore != null && (
                <Badge variant="outline" className={cn(
                  'text-[10px] font-mono',
                  item.dealScore >= 70 ? 'border-primary/40 text-primary' :
                  item.dealScore >= 50 ? 'border-amber-400/40 text-amber-400' :
                  'border-red-500/40 text-red-500'
                )}>
                  🎯 {item.dealScore}
                </Badge>
              )}
              {item.aiScore != null && (
                <span className="text-[10px] text-primary">⭐ {item.aiScore}</span>
              )}
              {item.aiEstimatedValue != null && item.price != null && item.aiEstimatedValue > item.price && (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/70">
                  AI ~{item.aiEstimatedValue}€
                </Badge>
              )}
              {item.priceHistoryCount > 1 && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  📈 {item.priceHistoryCount}× cena
                </Badge>
              )}
            </div>

            {/* Target progress bar */}
            {hasTarget && item.price != null && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Cena: {item.price}€</span>
                  <span>Cilj: {item.targetPrice}€</span>
                </div>
                <div className="h-1.5 bg-background rounded overflow-hidden relative">
                  {/* Target marker */}
                  <div
                    className="absolute top-0 bottom-0 border-r-2 border-primary"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((item.targetPrice! - (item.lowestEver ?? 0)) / Math.max(1, (item.highestEver ?? item.price) - (item.lowestEver ?? 0))) * 100))}%`
                    }}
                  />
                  {/* Current price marker */}
                  <div
                    className={cn(
                      'absolute top-[-2px] bottom-[-2px] w-1 rounded-full',
                      targetHit ? 'bg-primary' : 'bg-amber-400'
                    )}
                    style={{
                      left: `${Math.min(100, Math.max(0, ((item.price - (item.lowestEver ?? 0)) / Math.max(1, (item.highestEver ?? item.price) - (item.lowestEver ?? 0))) * 100))}%`
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] mt-1">
                  <span className="text-muted-foreground">
                    Min: {item.lowestEver ?? '?'}€
                  </span>
                  {distanceToTarget != null && (
                    <span className={cn(
                      'font-mono font-bold',
                      targetHit ? 'text-primary' : 'text-amber-400'
                    )}>
                      {targetHit
                        ? `✓ ${Math.abs(distanceToTarget)}€ pod ciljem`
                        : `še ${distanceToTarget}€ (${distancePct}%) nad ciljem`
                      }
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    Max: {item.highestEver ?? '?'}€
                  </span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 mt-2">
              {hasBookmarked && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-red-500 gap-1"
                  onClick={() => onRemoveBookmark(item.id)}
                >
                  <Bookmark className="w-3 h-3" />
                  Odstrani shranjeno
                </Button>
              )}
              {hasTarget && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-red-500 gap-1"
                  onClick={() => onClearTarget(item.id)}
                >
                  <Target className="w-3 h-3" />
                  Počisti cilj
                </Button>
              )}
              {priceRange && item.price != null && (
                <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
                  {item.lowestEver! < item.price ? (
                    <TrendingDown className="w-3 h-3 text-red-500" />
                  ) : (
                    <TrendingUp className="w-3 h-3 text-primary" />
                  )}
                  Najnižja: {item.lowestEver}€
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// v5.3: Smart Rules Modal — manage complex alert rules
function SmartRulesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
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

  const buildConfig = (): any => {
    const cfg: any = {};
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
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
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
                {monitors.map((m: any) => (
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
            {rules.map((r: any) => (
              <div key={r.id} className={cn(
                'border rounded p-2 text-xs',
                r.isActive ? 'bg-card/50 border-border' : 'bg-card/30 border-border opacity-60'
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="font-bold">{r.name}</span>
                      <Badge variant="outline" className="text-[9px]">{ruleTypeLabels[r.ruleType] || r.ruleType}</Badge>
                      {r.triggerCount > 0 && (
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                          🔥 {r.triggerCount}×
                        </Badge>
                      )}
                    </div>
                    {r.description && (
                      <div className="text-[10px] text-muted-foreground mb-1">{r.description}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {Object.entries(r.config).map(([k, v]: any) => `${k}=${v}`).join(', ')}
                    </div>
                    {r.channels?.length > 0 && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        Kanali: {r.channels.join(', ')}
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
                      onClick={() => toggleActive(r.id, r.isActive)}
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border',
                        r.isActive
                          ? 'border-primary/40 text-primary'
                          : 'border-border text-muted-foreground'
                      )}
                    >
                      {r.isActive ? 'AKTIVNO' : 'IZKLOP'}
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
