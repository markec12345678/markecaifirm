'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target, MapPin, Clock, Bookmark, Sparkles, ShoppingCart, BarChart3, TrendingDown, TrendingUp, Copy, Check, GitCompare, Trash2, EyeOff, Zap, User, Wallet, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// v6.95: AI panel-i izvlečeni v samostojne komponente (ListingDetailModal razbit).
// Prej je bil ListingDetailModal 4070 vrstic z 70+ useState. Sedaj ima AI analize v podkomponentah.
import { SentimentPanel } from '@/components/dashboard/listing-detail/sentiment-panel';
import { AuctionSniperPanel } from '@/components/dashboard/listing-detail/auction-sniper-panel';
// v6.96: FraudDetectionPanel — združuje fraud-detection + fake-detection + reverse-image-search
import { FraudDetectionPanel } from '@/components/dashboard/listing-detail/fraud-detection-panel';
// v6.97: ImageAnalysisPanel — združuje image-quality + description-optimizer + refurbishment-cost
import { ImageAnalysisPanel } from '@/components/dashboard/listing-detail/image-analysis-panel';
// v6.98: NegotiationPanel — združuje Negotiator + Playbook + Outcome + Chatbot (4 v 1)
import { NegotiationPanel } from '@/components/dashboard/listing-detail/negotiation-panel';
import { PriceHistoryPanel } from '@/components/dashboard/listing-detail/price-history-panel';
import { SellerIntelligencePanel } from '@/components/dashboard/listing-detail/seller-intelligence-panel';
import { MakeOfferPanel } from '@/components/dashboard/listing-detail/make-offer-panel';
import { SoldCompsPanel } from '@/components/dashboard/listing-detail/sold-comps-panel';
import { QuickBuyButton } from '@/components/dashboard/listing-detail/quick-buy-button';
// v6.99: ListingActionsBar — združuje Notes + Contact Tracker
import { ListingActionsBar } from '@/components/dashboard/listing-detail/listing-actions-bar';

import { formatTimeAgo } from './listings/utils';
import type { Listing, Monitor, ListingsResponse, BuyScore } from './listings/types';
import { ListingRow } from './listings/listing-row';
import { ListingDetailModal } from './listings/listing-detail-modal';
import { CompareModal } from './listings/compare-modal';
import { CompareRow } from './listings/compare-row';

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
  // v8.69: Buy Opportunity scores map (listingId → {score, verdict})
  const [buyScoreMap, setBuyScoreMap] = useState<Record<string, { score: number; verdict: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'AVOID'; expectedROI: number | null; expectedProfit: number | null; discountPercent: number | null; recommendation: string }>>({});
  const [buyScoreLoading, setBuyScoreLoading] = useState(false);
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

  // v8.69: Fetch buy opportunity scores for visible listings (batch, auto-refresh)
  useEffect(() => {
    if (!data?.listings?.length) return;
    let cancelled = false;
    (async () => {
      setBuyScoreLoading(true);
      try {
        const res = await fetch('/api/analytics/buy-opportunity?limit=50');
        if (res.ok) {
          const d = await res.json();
          if (d?.ok && Array.isArray(d.top5) && !cancelled) {
            // top5 has only 5 — need full results for all listings
            const all = [...(d.strongBuys || []), ...(d.buys || []), ...(d.considers || []), ...(d.avoids || [])];
            const map: Record<string, any> = {};
            for (const r of all) {
              map[r.listingId] = {
                score: r.score,
                verdict: r.verdict,
                expectedROI: r.expectedROI,
                expectedProfit: r.expectedProfit,
                discountPercent: r.discountPercent,
                recommendation: r.recommendation,
              };
            }
            if (!cancelled) setBuyScoreMap(map);
          }
        }
      } catch { /* non-critical */ }
      finally { if (!cancelled) setBuyScoreLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [data?.listings]);

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
              <Button size="sm" variant="ghost" onClick={() => setAnomalies([])} aria-label="Zapri prikaz anomalij" className="h-6 text-xs">×</Button>
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
                <Button size="sm" variant="ghost" onClick={() => setDuplicates([])} aria-label="Zapri prikaz podvojenih oglasov" className="h-6 text-xs">×</Button>
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
              <Button size="sm" variant="ghost" onClick={() => setBulkBuyData(null)} aria-label="Zapri prikaz skupnih nakupov" className="h-6 text-xs">×</Button>
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
              <Button size="sm" variant="ghost" onClick={() => { setMonitorId('all'); setVerdict('all'); setMinScore(''); setMaxRisk(''); setHasImage(false); setBookmarkedOnly(false); setContactFilter('all'); }} aria-label="Počisti vse filtre" className="h-7 text-xs">
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
          <CardContent className="p-8">
            <EmptyState
              icon={<LayoutGrid className="w-12 h-12" />}
              title="Ni oglasov"
              description="Brez monitorjev ali cron-a se oglasi ne bodo scrapali. Ustvari monitor in ga poženi, ali nastavi cron za avtomatsko scraping."
              actionHref={{
                label: 'Ustvari monitor',
                href: '/?view=monitors',
              }}
              actionHref2={{
                label: 'Išči v Iskalniku',
                href: '/?view=iskalnik',
              }}
            />
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
                buyScore={buyScoreMap[l.id] ?? null}
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
              <Button size="sm" variant="outline" onClick={() => bulkAction('bookmark')} disabled={bulkLoading} aria-label="Zaznamuj izbrane oglase" className="gap-1.5 text-xs h-7">
                <Bookmark className="w-3 h-3" /> Priljubljeni
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('contact')} disabled={bulkLoading} aria-label="Označi izbrane oglase kot kontaktirane" className="gap-1.5 text-xs h-7">
                📞 Kontaktiran
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('hide')} disabled={bulkLoading} aria-label="Skrij izbrane oglase" className="gap-1.5 text-xs h-7">
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

// ListingRow — v9.00: imported from ./listings/listing-row
// ListingDetailModal — v9.00: imported from ./listings/listingdetail-modal
// formatTimeAgo — v9.00: imported from ./listings/formattimeago
// CompareModal — v9.00: imported from ./listings/compare-modal
// CompareRow — v9.00: imported from ./listings/compare-row
