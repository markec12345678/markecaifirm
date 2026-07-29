'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSwipe } from '@/lib/use-swipe';
import { NegotiationHistory } from '@/components/dashboard/negotiation-history';
import { PriceForecastChart } from '@/components/dashboard/price-forecast-chart';
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
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target, MapPin, Clock, Bookmark, Sparkles, ShoppingCart, MessageSquare, BarChart3, TrendingDown, TrendingUp, Copy, Check, GitCompare, StickyNote, Phone, Trash2, EyeOff, Zap, User, Wallet, BookOpen, ShieldAlert, Dice5, Send, Wrench, Camera, ScanSearch, Search, FileEdit } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// v6.95: AI panel-i izvlečeni v samostojne komponente (ListingDetailModal razbit).
// Prej je bil ListingDetailModal 4070 vrstic z 70+ useState. Sedaj ima AI analize v podkomponentah.
import { SentimentPanel } from '@/components/dashboard/listing-detail/sentiment-panel';
import { AuctionSniperPanel } from '@/components/dashboard/listing-detail/auction-sniper-panel';

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
  contactStatus: string;
  // v4.4: AI Deal Score 0-100
  dealScore: number | null;
  dealScoreReason: string | null;
  dealScoreComputedAt: string | null;
  // v4.5: Target price
  targetPrice: number | null;
  targetPriceSetAt: string | null;
  targetPriceAlertSent: boolean;
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
  const [contactFilter, setContactFilter] = useState<string>('all');
  const [sort, setSort] = useState<string>('firstSeen');
  const [offset, setOffset] = useState(0);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  // v3.6: Bulk select for listings
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // v5.5: AI categorize loading
  const [categorizing, setCategorizing] = useState(false);
  // v5.6: AI anomaly scan
  const [scanningAnomalies, setScanningAnomalies] = useState(false);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  // v6.1: AI deduplication
  const [dedupLoading, setDedupLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  // v6.5: Bulk buy opportunities
  const [bulkBuyLoading, setBulkBuyLoading] = useState(false);
  const [bulkBuyData, setBulkBuyData] = useState<any>(null);
  // v6.1: Saved searches
  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
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
      if (contactFilter !== 'all') params.set('contactStatus', contactFilter);
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
  }, [monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, contactFilter, sort, offset]);

  useEffect(() => {
    (async () => {
      try {
        const [monRes, ssRes] = await Promise.all([
          fetch('/api/monitors'),
          fetch('/api/saved-searches'),
        ]);
        if (monRes.ok) setMonitors(await monRes.json());
        if (ssRes.ok) {
          const ssData = await ssRes.json();
          setSavedSearches(ssData.searches || []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reset offset when filters change
  useEffect(() => { setOffset(0); }, [monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, contactFilter, sort]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (monitorId !== 'all') params.set('monitorId', monitorId);
    if (verdict !== 'all') params.set('verdict', verdict);
    if (minScore) params.set('minScore', minScore);
    if (maxRisk) params.set('maxRisk', maxRisk);
    if (hasImage) params.set('hasImage', '1');
    if (bookmarkedOnly) params.set('bookmarked', '1');
    if (contactFilter !== 'all') params.set('contactStatus', contactFilter);
    params.set('sort', sort);
    params.set('limit', '500');
    params.set('format', 'csv');
    window.open(`/api/listings?${params}`, '_blank');
  };

  // v3.6: Bulk actions
  const toggleBulk = (id: string) => {
    setBulkIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkAction = async (action: 'bookmark' | 'unbookmark' | 'delete' | 'contact' | 'clear_contact' | 'hide') => {
    if (bulkIds.size === 0) return;
    if (action === 'delete' && !confirm(`Izbrišem ${bulkIds.size} oglasov?`)) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/listings/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(bulkIds), action }),
      });
      const data = await res.json();
      if (data.ok) {
        const labels: Record<string, string> = {
          bookmark: 'označeni kot priljubljeni',
          unbookmark: 'odstranjeno iz priljubljenih',
          delete: 'izbrisani',
          contact: 'označeni kot kontaktirani',
          clear_contact: 'počiščen kontakt status',
          hide: 'skriti',
        };
        toast.success(`${data.affected} oglasov ${labels[action] || action}`);
        setBulkIds(new Set());
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch {
      toast.error('Napaka pri bulk operaciji');
    } finally {
      setBulkLoading(false);
    }
  };

  // v3.9: Quick contact toggle — no modal needed
  const quickContact = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'none' ? 'contacted' : 'none';
    setData(prev => prev ? {
      ...prev,
      listings: prev.listings.map(l =>
        l.id === id ? { ...l, contactStatus: newStatus } : l
      ),
    } : prev);
    try {
      await fetch(`/api/listings/${id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactStatus: newStatus }),
      });
      toast.success(newStatus === 'contacted' ? '📞 Označeno kot kontaktirano' : 'Počiščeno');
    } catch {
      toast.error('Napaka');
    }
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* v5.5: AI Bulk Categorize */}
          {monitorId !== 'all' && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
              disabled={categorizing}
              onClick={async () => {
                setCategorizing(true);
                try {
                  const res = await fetch('/api/ai/categorize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monitorId, limit: 50 }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    toast.success(`✓ ${data.count} oglasov kategoriziranih`);
                    await load();
                  } else {
                    toast.error(data.error ?? 'Napaka');
                  }
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setCategorizing(false); }
              }}
              title="AI kategoriziraj nekategorizirane oglase"
            >
              {categorizing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AI kategoriziraj
            </Button>
          )}
          {/* v5.6: AI Anomaly Scan */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            disabled={scanningAnomalies}
            onClick={async () => {
              setScanningAnomalies(true);
              setAnomalies([]);
              try {
                const body: any = { days: 7, limit: 30 };
                if (monitorId !== 'all') body.monitorId = monitorId;
                const res = await fetch('/api/ai/detect-anomalies', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await res.json();
                if (data.ok) {
                  setAnomalies(data.anomalies || []);
                  const suspicious = data.suspiciousCount ?? 0;
                  toast.success(`✓ Analizirano ${data.analyzedCount} oglasov, ${suspicious} sumljivih`);
                } else {
                  toast.error(data.error ?? 'Napaka');
                }
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setScanningAnomalies(false); }
            }}
            title="AI skeniraj za sumljive oglase (prevarantski vzorci)"
          >
            {scanningAnomalies ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            AI anomaly scan
          </Button>
          {/* v6.1: AI Deduplication */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
            disabled={dedupLoading}
            onClick={async () => {
              setDedupLoading(true);
              setDuplicates([]);
              try {
                const body: any = { days: 14, limit: 50 };
                if (monitorId !== 'all') body.monitorId = monitorId;
                const res = await fetch('/api/ai/deduplicate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await res.json();
                if (data.ok) {
                  setDuplicates(data.duplicates || []);
                  toast.success(`✓ ${data.duplicateGroups} duplikatov najdenih (${data.totalDuplicates} oglasov)`);
                } else { toast.error(data.error ?? 'Napaka'); }
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setDedupLoading(false); }
            }}
            title="AI najdi duplicirane oglase"
          >
            {dedupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />}
            AI deduplikacija
          </Button>
          {/* v6.5: Bulk Buy Opportunities */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-green-400/40 text-green-400 hover:bg-green-400/10"
            disabled={bulkBuyLoading}
            onClick={async () => {
              setBulkBuyLoading(true); setBulkBuyData(null);
              try {
                const res = await fetch('/api/ai/bulk-buy?days=30&minListings=3');
                const data = await res.json();
                if (data.ok) { setBulkBuyData(data); toast.success(`✓ ${data.bulkOpportunities} bulk priložnosti (${data.totalPotentialSavings}€ prihranka)`); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setBulkBuyLoading(false); }
            }}
            title="AI najdi bulk buy priložnosti (paketni nakup s popustom)"
          >
            {bulkBuyLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            Bulk buy
          </Button>
          {/* v6.1: Save search */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setShowSaveSearch(!showSaveSearch)}
            title="Shrani trenutno iskanje"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Shrani iskanje
          </Button>
          <Button size="sm" variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Osveži
          </Button>
          {/* v3.3: JSON export */}
          <Button size="sm" variant="outline" onClick={() => window.open('/api/listings/export-json', '_blank')} className="gap-2" title="Izvozi JSON za eksterno analizo">
            <Download className="w-3.5 h-3.5" /> JSON
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-2">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* v5.6: Anomaly scan results */}
      {anomalies.length > 0 && (
        <Card className="bg-amber-400/5 border-amber-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                AI Anomaly Scan — {anomalies.filter(a => a.anomalyScore >= 50).length} sumljivih od {anomalies.length}
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v5.6</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setAnomalies([])} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {anomalies.filter(a => a.anomalyScore >= 30).sort((a, b) => b.anomalyScore - a.anomalyScore).map((a, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-2 p-2 rounded text-xs border',
                  a.anomalyScore >= 70 ? 'bg-red-500/5 border-red-500/30' :
                  a.anomalyScore >= 50 ? 'bg-amber-400/5 border-amber-400/30' :
                  'bg-card/50 border-border'
                )}>
                  <Badge variant="outline" className={cn(
                    'text-[9px] font-mono shrink-0',
                    a.anomalyScore >= 70 ? 'text-red-500 border-red-500/40' :
                    a.anomalyScore >= 50 ? 'text-amber-400 border-amber-400/40' :
                    'text-muted-foreground'
                  )}>
                    {a.anomalyScore}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary truncate block">
                      {a.title}
                    </a>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {a.price != null && `${a.price}€ • `}
                      {a.flags?.join(', ') || 'brez flagov'}
                    </div>
                    {a.reasoning && (
                      <div className="text-[10px] italic text-muted-foreground mt-0.5">{a.reasoning}</div>
                    )}
                    {a.recommendation && (
                      <div className={cn('text-[10px] mt-0.5', a.recommendation === 'avoid' ? 'text-red-500' : a.recommendation === 'proceed_cautiously' ? 'text-amber-400' : 'text-muted-foreground')}>
                        → {a.recommendation}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.1: Deduplication results */}
      {duplicates.length > 0 && (
        <Card className="bg-blue-400/5 border-blue-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                <GitCompare className="w-4 h-4" />
                AI Deduplikacija — {duplicates.length} grup duplikatov
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.1</Badge>
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1 text-amber-400 border-amber-400/40"
                  onClick={async () => {
                    const toHide = duplicates.flatMap(d => d.listings.slice(1).map((l: any) => l.id));
                    if (toHide.length === 0) return;
                    if (!confirm(`Skrijem ${toHide.length} duplikatov (obdržim prvi oglas v vsaki grupi)?`)) return;
                    try {
                      const res = await fetch('/api/listings/bulk-hide', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingIds: toHide }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        toast.success(`✓ Skritih ${data.hidden} duplikatov`);
                        setDuplicates([]);
                        await load();
                      }
                    } catch { toast.error('Napaka'); }
                  }}
                >
                  Skrij vse duplikate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDuplicates([])} className="h-6 text-xs">×</Button>
              </div>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {duplicates.map((dup, i) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40">
                      {dup.similarityScore}% podobnost
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{dup.reason}</span>
                  </div>
                  <div className="space-y-0.5">
                    {dup.listings.map((l: any, j: number) => (
                      <div key={l.id} className={cn(
                        'flex items-center gap-2 p-1 rounded text-[11px]',
                        j === 0 ? 'bg-primary/5' : 'bg-background/30'
                      )}>
                        {j === 0 && <Badge variant="outline" className="text-[8px] text-primary border-primary/40 shrink-0">PRVI</Badge>}
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate flex-1 hover:text-primary">
                          {l.title}
                        </a>
                        <span className="text-muted-foreground shrink-0">{l.priceText}</span>
                        <span className="text-[9px] text-muted-foreground shrink-0">{l.source}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.5: Bulk Buy results */}
      {bulkBuyData && !bulkBuyLoading && (
        <Card className="bg-green-400/5 border-green-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-green-400 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Bulk Buy priložnosti — {bulkBuyData.bulkOpportunities} prodajalcev, {bulkBuyData.totalPotentialSavings}€ prihranka
                <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/40">v6.5</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setBulkBuyData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {bulkBuyData.opportunities.map((opp: any, i: number) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-green-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">{opp.sellerName}</span>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[9px] text-green-400 border-green-400/40">
                        {opp.discountPct}% popust
                      </Badge>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                        💰 {opp.potentialSavings}€ prihranek
                      </Badge>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-1">
                    {opp.listingCount} oglasov • skupna vrednost {opp.totalValue}€ → paketna cena {opp.suggestedBulkPrice}€
                  </div>
                  <div className="text-[10px] italic text-muted-foreground mb-1">{opp.reason}</div>
                  <div className="space-y-0.5">
                    {opp.listings.slice(0, 4).map((l: any, j: number) => (
                      <a key={j} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 p-0.5 hover:bg-card/50 rounded text-[10px]">
                        <span className="truncate flex-1">{l.title}</span>
                        <span className="font-mono text-amber-400 shrink-0">{l.priceText}</span>
                        {l.dealScore != null && <Badge variant="outline" className="text-[8px] text-primary border-primary/40 shrink-0">🎯{l.dealScore}</Badge>}
                      </a>
                    ))}
                    {opp.listings.length > 4 && <div className="text-[9px] text-muted-foreground">... in {opp.listings.length - 4} več</div>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.1: Saved searches panel */}
      {(showSaveSearch || savedSearches.length > 0) && (
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5" />
                Shranjena iskanja
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.1</Badge>
              </h3>
            </div>
            {showSaveSearch && (
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={newSearchName}
                  onChange={(e) => setNewSearchName(e.target.value)}
                  placeholder="Ime iskanja (npr. iPhone pod 300€)"
                  className="text-xs h-7"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSearchName.trim()) {
                      (async () => {
                        try {
                          const res = await fetch('/api/saved-searches', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: newSearchName.trim(),
                              filters: { monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, contactFilter, sort },
                            }),
                          });
                          const data = await res.json();
                          if (data.ok) {
                            toast.success('Iskanje shranjeno');
                            setNewSearchName('');
                            setShowSaveSearch(false);
                            setSavedSearches(prev => [...prev, data.search]);
                          }
                        } catch { toast.error('Napaka'); }
                      })();
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!newSearchName.trim()}
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/saved-searches', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: newSearchName.trim(),
                          filters: { monitorId, verdict, minScore, maxRisk, hasImage, bookmarkedOnly, contactFilter, sort },
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        toast.success('Iskanje shranjeno');
                        setNewSearchName('');
                        setShowSaveSearch(false);
                        setSavedSearches(prev => [...prev, data.search]);
                      }
                    } catch { toast.error('Napaka'); }
                  }}
                >
                  Shrani
                </Button>
              </div>
            )}
            {savedSearches.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {savedSearches.map((ss: any) => (
                  <div key={ss.id} className="flex items-center gap-1 px-2 py-1 bg-background/30 rounded text-[11px] border border-border group">
                    <button
                      onClick={() => {
                        const f = ss.filters;
                        if (f.monitorId !== undefined) setMonitorId(f.monitorId);
                        if (f.verdict !== undefined) setVerdict(f.verdict);
                        if (f.minScore !== undefined) setMinScore(f.minScore);
                        if (f.maxRisk !== undefined) setMaxRisk(f.maxRisk);
                        if (f.hasImage !== undefined) setHasImage(f.hasImage);
                        if (f.bookmarkedOnly !== undefined) setBookmarkedOnly(f.bookmarkedOnly);
                        if (f.contactFilter !== undefined) setContactFilter(f.contactFilter);
                        if (f.sort !== undefined) setSort(f.sort);
                        toast.success(`Iskanje "${ss.name}" naloženo`);
                      }}
                      className="hover:text-primary"
                    >
                      {ss.name}
                    </button>
                    <button
                      onClick={async () => {
                        await fetch(`/api/saved-searches?id=${ss.id}`, { method: 'DELETE' });
                        setSavedSearches(prev => prev.filter((s: any) => s.id !== ss.id));
                        toast.success('Iskanje izbrisano');
                      }}
                      className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <SelectItem value="age">Najstarejši prvo (pogajalska moč)</SelectItem>
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
            {(monitorId !== 'all' || verdict !== 'all' || minScore || maxRisk || hasImage || bookmarkedOnly || contactFilter !== 'all') && (
              <Button size="sm" variant="ghost" onClick={() => { setMonitorId('all'); setVerdict('all'); setMinScore(''); setMaxRisk(''); setHasImage(false); setBookmarkedOnly(false); setContactFilter('all'); }} className="h-7 text-xs">
                Počisti filtre
              </Button>
            )}
          </div>
          {/* v2.5: Contact status filter */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Kontakt:</span>
            {['all', 'none', 'contacted', 'responded', 'closed'].map(f => (
              <Button
                key={f}
                size="sm"
                variant={contactFilter === f ? 'default' : 'outline'}
                onClick={() => setContactFilter(f)}
                className={cn('h-6 px-2 text-[10px] uppercase', contactFilter === f && 'bg-primary text-primary-foreground')}
              >
                {f === 'all' ? 'Vsi' : f === 'none' ? 'Ni kontakt' : f === 'contacted' ? '📞 Kontaktiran' : f === 'responded' ? '✉️ Odgovoril' : '✅ Zaključeno'}
              </Button>
            ))}
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
                onToggleBulk={() => toggleBulk(l.id)}
                isBulkSelected={bulkIds.has(l.id)}
                onQuickContact={() => quickContact(l.id, l.contactStatus || 'none')}
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

      {/* v3.6: Bulk actions toolbar */}
      {bulkIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-primary">{bulkIds.size} izbranih</span>
              <Button size="sm" variant="outline" onClick={() => bulkAction('bookmark')} disabled={bulkLoading} className="gap-1.5 text-xs h-7">
                <Bookmark className="w-3 h-3" /> Priljubljeni
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('contact')} disabled={bulkLoading} className="gap-1.5 text-xs h-7">
                📞 Kontaktiran
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('hide')} disabled={bulkLoading} className="gap-1.5 text-xs h-7">
                <EyeOff className="w-3 h-3" /> Skrij
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('delete')} disabled={bulkLoading} className="gap-1.5 text-xs h-7 text-destructive">
                <Trash2 className="w-3 h-3" /> Izbriši
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBulkIds(new Set())} className="h-7 text-xs">
                Počisti
              </Button>
            </div>
          </CardContent>
        </Card>
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

function ListingRow({ listing, onOpenDetail, onToggleBookmark, onToggleCompare, isCompareSelected, onToggleBulk, isBulkSelected, onQuickContact }: { listing: Listing; onOpenDetail: () => void; onToggleBookmark: () => void; onToggleCompare: () => void; isCompareSelected: boolean; onToggleBulk: () => void; isBulkSelected: boolean; onQuickContact: () => void; }) {
  const verdictColor =
    listing.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    listing.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';
  const verdictIcon =
    listing.aiVerdict === 'PRILIKA' ? <Target className="w-3 h-3" /> :
    listing.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3 h-3" /> :
    null;

  // v5.0: Swipe gestures (mobile only — touch events)
  const { swipeState, touchHandlers } = useSwipe({
    onSwipeLeft: () => onToggleBookmark(), // swipe left = bookmark
    onSwipeRight: () => onOpenDetail(), // swipe right = open detail
  }, true);

  // Visual feedback during swipe
  const swipeOffset = swipeState.isSwiping ? swipeState.deltaX * 0.3 : 0;
  const swipeOpacity = swipeState.isSwiping ? 1 - Math.min(0.4, Math.abs(swipeState.deltaX) / 300) : 1;
  const swipeBgHint = swipeState.isSwiping
    ? (swipeState.direction === 'left'
        ? 'bg-amber-400/5'
        : swipeState.direction === 'right'
          ? 'bg-primary/5'
          : '')
    : '';

  return (
    <div
      {...touchHandlers}
      className="relative"
      style={{
        transform: swipeState.isSwiping ? `translateX(${swipeOffset}px)` : 'translateX(0)',
        opacity: swipeOpacity,
        transition: swipeState.isSwiping ? 'none' : 'transform 200ms, opacity 200ms',
      }}
    >
      {/* v5.0: Swipe hint background */}
      {swipeState.isSwiping && swipeState.direction === 'left' && (
        <div className="absolute inset-0 flex items-center justify-end pr-4 pointer-events-none">
          <Bookmark className={cn('w-6 h-6', listing.isBookmarked ? 'text-primary' : 'text-amber-400')} />
        </div>
      )}
      {swipeState.isSwiping && swipeState.direction === 'right' && (
        <div className="absolute inset-0 flex items-center justify-start pl-4 pointer-events-none">
          <ExternalLink className="w-6 h-6 text-primary" />
        </div>
      )}
    <Card className={cn(
      'bg-card/50 hover:bg-card hover:border-primary/30 transition-colors cursor-pointer relative',
      listing.isBookmarked && 'border-primary/50 ring-1 ring-primary/20',
      swipeBgHint,
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
              {listing.dealScore != null && (
                <span className={cn(
                  'text-[11px] font-mono font-bold px-1.5 py-0.5 rounded',
                  listing.dealScore >= 90 ? 'bg-primary/20 text-primary' :
                  listing.dealScore >= 70 ? 'bg-primary/10 text-primary/80' :
                  listing.dealScore >= 50 ? 'bg-amber-400/10 text-amber-400' :
                  'bg-red-500/10 text-red-500'
                )}>
                  🎯 {listing.dealScore}/100
                </span>
              )}
              {listing.targetPrice != null && (
                <span className={cn(
                  'text-[11px] font-mono px-1.5 py-0.5 rounded border',
                  listing.price != null && listing.price <= listing.targetPrice
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-amber-400/40 bg-amber-400/5 text-amber-400'
                )} title={`Ciljna cena: ${listing.targetPrice}€`}>
                  🎯 {listing.targetPrice}€
                </span>
              )}
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
            {listing.isBookmarked && (
              <span className="text-primary text-[10px]">⭐ shranjeno</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* v3.6: Bulk select checkbox */}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleBulk(); }}
              className={cn(
                'w-4 h-4 rounded border shrink-0 transition-colors',
                isBulkSelected ? 'bg-primary border-primary' : 'border-border hover:border-primary'
              )}
              title="Izberi za bulk akcijo"
            >
              {isBulkSelected && <Check className="w-3 h-3 text-primary-foreground mx-auto" />}
            </button>
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
            {/* v3.9: Quick contact toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); onQuickContact(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors text-[10px]',
                (listing.contactStatus && listing.contactStatus !== 'none')
                  ? 'text-amber-400 bg-amber-400/5'
                  : 'text-muted-foreground hover:text-amber-400'
              )}
              title={listing.contactStatus && listing.contactStatus !== 'none' ? 'Počisti kontakt status' : 'Označi kot kontaktirano'}
            >
              📞
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
    </div>
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
  // v4.6: Multi-language support
  const [negotiateLang, setNegotiateLang] = useState<string>('sl');
  const [negotiateLangLabel, setNegotiateLangLabel] = useState<string>('SLO');
  const [copied, setCopied] = useState(false);
  // v2.4: Listing notes
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [contactStatus, setContactStatus] = useState('none');
  const [sellerResponse, setSellerResponse] = useState('');
  // v3.1: Refresh
  const [refreshing, setRefreshing] = useState(false);
  // v4.5: Target price
  const [targetPrice, setTargetPrice] = useState('');
  const [targetSaving, setTargetSaving] = useState(false);
  // v4.8: AI model comparison
  const [comparing, setComparing] = useState(false);
  const [compareResults, setCompareResults] = useState<any[]>([]);
  const [compareModelsInput, setCompareModelsInput] = useState<string>(''); // comma-separated model names
  // v5.0: AI auto-bid
  const [bidding, setBidding] = useState(false);
  const [bidResult, setBidResult] = useState<any>(null);
  const [bidStrategy, setBidStrategy] = useState<'aggressive' | 'moderate' | 'conservative'>('moderate');
  const [bidMaxBudget, setBidMaxBudget] = useState('');
  const [bidCopied, setBidCopied] = useState(false);
  // v5.1: Price prediction
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<any>(null);
  const [predictTarget, setPredictTarget] = useState('');
  // v6.11: Negotiation Playbook
  const [playbook, setPlaybook] = useState<any>(null);
  const [playbookLoading, setPlaybookLoading] = useState(false);
  const [playbookMaxBudget, setPlaybookMaxBudget] = useState('');
  const [playbookCopied, setPlaybookCopied] = useState<string | null>(null);
  // v6.13: Fraud Detection
  const [fraud, setFraud] = useState<any>(null);
  const [fraudLoading, setFraudLoading] = useState(false);
  // v6.14: Negotiation Outcome Predictor
  const [outcome, setOutcome] = useState<any>(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [outcomeOffer, setOutcomeOffer] = useState('');
  const [outcomeMessage, setOutcomeMessage] = useState('');
  // v6.20: Chatbot + Refurb (sentiment in snipe sta v podkomponentah v6.95)
  const [chatbotMessages, setChatbotMessages] = useState<Array<{ role: 'user' | 'seller'; text: string }>>([]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [chatbotLoading, setChatbotLoading] = useState(false);
  const [chatbotStrategy, setChatbotStrategy] = useState<'aggressive' | 'firm' | 'patient'>('firm');
  const [chatbotMaxPrice, setChatbotMaxPrice] = useState('');
  const [chatbotLastReply, setChatbotLastReply] = useState<any>(null);
  const [refurb, setRefurb] = useState<any>(null);
  const [refurbLoading, setRefurbLoading] = useState(false);
  // v6.21: Image Quality + Fake Detection
  const [imageQuality, setImageQuality] = useState<any>(null);
  const [imageQualityLoading, setImageQualityLoading] = useState(false);
  const [fakeDetect, setFakeDetect] = useState<any>(null);
  const [fakeDetectLoading, setFakeDetectLoading] = useState(false);
  // v6.22: Reverse Image Search
  const [reverseSearch, setReverseSearch] = useState<any>(null);
  const [reverseSearchLoading, setReverseSearchLoading] = useState(false);
  // v6.23: Description Optimizer
  const [descOpt, setDescOpt] = useState<any>(null);
  const [descOptLoading, setDescOptLoading] = useState(false);
  const [descOptCopied, setDescOptCopied] = useState<string | null>(null);
  // v5.1: Seller reputation
  const [sellerRep, setSellerRep] = useState<any>(null);
  const [sellerLoading, setSellerLoading] = useState(false);
  // v5.6: External price comparison
  const [extCompare, setExtCompare] = useState<any>(null);
  const [extCompareLoading, setExtCompareLoading] = useState(false);
  // v5.7: AI similar listings
  const [similarListings, setSimilarListings] = useState<any[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  // v6.0: AI listing enrichment
  const [enrichment, setEnrichment] = useState<any>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  // v6.2: AI Flip Score
  const [flipScore, setFlipScore] = useState<any>(null);
  const [flipLoading, setFlipLoading] = useState(false);
  // v6.2: Market Saturation
  const [saturation, setSaturation] = useState<any>(null);
  const [satLoading, setSatLoading] = useState(false);
  // v6.2: ROI Calculator
  const [roiResult, setRoiResult] = useState<any>(null);
  const [roiLoading, setRoiLoading] = useState(false);
  const [roiSellPrice, setRoiSellPrice] = useState('');
  const [roiPlatform, setRoiPlatform] = useState<'bolha' | 'vinted' | 'other'>('bolha');

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
      // v4.5: Load target price
      setTargetPrice(d.listing?.targetPrice != null ? String(d.listing.targetPrice) : '');
      // v4.8: Reset comparison results when loading new listing
      setCompareResults([]);
      // v5.0: Reset bid result
      setBidResult(null);
      // v5.1: Reset prediction
      setPrediction(null);
      setPredictTarget(d.listing?.targetPrice != null ? String(d.listing.targetPrice) : '');
      // v6.11: Reset negotiation playbook
      setPlaybook(null);
      setPlaybookCopied(null);
      // v6.13: Reset fraud detection
      setFraud(null);
      // v6.14: Reset negotiation outcome
      setOutcome(null);
      setOutcomeOffer('');
      setOutcomeMessage('');
      // v6.20: Reset chatbot + refurb (sentiment + snipe sta v podkomponentah v6.95)
      setChatbotMessages([]);
      setChatbotInput('');
      setChatbotMaxPrice('');
      setChatbotLastReply(null);
      setRefurb(null);
      // v6.21: Reset image quality + fake detection
      setImageQuality(null);
      setFakeDetect(null);
      // v6.22: Reset reverse image search
      setReverseSearch(null);
      // v6.23: Reset description optimizer
      setDescOpt(null);
      setDescOptCopied(null);
      // v5.6: Reset external comparison
      setExtCompare(null);
      // v5.7: Reset similar listings
      setSimilarListings([]);
      // v6.0: Reset enrichment
      setEnrichment(null);
      // v6.2: Reset flip score, saturation, ROI
      setFlipScore(null);
      setSaturation(null);
      setRoiResult(null);
      setRoiSellPrice(d.listing?.aiEstimatedValue ? String(d.listing.aiEstimatedValue) : '');
      // v5.1: Reset seller reputation
      setSellerRep(null);
      // Auto-load seller reputation if listing has sellerName
      if (d.listing?.sellerName) {
        loadSellerRep(d.listing.sellerName);
      }
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

  // v1.8: AI Negotiator — generate message to seller (v4.6: with language)
  const generateMessage = async (type: string, lang?: string) => {
    if (!listing) return;
    setNegotiating(true);
    setNegotiateType(type);
    setNegotiateMessage(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, lang: lang ?? negotiateLang }),
      });
      const data = await res.json();
      if (data.ok) {
        setNegotiateMessage(data.message);
        toast.success(`Sporočilo generirano (${data.lang?.toUpperCase()})`);
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

  // v3.1: Refresh listing from source
  const refreshListing = async () => {
    if (!listing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/listings/${listing.id}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        if (data.priceChanged) {
          toast.success(`Osveženo! Cena: ${data.oldPrice}€ → ${data.newPrice}€`);
        } else {
          toast.success('Osveženo! Cena nespremenjena.');
        }
        if (data.evaluation) {
          toast.info(`AI: ${data.evaluation.verdict} (${data.evaluation.score}/10)`);
        }
        await loadDetail();
      } else {
        toast.error(data.error ?? 'Napaka pri osveževanju');
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setRefreshing(false);
    }
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

  // v4.5: Save target price
  const saveTargetPrice = async (clear: boolean = false) => {
    if (!listing) return;
    setTargetSaving(true);
    try {
      const value = clear ? null : (targetPrice.trim() ? parseInt(targetPrice, 10) : null);
      if (!clear && targetPrice.trim() && (Number.isNaN(value) || (value as number) <= 0)) {
        toast.error('Ciljna cena mora biti pozitivno število');
        setTargetSaving(false);
        return;
      }
      const res = await fetch(`/api/listings/${listing.id}/target`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: value }),
      });
      const d = await res.json();
      if (d.ok) {
        if (value === null) {
          toast.success('Ciljna cena odstranjena');
          setTargetPrice('');
        } else {
          toast.success(`Ciljna cena nastavljena: ${value}€`);
          if (d.alreadyBelow) {
            toast.info(`Trenutna cena (${d.currentPrice}€) je že pod ciljem — alert bo poslan ob naslednjem pregledu`);
          }
        }
        await loadDetail();
      } else {
        toast.error(d.error ?? 'Napaka');
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setTargetSaving(false);
    }
  };

  // v4.8: Compare AI models on this listing
  const compareModels = async () => {
    if (!listing) return;
    const modelsList = compareModelsInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (modelsList.length === 0) {
      toast.error('Vnesi vsaj en model (npr. qwen2.5:7b, llama3.1:8b)');
      return;
    }
    if (modelsList.length > 5) {
      toast.error('Maksimalno 5 modelov na primerjavo');
      return;
    }
    setComparing(true);
    setCompareResults([]);
    try {
      // Use current AI provider settings but with different models
      // We need to fetch current settings to get provider/baseUrl/apiKey
      const settingsRes = await fetch('/api/settings');
      if (!settingsRes.ok) throw new Error();
      const s = await settingsRes.json();
      const models = modelsList.map(m => ({
        provider: s.aiProvider,
        baseUrl: s.aiBaseUrl,
        apiKey: '', // API key already in settings, we pass empty (backend will use stored)
        model: m,
        label: m,
      }));
      const res = await fetch(`/api/listings/${listing.id}/compare-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      });
      const data = await res.json();
      if (data.ok) {
        setCompareResults(data.results);
        const ok = data.results.filter((r: any) => r.ok).length;
        toast.success(`Primerjava končana: ${ok}/${data.results.length} modelov uspešnih`);
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setComparing(false);
    }
  };

  // v5.0: Generate AI auto-bid
  const generateBid = async () => {
    if (!listing) return;
    setBidding(true);
    setBidResult(null);
    try {
      const body: any = { strategy: bidStrategy };
      if (bidMaxBudget.trim()) {
        const budget = parseInt(bidMaxBudget, 10);
        if (!Number.isNaN(budget) && budget > 0) {
          body.maxBudget = budget;
        }
      }
      const res = await fetch(`/api/listings/${listing.id}/auto-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setBidResult(data.bid);
        toast.success(`💡 Predlog: ${data.bid.suggestedPrice}€ (zaupanje ${data.bid.confidence}%)`);
      } else {
        toast.error(data.error ?? 'Napaka pri generiranju ponudbe');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setBidding(false);
    }
  };

  const copyBidMessage = () => {
    if (!bidResult?.message) return;
    navigator.clipboard.writeText(bidResult.message);
    setBidCopied(true);
    toast.success('Sporočilo kopirano');
    setTimeout(() => setBidCopied(false), 2000);
  };

  // v5.1: Generate price prediction
  const generatePrediction = async () => {
    if (!listing) return;
    const target = parseInt(predictTarget, 10);
    if (Number.isNaN(target) || target <= 0) {
      toast.error('Vnesi veljavno ciljno ceno');
      return;
    }
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await fetch(`/api/listings/${listing.id}/predict-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: target }),
      });
      const data = await res.json();
      if (data.ok) {
        setPrediction(data);
        if (data.prediction.willReachTarget) {
          toast.success(`✓ AI napove: cilj dosežen v ~${data.prediction.estimatedDays ?? '?'} dneh (${data.prediction.confidence}%)`);
        } else {
          toast.info(`AI napove: cilj verjetno NE bo dosežen (${data.prediction.confidence}%)`);
        }
      } else {
        toast.error(data.error ?? 'Napaka pri napovedi');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setPredicting(false);
    }
  };

  // v5.1: Load seller reputation
  const loadSellerRep = async (sellerName: string) => {
    setSellerLoading(true);
    setSellerRep(null);
    try {
      const res = await fetch(`/api/sellers/${encodeURIComponent(sellerName)}/reputation`);
      const data = await res.json();
      if (data.ok) {
        setSellerRep(data.seller);
      }
    } catch { /* ignore */ }
    finally { setSellerLoading(false); }
  };

  return (
    <Dialog open={!!listingId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-6 p-4 sm:p-6">
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
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
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

            {/* v4.8: AI Model Comparison */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <GitCompare className="w-3.5 h-3.5" />
                  Primerjava AI modelov
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.8</Badge>
                </h4>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Primerjaj ocene različnih AI modelov na istem oglasu. Vnesi modele (comma-separated) iz trenutno konfiguriranega providerja.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-2">
                <Input
                  value={compareModelsInput}
                  onChange={(e) => setCompareModelsInput(e.target.value)}
                  placeholder="npr. qwen2.5:7b, llama3.1:8b, mistral:7b"
                  className="text-xs font-mono"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={compareModels}
                  disabled={comparing || !compareModelsInput.trim()}
                >
                  {comparing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
                  Primerjaj
                </Button>
              </div>
              {comparing && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                  AI modeli ocenjujejo oglas... (to lahko traja)
                </div>
              )}
              {compareResults.length > 0 && !comparing && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2">
                    {compareResults.map((r, i) => (
                      <div key={i} className={cn(
                        'border rounded p-2 text-xs',
                        r.ok ? 'border-border bg-background/30' : 'border-red-500/30 bg-red-500/5'
                      )}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-bold text-sm">{r.label}</span>
                          {r.ok ? (
                            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                              {(r.durationMs / 1000).toFixed(1)}s
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">
                              napaka
                            </Badge>
                          )}
                        </div>
                        {r.ok && r.evaluation ? (
                          <div className="grid grid-cols-4 gap-2 text-[10px]">
                            <div>
                              <div className="text-muted-foreground">Verdikt</div>
                              <div className={cn(
                                'font-bold',
                                r.evaluation.verdict === 'PRILIKA' && 'text-primary',
                                r.evaluation.verdict === 'SUMNJIVO' && 'text-amber-400',
                                r.evaluation.verdict === 'NEZANIMIVO' && 'text-muted-foreground',
                              )}>{r.evaluation.verdict}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Prilika</div>
                              <div className="font-mono font-bold text-primary">{r.evaluation.ocena_prilike}/10</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Tveganje</div>
                              <div className="font-mono font-bold text-amber-400">{r.evaluation.ocena_tveganja}/10</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Tržna vred.</div>
                              <div className="font-mono">{r.evaluation.predvidena_trzna_vrednost ?? '?'}€</div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-red-500 truncate" title={r.error}>
                            {r.error}
                          </div>
                        )}
                        {r.ok && r.evaluation?.razlog && (
                          <div className="text-[10px] text-muted-foreground italic mt-1 line-clamp-2">
                            "{r.evaluation.razlog}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Summary comparison */}
                  {compareResults.filter(r => r.ok).length >= 2 && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                      <div className="text-primary font-bold mb-1">📊 Povzetek</div>
                      {(() => {
                        const valid = compareResults.filter(r => r.ok);
                        const best = valid.reduce((a: any, b: any) =>
                          (a.evaluation.ocena_prilike - a.evaluation.ocena_tveganja) >
                          (b.evaluation.ocena_prilike - b.evaluation.ocena_tveganja) ? a : b
                        );
                        const fastest = valid.reduce((a: any, b: any) => a.durationMs < b.durationMs ? a : b);
                        return (
                          <div className="space-y-0.5">
                            <div>🏆 <b>Najboljša ocena</b>: {best.label} (prilika {best.evaluation.ocena_prilike}/10, tveganje {best.evaluation.ocena_tveganja}/10)</div>
                            <div>⚡ <b>Najhitrejši</b>: {fastest.label} ({(fastest.durationMs / 1000).toFixed(1)}s)</div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* v4.4: AI Deal Score (0-100) */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Deal Score (0-100)
                </h4>
                {listing.dealScore != null && (
                  <span className="text-[10px] text-muted-foreground">
                    {listing.dealScoreComputedAt && new Date(listing.dealScoreComputedAt).toLocaleString('sl-SI')}
                  </span>
                )}
              </div>
              {listing.dealScore != null ? (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={cn(
                      'text-3xl font-bold font-mono',
                      listing.dealScore >= 90 ? 'text-primary' :
                      listing.dealScore >= 70 ? 'text-primary/80' :
                      listing.dealScore >= 50 ? 'text-amber-400' :
                      'text-red-500'
                    )}>
                      {listing.dealScore}
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-background rounded overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all',
                            listing.dealScore >= 90 ? 'bg-primary' :
                            listing.dealScore >= 70 ? 'bg-primary/70' :
                            listing.dealScore >= 50 ? 'bg-amber-400' :
                            'bg-red-500'
                          )}
                          style={{ width: `${listing.dealScore}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {listing.dealScore >= 90 ? 'Izjemna priložnost' :
                         listing.dealScore >= 70 ? 'Dobra priložnost' :
                         listing.dealScore >= 50 ? 'Povprečen oglas' :
                         listing.dealScore >= 30 ? 'Tvegano' :
                         'Slaba priložnost'}
                      </div>
                    </div>
                  </div>
                  {listing.dealScoreReason && (
                    <p className="text-xs text-muted-foreground italic">"{listing.dealScoreReason}"</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={async () => {
                      try {
                        toast.loading('Ponovno ocenjujem...', { id: 'score' });
                        const r = await fetch(`/api/listings/${listing.id}/score`, { method: 'POST' });
                        const d = await r.json();
                        if (d.ok) {
                          toast.success(`Score: ${d.dealScore}/100`, { id: 'score' });
                          await loadDetail();
                        } else {
                          toast.error(d.error ?? 'Napaka', { id: 'score' });
                        }
                      } catch {
                        toast.error('Napaka', { id: 'score' });
                      }
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> Ponovno oceni
                  </Button>
                </div>
              ) : (
                <div className="text-center py-3">
                  <p className="text-xs text-muted-foreground mb-2">Še ni ocenjen s Deal Score</p>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={async () => {
                      try {
                        toast.loading('AI ocenjuje...', { id: 'score' });
                        const r = await fetch(`/api/listings/${listing.id}/score`, { method: 'POST' });
                        const d = await r.json();
                        if (d.ok) {
                          toast.success(`Score: ${d.dealScore}/100`, { id: 'score' });
                          await loadDetail();
                        } else {
                          toast.error(d.error ?? 'Napaka', { id: 'score' });
                        }
                      } catch {
                        toast.error('Napaka', { id: 'score' });
                      }
                    }}
                  >
                    <Sparkles className="w-3 h-3 mr-1" /> Izračunaj Deal Score
                  </Button>
                </div>
              )}
            </div>

            {/* v4.4: QR code for sharing */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  Deli oglas — QR koda
                </h4>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <img
                  src={`/api/listings/${listing.id}/qr?size=160&t=${Date.now()}`}
                  alt="QR koda"
                  className="w-32 h-32 bg-white rounded border border-border p-1"
                />
                <div className="flex-1 space-y-1.5 text-xs">
                  <p className="text-muted-foreground">Skeniraj s telefonom za odprtje oglasa na mobilni napravi.</p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(listing.url);
                        toast.success('URL kopiran');
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Kopiraj URL
                    </Button>
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center h-7 px-3 text-xs rounded border border-border bg-card hover:bg-card/70"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" /> Odpri
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* v5.1: Seller reputation */}
            {listing.sellerName && (
              <div className="bg-card/30 border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Reputacija prodajalca
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.1</Badge>
                  </h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => listing.sellerName && loadSellerRep(listing.sellerName)}
                    disabled={sellerLoading}
                  >
                    {sellerLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Osveži
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground mb-2">
                  <span className="font-mono text-primary">{listing.sellerName}</span>
                  {sellerRep?.daysActive != null && (
                    <span> • aktiven {sellerRep.daysActive} dni</span>
                  )}
                </div>

                {sellerLoading ? (
                  <div className="py-3 text-center text-xs text-muted-foreground">
                    <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                    Nalagam...
                  </div>
                ) : sellerRep ? (
                  <div className="space-y-2">
                    {/* Reputation score */}
                    <div className={cn(
                      'border rounded p-2 flex items-center gap-3',
                      sellerRep.reputationScore >= 65 ? 'bg-primary/5 border-primary/20' :
                      sellerRep.reputationScore >= 45 ? 'bg-amber-400/5 border-amber-400/20' :
                      'bg-red-500/5 border-red-500/20'
                    )}>
                      <div className={cn(
                        'text-3xl font-bold font-mono',
                        sellerRep.reputationScore >= 65 ? 'text-primary' :
                        sellerRep.reputationScore >= 45 ? 'text-amber-400' : 'text-red-500'
                      )}>
                        {sellerRep.reputationScore}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold">
                          {sellerRep.tier}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {sellerRep.listingsCount} oglasov • {sellerRep.activeListingsCount} aktivnih
                        </div>
                      </div>
                      <div className="w-16 h-16 relative shrink-0">
                        <svg viewBox="0 0 36 36" className="w-16 h-16">
                          <circle cx="18" cy="18" r="14" fill="none" stroke="#262626" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="14" fill="none"
                            stroke={sellerRep.reputationScore >= 65 ? '#10b981' : sellerRep.reputationScore >= 45 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="3"
                            strokeDasharray={`${(sellerRep.reputationScore / 100) * 88} 88`}
                            strokeLinecap="round"
                            transform="rotate(-90 18 18)"
                          />
                        </svg>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-background/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Povp. cena</div>
                        <div className="font-mono font-bold">{sellerRep.avgPrice ?? '?'}€</div>
                      </div>
                      <div className="bg-background/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Kontakt</div>
                        <div className="font-mono font-bold">{sellerRep.contactStats.contactRate}%</div>
                        <div className="text-[9px] text-muted-foreground">{sellerRep.contactStats.contacted}/{sellerRep.listingsCount}</div>
                      </div>
                      <div className="bg-background/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Odgovor</div>
                        <div className={cn(
                          'font-mono font-bold',
                          sellerRep.contactStats.responseRate >= 50 ? 'text-primary' :
                          sellerRep.contactStats.responseRate > 0 ? 'text-amber-400' : 'text-red-500'
                        )}>
                          {sellerRep.contactStats.responseRate}%
                        </div>
                      </div>
                      <div className="bg-background/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground uppercase">Padci cen</div>
                        <div className="font-mono font-bold text-amber-400">{sellerRep.priceDropCount}</div>
                      </div>
                    </div>

                    {/* AI verdict breakdown */}
                    {Object.keys(sellerRep.aiVerdictBreakdown).length > 0 && (
                      <div className="bg-background/30 rounded p-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">AI verdikti</div>
                        <div className="flex items-center gap-2 text-xs">
                          {sellerRep.aiVerdictBreakdown.PRILIKA > 0 && (
                            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                              🎯 {sellerRep.aiVerdictBreakdown.PRILIKA}× prilika
                            </Badge>
                          )}
                          {sellerRep.aiVerdictBreakdown.SUMNJIVO > 0 && (
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">
                              ⚠️ {sellerRep.aiVerdictBreakdown.SUMNJIVO}× sumljivo
                            </Badge>
                          )}
                          {sellerRep.aiVerdictBreakdown.NEZANIMIVO > 0 && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              • {sellerRep.aiVerdictBreakdown.NEZANIMIVO}× nezanima
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Trades stats */}
                    {sellerRep.tradesStats.sold > 0 && (
                      <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                        <span className="text-primary font-bold">✓ {sellerRep.tradesStats.sold}</span>
                        <span className="text-muted-foreground"> prodanih oglasov iz tega prodajalca</span>
                        {sellerRep.tradesStats.avgSellTimeDays != null && (
                          <span className="text-[10px] text-muted-foreground ml-2">
                            (povp. {sellerRep.tradesStats.avgSellTimeDays} dni do prodaje)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Sources */}
                    {sellerRep.sources.length > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        Viri: {sellerRep.sources.join(', ')}
                      </div>
                    )}

                    {/* Top listings */}
                    {sellerRep.topListings && sellerRep.topListings.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer hover:text-foreground text-muted-foreground">
                          📋 Top {sellerRep.topListings.length} oglasov tega prodajalca
                        </summary>
                        <div className="mt-1 space-y-1">
                          {sellerRep.topListings.map((l: any) => (
                            <a
                              key={l.id}
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 p-1.5 bg-background/30 rounded hover:bg-background/50 text-xs"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{l.title}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {l.priceText} • {l.monitor?.name}
                                </div>
                              </div>
                              {l.dealScore != null && (
                                <Badge variant="outline" className="text-[10px] text-primary border-primary/40 shrink-0">
                                  🎯 {l.dealScore}
                                </Badge>
                              )}
                              {l.isBookmarked && <Bookmark className="w-3 h-3 text-amber-400 shrink-0" />}
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="py-3 text-center text-xs text-muted-foreground">
                    Klikni "Osveži" za nalaganje reputacije.
                  </div>
                )}
              </div>
            )}

            {/* v4.5: Target price — alert me when price drops at or below this */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" />
                  Ciljna cena — alert ko pade pod
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.5</Badge>
                </h4>
                {listing.targetPrice != null && listing.targetPriceAlertSent && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                    ✓ Alert poslan
                  </Badge>
                )}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1">
                  <Input
                    type="number"
                    min="0"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="npr. 300 (EUR)"
                    className="text-xs font-mono"
                  />
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={targetSaving || !targetPrice.trim()}
                  onClick={() => saveTargetPrice(false)}
                >
                  {targetSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                  Nastavi
                </Button>
                {listing.targetPrice != null && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={targetSaving}
                    onClick={() => { setTargetPrice(''); saveTargetPrice(true); }}
                  >
                    Počisti
                  </Button>
                )}
              </div>
              {listing.targetPrice != null && (
                <div className="mt-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Trenutna cena:</span>
                    <span className="font-mono text-amber-400">{listing.price ?? '?'} €</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Ciljna cena:</span>
                    <span className="font-mono text-primary">{listing.targetPrice} €</span>
                  </div>
                  {listing.price != null && (
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <span className="text-muted-foreground">Razlika:</span>
                      <span className={cn(
                        'font-mono font-bold',
                        listing.price <= listing.targetPrice ? 'text-primary' : 'text-amber-400'
                      )}>
                        {listing.price <= listing.targetPrice
                          ? `✓ ${listing.targetPrice - listing.price}€ pod ciljem`
                          : `še ${listing.price - listing.targetPrice}€ nad ciljem`}
                      </span>
                    </div>
                  )}
                  {listing.targetPriceSetAt && (
                    <p className="text-[10px] text-muted-foreground pt-1">
                      Nastavljeno: {new Date(listing.targetPriceSetAt).toLocaleString('sl-SI')}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Ko cena pade na ali pod ciljno mejo, dobiš alert na Telegram/Discord/Push/Email.
              </p>
            </div>

            {/* v5.1: AI Price Prediction — kdaj bo cena padla na cilj */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  AI napoved cene
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.1</Badge>
                </h4>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                AI napove kdaj bo cena padla na tvojo ciljno mejo (glede na zgodovino cen in tržne podatke).
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-2">
                <Input
                  type="number"
                  min="0"
                  value={predictTarget}
                  onChange={(e) => setPredictTarget(e.target.value)}
                  placeholder="Ciljna cena (EUR)"
                  className="text-xs font-mono"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={generatePrediction}
                  disabled={predicting || !predictTarget.trim()}
                >
                  {predicting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
                  Napovej
                </Button>
              </div>

              {predicting && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                  AI analizira ceno, tržne podatke in trende...
                </div>
              )}

              {prediction && !predicting && (
                <div className="space-y-2">
                  {/* Verdict */}
                  <div className={cn(
                    'border rounded p-3',
                    prediction.prediction.willReachTarget
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-amber-400/5 border-amber-400/20'
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider">
                        {prediction.prediction.willReachTarget ? '✅ Cilj bo dosežen' : '⚠️ Cilj verjetno ne bo dosežen'}
                      </span>
                      <Badge variant="outline" className={cn(
                        'text-[10px]',
                        prediction.prediction.confidence >= 70 ? 'text-primary border-primary/40' :
                        prediction.prediction.confidence >= 40 ? 'text-amber-400 border-amber-400/40' :
                        'text-red-500 border-red-500/40'
                      )}>
                        🎯 {prediction.prediction.confidence}%
                      </Badge>
                    </div>
                    {prediction.prediction.estimatedDays != null && prediction.prediction.willReachTarget && (
                      <div className="text-2xl font-bold font-mono text-primary">
                        ~{prediction.prediction.estimatedDays} dni
                      </div>
                    )}
                    {prediction.prediction.predictedDate && prediction.prediction.willReachTarget && (
                      <div className="text-[10px] text-muted-foreground">
                        Predvideni datum: {new Date(prediction.prediction.predictedDate).toLocaleDateString('sl-SI')}
                      </div>
                    )}
                  </div>

                  {/* Trend analysis */}
                  <div className="bg-background/30 rounded p-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📈 Trend</div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={cn(
                        'text-[10px]',
                        prediction.prediction.currentTrend === 'declining' && 'text-primary border-primary/40',
                        prediction.prediction.currentTrend === 'rising' && 'text-red-500 border-red-500/40',
                        prediction.prediction.currentTrend === 'stable' && 'text-amber-400 border-amber-400/40',
                      )}>
                        {prediction.prediction.currentTrend === 'declining' ? '📉 Pada' :
                         prediction.prediction.currentTrend === 'rising' ? '📈 Raste' : '➡️ Stabilna'}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        ~{prediction.prediction.averageDropPerWeek}€/teden
                      </span>
                    </div>
                    {prediction.prediction.trendAnalysis && (
                      <p className="italic text-muted-foreground">{prediction.prediction.trendAnalysis}</p>
                    )}
                  </div>

                  {/* Projected prices chart */}
                  {prediction.prediction.projectedPrices && prediction.prediction.projectedPrices.length > 0 && (
                    <div className="bg-background/30 rounded p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">🔮 Projekcija cene</div>
                      <div className="space-y-1">
                        {prediction.prediction.projectedPrices.map((p: any, i: number) => {
                          const currentPrice = prediction.currentPrice;
                          const targetPrice = prediction.targetPrice;
                          const pct = currentPrice > 0 ? Math.round(((p.price - currentPrice) / currentPrice) * 100) : 0;
                          const isAtTarget = p.price <= targetPrice;
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground w-20">{new Date(p.date).toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' })}</span>
                              <span className={cn('font-mono font-bold w-16', isAtTarget ? 'text-primary' : '')}>{p.price}€</span>
                              <div className="flex-1 h-2 bg-background rounded overflow-hidden">
                                <div
                                  className={cn('h-full', isAtTarget ? 'bg-primary' : pct < 0 ? 'bg-amber-400' : 'bg-red-500')}
                                  style={{ width: `${Math.min(100, Math.max(5, 100 - Math.abs(pct)))}%` }}
                                />
                              </div>
                              <span className={cn('text-[10px] w-12 text-right', pct < 0 ? 'text-primary' : pct > 0 ? 'text-red-500' : 'text-muted-foreground')}>
                                {pct > 0 ? '+' : ''}{pct}%
                              </span>
                              {isAtTarget && <Check className="w-3 h-3 text-primary" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Reasoning */}
                  {prediction.prediction.reasoning && (
                    <div className="bg-background/30 rounded p-2 text-xs">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">💭 Razlog</div>
                      <p className="italic">"{prediction.prediction.reasoning}"</p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    ⚠️ Napoved je samo napake AI. Dejanski rezultat je odvisen od prodajalca in trga.
                  </p>
                </div>
              )}
            </div>

            {/* v6.0: AI Listing Enrichment — AI izvleče strukturirane podatke */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Obogatitev podatkov
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.0</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={enrichLoading}
                  onClick={async () => {
                    setEnrichLoading(true);
                    setEnrichment(null);
                    try {
                      const res = await fetch(`/api/listings/${listing.id}/enrich`, { method: 'POST' });
                      const data = await res.json();
                      if (data.ok) {
                        setEnrichment(data.enrichment);
                        toast.success('✓ AI obogatitev generirana');
                      } else {
                        toast.error(data.error ?? 'Napaka');
                      }
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setEnrichLoading(false); }
                  }}
                >
                  {enrichLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Obogati
                </Button>
              </div>
              {enrichLoading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                  AI izvleče podatke iz oglasa...
                </div>
              ) : enrichment ? (
                <div className="space-y-2 text-xs">
                  {enrichment.summary && (
                    <div className="bg-background/30 rounded p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📝 Povzetek</div>
                      <p>{enrichment.summary}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {enrichment.brand && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Znamka</div>
                        <div className="font-bold">{enrichment.brand}</div>
                      </div>
                    )}
                    {enrichment.model && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Model</div>
                        <div className="font-bold">{enrichment.model}</div>
                      </div>
                    )}
                    {enrichment.condition && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Stanje</div>
                        <div className="font-bold">{enrichment.condition}</div>
                      </div>
                    )}
                    {enrichment.year && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Letnik</div>
                        <div className="font-mono font-bold">{enrichment.year}</div>
                      </div>
                    )}
                    {enrichment.color && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Barva</div>
                        <div className="font-bold">{enrichment.color}</div>
                      </div>
                    )}
                    {enrichment.category && (
                      <div className="bg-background/30 rounded p-1.5">
                        <div className="text-[9px] text-muted-foreground uppercase">Kategorija</div>
                        <div className="font-bold">{enrichment.category}</div>
                      </div>
                    )}
                  </div>
                  {enrichment.tags?.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {enrichment.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px]">#{tag}</Badge>
                      ))}
                    </div>
                  )}
                  {enrichment.specs && Object.keys(enrichment.specs).length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer hover:text-foreground text-muted-foreground">📋 Specifikacije ({Object.keys(enrichment.specs).length})</summary>
                      <div className="mt-1 grid grid-cols-2 gap-1">
                        {Object.entries(enrichment.specs).map(([k, v]: any) => (
                          <div key={k} className="bg-background/30 rounded px-2 py-0.5">
                            <span className="text-muted-foreground">{k}:</span> <span className="font-bold">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Klikni "Obogati" za AI izvleček strukturiranih podatkov (znamka, model, stanje, specifikacije).
                </p>
              )}
            </div>

            {/* v6.2: AI Flip Score — ali se splača kupiti za preprodajo? */}
            {listing.price != null && (
              <div className="bg-card/30 border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-primary" />
                    AI Flip Score (profitnost)
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.2</Badge>
                  </h4>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={flipLoading}
                    onClick={async () => {
                      setFlipLoading(true); setFlipScore(null);
                      try {
                        const res = await fetch(`/api/listings/${listing.id}/flip-score`, { method: 'POST' });
                        const data = await res.json();
                        if (data.ok) { setFlipScore(data); toast.success(`Flip Score: ${data.flipScore}/100`); }
                        else toast.error(data.error ?? 'Napaka');
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setFlipLoading(false); }
                    }}>
                    {flipLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                    Izračunaj
                  </Button>
                </div>
                {flipLoading ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                    AI analizira profitnost...
                  </div>
                ) : flipScore ? (
                  <div className="space-y-2">
                    <div className={cn('border rounded p-2 flex items-center gap-3',
                      flipScore.flipScore >= 80 ? 'bg-primary/5 border-primary/30' :
                      flipScore.flipScore >= 50 ? 'bg-amber-400/5 border-amber-400/30' :
                      'bg-red-500/5 border-red-500/30')}>
                      <div className={cn('text-3xl font-bold font-mono',
                        flipScore.flipScore >= 80 ? 'text-primary' :
                        flipScore.flipScore >= 50 ? 'text-amber-400' : 'text-red-500')}>
                        {flipScore.flipScore}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold">
                          {flipScore.flipScore >= 80 ? '🟢 ODLIČNA PRILOŽNOST' :
                           flipScore.flipScore >= 50 ? '🟡 ZMERNO DONOSNO' : '🔴 NE PRIPOROČAM'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{flipScore.reasoning}</div>
                      </div>
                      <Badge variant="outline" className={cn('text-[10px] shrink-0',
                        flipScore.recommendation === 'kupi' ? 'text-primary border-primary/40' : 'text-muted-foreground')}>
                        {flipScore.recommendation?.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Dobiček</div>
                        <div className={cn('font-mono font-bold', flipScore.estimatedProfit > 0 ? 'text-primary' : 'text-red-500')}>
                          {flipScore.estimatedProfit > 0 ? '+' : ''}{flipScore.estimatedProfit}€
                        </div>
                      </div>
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Marža</div>
                        <div className="font-mono font-bold text-primary">{flipScore.estimatedMargin}%</div>
                      </div>
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Čas prodaje</div>
                        <div className="font-mono font-bold">~{flipScore.estimatedDaysToSell}d</div>
                      </div>
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Likvidnost</div>
                        <div className={cn('font-mono font-bold', flipScore.liquidityScore >= 70 ? 'text-primary' : flipScore.liquidityScore >= 40 ? 'text-amber-400' : 'text-red-500')}>
                          {flipScore.liquidityLabel} ({flipScore.liquidityScore})
                        </div>
                      </div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-[10px] text-muted-foreground">
                      💰 Predvidena prodajna cena: <b className="text-primary">{flipScore.estimatedSellPrice}€</b> (tržna povprečna: {flipScore.marketAvgPrice}€)
                      {' • '}Stroški: {flipScore.totalCosts}€ (Bolha {flipScore.bolhaFee}€ + dostava {flipScore.shipping}€)
                      {' • '}{flipScore.marketListingCount} podobnih oglasov na trgu
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    Klikni "Izračunaj" za AI analizo profitnosti (marža, likvidnost, čas prodaje, stroški).
                  </p>
                )}
              </div>
            )}

            {/* v6.2: Market Saturation — koliko konkurence je na trgu? */}
            {listing.price != null && (
              <div className="bg-card/30 border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Tržna nasičenost
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.2</Badge>
                  </h4>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={satLoading}
                    onClick={async () => {
                      setSatLoading(true); setSaturation(null);
                      try {
                        const res = await fetch(`/api/listings/${listing.id}/saturation`);
                        const data = await res.json();
                        if (data.ok) { setSaturation(data.saturation); toast.success(`${data.saturation.levelLabel} nasičenost (${data.saturation.count} oglasov)`); }
                        else toast.error(data.error ?? 'Napaka');
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setSatLoading(false); }
                    }}>
                    {satLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                    Analiziraj
                  </Button>
                </div>
                {satLoading ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                    Analyzing market saturation...
                  </div>
                ) : saturation ? (
                  <div className="space-y-2">
                    <div className={cn('border rounded p-2 text-xs',
                      saturation.level === 'low' ? 'bg-primary/5 border-primary/20' :
                      saturation.level === 'medium' ? 'bg-amber-400/5 border-amber-400/20' :
                      'bg-red-500/5 border-red-500/20')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn('font-bold', saturation.color)}>
                          {saturation.levelLabel} nasičenost ({saturation.count} oglasov)
                        </span>
                        <Badge variant="outline" className={cn('text-[9px]', saturation.color)}>
                          Trend: {saturation.trendLabel}
                        </Badge>
                      </div>
                      <p className="text-[11px]">{saturation.recommendation}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Tržna povp.</div>
                        <div className="font-mono font-bold">{saturation.avgPrice}€</div>
                      </div>
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Min – Max</div>
                        <div className="font-mono text-[10px]">{saturation.minPrice}–{saturation.maxPrice}€</div>
                      </div>
                      <div className="bg-background/30 rounded p-1.5 text-center">
                        <div className="text-muted-foreground uppercase">Tvoj položaj</div>
                        <div className={cn('font-mono font-bold', saturation.positionPct < 0 ? 'text-primary' : saturation.positionPct > 10 ? 'text-red-500' : 'text-amber-400')}>
                          {saturation.positionPct > 0 ? '+' : ''}{saturation.positionPct}%
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    Klikni "Analiziraj" za preverbo koliko podobnih oglasov je na trgu.
                  </p>
                )}
              </div>
            )}

            {/* v6.2: ROI Calculator z vsemi stroški + davki */}
            {listing.price != null && (
              <div className="bg-card/30 border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5" />
                    ROI kalkulator (stroški + davki)
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.2</Badge>
                  </h4>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Input type="number" value={roiSellPrice} onChange={(e) => setRoiSellPrice(e.target.value)} placeholder="Prodajna cena (€)" className="text-xs font-mono h-7 flex-1" />
                  <select value={roiPlatform} onChange={(e) => setRoiPlatform(e.target.value as any)} className="bg-card border border-border rounded px-2 py-1 text-[10px]">
                    <option value="bolha">Bolha</option>
                    <option value="vinted">Vinted</option>
                    <option value="other">Drugo</option>
                  </select>
                  <Button size="sm" className="h-7 text-xs gap-1" disabled={roiLoading || !roiSellPrice.trim()}
                    onClick={async () => {
                      setRoiLoading(true); setRoiResult(null);
                      try {
                        const res = await fetch('/api/trades/roi-calc', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ buyPrice: listing.price, sellPrice: parseInt(roiSellPrice, 10), platform: roiPlatform }),
                        });
                        const data = await res.json();
                        if (data.ok) { setRoiResult(data.roi); toast.success(`ROI: ${data.roi.roiPct}%`); }
                        else toast.error(data.error ?? 'Napaka');
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setRoiLoading(false); }
                    }}>
                    {roiLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
                    Izračunaj
                  </Button>
                </div>
                {roiResult && (
                  <div className="space-y-2 text-xs">
                    <div className={cn('border rounded p-2',
                      roiResult.netAfterTax > 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold">
                          {roiResult.netAfterTax > 0 ? '✅ DONOSNO' : '❌ NEDONOSNO'}
                        </span>
                        <Badge variant="outline" className={cn('text-[10px] font-mono',
                          roiResult.roiPct > 20 ? 'text-primary border-primary/40' :
                          roiResult.roiPct > 0 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                          ROI: {roiResult.roiPct > 0 ? '+' : ''}{roiResult.roiPct}%
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <span className="text-muted-foreground">Bruto dobiček:</span>
                          <span className={cn('font-mono font-bold ml-1', roiResult.grossProfit > 0 ? 'text-primary' : 'text-red-500')}>
                            {roiResult.grossProfit > 0 ? '+' : ''}{roiResult.grossProfit}€
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Neto (pred dajatvami):</span>
                          <span className={cn('font-mono font-bold ml-1', roiResult.netProfit > 0 ? 'text-primary' : 'text-red-500')}>
                            {roiResult.netProfit > 0 ? '+' : ''}{roiResult.netProfit}€
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Dohodnina (40%):</span>
                          <span className="font-mono font-bold ml-1 text-red-500">-{roiResult.tax}€</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Neto po davku:</span>
                          <span className={cn('font-mono font-bold ml-1', roiResult.netAfterTax > 0 ? 'text-primary' : 'text-red-500')}>
                            {roiResult.netAfterTax > 0 ? '+' : ''}{roiResult.netAfterTax}€
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-[10px]">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">Kupna cena:</span>
                        <span className="font-mono">{roiResult.buyPrice}€</span>
                      </div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">Prov. nakup ({roiResult.platform}):</span>
                        <span className="font-mono text-red-500">-{roiResult.costs.buyFees}€</span>
                      </div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">Prov. prodaja:</span>
                        <span className="font-mono text-red-500">-{roiResult.costs.sellFees}€</span>
                      </div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">Dostava:</span>
                        <span className="font-mono text-red-500">-{roiResult.costs.shipping}€</span>
                      </div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">Pakiranje:</span>
                        <span className="font-mono text-red-500">-{roiResult.costs.packaging}€</span>
                      </div>
                      <div className="flex items-center justify-between pt-0.5 border-t border-border">
                        <span className="text-muted-foreground">Skupni stroški:</span>
                        <span className="font-mono font-bold text-red-500">-{roiResult.costs.total}€</span>
                      </div>
                    </div>
                    <p className={cn('text-[10px] font-bold text-center',
                      roiResult.netAfterTax > 0 && roiResult.marginPct > 15 ? 'text-primary' : 'text-amber-400')}>
                      💡 {roiResult.recommendation}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* v5.5: AI Price Forecast — vizualizacija cene z napovedmi */}
            {listing.price != null && (
              <PriceForecastChart listingId={listing.id} currentPrice={listing.price} />
            )}

            {/* v5.6: External Price Comparison — primerjaj z Amazon/eBay/AliExpress */}
            {listing.price != null && (
              <div className="bg-card/30 border border-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <GitCompare className="w-3.5 h-3.5" />
                    Primerjava z zunanjimi viri
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.6</Badge>
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={extCompareLoading}
                    onClick={async () => {
                      setExtCompareLoading(true);
                      setExtCompare(null);
                      try {
                        const res = await fetch(`/api/listings/${listing.id}/external-compare`);
                        const data = await res.json();
                        if (data.ok) {
                          setExtCompare(data);
                          toast.success(`✓ ${data.comparisons?.length || 0} primerjav najdenih`);
                        } else {
                          toast.error(data.error ?? 'Napaka');
                        }
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setExtCompareLoading(false); }
                    }}
                  >
                    {extCompareLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
                    Primerjaj
                  </Button>
                </div>
                {extCompareLoading ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                    AI išče podobne izdelke na Amazon, eBay, AliExpress...
                  </div>
                ) : extCompare ? (
                  <div className="space-y-2">
                    {extCompare.comparisons?.length > 0 ? (
                      <div className="space-y-1">
                        {extCompare.comparisons.map((c: any, i: number) => {
                          const isCheaper = c.priceDiff > 0; // local is more expensive = external is cheaper
                          return (
                            <a
                              key={i}
                              href={c.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'flex items-center gap-2 p-1.5 rounded text-xs border hover:bg-card/50 transition-colors',
                                isCheaper ? 'bg-red-500/5 border-red-500/20' : 'bg-primary/5 border-primary/20'
                              )}
                            >
                              <Badge variant="outline" className="text-[9px] shrink-0 uppercase">{c.source}</Badge>
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{c.productName}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  <span className={cn('font-mono font-bold', isCheaper ? 'text-red-500' : 'text-primary')}>
                                    {c.price}€
                                  </span>
                                  {' '}
                                  <span className={cn(isCheaper ? 'text-red-500' : 'text-primary')}>
                                    ({c.priceDiff > 0 ? '+' : ''}{c.priceDiff}€ / {c.priceDiffPct > 0 ? '+' : ''}{c.priceDiffPct}%)
                                  </span>
                                </div>
                              </div>
                              <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground text-center py-2">Ni najdenih primerjav.</p>
                    )}
                    {extCompare.aiAnalysis && (
                      <div className="bg-background/30 rounded p-2 text-[11px]">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📊 AI analiza</div>
                        <p>{extCompare.aiAnalysis}</p>
                      </div>
                    )}
                    {extCompare.aiRecommendation && (
                      <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[11px]">
                        <span className="text-primary font-bold">💡 Priporočilo:</span> {extCompare.aiRecommendation}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    Klikni "Primerjaj" za AI primerjavo z Amazon, eBay, AliExpress.
                  </p>
                )}
              </div>
            )}

            {/* v5.7: AI Similar Listings — najdi podobne oglase */}
            <div className="bg-card/30 border border-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <GitCompare className="w-3.5 h-3.5" />
                  Podobni oglasi (AI)
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.7</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={similarLoading}
                  onClick={async () => {
                    setSimilarLoading(true);
                    setSimilarListings([]);
                    try {
                      const res = await fetch(`/api/listings/${listing.id}/similar`);
                      const data = await res.json();
                      if (data.ok) {
                        setSimilarListings(data.similar || []);
                        toast.success(`✓ ${data.similar?.length || 0} podobnih oglasov`);
                      } else {
                        toast.error(data.error ?? 'Napaka');
                      }
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setSimilarLoading(false); }
                  }}
                >
                  {similarLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
                  Najdi podobne
                </Button>
              </div>
              {similarLoading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                  AI išče podobne oglase v bazi...
                </div>
              ) : similarListings.length > 0 ? (
                <div className="space-y-1">
                  {similarListings.slice(0, 8).map((s: any, i: number) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-1.5 bg-background/30 rounded hover:bg-background/50 text-xs"
                    >
                      {s.imageUrl && (
                        <img src={s.imageUrl} alt="" className="w-8 h-8 object-cover rounded shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{s.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.priceText} • {s.monitor?.source} {s.location && `• ${s.location}`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className={cn(
                          'text-[9px] font-mono',
                          s.similarityScore >= 70 ? 'text-primary border-primary/40' :
                          s.similarityScore >= 50 ? 'text-amber-400 border-amber-400/40' :
                          'text-muted-foreground'
                        )}>
                          {s.similarityScore}%
                        </Badge>
                        {s.dealScore != null && (
                          <div className="text-[9px] text-primary mt-0.5">🎯 {s.dealScore}</div>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Klikni "Najdi podobne" za AI iskanje podobnih oglasov v bazi.
                </p>
              )}
            </div>

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
              {/* v3.2: Copy URL */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(listing.url);
                  toast.success('URL kopiran');
                }}
                className="gap-2"
              >
                <Copy className="w-3.5 h-3.5" /> Kopiraj URL
              </Button>
              {/* v3.7: Copy all data */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const text = [
                    `📍 ${listing.title}`,
                    `💰 ${listing.priceText}`,
                    listing.location ? `📌 ${listing.location}` : '',
                    listing.aiVerdict ? `AI: ${listing.aiVerdict} (prilika ${listing.aiScore}/10, tveganje ${listing.aiRisk}/10)` : '',
                    listing.aiEstimatedValue ? `📈 Tržna vrednost: ~${listing.aiEstimatedValue}€` : '',
                    listing.aiReason ? `💡 ${listing.aiReason}` : '',
                    data?.marketComparison ? `📊 Tržno povprečje: ${data.marketComparison.average}€ (mediana ${data.marketComparison.median}€)` : '',
                    `🔗 ${listing.url}`,
                    `📦 ${listing.monitor?.name ?? ''}`,
                  ].filter(Boolean).join('\n');
                  navigator.clipboard.writeText(text);
                  toast.success('Vsi podatki kopirani');
                }}
                className="gap-2"
              >
                <Copy className="w-3.5 h-3.5" /> Kopiraj vse
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
              {/* v3.1: Refresh from source */}
              <Button
                size="sm"
                variant="outline"
                onClick={refreshListing}
                disabled={refreshing}
                className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
              >
                {refreshing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Osveži iz vira
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

            {/* v3.8: Quick sell — mark as sold and add to Skladišče */}
            {listing.trades && listing.trades.length > 0 && listing.trades.some((t: any) => t.status === 'held') && (
              <div className="border-t border-border pt-3">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">⚡ Hitra prodaja</h4>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-[10px] uppercase">Prodajna cena (€)</Label>
                    <Input
                      type="number"
                      id="quick-sell-price"
                      placeholder={String(listing.price ?? 0)}
                      className="mt-0.5 font-mono text-xs h-8"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-8"
                    onClick={async () => {
                      const input = document.getElementById('quick-sell-price') as HTMLInputElement;
                      const sellPrice = input?.value ? parseFloat(input.value) : listing.price ?? 0;
                      const trade = listing.trades.find((t: any) => t.status === 'held');
                      if (!trade) return;
                      try {
                        await fetch(`/api/trades/${trade.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sellPrice, status: 'sold', sellDate: new Date().toISOString() }),
                        });
                        toast.success(`✅ Prodano za ${sellPrice}€`);
                        await loadDetail();
                      } catch { toast.error('Napaka'); }
                    }}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" /> Prodano
                  </Button>
                </div>
              </div>
            )}

            {/* v1.8: AI Negotiator (v4.6: multi-language) */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  AI pogajalec
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.6</Badge>
                </h4>
                {/* v4.6: Language switcher */}
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-muted-foreground">Jezik:</span>
                  {[
                    { code: 'sl', label: '🇸🇮 SLO' },
                    { code: 'en', label: '🇬🇧 EN' },
                    { code: 'de', label: '🇩🇪 DE' },
                    { code: 'it', label: '🇮🇹 IT' },
                    { code: 'hr', label: '🇭🇷 HR' },
                  ].map(l => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setNegotiateLang(l.code);
                        setNegotiateLangLabel(l.label);
                        if (negotiateMessage) {
                          // Regenerate with new language
                          generateMessage(negotiateType, l.code);
                        }
                      }}
                      className={cn(
                        'px-1.5 py-0.5 rounded border text-[10px] transition-colors',
                        negotiateLang === l.code
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
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
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Generirano sporočilo ({negotiateLangLabel}):
                    </span>
                    <Button size="sm" variant="ghost" onClick={copyMessage} className="h-6 px-2 text-xs gap-1">
                      {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Kopirano' : 'Kopiraj'}
                    </Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{negotiateMessage}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    ⚠️ Preglej in prilagodi pred pošiljanjem. AI ne pozna specifičnih detailov ki jih vidiš ti.
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    💡 Preklopi jezik zgoraj — AI bo regeneriral v izbranem jeziku.
                  </p>
                </div>
              )}
            </div>

            {/* v6.11: AI Negotiation Playbook — celovit pogajalski scenarij */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                  AI Negotiation Playbook
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
                </h4>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    placeholder="Max budget (€)"
                    value={playbookMaxBudget}
                    onChange={(e) => setPlaybookMaxBudget(e.target.value)}
                    className="h-6 w-24 text-[10px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                    disabled={playbookLoading}
                    onClick={async () => {
                      setPlaybookLoading(true);
                      setPlaybook(null);
                      setPlaybookCopied(null);
                      try {
                        const budgetNum = playbookMaxBudget ? Number(playbookMaxBudget) : 0;
                        const res = await fetch('/api/ai/negotiation-playbook', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ listingId: listing.id, maxBudget: budgetNum || undefined }),
                        });
                        const data = await res.json();
                        if (data.ok) { setPlaybook(data); toast.success('✓ Pogajalski playbook generiran'); }
                        else toast.error(data.error ?? 'Napaka');
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setPlaybookLoading(false); }
                    }}
                  >
                    {playbookLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                    Generiraj
                  </Button>
                </div>
              </div>

              {playbookLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI pripravlja celovit pogajalski scenarij...
                </div>
              ) : playbook?.playbook ? (
                <div className="space-y-2 text-[11px]">
                  {/* Strategy */}
                  <div className="bg-primary/5 border border-primary/20 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-primary uppercase text-[10px]">📋 Strategija: {playbook.playbook.strategy}</span>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                        {playbook.playbook.openingOffer}€ → {playbook.playbook.targetPrice}€ → {playbook.playbook.walkAwayPrice}€
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">{playbook.playbook.strategyReasoning}</p>
                  </div>

                  {/* Price targets */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-background/40 rounded p-1.5 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">🎨 Opening</div>
                      <div className="font-mono font-bold text-primary">{playbook.playbook.openingOffer}€</div>
                    </div>
                    <div className="bg-background/40 rounded p-1.5 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">🎯 Target</div>
                      <div className="font-mono font-bold">{playbook.playbook.targetPrice}€</div>
                    </div>
                    <div className="bg-background/40 rounded p-1.5 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">🚫 Walk-away</div>
                      <div className="font-mono font-bold text-destructive">{playbook.playbook.walkAwayPrice}€</div>
                    </div>
                  </div>

                  {playbook.marketContext && (
                    <div className="text-[10px] text-muted-foreground">📊 {playbook.marketContext}</div>
                  )}

                  {/* Arguments */}
                  {playbook.playbook.arguments?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Argumenti za pogajanje:</div>
                      <ul className="space-y-0.5 ml-3">
                        {playbook.playbook.arguments.map((arg: string, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">{arg}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Counter offers */}
                  {playbook.playbook.counterOffers?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Counter-offers:</div>
                      <div className="space-y-1">
                        {playbook.playbook.counterOffers.map((c: any, i: number) => (
                          <div key={i} className="bg-background/40 rounded p-1.5 border">
                            <div className="text-[10px] text-muted-foreground">Če: "{c.trigger}"</div>
                            <div className="text-[10px] font-medium">{c.response} <Badge variant="outline" className="text-[9px] ml-1">{c.price}€</Badge></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Psychology tactics */}
                  {playbook.playbook.psychologyTactics?.length > 0 && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-purple-400 mb-1">🧠 Psihološke taktike:</div>
                      <ul className="space-y-0.5 ml-3">
                        {playbook.playbook.psychologyTactics.map((t: string, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Red flags */}
                  {playbook.playbook.redFlags?.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-red-500 mb-1">🚩 Red flags:</div>
                      <ul className="space-y-0.5 ml-3">
                        {playbook.playbook.redFlags.map((r: string, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Best timing */}
                  {playbook.playbook.bestTiming && (
                    <div className="text-[10px] text-muted-foreground">
                      ⏰ <span className="font-semibold">Najboljši čas za kontakt:</span> {playbook.playbook.bestTiming}
                    </div>
                  )}

                  {/* Message templates */}
                  {playbook.playbook.messageTemplates?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase text-muted-foreground">Predloge sporočil:</div>
                      {playbook.playbook.messageTemplates.map((m: any, i: number) => (
                        <div key={i} className="bg-background/40 rounded p-1.5 border">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="text-[9px]">{m.type}</Badge>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(m.text);
                                setPlaybookCopied(m.type);
                                setTimeout(() => setPlaybookCopied(null), 1500);
                                toast.success('Sporočilo kopirano');
                              }}
                              className="text-[9px] text-primary hover:underline"
                            >
                              {playbookCopied === m.type ? <Check className="w-3 h-3 inline" /> : <Copy className="w-3 h-3 inline" />} Kopiraj
                            </button>
                          </div>
                          <p className="text-[10px] whitespace-pre-wrap">{m.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  AI pripravi strategijo, argumente, counter-offers, psihološke taktike in predloge sporočil.
                </p>
              )}
            </div>

            {/* v6.95: AuctionSniperPanel — izvlečen v samostojno komponento (prej 138 vrstic inline) */}
            <AuctionSniperPanel listingId={listing.id} />

            {/* v6.13: Predictive Fraud Detection z ML patterns */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                  AI Fraud Detection
                  <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.13</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-red-500/40 text-red-500 hover:bg-red-500/10"
                  disabled={fraudLoading}
                  onClick={async () => {
                    setFraudLoading(true);
                    setFraud(null);
                    try {
                      const res = await fetch('/api/ai/fraud-detection', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: listing.id }),
                      });
                      const data = await res.json();
                      if (data.ok) { setFraud(data); toast.success('✓ Fraud analiza generirana'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setFraudLoading(false); }
                  }}
                >
                  {fraudLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
                  Skeniraj oglas
                </Button>
              </div>

              {fraudLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI analizira 30+ vzorcev prevare + ML signale...
                </div>
              ) : fraud?.analysis ? (
                <div className="space-y-2 text-[11px]">
                  {/* Fraud score */}
                  <div className={cn('border rounded p-2',
                    fraud.analysis.riskLevel === 'critical' ? 'bg-red-500/10 border-red-500/40' :
                    fraud.analysis.riskLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
                    fraud.analysis.riskLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/5 border-primary/20')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn('font-bold uppercase text-[10px]',
                        fraud.analysis.riskLevel === 'critical' || fraud.analysis.riskLevel === 'high' ? 'text-red-500' :
                        fraud.analysis.riskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                        🛡️ {fraud.analysis.riskLevel} risk · {fraud.analysis.scamType.replace('_', ' ')}
                      </span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        fraud.analysis.fraudScore >= 70 ? 'text-red-500 border-red-500/40' :
                        fraud.analysis.fraudScore >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                        Score: {fraud.analysis.fraudScore}/100
                      </Badge>
                    </div>
                    <p className="text-[10px] font-medium">{fraud.analysis.aiAssessment}</p>
                    {fraud.analysis.reasoning && <p className="text-[9px] text-muted-foreground italic mt-1">{fraud.analysis.reasoning}</p>}
                  </div>

                  {/* Recommendation */}
                  <div className={cn('rounded p-1.5 border text-[10px] font-bold uppercase text-center',
                    fraud.analysis.recommendation === 'avoid' || fraud.analysis.recommendation === 'report'
                      ? 'bg-red-500/10 border-red-500/30 text-red-500'
                      : fraud.analysis.recommendation === 'verify_first'
                      ? 'bg-amber-400/10 border-amber-400/30 text-amber-400'
                      : 'bg-primary/10 border-primary/30 text-primary')}>
                    {fraud.analysis.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
                     fraud.analysis.recommendation === 'report' ? '🚨 PRIJAVI' :
                     fraud.analysis.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI S PREVIDNOSTJO'}
                  </div>

                  {/* Score breakdown */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-background/40 rounded p-1.5 border">
                      <div className="text-muted-foreground text-[9px]">Hevristika</div>
                      <div className="font-mono font-bold">{fraud.analysis.hevristicScore}/100</div>
                    </div>
                    <div className="bg-background/40 rounded p-1.5 border">
                      <div className="text-muted-foreground text-[9px]">AI ocena</div>
                      <div className="font-mono font-bold">{fraud.analysis.aiScore}/100</div>
                    </div>
                  </div>

                  {/* Red flags */}
                  {fraud.analysis.redFlags?.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-red-500 mb-1">🚩 Red flags ({fraud.analysis.redFlags.length}):</div>
                      <ul className="space-y-0.5 ml-3">
                        {fraud.analysis.redFlags.slice(0, 8).map((r: any, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">
                            <span className="font-medium">{r.pattern}</span>
                            <span className="text-muted-foreground"> (+{r.weight}pt)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* ML signals */}
                  {fraud.analysis.mlSignals?.length > 0 && (
                    <div className="bg-blue-400/5 border border-blue-400/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-blue-400 mb-1">🤖 ML signali:</div>
                      <ul className="space-y-0.5 ml-3">
                        {fraud.analysis.mlSignals.map((s: any, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">
                            {s.signal} <span className="text-muted-foreground">(+{s.riskContribution}pt)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Additional red flags */}
                  {fraud.analysis.additionalRedFlags?.length > 0 && (
                    <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-amber-400 mb-1">🔍 Subtilni znaki:</div>
                      <ul className="space-y-0.5 ml-3">
                        {fraud.analysis.additionalRedFlags.map((r: string, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Verification steps */}
                  {fraud.analysis.verificationSteps?.length > 0 && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-primary mb-1">✓ Koraki za preverjanje:</div>
                      <ol className="space-y-0.5 ml-3">
                        {fraud.analysis.verificationSteps.map((s: string, i: number) => (
                          <li key={i} className="text-[10px] list-decimal list-outside">{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Similar fraud patterns */}
                  {fraud.analysis.similarFraudPatterns?.length > 0 && (
                    <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                      🔗 Podobni sumljivi oglasi: {fraud.analysis.similarFraudPatterns.length}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  AI kombinira hevristiko (30+ vzorcev prevare) z ML signali in kontekstno AI analizo.
                </p>
              )}
            </div>

            {/* v6.14: AI Negotiation Outcome Predictor */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Dice5 className="w-3.5 h-3.5 text-primary" />
                  AI Negotiation Outcome
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
                </h4>
              </div>

              <div className="space-y-2 mb-2">
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    placeholder={`Moja ponudba (€) — npr. ${Math.round((listing.price ?? 100) * 0.85)}`}
                    value={outcomeOffer}
                    onChange={(e) => setOutcomeOffer(e.target.value)}
                    className="h-7 text-[11px] flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                    disabled={outcomeLoading}
                    onClick={async () => {
                      setOutcomeLoading(true);
                      setOutcome(null);
                      try {
                        const res = await fetch('/api/ai/negotiation-outcome', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            listingId: listing.id,
                            offerPrice: outcomeOffer ? Number(outcomeOffer) : undefined,
                            message: outcomeMessage || undefined,
                          }),
                        });
                        const data = await res.json();
                        if (data.ok) { setOutcome(data); toast.success('✓ Napoved izida generirana'); }
                        else toast.error(data.error ?? 'Napaka');
                      } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                      finally { setOutcomeLoading(false); }
                    }}
                  >
                    {outcomeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Dice5 className="w-3 h-3" />}
                    Napovej izid
                  </Button>
                </div>
                <Input
                  type="text"
                  placeholder="Sporočilo prodajalcu (opcijsko)"
                  value={outcomeMessage}
                  onChange={(e) => setOutcomeMessage(e.target.value)}
                  className="h-7 text-[11px]"
                />
              </div>

              {outcomeLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI analizira prodajalca, tržne pogoje in verjetnost uspeha...
                </div>
              ) : outcome?.prediction ? (
                <div className="space-y-2 text-[11px]">
                  {/* Success probability */}
                  <div className={cn('border rounded p-2',
                    outcome.prediction.successProbabilityPct >= 70 ? 'bg-primary/10 border-primary/30' :
                    outcome.prediction.successProbabilityPct >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold uppercase text-[10px]">
                        🎯 Verjetnost uspeha
                      </span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        outcome.prediction.successProbabilityPct >= 70 ? 'text-primary border-primary/40' :
                        outcome.prediction.successProbabilityPct >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                        {outcome.prediction.successProbabilityPct}% (confidence {outcome.prediction.confidence}%)
                      </Badge>
                    </div>
                    {/* Probability bar */}
                    <div className="w-full h-2 bg-background rounded overflow-hidden mt-1">
                      <div className={cn('h-full rounded',
                        outcome.prediction.successProbabilityPct >= 70 ? 'bg-primary' :
                        outcome.prediction.successProbabilityPct >= 40 ? 'bg-amber-400' : 'bg-red-500')}
                        style={{ width: `${outcome.prediction.successProbabilityPct}%` }} />
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">{outcome.prediction.reasoning}</p>
                  </div>

                  {/* Counter-offer and optimal offer */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-background/40 rounded p-1.5 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">Tvoja ponudba</div>
                      <div className="font-mono font-bold">{outcome.userOffer}€</div>
                      <div className="text-[9px] text-amber-400">−{outcome.discountRequested}%</div>
                    </div>
                    <div className="bg-background/40 rounded p-1.5 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">Counter-offer</div>
                      <div className="font-mono font-bold text-amber-400">{outcome.prediction.expectedCounterOfferEur}€</div>
                      <div className="text-[9px] text-muted-foreground">predvideno</div>
                    </div>
                    <div className="bg-primary/5 rounded p-1.5 border border-primary/20 text-center">
                      <div className="text-[9px] uppercase text-primary">Optimalna</div>
                      <div className="font-mono font-bold text-primary">{outcome.prediction.suggestedOptimalOfferEur}€</div>
                      <div className="text-[9px] text-primary">→ ponudi to</div>
                    </div>
                  </div>

                  {/* Strategy */}
                  {outcome.prediction.optimalStrategy?.approach && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-primary mb-1">
                        🎯 Strategija: <b>{outcome.prediction.optimalStrategy.approach.replace('_', ' ')}</b>
                      </div>
                      <div className="text-[10px]">{outcome.prediction.optimalStrategy.timing}</div>
                      {outcome.prediction.optimalStrategy.messageTips?.length > 0 && (
                        <ul className="space-y-0.5 ml-3 mt-1">
                          {outcome.prediction.optimalStrategy.messageTips.map((t: string, i: number) => (
                            <li key={i} className="text-[9px] list-disc list-outside">{t}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Factors */}
                  {outcome.prediction.factors?.length > 0 && (
                    <div className="bg-background/40 rounded p-1.5 border">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Faktorji:</div>
                      <div className="space-y-0.5">
                        {outcome.prediction.factors.map((f: any, i: number) => {
                          const impactColor = f.impact === 'positive' ? 'text-primary' :
                                              f.impact === 'negative' ? 'text-red-500' : 'text-muted-foreground';
                          return (
                            <div key={i} className="text-[10px] flex items-center gap-1">
                              <span className={cn('font-bold w-3', impactColor)}>
                                {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '○'}
                              </span>
                              <span className="font-medium">{f.factor}</span>
                              <span className="text-muted-foreground text-[9px]">({f.weight}/10)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Scenarios */}
                  {outcome.prediction.scenarios?.length > 0 && (
                    <div className="bg-background/40 rounded p-1.5 border">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">🔮 Scenariji:</div>
                      <div className="space-y-1">
                        {outcome.prediction.scenarios.map((s: any, i: number) => (
                          <div key={i} className="text-[10px]">
                            <div className="flex items-center justify-between">
                              <span className="font-bold">{s.name}</span>
                              <span className="font-mono text-primary">{s.probabilityPct}% · {s.finalPriceEur}€</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground">{s.outcome}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {outcome.prediction.warnings?.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Opozorila:</div>
                      <ul className="space-y-0.5 ml-3">
                        {outcome.prediction.warnings.map((w: string, i: number) => (
                          <li key={i} className="text-[10px] list-disc list-outside">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Context */}
                  {(outcome.marketContext || outcome.sellerHistory) && (
                    <div className="text-[9px] text-muted-foreground border-t border-border pt-1 space-y-0.5">
                      {outcome.marketContext && <div>📊 {outcome.marketContext}</div>}
                      {outcome.sellerHistory && <div>👤 {outcome.sellerHistory}</div>}
                      <div>📅 Oglas star {outcome.daysSincePosted} dni</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Vnesi ponudbo — AI bo napovedal verjetnost uspeha, counter-offer in optimalno strategijo.
                </p>
              )}
            </div>

            {/* v6.21: AI Image Quality Assessor */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-400" />
                  AI Image Quality Assessor
                  <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.21</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
                  disabled={imageQualityLoading || !listing.imageUrl}
                  onClick={async () => {
                    setImageQualityLoading(true);
                    setImageQuality(null);
                    try {
                      const res = await fetch('/api/ai/image-quality', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: listing.id }),
                      });
                      const data = await res.json();
                      if (data.ok) { setImageQuality(data); toast.success('✓ Analiza kakovosti slike generirana'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setImageQualityLoading(false); }
                  }}
                >
                  {imageQualityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                  Oceni sliko
                </Button>
              </div>
              {imageQualityLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI analizira kakovost slike (osvetlitev, kompozicija, ostrina)...
                </div>
              ) : imageQuality?.assessment ? (
                <div className="space-y-2 text-[11px]">
                  <div className={cn('border rounded p-2',
                    imageQuality.assessment.overallScore >= 70 ? 'bg-primary/10 border-primary/30' :
                    imageQuality.assessment.overallScore >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold uppercase text-[10px]">Skupna kakovost</span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        imageQuality.assessment.overallScore >= 70 ? 'text-primary border-primary/40' :
                        imageQuality.assessment.overallScore >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                        {imageQuality.assessment.overallScore}/100
                      </Badge>
                    </div>
                    {imageQuality.assessment.imageFindings && (
                      <p className="text-[10px] italic">{imageQuality.assessment.imageFindings}</p>
                    )}
                  </div>
                  {/* Quality factors grid */}
                  <div className="grid grid-cols-5 gap-1 text-[9px]">
                    {Object.entries(imageQuality.assessment.qualityFactors).map(([k, v]: [string, any]) => (
                      <div key={k} className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground truncate">{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                        <div className={cn('font-mono font-bold',
                          v >= 7 ? 'text-primary' : v >= 4 ? 'text-amber-400' : 'text-red-500')}>{v}/10</div>
                      </div>
                    ))}
                  </div>
                  {/* Issues */}
                  {imageQuality.assessment.issues?.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Težave:</div>
                      <div className="space-y-1">
                        {imageQuality.assessment.issues.map((i: any, j: number) => (
                          <div key={j} className="text-[10px]">
                            <div className="flex items-center justify-between">
                              <span><Badge variant="outline" className="text-[8px] mr-1">{i.type}</Badge> {i.description}</span>
                              <Badge variant="outline" className={cn('text-[8px]',
                                i.severity === 'high' ? 'text-red-500 border-red-500/30' :
                                i.severity === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{i.severity}</Badge>
                            </div>
                            <div className="text-[9px] text-primary">→ {i.fix}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Recommendations */}
                  {imageQuality.assessment.recommendations?.length > 0 && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                      <div className="space-y-1">
                        {imageQuality.assessment.recommendations.map((r: any, j: number) => (
                          <div key={j} className="text-[10px] flex items-center justify-between">
                            <span>{r.action}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn('text-[8px]',
                                r.impact === 'high' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>{r.impact}</Badge>
                              {r.estimatedValueIncreaseEur > 0 && <span className="font-mono text-primary">+{r.estimatedValueIncreaseEur}€</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Suggested shots */}
                  {imageQuality.assessment.suggestedShots?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">📸 Predlagane dodatne slike:</div>
                      <div className="space-y-0.5">
                        {imageQuality.assessment.suggestedShots.map((s: any, j: number) => (
                          <div key={j} className="text-[10px] flex items-center justify-between">
                            <span><Badge variant="outline" className="text-[8px] mr-1">{s.type}</Badge> {s.description}</span>
                            <Badge variant="outline" className={cn('text-[8px]',
                              s.priority === 'high' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>{s.priority}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  {listing.imageUrl ? 'AI oceni kakovost slike (osvetlitev, kompozicija, ostrina, prodajni potencial).' : 'Ni slike za analizo.'}
                </p>
              )}
            </div>

            {/* v6.21: AI Fake Detection (luxury + electronics) */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ScanSearch className="w-3.5 h-3.5 text-red-500" />
                  AI Fake Detection
                  <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.21</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-red-500/40 text-red-500 hover:bg-red-500/10"
                  disabled={fakeDetectLoading || !listing.imageUrl}
                  onClick={async () => {
                    setFakeDetectLoading(true);
                    setFakeDetect(null);
                    try {
                      const res = await fetch('/api/ai/fake-detection', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: listing.id }),
                      });
                      const data = await res.json();
                      if (data.ok) { setFakeDetect(data); toast.success('✓ Fake detection analiza generirana'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setFakeDetectLoading(false); }
                  }}
                >
                  {fakeDetectLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
                  Preveri pristnost
                </Button>
              </div>
              {fakeDetectLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI preverja znake ponarejanja z vizualno analizo...
                </div>
              ) : fakeDetect?.detection ? (
                <div className="space-y-2 text-[11px]">
                  <div className={cn('border rounded p-2',
                    fakeDetect.detection.isLikelyFake ? 'bg-red-500/10 border-red-500/30' :
                    fakeDetect.detection.authenticityScore >= 70 ? 'bg-primary/10 border-primary/30' :
                    'bg-amber-400/5 border-amber-400/20')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold uppercase text-[10px]">
                        {fakeDetect.detection.isLikelyFake ? '🚨 VERJETNO PONAREDEK' : '✓ Verjetno pristen'}
                      </span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        fakeDetect.detection.fakeProbabilityPct >= 60 ? 'text-red-500 border-red-500/40' :
                        fakeDetect.detection.fakeProbabilityPct >= 30 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                        Pristnost: {fakeDetect.detection.authenticityScore}%
                      </Badge>
                    </div>
                    {fakeDetect.detection.detectedBrand && (
                      <div className="text-[9px] text-muted-foreground">Znamka: <b>{fakeDetect.detection.detectedBrand}</b></div>
                    )}
                    {fakeDetect.detection.imageFindings && (
                      <p className="text-[10px] italic mt-1">{fakeDetect.detection.imageFindings}</p>
                    )}
                  </div>
                  <div className={cn('rounded p-1.5 text-[10px] text-center font-bold uppercase',
                    fakeDetect.detection.recommendation === 'avoid' || fakeDetect.detection.recommendation === 'report'
                      ? 'bg-red-500/10 text-red-500'
                      : fakeDetect.detection.recommendation === 'verify_first'
                      ? 'bg-amber-400/10 text-amber-400'
                      : 'bg-primary/10 text-primary')}>
                    → {fakeDetect.detection.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
                       fakeDetect.detection.recommendation === 'report' ? '🚨 PRIJAVI' :
                       fakeDetect.detection.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI'}
                  </div>
                  {fakeDetect.detection.reasoning && (
                    <div className="text-[10px] text-muted-foreground italic">{fakeDetect.detection.reasoning}</div>
                  )}
                  {/* Indicators */}
                  {fakeDetect.detection.indicators?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Indikatorji:</div>
                      <div className="space-y-0.5">
                        {fakeDetect.detection.indicators.map((i: any, j: number) => (
                          <div key={j} className="text-[10px] flex items-center justify-between">
                            <span className={cn(i.type === 'authentic' ? 'text-primary' : i.type === 'fake' ? 'text-red-500' : 'text-amber-400')}>
                              {i.type === 'authentic' ? '✓' : i.type === 'fake' ? '🚨' : '⚠️'} {i.description}
                            </span>
                            <span className="text-[8px] text-muted-foreground">({i.weight}/10)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Brand-specific checks */}
                  {fakeDetect.detection.brandSpecificChecks?.length > 0 && (
                    <div className="bg-background/40 border rounded p-1.5">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Specifično za znamko:</div>
                      <div className="space-y-0.5">
                        {fakeDetect.detection.brandSpecificChecks.map((c: any, j: number) => (
                          <div key={j} className="text-[10px] flex items-center justify-between">
                            <span>{c.check}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn('text-[8px]',
                                c.status === 'present' ? 'text-primary border-primary/30' :
                                c.status === 'missing' ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                                {c.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Verification steps */}
                  {fakeDetect.detection.verificationSteps?.length > 0 && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-primary mb-1">✓ Koraki za preverjanje:</div>
                      <ol className="space-y-0.5 ml-3">
                        {fakeDetect.detection.verificationSteps.map((s: any, j: number) => (
                          <li key={j} className="text-[10px] list-decimal list-outside">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{s.step}</span>
                              <Badge variant="outline" className={cn('text-[8px]',
                                s.priority === 'high' ? 'text-red-500 border-red-500/30' : 'text-muted-foreground')}>{s.priority}</Badge>
                            </div>
                            <div className="text-[9px] text-muted-foreground">→ {s.howTo}</div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {/* Online tools */}
                  {fakeDetect.detection.onlineVerification?.recommendedTools?.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      🔍 Orodja: {fakeDetect.detection.onlineVerification.recommendedTools.join(' · ')}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  {listing.imageUrl ? 'AI preveri znake ponarejanja (Gucci/LV/Rolex/iPhone/...).' : 'Ni slike za analizo.'}
                </p>
              )}
            </div>

            {/* v6.23: AI Description Optimizer */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <FileEdit className="w-3.5 h-3.5 text-pink-400" />
                  AI Description Optimizer
                  <Badge variant="outline" className="text-[10px] text-pink-400 border-pink-400/40">v6.23</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-pink-400/40 text-pink-400 hover:bg-pink-400/10"
                  disabled={descOptLoading}
                  onClick={async () => {
                    setDescOptLoading(true);
                    setDescOpt(null);
                    try {
                      const res = await fetch('/api/ai/description-optimizer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          currentDescription: listing.detailDescription || listing.description,
                          title: listing.title,
                          category: listing.monitor?.source,
                          price: listing.price,
                          targetPlatform: 'bolha',
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) { setDescOpt(data); toast.success('✓ Optimizacija opisa generirana'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setDescOptLoading(false); }
                  }}
                >
                  {descOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileEdit className="w-3 h-3" />}
                  Optimiziraj opis
                </Button>
              </div>
              {descOptLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI optimizira opis z 4 strategijami (BENEFIT/STORY/TECHNICAL/SCANNABLE)...
                </div>
              ) : descOpt?.optimization ? (
                <div className="space-y-2 text-[11px]">
                  {/* Current analysis */}
                  <div className="bg-background/40 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Trenutni opis:</span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        descOpt.optimization.currentAnalysis.score >= 70 ? 'text-primary border-primary/40' :
                        descOpt.optimization.currentAnalysis.score >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                        Score: {descOpt.optimization.currentAnalysis.score}/100
                      </Badge>
                    </div>
                    {descOpt.optimization.currentAnalysis.strengths?.length > 0 && (
                      <div className="text-[9px] text-primary">✓ {descOpt.optimization.currentAnalysis.strengths.join(' · ')}</div>
                    )}
                    {descOpt.optimization.currentAnalysis.weaknesses?.length > 0 && (
                      <div className="text-[9px] text-red-500">⚠️ {descOpt.optimization.currentAnalysis.weaknesses.join(' · ')}</div>
                    )}
                  </div>

                  {/* Winner */}
                  {descOpt.optimization.winner?.description && (
                    <div className="bg-primary/10 border border-primary/30 rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase text-primary font-bold">🏆 Zmagovalni opis:</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(descOpt.optimization.winner.description);
                            setDescOptCopied('winner');
                            setTimeout(() => setDescOptCopied(null), 1500);
                            toast.success('Opis kopiran');
                          }}
                          className="text-[9px] text-primary hover:underline"
                        >
                          {descOptCopied === 'winner' ? '✓' : '📋'} Kopiraj
                        </button>
                      </div>
                      <div className="text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto">{descOpt.optimization.winner.description}</div>
                      <div className="text-[9px] text-muted-foreground mt-1">{descOpt.optimization.winner.why}</div>
                      {descOpt.optimization.winner.expectedImprovementPct > 0 && (
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40 mt-1">
                          +{descOpt.optimization.winner.expectedImprovementPct}% izboljšava
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Variants */}
                  {descOpt.optimization.variants?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Variante opisov:</div>
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {descOpt.optimization.variants.map((v: any, i: number) => (
                          <div key={i} className="bg-background/40 border rounded p-1.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="text-[8px] text-pink-400 border-pink-400/30">{v.strategy.replace('_', ' ')}</Badge>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="outline" className={cn('text-[8px] font-mono',
                                  v.overallScore >= 70 ? 'text-primary border-primary/40' : 'text-amber-400 border-amber-400/40')}>{v.overallScore}</Badge>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(v.description);
                                    setDescOptCopied(`v${i}`);
                                    setTimeout(() => setDescOptCopied(null), 1500);
                                    toast.success('Varianta kopirana');
                                  }}
                                  className="text-[9px] text-pink-400 hover:underline"
                                >
                                  {descOptCopied === `v${i}` ? '✓' : '📋'}
                                </button>
                              </div>
                            </div>
                            <div className="text-[9px] text-muted-foreground line-clamp-2">{v.description.slice(0, 150)}...</div>
                            <div className="grid grid-cols-4 gap-1 text-[8px]">
                              <div className="text-center"><span className="text-muted-foreground">Berljivost:</span> <b className={v.readabilityScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.readabilityScore}</b></div>
                              <div className="text-center"><span className="text-muted-foreground">Prep.:</span> <b className={v.persuasivenessScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.persuasivenessScore}</b></div>
                              <div className="text-center"><span className="text-muted-foreground">SEO:</span> <b className={v.seoScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.seoScore}</b></div>
                              <div className="text-center"><span className="text-muted-foreground">Zaupanje:</span> <b className={v.trustScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.trustScore}</b></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SEO keywords */}
                  {descOpt.optimization.seoKeywords?.length > 0 && (
                    <div className="bg-background/40 border rounded p-1.5">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">🔍 SEO ključne besede:</div>
                      <div className="flex flex-wrap gap-1">
                        {descOpt.optimization.seoKeywords.map((k: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[8px]">{k}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  AI optimizira opis z 4 strategijami (BENEFIT/STORY/TECHNICAL/SCANNABLE) in A/B testi.
                </p>
              )}
            </div>

            {/* v6.22: AI Reverse Image Search (stock photo detection) */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-cyan-400" />
                  AI Reverse Image Search
                  <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400/40">v6.22</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/10"
                  disabled={reverseSearchLoading || !listing.imageUrl}
                  onClick={async () => {
                    setReverseSearchLoading(true);
                    setReverseSearch(null);
                    try {
                      const res = await fetch('/api/ai/reverse-image-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: listing.id }),
                      });
                      const data = await res.json();
                      if (data.ok) { setReverseSearch(data); toast.success('✓ Reverse image search generiran'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setReverseSearchLoading(false); }
                  }}
                >
                  {reverseSearchLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Preveri sliko
                </Button>
              </div>
              {reverseSearchLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI preverja ali je slika stock fotografija...
                </div>
              ) : reverseSearch?.search ? (
                <div className="space-y-2 text-[11px]">
                  <div className={cn('border rounded p-2',
                    reverseSearch.search.isStockPhoto ? 'bg-red-500/10 border-red-500/30' :
                    reverseSearch.search.stockPhotoProbabilityPct >= 50 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/10 border-primary/30')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold uppercase text-[10px]">
                        {reverseSearch.search.isStockPhoto ? '🚨 STOCK FOTOGRAFIJA' : '✓ Verjetno realna slika'}
                      </span>
                      <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                        reverseSearch.search.stockPhotoProbabilityPct >= 70 ? 'text-red-500 border-red-500/40' :
                        reverseSearch.search.stockPhotoProbabilityPct >= 30 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                        Stock verjetnost: {reverseSearch.search.stockPhotoProbabilityPct}%
                      </Badge>
                    </div>
                    {reverseSearch.search.imageFindings && (
                      <p className="text-[10px] italic">{reverseSearch.search.imageFindings}</p>
                    )}
                  </div>
                  <div className={cn('rounded p-1.5 text-[10px] text-center font-bold uppercase',
                    reverseSearch.search.recommendation === 'avoid' || reverseSearch.search.recommendation === 'report'
                      ? 'bg-red-500/10 text-red-500'
                      : reverseSearch.search.recommendation === 'verify_first'
                      ? 'bg-amber-400/10 text-amber-400'
                      : 'bg-primary/10 text-primary')}>
                    → {reverseSearch.search.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
                       reverseSearch.search.recommendation === 'report' ? '🚨 PRIJAVI' :
                       reverseSearch.search.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI S PREVIDNOSTJO'}
                  </div>
                  {reverseSearch.search.reasoning && (
                    <div className="text-[10px] text-muted-foreground italic">{reverseSearch.search.reasoning}</div>
                  )}
                  {/* URL analysis */}
                  {reverseSearch.search.urlAnalysis && (
                    <div className="bg-background/40 border rounded p-1.5">
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">🔗 URL analiza:</div>
                      <div className="space-y-0.5 text-[10px]">
                        {reverseSearch.search.urlAnalysis.matchedStockDomains?.length > 0 && (
                          <div className="text-red-500">🚨 Stock domena: {reverseSearch.search.urlAnalysis.matchedStockDomains.join(', ')}</div>
                        )}
                        {reverseSearch.search.urlAnalysis.matchedPatterns?.length > 0 && (
                          <div className="text-amber-400">⚠️ Stock vzorci: {reverseSearch.search.urlAnalysis.matchedPatterns.join(', ')}</div>
                        )}
                        {reverseSearch.search.urlAnalysis.matchedWatermarks?.length > 0 && (
                          <div className="text-red-500">🚨 Watermark: {reverseSearch.search.urlAnalysis.matchedWatermarks.join(', ')}</div>
                        )}
                        {reverseSearch.search.urlAnalysis.totalRedFlags === 0 && (
                          <div className="text-primary">✓ URL brez sumljivih vzorcev</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Visual indicators */}
                  {reverseSearch.search.visualIndicators?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Vizualni indikatorji:</div>
                      <div className="space-y-0.5">
                        {reverseSearch.search.visualIndicators.map((v: any, j: number) => (
                          <div key={j} className="text-[10px] flex items-center justify-between">
                            <span className={cn(v.type === 'authentic' ? 'text-primary' : v.type === 'stock' ? 'text-red-500' : 'text-amber-400')}>
                              {v.type === 'authentic' ? '✓' : v.type === 'stock' ? '🚨' : '⚠️'} {v.indicator}
                            </span>
                            <span className="text-[8px] text-muted-foreground">({v.weight}/10)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Search URLs */}
                  {reverseSearch.search.searchStrategy && (
                    <div className="bg-cyan-400/5 border border-cyan-400/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-cyan-400 mb-1">🔍 Preveri na:</div>
                      <div className="grid grid-cols-2 gap-1 text-[9px]">
                        {reverseSearch.search.searchStrategy.googleLensUrl && (
                          <a href={reverseSearch.search.searchStrategy.googleLensUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                            <ExternalLink className="w-3 h-3" /> Google Lens
                          </a>
                        )}
                        {reverseSearch.search.searchStrategy.tineyeUrl && (
                          <a href={reverseSearch.search.searchStrategy.tineyeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                            <ExternalLink className="w-3 h-3" /> TinEye
                          </a>
                        )}
                        {reverseSearch.search.searchStrategy.bingVisualUrl && (
                          <a href={reverseSearch.search.searchStrategy.bingVisualUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                            <ExternalLink className="w-3 h-3" /> Bing Visual
                          </a>
                        )}
                        {reverseSearch.search.searchStrategy.yandexUrl && (
                          <a href={reverseSearch.search.searchStrategy.yandexUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                            <ExternalLink className="w-3 h-3" /> Yandex
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  {listing.imageUrl ? 'AI preveri ali je slika stock fotografija (URL + vizualna analiza).' : 'Ni slike za analizo.'}
                </p>
              )}
            </div>

            {/* v6.95: SentimentPanel — izvlečen v samostojno komponento (prej 117 vrstic inline) */}
            <SentimentPanel listingId={listing.id} />

            {/* v6.20: AI Smart Negotiation Chatbot */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  AI Negotiation Chatbot
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.20</Badge>
                </h4>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select
                  value={chatbotStrategy}
                  onChange={(e) => setChatbotStrategy(e.target.value as any)}
                  className="h-7 text-[11px] bg-background border rounded px-2"
                >
                  <option value="aggressive">🔥 Agresivna (15-25% pod)</option>
                  <option value="firm">⚖️ Zmerna (10-15% pod)</option>
                  <option value="patient">🛡️ Strpna (sprašuj)</option>
                </select>
                <Input
                  type="number"
                  placeholder="Max budget (€)"
                  value={chatbotMaxPrice}
                  onChange={(e) => setChatbotMaxPrice(e.target.value)}
                  className="h-7 text-[11px]"
                />
              </div>
              {chatbotMessages.length > 0 && (
                <div className="space-y-1 mb-2 max-h-40 overflow-y-auto bg-background/40 rounded p-2 border">
                  {chatbotMessages.map((m, i) => (
                    <div key={i} className={cn('text-[10px] rounded p-1.5',
                      m.role === 'user' ? 'bg-primary/10 text-primary ml-4' : 'bg-muted/30 mr-4')}>
                      <div className="text-[8px] uppercase font-bold opacity-70">
                        {m.role === 'user' ? 'JAZ' : 'PRODAJALEC'}
                      </div>
                      <div>{m.text}</div>
                    </div>
                  ))}
                  {chatbotLastReply && (
                    <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                      <div className="text-[8px] uppercase font-bold text-primary">AI PREDLOG ↓</div>
                      <div className="text-[10px] font-medium">{chatbotLastReply.text}</div>
                      {chatbotLastReply.suggestedPriceEur != null && (
                        <div className="text-[9px] text-primary mt-0.5">💰 Predlagana cena: {chatbotLastReply.suggestedPriceEur}€</div>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(chatbotLastReply.text);
                          toast.success('Predlagani odgovor kopiran');
                        }}
                        className="text-[9px] text-primary hover:underline mt-1"
                      >
                        📋 Kopiraj
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-1">
                <Input
                  type="text"
                  placeholder="Sporočilo prodajalca (ali prazno za začetek)"
                  value={chatbotInput}
                  onChange={(e) => setChatbotInput(e.target.value)}
                  className="h-7 text-[11px] flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !chatbotLoading) {
                      const newMessages = chatbotInput
                        ? [...chatbotMessages, { role: 'seller' as const, text: chatbotInput }]
                        : chatbotMessages;
                      setChatbotMessages(newMessages);
                      setChatbotInput('');
                      setChatbotLoading(true);
                      fetch('/api/ai/negotiation-chatbot', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          listingId: listing.id,
                          messages: newMessages,
                          strategy: chatbotStrategy,
                          myGoal: { maxPrice: chatbotMaxPrice ? Number(chatbotMaxPrice) : undefined },
                        }),
                      })
                        .then(r => r.json())
                        .then(data => {
                          if (data.ok) {
                            setChatbotMessages([...newMessages, { role: 'user', text: data.reply.text }]);
                            setChatbotLastReply(data.reply);
                            toast.success(`✓ AI odgovor (${data.reply.confidencePct}% confidence)`);
                          } else toast.error(data.error ?? 'Napaka');
                        })
                        .catch(err => toast.error(err?.message ?? 'Napaka'))
                        .finally(() => setChatbotLoading(false));
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  disabled={chatbotLoading}
                  onClick={() => {
                    const newMessages = chatbotInput
                      ? [...chatbotMessages, { role: 'seller' as const, text: chatbotInput }]
                      : chatbotMessages;
                    if (newMessages.length === 0) {
                      // Začetni odgovor — generiraj prvo sporočilo
                      setChatbotMessages([{ role: 'seller', text: '(začetek pogovora)' }]);
                    }
                    setChatbotMessages(newMessages.length > 0 ? newMessages : [{ role: 'seller', text: '(začetek)' }]);
                    setChatbotInput('');
                    setChatbotLoading(true);
                    fetch('/api/ai/negotiation-chatbot', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        listingId: listing.id,
                        messages: newMessages.length > 0 ? newMessages : [{ role: 'seller', text: 'Pozdravljen, vaš oglas me zanima. Kakšna je najboljša cena?' }],
                        strategy: chatbotStrategy,
                        myGoal: { maxPrice: chatbotMaxPrice ? Number(chatbotMaxPrice) : undefined },
                      }),
                    })
                      .then(r => r.json())
                      .then(data => {
                        if (data.ok) {
                          setChatbotMessages([...(newMessages.length > 0 ? newMessages : [{ role: 'seller' as const, text: 'Pozdravljen, vaš oglas me zanima.' }]), { role: 'user' as const, text: data.reply.text }]);
                          setChatbotLastReply(data.reply);
                          toast.success(`✓ AI odgovor (${data.reply.confidencePct}% confidence)`);
                        } else toast.error(data.error ?? 'Napaka');
                      })
                      .catch(err => toast.error(err?.message ?? 'Napaka'))
                      .finally(() => setChatbotLoading(false));
                  }}
                >
                  {chatbotLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  {chatbotMessages.length === 0 ? 'Začni' : 'Odgovori'}
                </Button>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">
                💡 Prilepi prodajalčevo sporočilo in AI bo generiral tvoj naslednji odgovor. Strategija: {chatbotStrategy}.
              </p>
            </div>

            {/* v6.20: AI Refurbishment Cost Estimator */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-amber-400" />
                  AI Refurbishment Cost Estimator
                  <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.20</Badge>
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1.5 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
                  disabled={refurbLoading}
                  onClick={async () => {
                    setRefurbLoading(true);
                    setRefurb(null);
                    try {
                      const res = await fetch('/api/ai/refurbishment-cost', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ listingId: listing.id }),
                      });
                      const data = await res.json();
                      if (data.ok) { setRefurb(data); toast.success('✓ Refurbishment ocena generirana'); }
                      else toast.error(data.error ?? 'Napaka');
                    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                    finally { setRefurbLoading(false); }
                  }}
                >
                  {refurbLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                  Oceni obnovo
                </Button>
              </div>
              {refurbLoading ? (
                <div className="py-3 text-center text-[11px] text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                  AI analizira sliko in ocenjuje stroške obnove...
                </div>
              ) : refurb?.estimate ? (
                <div className="space-y-2 text-[11px]">
                  <div className={cn('border rounded p-2',
                    refurb.estimate.recommendedAction === 'avoid' ? 'bg-red-500/5 border-red-500/20' :
                    refurb.estimate.recommendedAction === 'buy_and_refurb' ? 'bg-primary/10 border-primary/30' :
                    refurb.estimate.recommendedAction === 'marginal' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/40 border-border')}>
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                        refurb.estimate.recommendedAction === 'avoid' ? 'text-red-500 border-red-500/40' :
                        refurb.estimate.recommendedAction === 'buy_and_refurb' ? 'text-primary border-primary/40' :
                        refurb.estimate.recommendedAction === 'marginal' ? 'text-amber-400 border-amber-400/40' : 'text-muted-foreground')}>
                        {refurb.estimate.recommendedAction.replace('_', ' ')}
                      </Badge>
                      <span className="text-[9px]">{refurb.estimate.refurbStrategy.replace('_', ' ')}</span>
                    </div>
                    {refurb.estimate.imageFindings && (
                      <p className="text-[10px] italic mb-1">📸 {refurb.estimate.imageFindings}</p>
                    )}
                    <p className="text-[10px]">{refurb.estimate.reasoning}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px]">
                    <div className="bg-background/40 rounded p-1 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">Nakup</div>
                      <div className="font-mono font-bold">{refurb.estimate.buyPrice}€</div>
                    </div>
                    <div className="bg-background/40 rounded p-1 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">Obnova</div>
                      <div className="font-mono font-bold text-amber-400">{refurb.estimate.totalRefurbCostEur}€</div>
                    </div>
                    <div className="bg-background/40 rounded p-1 border text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">Prodaja</div>
                      <div className="font-mono font-bold text-primary">{refurb.estimate.resaleValueEur}€</div>
                    </div>
                    <div className={cn('rounded p-1 border text-center',
                      refurb.estimate.profitPotentialEur >= 0 ? 'bg-primary/10 border-primary/30' : 'bg-red-500/10 border-red-500/30')}>
                      <div className="text-[9px] uppercase text-muted-foreground">Dobiček</div>
                      <div className={cn('font-mono font-bold', refurb.estimate.profitPotentialEur >= 0 ? 'text-primary' : 'text-destructive')}>
                        {refurb.estimate.profitPotentialEur >= 0 ? '+' : ''}{refurb.estimate.profitPotentialEur}€
                      </div>
                    </div>
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    ROI: <b className={refurb.estimate.roiPct >= 20 ? 'text-primary' : 'text-amber-400'}>{refurb.estimate.roiPct}%</b>
                    {' · '}⏱ {refurb.estimate.timeRequiredDays}d
                    {' · '}🔧 {refurb.estimate.skillsRequired}
                  </div>
                  {refurb.estimate.items?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Postopki obnove:</div>
                      <div className="space-y-0.5">
                        {refurb.estimate.items.map((it: any, i: number) => (
                          <div key={i} className="text-[10px] flex items-center justify-between bg-background/40 rounded p-1 border">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className={cn('text-[8px]',
                                it.complexity === 'hard' ? 'text-red-500 border-red-500/30' :
                                it.complexity === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                                {it.complexity}
                              </Badge>
                              {it.optional && <span className="text-[8px] text-muted-foreground">opcijsko</span>}
                              <span>{it.name}</span>
                            </div>
                            <span className="font-mono font-bold text-amber-400">{it.costEur}€</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {refurb.estimate.toolsNeeded?.length > 0 && (
                    <div className="text-[9px] text-muted-foreground">
                      🛠 Orodja: {refurb.estimate.toolsNeeded.join(' · ')}
                    </div>
                  )}
                  {refurb.estimate.warnings?.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                      <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Opozorila:</div>
                      <ul className="space-y-0.5 ml-3">
                        {refurb.estimate.warnings.map((w: string, i: number) => <li key={i} className="text-[10px] list-disc list-outside">{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  AI oceni stroške obnove (vizualna analiza slike + kalkulacija dobička po preprodaji).
                </p>
              )}
            </div>

            {/* v5.0: AI Auto-Bid — strategija + sporočilo prodajalcu */}
            <div className="border-t border-border pt-3">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                AI Auto-Bid
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.0</Badge>
              </h4>
              <p className="text-[11px] text-muted-foreground mb-3">
                AI analizira oglas, tržne podatke in zgodovino cene, nato predlaga ponudbo + sporočilo prodajalcu.
              </p>

              {/* Strategy picker */}
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">Strategija:</span>
                {([
                  { v: 'aggressive', l: '🔥 Agresivna', desc: '20-30% pod tržno' },
                  { v: 'moderate', l: '⚖️ Zmerna', desc: '10-15% pod tržno' },
                  { v: 'conservative', l: '🛡️ Konzervativna', desc: '5% pod tržno' },
                ] as const).map(opt => (
                  <button
                    key={opt.v}
                    onClick={() => setBidStrategy(opt.v)}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] border transition-colors',
                      bidStrategy === opt.v
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                    title={opt.desc}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>

              {/* Optional budget */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] text-muted-foreground shrink-0">Max budget (opcionalno):</span>
                <Input
                  type="number"
                  min="0"
                  value={bidMaxBudget}
                  onChange={(e) => setBidMaxBudget(e.target.value)}
                  placeholder="EUR"
                  className="text-xs font-mono h-7 w-32"
                />
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={generateBid}
                  disabled={bidding}
                >
                  {bidding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Generiraj ponudbo
                </Button>
              </div>

              {bidding && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
                  AI analizira oglas in tržne podatke...
                </div>
              )}

              {bidResult && !bidding && (
                <div className="space-y-2">
                  {/* Bid summary */}
                  <div className="bg-primary/5 border border-primary/20 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wider text-primary">💡 Predlagana ponudba</span>
                      <Badge variant="outline" className={cn(
                        'text-[10px]',
                        bidResult.confidence >= 70 ? 'text-primary border-primary/40' :
                        bidResult.confidence >= 40 ? 'text-amber-400 border-amber-400/40' :
                        'text-red-500 border-red-500/40'
                      )}>
                        🎯 {bidResult.confidence}% zaupanje
                      </Badge>
                    </div>
                    <div className="text-2xl font-bold font-mono text-primary">
                      {bidResult.suggestedPrice}€
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Pozicija: {bidResult.marketPosition === 'below_market' ? 'pod tržno' :
                                bidResult.marketPosition === 'above_market' ? 'nad tržno' : 'pri tržni ceni'}
                      {listing.price && bidResult.suggestedPrice < listing.price &&
                        ` • ${Math.round((1 - bidResult.suggestedPrice / listing.price) * 100)}% pod asking ceno`
                      }
                    </div>
                  </div>

                  {/* Reasoning */}
                  {bidResult.reasoning && (
                    <div className="bg-background/30 rounded p-2 text-xs">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📊 Razlog</div>
                      <p className="italic">"{bidResult.reasoning}"</p>
                    </div>
                  )}

                  {/* Message */}
                  {bidResult.message && (
                    <div className="bg-background/30 border border-border rounded p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          ✉️ Sporočilo prodajalcu
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] gap-1"
                          onClick={copyBidMessage}
                        >
                          {bidCopied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                          {bidCopied ? 'Kopirano' : 'Kopiraj'}
                        </Button>
                      </div>
                      <p className="text-xs whitespace-pre-wrap">{bidResult.message}</p>
                    </div>
                  )}

                  {/* Expected response */}
                  {bidResult.expectedResponse && (
                    <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs">
                      <span className="text-[10px] uppercase tracking-wider text-amber-400">📈 Pričakovan odgovor: </span>
                      <span>{bidResult.expectedResponse}</span>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    ⚠️ Preglej in prilagodi pred pošiljanjem. AI ne pozna specifičnih detailov ki jih vidiš ti.
                  </p>
                </div>
              )}
            </div>

            {/* v5.4: Negotiation History — sledi pogajanjem z AI naslednjim korakom */}
            <NegotiationHistory listingId={listing.id} aiMessage={negotiateMessage} />
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
