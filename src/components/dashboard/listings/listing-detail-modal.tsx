'use client';

// v9.00: ListingDetailModal — extracted from listings-view.tsx.

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target, MapPin, Clock, Bookmark, Sparkles, ShoppingCart, BarChart3, TrendingDown, TrendingUp, Copy, Check, GitCompare, Trash2, EyeOff, Zap, User, Wallet, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SentimentPanel } from '@/components/dashboard/listing-detail/sentiment-panel';
import { AuctionSniperPanel } from '@/components/dashboard/listing-detail/auction-sniper-panel';
import { FraudDetectionPanel } from '@/components/dashboard/listing-detail/fraud-detection-panel';
import { ImageAnalysisPanel } from '@/components/dashboard/listing-detail/image-analysis-panel';
import { NegotiationPanel } from '@/components/dashboard/listing-detail/negotiation-panel';
import { PriceHistoryPanel } from '@/components/dashboard/listing-detail/price-history-panel';
import { SellerIntelligencePanel } from '@/components/dashboard/listing-detail/seller-intelligence-panel';
import { MakeOfferPanel } from '@/components/dashboard/listing-detail/make-offer-panel';
import { SoldCompsPanel } from '@/components/dashboard/listing-detail/sold-comps-panel';
import { QuickBuyButton } from '@/components/dashboard/listing-detail/quick-buy-button';
import { ListingActionsBar } from '@/components/dashboard/listing-detail/listing-actions-bar';
import type { Listing, ListingsResponse, Monitor, BuyScore } from './types';
import { formatTimeAgo } from './utils';


