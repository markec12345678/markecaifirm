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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target, MapPin, Clock, Bookmark, Sparkles, ShoppingCart, MessageSquare, BarChart3, TrendingDown, TrendingUp, Copy, Check, GitCompare, StickyNote, Phone } from 'lucide-react';
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
  isBookmarked: boolean;
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
  const [detailListingId, setDetailListingId] = useState<string | null>(null);

  // Filters
  const [monitorId, setMonitorId] = useState<string>('all');
  const [verdict, setVerdict] = useState<string>('all');
  const [minScore, setMinScore] = useState<string>('');
  const [maxRisk, setMaxRisk] = useState<string>('');
  const [hasImage, setHasImage] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [sort, setSort] = useState<string>('firstSeen');
  const [offset, setOffset] = useState(0);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
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
      if (bookmarkedOnly) params.set('bookmarked', '1');
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
  }, [monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, sort, offset]);

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
  useEffect(() => { setOffset(0); }, [monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, sort]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (monitorId !== 'all') params.set('monitorId', monitorId);
    if (verdict !== 'all') params.set('verdict', verdict);
    if (minScore) params.set('minScore', minScore);
    if (maxRisk) params.set('maxRisk', maxRisk);
    if (hasImage) params.set('hasImage', '1');
    if (bookmarkedOnly) params.set('bookmarked', '1');
    params.set('sort', sort);
    params.set('limit', '500');
    params.set('format', 'csv');
    window.open(`/api/listings?${params}`, '_blank');
  };

  // v2.3: Compare functions
  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      else toast.info('Maksimalno 4 oglase za primerjavo');
      return next;
    });
  };

  const runCompare = async () => {
    if (compareIds.size < 2) {
      toast.error('Izberi vsaj 2 oglasa za primerjavo');
      return;
    }
    setCompareLoading(true);
    try {
      const res = await fetch('/api/listings/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(compareIds) }),
      });
      const data = await res.json();
      setCompareData(data);
    } catch {
      toast.error('Napaka pri primerjavi');
    } finally {
      setCompareLoading(false);
    }
  };

  // v1.4: Toggle bookmark
  const toggleBookmark = async (id: string, current: boolean) => {
    // Optimistic update
    setData(prev => prev ? {
      ...prev,
      listings: prev.listings.map(l =>
        l.id === id ? { ...l, isBookmarked: !current } : l
      ),
    } : prev);
    try {
      await fetch('/api/listings/bookmark', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isBookmarked: !current }),
      });
      toast.success(!current ? '⭐ Shranjeno' : 'Odstranjeno iz shranjenih');
    } catch {
      toast.error('Napaka pri shranjevanju');
      // Revert on error
      setData(prev => prev ? {
        ...prev,
        listings: prev.listings.map(l =>
          l.id === id ? { ...l, isBookmarked: current } : l
        ),
      } : prev);
    }
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
            <Button
              size="sm"
              variant={bookmarkedOnly ? 'default' : 'outline'}
              onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
              className="h-7 text-xs gap-2"
            >
              <Bookmark className="w-3.5 h-3.5" />
              Samo priljubljeni
            </Button>
            {(monitorId !== 'all' || verdict !== 'all' || minScore || maxRisk || hasImage || bookmarkedOnly) && (
              <Button size="sm" variant="ghost" onClick={() => { setMonitorId('all'); setVerdict('all'); setMinScore(''); setMaxRisk(''); setHasImage(false); setBookmarkedOnly(false); }} className="h-7 text-xs">
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
            {data.listings.map(l => (
              <ListingRow
                key={l.id}
                listing={l}
                onOpenDetail={() => setDetailListingId(l.id)}
                onToggleBookmark={() => toggleBookmark(l.id, l.isBookmarked)}
                onToggleCompare={() => toggleCompare(l.id)}
                isCompareSelected={compareIds.has(l.id)}
              />
            ))}
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

      {/* v2.3: Compare toolbar */}
      {compareIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-primary">{compareIds.size} izbranih za primerjavo</span>
              <Button size="sm" onClick={runCompare} disabled={compareLoading || compareIds.size < 2} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-7">
                {compareLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />}
                Primerjaj ({compareIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCompareIds(new Set())} className="h-7 text-xs">
                Počisti
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v2.3: Compare modal */}
      <CompareModal data={compareData} onClose={() => { setCompareData(null); setCompareIds(new Set()); }} />

      {/* v1.3: Listing detail modal */}
      <ListingDetailModal
        listingId={detailListingId}
        onClose={() => setDetailListingId(null)}
      />
    </div>
  );
}

function ListingRow({ listing, onOpenDetail, onToggleBookmark, onToggleCompare, isCompareSelected }: { listing: Listing; onOpenDetail: () => void; onToggleBookmark: () => void; onToggleCompare: () => void; isCompareSelected: boolean }) {
  const verdictColor =
    listing.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    listing.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';
  const verdictIcon =
    listing.aiVerdict === 'PRILIKA' ? <Target className="w-3 h-3" /> :
    listing.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3 h-3" /> :
    null;

  return (
    <Card className={cn(
      'bg-card/50 hover:bg-card hover:border-primary/30 transition-colors cursor-pointer',
      listing.isBookmarked && 'border-primary/50 ring-1 ring-primary/20'
    )} onClick={onOpenDetail}>
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
              {(() => {
                const days = Math.floor((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000);
                if (days >= 7) return <span className="text-amber-400">• {days}d aktiven ⏳</span>;
                if (days >= 30) return <span className="text-primary">• {days}d aktiven 🟢</span>;
                return null;
              })()}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors',
                isCompareSelected ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
              )}
              title={isCompareSelected ? 'Odstrani iz primerjave' : 'Dodaj v primerjavo'}
            >
              <GitCompare className={cn('w-4 h-4', isCompareSelected && 'text-primary')} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors',
                listing.isBookmarked ? 'text-primary' : 'text-muted-foreground hover:text-primary'
              )}
              title={listing.isBookmarked ? 'Odstrani iz shranjenih' : 'Shrani'}
            >
              <Bookmark className={cn('w-4 h-4', listing.isBookmarked && 'fill-current')} />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// v1.3+v1.4: Listing detail modal
