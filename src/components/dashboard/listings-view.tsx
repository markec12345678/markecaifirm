'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Listing {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  description: string;
  imageUrl: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  aiEstimatedValue: number | null;
  aiImageVerdict: string | null;
  aiImageAnalysis: string | null;
  monitor: { name: string; source: string };
}

interface Monitor {
  id: string;
  name: string;
  source: string;
}

interface ListingsResponse {
  listings: Listing[];
  total: number;
  offset: number;
  limit: number;
}

export function ListingsView() {
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [monitorId, setMonitorId] = useState<string>('all');
  const [verdict, setVerdict] = useState<string>('all');
  const [minScore, setMinScore] = useState<string>('');
  const [maxRisk, setMaxRisk] = useState<string>('');
  const [hasImage, setHasImage] = useState(false);
  const [sort, setSort] = useState<string>('firstSeen');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (monitorId !== 'all') params.set('monitorId', monitorId);
      if (verdict !== 'all') params.set('verdict', verdict);
      if (minScore) params.set('minScore', minScore);
      if (maxRisk) params.set('maxRisk', maxRisk);
      if (hasImage) params.set('hasImage', '1');
      params.set('sort', sort);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const res = await fetch(`/api/listings?${params}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
    } catch {
      toast.error('Ne morem naložiti oglasov');
    } finally {
      setLoading(false);
    }
  }, [monitorId, verdict, minScore, maxRisk, hasImage, sort, offset]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/monitors');
        if (res.ok) setMonitors(await res.json());
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reset offset when filters change
  useEffect(() => { setOffset(0); }, [monitorId, verdict, minScore, maxRisk, hasImage, sort]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (monitorId !== 'all') params.set('monitorId', monitorId);
    if (verdict !== 'all') params.set('verdict', verdict);
    if (minScore) params.set('minScore', minScore);
    if (maxRisk) params.set('maxRisk', maxRisk);
    if (hasImage) params.set('hasImage', '1');
    params.set('sort', sort);
    params.set('limit', '500');
    params.set('format', 'csv');
    window.open(`/api/listings?${params}`, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Oglasi
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Vsi scraped oglasi z AI oceno — vključno z NEZANIMIVO za validacijo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Osveži
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-2">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-card/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Filter className="w-3.5 h-3.5" /> Filtri
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs uppercase">Monitor</Label>
              <Select value={monitorId} onValueChange={setMonitorId}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsi</SelectItem>
                  {monitors.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Verdikt</Label>
              <Select value={verdict} onValueChange={setVerdict}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vsi</SelectItem>
                  <SelectItem value="PRILIKA">🎯 Prilika</SelectItem>
                  <SelectItem value="SUMNJIVO">⚠️ Sumljivo</SelectItem>
                  <SelectItem value="NEZANIMIVO">⚪ Nezanimivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Sortiraj</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="firstSeen">Prvič videno (najnovejše)</SelectItem>
                  <SelectItem value="score">AI ocena prilike</SelectItem>
                  <SelectItem value="risk">AI tveganje</SelectItem>
                  <SelectItem value="price">Cena</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs uppercase">Min score</Label>
                <Input type="number" min={1} max={10} value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="1-10" className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Max risk</Label>
                <Input type="number" min={1} max={10} value={maxRisk} onChange={(e) => setMaxRisk(e.target.value)} placeholder="1-10" className="mt-1 text-xs" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={hasImage ? 'default' : 'outline'}
              onClick={() => setHasImage(!hasImage)}
              className="h-7 text-xs gap-2"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Samo z sliko
            </Button>
            {(monitorId !== 'all' || verdict !== 'all' || minScore || maxRisk || hasImage) && (
              <Button size="sm" variant="ghost" onClick={() => { setMonitorId('all'); setVerdict('all'); setMinScore(''); setMaxRisk(''); setHasImage(false); }} className="h-7 text-xs">
                Počisti filtre
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Listings */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-card animate-pulse rounded" />
          ))}
        </div>
      ) : !data || data.listings.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Ni oglasov s temi filtri.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            Prikazano {data.listings.length} od {data.total} oglasov
          </div>
          <div className="space-y-2">
            {data.listings.map(l => <ListingRow key={l.id} listing={l} />)}
          </div>
          {/* Pagination */}
          {data.total > limit && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="gap-2"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Nazaj
              </Button>
              <span className="text-xs text-muted-foreground font-mono">
                {offset + 1}-{Math.min(offset + limit, data.total)} / {data.total}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
                className="gap-2"
              >
                Naprej <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const [expanded, setExpanded] = useState(false);
  const verdictColor =
    listing.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    listing.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';
  const verdictIcon =
    listing.aiVerdict === 'PRILIKA' ? <Target className="w-3 h-3" /> :
    listing.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3 h-3" /> :
    null;

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors" onClick={() => setExpanded(!expanded)}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {listing.imageUrl ? (
            <img
              src={listing.imageUrl}
              alt=""
              className="w-16 h-16 rounded object-cover bg-muted shrink-0"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {verdictIcon && <span className={verdictColor.split(' ')[1]}>{verdictIcon}</span>}
              {listing.aiVerdict && (
                <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider', verdictColor)}>
                  {listing.aiVerdict}
                </Badge>
              )}
              {listing.aiScore != null && <span className="text-[11px] text-primary">⭐ {listing.aiScore}</span>}
              {listing.aiRisk != null && <span className="text-[11px] text-amber-400">🛡 {listing.aiRisk}</span>}
              {listing.aiImageVerdict && listing.aiImageVerdict !== 'NO_IMAGE' && (
                <Badge variant="outline" className={cn(
                  'text-[10px]',
                  listing.aiImageVerdict === 'AUTHENTIC' && 'border-primary/40 text-primary',
                  listing.aiImageVerdict === 'SUSPICIOUS' && 'border-amber-400/40 text-amber-400',
                  listing.aiImageVerdict === 'STOCK_PHOTO' && 'border-amber-400/40 text-amber-400',
                )}>
                  📸 {listing.aiImageVerdict}
                </Badge>
              )}
            </div>
            <h3 className="font-bold text-sm truncate">{listing.title}</h3>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
              <span className="text-amber-400 font-mono">{listing.priceText}</span>
              {listing.aiEstimatedValue && listing.price && (
                <span className="text-primary">
                  (tržna ~{listing.aiEstimatedValue}€, {listing.aiEstimatedValue > listing.price ? `+${listing.aiEstimatedValue - listing.price}€` : `${listing.aiEstimatedValue - listing.price}€`})
                </span>
              )}
              {listing.location && <span>• {listing.location}</span>}
              <span>• {listing.monitor.name}</span>
              <span>• {formatTimeAgo(listing.firstSeenAt)}</span>
            </div>
            {expanded && listing.aiReason && (
              <p className="text-xs text-muted-foreground mt-2 italic border-l-2 border-border pl-2">
                {listing.aiReason}
              </p>
            )}
            {expanded && listing.aiImageAnalysis && (
              <p className="text-xs text-muted-foreground mt-1 border-l-2 border-border pl-2">
                📸 {listing.aiImageAnalysis}
              </p>
            )}
            {expanded && listing.description && (
              <p className="text-xs text-muted-foreground mt-2 max-h-32 overflow-y-auto">
                {listing.description}
              </p>
            )}
            {expanded && (
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary/70 hover:text-primary mt-2"
              >
                <ExternalLink className="w-3 h-3" /> Odpri oglas
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
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
  const days = Math.floor(h / 24);
  if (days < 30) return `pred ${days}d`;
  return d.toLocaleDateString('sl-SI');
}