export function ListingDetailModal({ listingId, onClose }: { listingId: string | null; onClose: () => void }) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingDetail, setFetchingDetail] = useState(false);
  const [togglingBookmark, setTogglingBookmark] = useState(false);
  const [addingToTrade, setAddingToTrade] = useState(false);
  // v6.98: Negotiator + Playbook + Outcome + Chatbot so v NegotiationPanel (lastni state)
  // v6.99: notes + contactStatus + sellerResponse so v ListingActionsBar (lastni state)
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
  const [bidResult, setBidResult] = useState<Record<string, any> | null>(null);
  const [bidStrategy, setBidStrategy] = useState<'aggressive' | 'moderate' | 'conservative'>('moderate');
  const [bidMaxBudget, setBidMaxBudget] = useState('');
  const [bidCopied, setBidCopied] = useState(false);
  // v5.1: Price prediction
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<Record<string, any> | null>(null);
  const [predictTarget, setPredictTarget] = useState('');
  // v6.97: refurb + imageQuality + descOpt so v ImageAnalysisPanel
  // v5.1: Seller reputation
  const [sellerRep, setSellerRep] = useState<Record<string, any> | null>(null);
  const [sellerLoading, setSellerLoading] = useState(false);
  // v5.6: External price comparison
  const [extCompare, setExtCompare] = useState<Record<string, any> | null>(null);
  const [extCompareLoading, setExtCompareLoading] = useState(false);
  // v5.7: AI similar listings
  const [similarListings, setSimilarListings] = useState<any[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  // v6.0: AI listing enrichment
  const [enrichment, setEnrichment] = useState<Record<string, any> | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  // v6.2: AI Flip Score
  const [flipScore, setFlipScore] = useState<Record<string, any> | null>(null);
  const [flipLoading, setFlipLoading] = useState(false);
  // v6.2: Market Saturation
  const [saturation, setSaturation] = useState<Record<string, any> | null>(null);
  const [satLoading, setSatLoading] = useState(false);
  // v6.2: ROI Calculator
  const [roiResult, setRoiResult] = useState<Record<string, any> | null>(null);
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
      // v6.99: notes + contactStatus + sellerResponse so v ListingActionsBar (lastni state, sync z initial*)
      // v4.5: Load target price
      setTargetPrice(d.listing?.targetPrice != null ? String(d.listing.targetPrice) : '');
      // v4.8: Reset comparison results when loading new listing
      setCompareResults([]);
      // v5.0: Reset bid result
      setBidResult(null);
      // v5.1: Reset prediction
      setPrediction(null);
      setPredictTarget(d.listing?.targetPrice != null ? String(d.listing.targetPrice) : '');
      // v6.98: NegotiationPanel ima svoj state (playbook + outcome + chatbot + negotiator)
      // v6.97: refurb + imageQuality + descOpt so v ImageAnalysisPanel (lastni state)
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

  // v6.98: generateMessage in copyMessage sta v NegotiationPanel (lastni state)

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

  // v6.99: saveNotes + updateContact + saveSellerResponse so v ListingActionsBar (lastni state + funkcije)

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
        const ok = data.results.filter((r: Record<string, any>) => r.ok).length;
        toast.success(`Primerjava končana: ${ok}/${data.results.length} modelov uspešnih`);
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
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
      const body: Record<string, unknown> = { strategy: bidStrategy };
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
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
                        const best = valid.reduce((a: Record<string, any>, b: any) =>
                          (a.evaluation.ocena_prilike - a.evaluation.ocena_tveganja) >
                          (b.evaluation.ocena_prilike - b.evaluation.ocena_tveganja) ? a : b
                        );
                        const fastest = valid.reduce((a: Record<string, any>, b: any) => a.durationMs < b.durationMs ? a : b);
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
                          {sellerRep.topListings.map((l: Record<string, any>) => (
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
                        {prediction.prediction.projectedPrices.map((p: Record<string, any>, i: number) => {
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
                    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                      } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                      } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                      } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                      } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                        {extCompare.comparisons.map((c: Record<string, any>, i: number) => {
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
                    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
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
                  {similarListings.slice(0, 8).map((s: Record<string, any>, i: number) => (
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

            {/* v7.34: Price History Panel — chart + buy recommendation (Keepa-style) */}
            {listing.price != null && (
              <PriceHistoryPanel listingId={listing.id} />
            )}

            {/* v7.34: Seller Intelligence — reputation + risk assessment */}
            {listing.sellerName && (
              <SellerIntelligencePanel sellerName={listing.sellerName} />
            )}

            {/* v7.35: Make Offer — 1-click AI offer generator */}
            <MakeOfferPanel
              listingId={listing.id}
              listingUrl={listing.url}
              listingTitle={listing.title}
              askingPrice={listing.price}
            />

            {/* v7.37: Sold Comps — "za koliko so se podobni prodali?" (Keepa-style) */}
            <SoldCompsPanel
              listingId={listing.id}
              title={listing.title}
              askingPrice={listing.price}
            />

            {/* v7.38: Quick Buy — 1-click "Kupil" → instant Trade creation */}
            <QuickBuyButton
              listingId={listing.id}
              buyPrice={listing.price}
              estValue={listing.aiEstimatedValue}
            />

            {/* v1.4: Price history (text log) */}
            {priceHistory.length > 1 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  📈 Zgodovina cene ({priceHistory.length} {priceHistory.length === 1 ? 'zapisek' : 'zapiskov'})
                </h4>
                <div className="space-y-1">
                  {priceHistory.map((ph: Record<string, any>, i: number) => {
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
                  {similar.map((s: Record<string, any>) => (
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

            {/* v6.99: ListingActionsBar — združuje Notes + Contact Tracker (prej 57 vrstic inline) */}
            <ListingActionsBar
              listingId={listing.id}
              initialContactStatus={listing.contactStatus}
              initialSellerResponse={listing.sellerResponse}
              initialNotes={listing.userNotes}
            />

            {/* v3.8: Quick sell — mark as sold and add to Skladišče */}
            {listing.trades && listing.trades.length > 0 && listing.trades.some((t: Record<string, any>) => t.status === 'held') && (
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
                      const trade = listing.trades.find((t: Record<string, any>) => t.status === 'held');
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

            {/* v6.98: NegotiationPanel — združuje Negotiator + Playbook + Outcome + Chatbot (4 v 1, prej 580 vrstic inline) */}
            <NegotiationPanel listingId={listing.id} price={listing.price} />

            {/* v6.95: AuctionSniperPanel — izvlečen v samostojno komponento (prej 138 vrstic inline) */}
            <AuctionSniperPanel listingId={listing.id} />

            {/* v6.96: FraudDetectionPanel — združuje fraud-detection + fake-detection + reverse-image-search (prej 434 vrstic inline) */}
            <FraudDetectionPanel listingId={listing.id} imageUrl={listing.imageUrl} />


            {/* v6.97: ImageAnalysisPanel — združuje image-quality + description-optimizer + refurbishment-cost (prej 396 vrstic inline) */}
            <ImageAnalysisPanel
              listingId={listing.id}
              imageUrl={listing.imageUrl}
              title={listing.title}
              description={listing.description}
              detailDescription={listing.detailDescription}
              source={listing.monitor?.source}
              price={listing.price}
            />

            {/* v6.95: SentimentPanel — izvlečen v samostojno komponento (prej 117 vrstic inline) */}
            <SentimentPanel listingId={listing.id} />


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
            <NegotiationHistory listingId={listing.id} aiMessage={null} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