function ListingDetailModal({ listingId, onClose }: { listingId: string | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingDetail, setFetchingDetail] = useState(false);
  const [togglingBookmark, setTogglingBookmark] = useState(false);
  const [addingToTrade, setAddingToTrade] = useState(false);
  // v1.8: AI Negotiator
  const [negotiating, setNegotiating] = useState(false);
  const [negotiateMessage, setNegotiateMessage] = useState<string | null>(null);
  const [negotiateType, setNegotiateType] = useState<string>('initial');
  const [copied, setCopied] = useState(false);
  // v2.4: Listing notes
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [contactStatus, setContactStatus] = useState('none');
  const [sellerResponse, setSellerResponse] = useState('');

  const loadDetail = useCallback(async () => {
    if (!listingId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
      // v2.4: Load notes
      setNotes(d.listing?.userNotes ?? '');
      setContactStatus(d.listing?.contactStatus ?? 'none');
      setSellerResponse(d.listing?.sellerResponse ?? '');
    } catch {
      toast.error('Ne morem naložiti podrobnosti');
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (!listingId) return null;

  const listing = data?.listing;
  const similar = data?.similar ?? [];
  const priceHistory = data?.priceHistory ?? [];

  const fetchDetailPage = async () => {
    if (!listing) return;
    setFetchingDetail(true);
    try {
      const res = await fetch(`/api/listings/${listing.id}/fetch-detail`, { method: 'POST' });
      const d = await res.json();
      if (d.ok) {
        toast.success(`✓ Pridobljenih ${d.images?.length ?? 0} slik in ${(d.fullDescription?.length ?? 0)} znakov opisa`);
        await loadDetail();
      } else {
        toast.error(`Napaka: ${d.error?.slice(0, 80)}`);
      }
    } catch {
      toast.error('Napaka pri pridobivanju detail page');
    } finally {
      setFetchingDetail(false);
    }
  };

  const toggleBookmark = async () => {
    if (!listing) return;
    setTogglingBookmark(true);
    try {
      const res = await fetch('/api/listings/bookmark', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listing.id, isBookmarked: !listing.isBookmarked }),
      });
      if (res.ok) {
        toast.success(!listing.isBookmarked ? '⭐ Shranjeno' : 'Odstranjeno iz shranjenih');
        await loadDetail();
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setTogglingBookmark(false);
    }
  };

  // v1.7: Add to Skladišče (Trade) — 1-click from listing detail
  const addToSkladisce = async () => {
    if (!listing) return;
    setAddingToTrade(true);
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromListingId: listing.id,
          category: '',
        }),
      });
      if (res.ok) {
        toast.success('✓ Dodano v Skladišče — uredi podrobnosti v zavihku Skladišče');
        await loadDetail();
      } else {
        toast.error('Napaka pri dodajanju');
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setAddingToTrade(false);
    }
  };

  // v1.8: AI Negotiator — generate message to seller
  const generateMessage = async (type: string) => {
    if (!listing) return;
    setNegotiating(true);
    setNegotiateType(type);
    setNegotiateMessage(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.ok) {
        setNegotiateMessage(data.message);
        toast.success('Sporočilo generirano');
      } else {
        toast.error(data.error ?? 'Napaka pri generiranju');
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setNegotiating(false);
    }
  };

  const copyMessage = () => {
    if (!negotiateMessage) return;
    navigator.clipboard.writeText(negotiateMessage);
    setCopied(true);
    toast.success('Sporočilo kopirano');
    setTimeout(() => setCopied(false), 2000);
  };

  // v2.4: Save notes
  const saveNotes = async () => {
    if (!listing) return;
    setNotesSaving(true);
    try {
      await fetch(`/api/listings/${listing.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      toast.success('Opombe shranjene');
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setNotesSaving(false);
    }
  };

  // v2.4: Update contact status
  const updateContact = async (status: string) => {
    if (!listing) return;
    setContactStatus(status);
    try {
      await fetch(`/api/listings/${listing.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactStatus: status, sellerResponse }),
      });
      toast.success(`Status: ${status}`);
    } catch {
      toast.error('Napaka');
    }
  };

  // v2.4: Save seller response
  const saveSellerResponse = async () => {
    if (!listing) return;
    try {
      await fetch(`/api/listings/${listing.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerResponse }),
      });
      toast.success('Odgovor shranjen');
    } catch {
      toast.error('Napaka');
    }
  };

  return (
    <Dialog open={!!listingId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {listing?.aiVerdict === 'PRILIKA' && <Target className="w-4 h-4 text-primary" />}
            {listing?.aiVerdict === 'SUMNJIVO' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
            Detajl oglasa
          </DialogTitle>
          <DialogDescription>
            {listing?.monitor?.name} • {listing?.monitor?.source}
          </DialogDescription>
        </DialogHeader>

        {loading || !listing ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Nalagam...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Image gallery - primary image + detail images if fetched */}
            {(listing.imageUrl || (listing.detailImages?.length ?? 0) > 0) && (
              <div className="rounded overflow-hidden border border-border bg-muted/30">
                {listing.detailImages && listing.detailImages.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1 max-h-96 overflow-y-auto">
                    {listing.detailImages.map((img: string, i: number) => (
                      <img
                        key={i}
                        src={img}
                        alt={`Slika ${i + 1}`}
                        className="w-full h-24 object-cover rounded bg-background cursor-pointer hover:opacity-80"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ))}
                  </div>
                ) : listing.imageUrl ? (
                  <img
                    src={listing.imageUrl}
                    alt={listing.title}
                    className="w-full max-h-80 object-contain bg-background"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : null}
              </div>
            )}

            {/* Title + price */}
            <div>
              <h2 className="font-bold text-base mb-1">{listing.title}</h2>
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="text-amber-400 font-mono text-lg">{listing.priceText}</span>
                {listing.aiEstimatedValue && (
                  <span className="text-xs text-primary">
                    AI tržna vrednost: ~{listing.aiEstimatedValue}€
                    {listing.price && (
                      <span className="ml-1">
                        ({listing.aiEstimatedValue > listing.price
                          ? `podcenjeno za ${listing.aiEstimatedValue - listing.price}€`
                          : `precenjeno za ${listing.price - listing.aiEstimatedValue}€`})
                      </span>
                    )}
                  </span>
                )}
              </div>
              {(listing.location || listing.firstSeenAt) && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5 flex-wrap">
                  {listing.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {listing.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> prvič videno {new Date(listing.firstSeenAt).toLocaleString('sl-SI')}
                  </span>
                </div>
              )}
            </div>

            {/* AI evaluation summary */}
            {(listing.aiScore != null || listing.aiRisk != null || listing.aiVerdict) && (
              <div className="grid grid-cols-3 gap-2">
                {listing.aiVerdict && (
                  <div className="bg-card/50 border border-border rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Verdikt</div>
                    <Badge variant="outline" className={cn(
                      'text-xs',
                      listing.aiVerdict === 'PRILIKA' && 'border-primary/40 text-primary',
                      listing.aiVerdict === 'SUMNJIVO' && 'border-amber-400/40 text-amber-400',
                      listing.aiVerdict === 'NEZANIMIVO' && 'border-muted text-muted-foreground',
                    )}>{listing.aiVerdict}</Badge>
                  </div>
                )}
                {listing.aiScore != null && (
                  <div className="bg-card/50 border border-border rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Prilika</div>
                    <div className="text-lg font-bold text-primary">{listing.aiScore}/10</div>
                  </div>
                )}
                {listing.aiRisk != null && (
                  <div className="bg-card/50 border border-border rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tveganje</div>
                    <div className="text-lg font-bold text-amber-400">{listing.aiRisk}/10</div>
                  </div>
                )}
              </div>
            )}

            {/* v1.8: Market comparison — real data vs AI estimate */}
            {data?.marketComparison && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Tržna primerjava (realni podatki)
                  <Badge variant="outline" className="text-[10px] ml-1">
                    {data.marketComparison.count} podobnih
                  </Badge>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Povprečje</div>
                    <div className="font-mono font-bold text-primary">{data.marketComparison.average} €</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Mediana</div>
                    <div className="font-mono font-bold">{data.marketComparison.median} €</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Min – Max</div>
                    <div className="font-mono text-[11px]">{data.marketComparison.min} – {data.marketComparison.max} €</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Std. dev.</div>
                    <div className="font-mono">±{data.marketComparison.stdDev} €</div>
                  </div>
                </div>
                <div className={cn(
                  'mt-2 p-2 rounded text-xs flex items-center gap-2',
                  data.marketComparison.belowMarket
                    ? 'bg-primary/5 border border-primary/20 text-primary'
                    : 'bg-amber-400/5 border border-amber-400/20 text-amber-400'
                )}>
                  {data.marketComparison.belowMarket
                    ? <TrendingDown className="w-4 h-4 shrink-0" />
                    : <TrendingUp className="w-4 h-4 shrink-0" />}
                  <span>
                    Ta oglas je <b>{data.marketComparison.belowMarket ? 'pod' : 'nad'}</b> tržnim povprečjem
                    za <b>{Math.abs(data.marketComparison.diffPct)}%</b> ({Math.abs(data.marketComparison.diffFromAvg)} €).
                    {data.marketComparison.aiVsMarketDiff != null && (
                      <span className="ml-1">
                        AI ocena {listing.aiEstimatedValue}€ {data.marketComparison.aiVsMarketDiff > 0 ? 'višja' : 'nižja'} od tržne za {Math.abs(data.marketComparison.aiVsMarketDiff)}€.
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* v1.4: Price history */}
            {priceHistory.length > 1 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  📈 Zgodovina cene ({priceHistory.length} {priceHistory.length === 1 ? 'zapisek' : 'zapiskov'})
                </h4>
                <div className="space-y-1">
                  {priceHistory.map((ph: any, i: number) => {
                    const prev = i > 0 ? priceHistory[i - 1] : null;
                    const changed = prev && (prev.price !== ph.price);
                    const diff = changed && prev.price != null && ph.price != null ? ph.price - prev.price : null;
                    return (
                      <div key={ph.id} className="flex items-center gap-2 text-xs p-1.5 bg-background/30 rounded">
                        <span className="font-mono text-amber-400">{ph.priceText}</span>
                        <span className="text-muted-foreground text-[10px]">• {new Date(ph.seenAt).toLocaleString('sl-SI')}</span>
                        {diff != null && (
                          <Badge variant="outline" className={cn(
                            'text-[10px] ml-auto',
                            diff < 0 ? 'border-primary/40 text-primary' : 'border-amber-400/40 text-amber-400',
                          )}>
                            {diff < 0 ? '↓' : '↑'} {Math.abs(diff)}€ ({diff < 0 ? 'padec' : 'dvig'})
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI reason */}
            {listing.aiReason && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">AI razlog</h4>
                <p className="text-sm italic border-l-2 border-border pl-3">{listing.aiReason}</p>
              </div>
            )}

            {/* Image analysis */}
            {listing.aiImageAnalysis && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">📸 AI analiza slike</h4>
                <p className="text-sm border-l-2 border-border pl-3">{listing.aiImageAnalysis}</p>
                {listing.aiImageVerdict && (
                  <Badge variant="outline" className={cn(
                    'text-[10px] mt-1.5',
                    listing.aiImageVerdict === 'AUTHENTIC' && 'border-primary/40 text-primary',
                    listing.aiImageVerdict === 'SUSPICIOUS' && 'border-amber-400/40 text-amber-400',
                    listing.aiImageVerdict === 'STOCK_PHOTO' && 'border-amber-400/40 text-amber-400',
                  )}>{listing.aiImageVerdict}</Badge>
                )}
              </div>
            )}

            {/* v1.4: Full detail description (from detail page fetch) */}
            {listing.detailDescription && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                  📄 Celoten opis (z detail strani)
                  {listing.detailFetchedAt && (
                    <span className="text-[10px] font-normal">
                      • pridobljeno {new Date(listing.detailFetchedAt).toLocaleString('sl-SI')}
                    </span>
                  )}
                </h4>
                <p className="text-sm bg-background/50 border border-border rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">{listing.detailDescription}</p>
              </div>
            )}

            {/* Original description */}
            {listing.description && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Originalni opis</h4>
                <p className="text-sm bg-background/50 border border-border rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">{listing.description}</p>
              </div>
            )}

            {/* v1.9: VIN extraction (for car listings) */}
            {(() => {
              const fullText = `${listing.title} ${listing.description || ''} ${listing.detailDescription || ''}`;
              // VIN pattern: 17 chars, alphanumeric, no I/O/Q, typically preceded by "VIN" or "št. podvozja"
              const vinMatch = fullText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
              if (!vinMatch) return null;
              const vin = vinMatch[1].toUpperCase();
              const days = Math.floor((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000);
              return (
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    🚗 VIN / Zgodovina vozila <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v1.9</Badge>
                  </h4>
                  <div className="bg-background/50 border border-border rounded p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase">VIN:</span>
                      <code className="text-sm font-mono text-primary">{vin}</code>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={`https://www.carfax.eu/vin/${vin}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary/70 hover:text-primary flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> CARFAX EU
                      </a>
                      <a href={`https://www.vindecoderz.com/VIN/${vin}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary/70 hover:text-primary flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> VIN Decoder
                      </a>
                      <a href={`https://en.wikipedia.org/wiki/Vehicle_identification_number`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> Kaj je VIN?
                      </a>
                    </div>
                    {days >= 14 && (
                      <p className="text-[11px] text-amber-400 mt-1">
                        ⏳ Oglas aktiven {days} dni — prodajalec je verjetno bolj motiviran za pogajanje.
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Similar listings */}
            {similar.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Podobni oglasi (isti monitor, cena ±30%)
                </h4>
                <div className="space-y-1.5">
                  {similar.map((s: any) => (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 p-2 bg-background/30 border border-border rounded hover:border-primary/30 transition-colors text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.priceText} • {new Date(s.firstSeenAt).toLocaleDateString('sl-SI')}
                          {s.aiVerdict && ` • ${s.aiVerdict}`}
                        </div>
                      </div>
                      <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <Button asChild size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <a href={listing.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" /> Odpri oglas
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={toggleBookmark}
                disabled={togglingBookmark}
                className={cn('gap-2', listing.isBookmarked && 'border-primary/40 text-primary')}
              >
                <Bookmark className={cn('w-3.5 h-3.5', listing.isBookmarked && 'fill-current')} />
                {listing.isBookmarked ? 'Shranjeno' : 'Shrani'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchDetailPage}
                disabled={fetchingDetail}
                className="gap-2"
              >
                {fetchingDetail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Pridobi detail page
              </Button>
              {listing.trades && listing.trades.length > 0 ? (
                <Badge variant="outline" className="border-primary/40 text-primary text-xs gap-1">
                  <ShoppingCart className="w-3 h-3" />
                  V skladišču ({listing.trades.length})
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addToSkladisce}
                  disabled={addingToTrade}
                  className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
                >
                  {addingToTrade ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                  Dodaj v Skladišče
                </Button>
              )}
            </div>

            {/* v2.4: Personal notes */}
            <div className="border-t border-border pt-3">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5" />
                Moje opombe
              </h4>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="npr. Poklical sem prodajalca, razpoložljiv od petka. Dogovor za 350€."
                className="text-xs min-h-[60px]"
              />
              <Button size="sm" variant="outline" onClick={saveNotes} disabled={notesSaving} className="mt-1.5 gap-1.5 h-7 text-xs">
                {notesSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <StickyNote className="w-3 h-3" />}
                Shrani opombe
              </Button>
            </div>

            {/* v2.4: Contact tracker */}
            <div className="border-t border-border pt-3">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                Sledenje kontakta <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.4</Badge>
              </h4>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  { val: 'none', label: 'Ni kontakt', cls: 'border-muted text-muted-foreground' },
                  { val: 'contacted', label: '📞 Kontaktiran', cls: 'border-amber-400/40 text-amber-400' },
                  { val: 'responded', label: '✉️ Odgovoril', cls: 'border-primary/40 text-primary' },
                  { val: 'closed', label: '✅ Zaključeno', cls: 'border-muted text-muted-foreground' },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => updateContact(opt.val)}
                    className={cn(
                      'px-2 py-1 rounded border text-[10px] uppercase tracking-wider transition-colors',
                      contactStatus === opt.val ? opt.cls + ' bg-card' : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {contactStatus !== 'none' && (
                <>
                  <Textarea
                    value={sellerResponse}
                    onChange={(e) => setSellerResponse(e.target.value)}
                    placeholder="Kaj je prodajalec odgovoril? (npr. 'Cena je fiksna, lahko pridete v ponedeljek')"
                    className="text-xs min-h-[40px]"
                  />
                  <Button size="sm" variant="ghost" onClick={saveSellerResponse} className="mt-1 h-6 text-xs gap-1">
                    Shrani odgovor
                  </Button>
                </>
              )}
            </div>

            {/* v1.8: AI Negotiator */}
            <div className="border-t border-border pt-3">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                AI pogajalec
              </h4>
              <div className="flex flex-wrap gap-2 mb-2">
                <Button size="sm" variant="outline" onClick={() => generateMessage('initial')} disabled={negotiating} className="gap-1.5 text-xs h-7">
                  {negotiating && negotiateType === 'initial' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                  Začetno sporočilo
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateMessage('low_offer')} disabled={negotiating} className="gap-1.5 text-xs h-7">
                  {negotiating && negotiateType === 'low_offer' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
                  Nizka ponudba
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateMessage('polite_decline')} disabled={negotiating} className="gap-1.5 text-xs h-7">
                  {negotiating && negotiateType === 'polite_decline' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                  Vljudna zavrnitev
                </Button>
              </div>
              {negotiateMessage && (
                <div className="bg-background/50 border border-border rounded p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Generirano sporočilo:</span>
                    <Button size="sm" variant="ghost" onClick={copyMessage} className="h-6 px-2 text-xs gap-1">
                      {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Kopirano' : 'Kopiraj'}
                    </Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{negotiateMessage}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    ⚠️ Preglej in prilagodi pred pošiljanjem. AI ne pozna specifičnih detailov ki jih vidiš ti.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
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
  const days = Math.floor(h / 24);
  if (days < 30) return `pred ${days}d`;
  return d.toLocaleDateString('sl-SI');
}

// v2.3: Side-by-side compare modal
function CompareModal({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data || !data.listings || data.listings.length === 0) return null;
  const listings = data.listings;

  // Find best price (lowest)
  const prices = listings.map((l: any) => l.price).filter((p: any) => p != null);
  const bestPrice = prices.length > 0 ? Math.min(...prices) : null;
  // Find best AI score (highest)
  const scores = listings.map((l: any) => l.aiScore).filter((s: any) => s != null);
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-primary" />
            Primerjava {listings.length} oglasov
          </DialogTitle>
          <DialogDescription>Side-by-side primerjava — izberi najboljšo ponzudbo.</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-2 text-muted-foreground uppercase tracking-wider w-32">Lastnost</th>
                {listings.map((l: any, i: number) => (
                  <th key={i} className="text-left p-2 align-top min-w-[180px]">
                    {l.imageUrl && (
                      <img src={l.imageUrl} alt="" className="w-full h-24 object-cover rounded mb-2" loading="lazy" />
                    )}
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline line-clamp-2">
                      {l.title}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Cena" values={listings.map((l: any) => l.priceText ?? '—')} best={listings.map((l: any) => l.price === bestPrice && l.price != null)} />
              <CompareRow label="AI verdikt" values={listings.map((l: any) => l.aiVerdict ?? '—')} />
              <CompareRow label="AI prilika" values={listings.map((l: any) => l.aiScore != null ? `${l.aiScore}/10` : '—')} best={listings.map((l: any) => l.aiScore === bestScore && l.aiScore != null)} />
              <CompareRow label="AI tveganje" values={listings.map((l: any) => l.aiRisk != null ? `${l.aiRisk}/10` : '—')} />
              <CompareRow label="AI tržna vrednost" values={listings.map((l: any) => l.aiEstimatedValue ? `${l.aiEstimatedValue} €` : '—')} />
              <CompareRow label="Lokacija" values={listings.map((l: any) => l.location || '—')} />
              <CompareRow label="Monitor" values={listings.map((l: any) => l.monitor?.name ?? '—')} />
              <CompareRow label="Prvič videno" values={listings.map((l: any) => new Date(l.firstSeenAt).toLocaleDateString('sl-SI'))} />
              <CompareRow label="Starost (dni)" values={listings.map((l: any) => String(Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000)))} />
              <CompareRow label="Padec cene" values={listings.map((l: any) => l.priceDroppedAt ? `📉 ${new Date(l.priceDroppedAt).toLocaleDateString('sl-SI')}` : '—')} />
              <CompareRow label="AI razlog" values={listings.map((l: any) => (l.aiReason || '—').slice(0, 100))} />
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompareRow({ label, values, best }: { label: string; values: string[]; best?: boolean[] }) {
  return (
    <tr className="border-b border-border/50">
      <td className="p-2 text-muted-foreground font-medium uppercase tracking-wider text-[10px]">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cn('p-2 font-mono', best?.[i] && 'text-primary font-bold')}>
          {v}
        </td>
      ))}
    </tr>
  );
}
