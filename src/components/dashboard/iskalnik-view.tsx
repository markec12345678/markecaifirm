'use client';

// v8.71: Iskalnik View — Targeted Item Search
// "Iščem VW Golf 5, 2020, max 15000€, Ljubljana" → najdi najcenejši, opis, kraj, cel oglas
// + "Iščem za nekoga" (proxy buying) — save search with person name

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, MapPin, Euro, Calendar, ExternalLink, Star, Shield, Save, Trash2, User, X, RefreshCw, TrendingDown, Filter, GitCompare, Check, Trophy, AlertTriangle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  description: string;
  detailDescription?: string;
  fullDescription: string;
  imageUrl: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  aiEstimatedValue: number | null;
  aiImageVerdict: string | null;
  previousPrice: number | null;
  priceDroppedAt: string | null;
  sellerName: string | null;
  buyScore: number | null;
  monitor?: { name: string; source: string; tags: string } | null;
}

interface SearchResponse {
  ok: boolean;
  total: number;
  totalBeforeLimit: number;
  results: SearchResult[];
  sortBy: string;
}

interface SavedRequest {
  id: string;
  searchFor: string;
  title: string;
  keywords: string;
  category: string;
  priceMin: number | null;
  priceMax: number | null;
  location: string;
  yearMin: number | null;
  yearMax: number | null;
  condition: string;
  sortBy: string;
  notes: string;
  isActive: boolean;
  lastRunAt: string | null; // v8.75
  newMatchesCount: number;  // v8.75
  createdAt: string;
}

const CATEGORIES = ['elektronika', 'avto', 'oblačila', 'obutev', 'orodje', 'pohištvo', 'nepremičnina', 'kolektorstvo', 'drugo'];

// v8.74: Platform source badge helpers
const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  bolha: { icon: '🇸🇮', label: 'Bolha', color: 'border-emerald-500/40 text-emerald-500' },
  nepremicnine: { icon: '🏠', label: 'Nepremičnine', color: 'border-blue-500/40 text-blue-500' },
  avtonet: { icon: '🚗', label: 'Avtonet', color: 'border-amber-500/40 text-amber-500' },
  salomon: { icon: '🛍️', label: 'Salomon', color: 'border-purple-500/40 text-purple-500' },
  vinted: { icon: '👕', label: 'Vinted', color: 'border-teal-500/40 text-teal-500' },
  'mobile-de': { icon: '🇩🇪', label: 'Mobile.de', color: 'border-yellow-500/40 text-yellow-500' },
  kleinanzeigen: { icon: '🇩🇪', label: 'Kleinanzeigen', color: 'border-yellow-500/40 text-yellow-500' },
  subito: { icon: '🇮🇹', label: 'Subito', color: 'border-green-500/40 text-green-500' },
  willhaben: { icon: '🇦🇹', label: 'Willhaben', color: 'border-red-500/40 text-red-500' },
  quoka: { icon: '🇩🇪', label: 'Quoka', color: 'border-yellow-500/40 text-yellow-500' },
  'custom-rss': { icon: '📡', label: 'RSS', color: 'border-muted text-muted-foreground' },
};

function sourceIcon(source: string): string {
  return SOURCE_META[source]?.icon ?? '📋';
}

function sourceColor(source: string): string {
  return SOURCE_META[source]?.color ?? 'border-muted text-muted-foreground';
}

// v8.75: Time ago helper
function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'zdaj';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min nazaj`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h nazaj`;
  const days = Math.floor(hours / 24);
  return `${days}d nazaj`;
}

export function IskalnikView() {
  // Search form state
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [location, setLocation] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [verdict, setVerdict] = useState('');
  const [sortBy, setSortBy] = useState<'cheapest' | 'best_score' | 'newest' | 'closest' | 'price_drop'>('cheapest');
  const [searchFor, setSearchFor] = useState('');

  // Results state
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // v8.76: Match viewer state — when user clicks a saved search with new matches
  const [matchResults, setMatchResults] = useState<any[]>([]);
  const [matchViewing, setMatchViewing] = useState<string | null>(null); // buyRequestId being viewed
  const [matchLoading, setMatchLoading] = useState(false);

  // Saved requests state
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveSearchFor, setSaveSearchFor] = useState('');
  const [saveNotes, setSaveNotes] = useState('');

  // Expanded listing detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // v8.72: Multi-select for comparison
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // Load saved requests on mount
  useEffect(() => {
    fetch('/api/buy-requests').then(r => r.json()).then(d => {
      if (d?.ok) setSavedRequests(d.requests || []);
    }).catch(() => {});
  }, []);

  const buildSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (location.trim()) params.set('location', location.trim());
    if (yearMin) params.set('yearMin', yearMin);
    if (yearMax) params.set('yearMax', yearMax);
    if (verdict) params.set('verdict', verdict);
    params.set('sortBy', sortBy);
    return params;
  }, [query, category, priceMin, priceMax, location, yearMin, yearMax, verdict, sortBy]);

  const search = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const params = buildSearchParams();
      const res = await fetch(`/api/search/items?${params.toString()}`);
      const data: SearchResponse = await res.json();
      if (data.ok) {
        setResults(data.results);
        setTotalFound(data.totalBeforeLimit);
        if (data.results.length === 0) {
          toast.info('Ni rezultatov. Poskusi širite kriterije.');
        } else {
          toast.success(`✓ Najdenih ${data.results.length} oglasov`);
        }
      } else {
        toast.error('Napaka pri iskanju');
      }
    } catch {
      toast.error('Napaka pri iskanju');
    } finally {
      setLoading(false);
    }
  }, [buildSearchParams]);

  const reset = () => {
    setQuery(''); setCategory(''); setPriceMin(''); setPriceMax('');
    setLocation(''); setYearMin(''); setYearMax(''); setVerdict('');
    setSortBy('cheapest'); setSearchFor('');
    setResults([]); setHasSearched(false);
  };

  // v8.76: Load saved search criteria into form
  const applySavedRequest = (req: SavedRequest) => {
    setQuery(req.title);
    setCategory(req.category);
    setPriceMin(req.priceMin?.toString() ?? '');
    setPriceMax(req.priceMax?.toString() ?? '');
    setLocation(req.location);
    setYearMin(req.yearMin?.toString() ?? '');
    setYearMax(req.yearMax?.toString() ?? '');
    setSortBy(req.sortBy as any || 'cheapest');
    setSearchFor(req.searchFor);
    // Clear match viewer
    setMatchViewing(null);
    setMatchResults([]);
    toast.info(`Naloženo: "${req.title}"${req.searchFor ? ` za ${req.searchFor}` : ''}`);
  };

  // v8.76: View matches for a saved search (shows listings that matched, not just criteria)
  const viewMatches = async (req: SavedRequest) => {
    setMatchLoading(true);
    setMatchViewing(req.id);
    try {
      const res = await fetch(`/api/buy-requests/${req.id}/matches`);
      const data = await res.json();
      if (data?.ok) {
        setMatchResults(data.matches || []);
        // Load criteria into form WITHOUT clearing match viewer (don't call applySavedRequest which resets matchViewing)
        setQuery(req.title);
        setCategory(req.category);
        setPriceMin(req.priceMin?.toString() ?? '');
        setPriceMax(req.priceMax?.toString() ?? '');
        setLocation(req.location);
        setYearMin(req.yearMin?.toString() ?? '');
        setYearMax(req.yearMax?.toString() ?? '');
        setSortBy(req.sortBy as any || 'cheapest');
        setSearchFor(req.searchFor);
        if (data.matches.length === 0) {
          toast.info('Ni najdenih ujemanj za to iskanje.');
        } else {
          toast.success(`✓ ${data.matches.length} ujemanj najdenih`);
        }
        // Refresh saved requests to reset newMatchesCount
        setSavedRequests(prev => prev.map(r => r.id === req.id ? { ...r, newMatchesCount: 0 } : r));
      }
    } catch {
      toast.error('Napaka pri nalaganju ujemanj');
    } finally {
      setMatchLoading(false);
    }
  };

  const saveCurrentAsRequest = async () => {
    if (!query.trim()) {
      toast.error('Vnesi iskalni niz pred shranjevanjem');
      return;
    }
    try {
      const res = await fetch('/api/buy-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: query.trim(),
          searchFor: saveSearchFor.trim(),
          category,
          priceMin: priceMin || null,
          priceMax: priceMax || null,
          location: location.trim(),
          yearMin: yearMin || null,
          yearMax: yearMax || null,
          sortBy,
          notes: saveNotes.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success('✓ Iskanje shranjeno');
        setSavedRequests([data.request, ...savedRequests]);
        setShowSaveDialog(false);
        setSaveTitle(''); setSaveSearchFor(''); setSaveNotes('');
      } else {
        toast.error('Napaka pri shranjevanju');
      }
    } catch {
      toast.error('Napaka');
    }
  };

  const deleteRequest = async (id: string) => {
    try {
      await fetch(`/api/buy-requests/${id}`, { method: 'DELETE' });
      setSavedRequests(savedRequests.filter(r => r.id !== id));
      toast.success('Izbrisano');
    } catch {
      toast.error('Napaka');
    }
  };

  const cheapestPrice = results.length > 0 && results[0].price != null
    ? Math.min(...results.map(r => r.price ?? Infinity))
    : null;

  // v8.72: Toggle selection for comparison
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 6) next.add(id);
      else toast.warning('Največ 6 listings za primerjavo');
      return next;
    });
  }, []);

  const runCompare = useCallback(async () => {
    if (selectedIds.size < 2) {
      toast.error('Izberi vsaj 2 listings za primerjavo');
      return;
    }
    setCompareLoading(true);
    setShowCompare(true);
    try {
      const res = await fetch('/api/search/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        setCompareData(data);
      } else {
        toast.error(data.error || 'Napaka pri primerjavi');
        setShowCompare(false);
      }
    } catch {
      toast.error('Napaka');
      setShowCompare(false);
    } finally {
      setCompareLoading(false);
    }
  }, [selectedIds]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Search className="w-5 h-5" />
            Iskalnik
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Išči po vseh oglasih z kriteriji — najdi najcenejši, najboljši buy score, najbližji kraj.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSaveSearchFor(searchFor); setShowSaveDialog(true); }}
            disabled={!query.trim()}
            className="gap-2"
          >
            <Save className="w-3.5 h-3.5" /> Shrani iskanje
          </Button>
          {/* v8.72: Compare button */}
          {selectedIds.size >= 2 && (
            <Button
              size="sm"
              onClick={runCompare}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <GitCompare className="w-3.5 h-3.5" /> Primerjaj ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* v8.72: Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary/5 border border-primary/30 rounded-md text-xs">
          <span className="text-primary font-medium">
            {selectedIds.size} {selectedIds.size === 1 ? 'listing izbran' : 'listingov izbranih'}
            {selectedIds.size < 2 && ' — izberi še vsaj 1 za primerjavo'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedIds(new Set())}>
              <X className="w-3 h-3" /> Počisti
            </Button>
            {selectedIds.size >= 2 && (
              <Button size="sm" onClick={runCompare} className="h-6 text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90">
                <GitCompare className="w-3 h-3" /> Primerjaj
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Search Form */}
      <Card className="bg-card/50">
        <CardContent className="p-4 space-y-3">
          {/* Main query */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase">Kaj iščeš? *</Label>
            <div className="flex gap-2">
              <Input
                placeholder="npr. VW Golf 5, iPhone 13 Pro, MacBook Air M1..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                className="flex-1"
              />
              <Button onClick={search} disabled={loading} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Išči
              </Button>
            </div>
          </div>

          {/* "Iščem za" — proxy buying */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase flex items-center gap-1"><User className="w-3 h-3" /> Iščem za (neobvezno)</Label>
            <Input
              placeholder="npr. Marko, Mama, Kolega — za koga iščeš?"
              value={searchFor}
              onChange={(e) => setSearchFor(e.target.value)}
              className="text-xs"
            />
          </div>

          {/* Filters grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Kategorija</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-8 text-xs w-full bg-card border border-border rounded px-2 cursor-pointer"
              >
                <option value="">Vse</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Cena min (€)</Label>
              <Input type="number" placeholder="0" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Cena max (€)</Label>
              <Input type="number" placeholder="5000" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Lokacija</Label>
              <Input placeholder="Ljubljana" value={location} onChange={(e) => setLocation(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Letnik min</Label>
              <Input type="number" placeholder="2018" value={yearMin} onChange={(e) => setYearMin(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Letnik max</Label>
              <Input type="number" placeholder="2023" value={yearMax} onChange={(e) => setYearMax(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">AI Verdict</Label>
              <select
                value={verdict}
                onChange={(e) => setVerdict(e.target.value)}
                className="h-8 text-xs w-full bg-card border border-border rounded px-2 cursor-pointer"
              >
                <option value="">Vsi</option>
                <option value="PRILIKA">🎯 Priložnost</option>
                <option value="SUMNJIVO">⚠️ Sumljivo</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Sortiraj po</Label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 text-xs w-full bg-card border border-border rounded px-2 cursor-pointer"
              >
                <option value="cheapest">💰 Najcenejši</option>
                <option value="best_score">🛒 Najboljši buy score</option>
                <option value="newest">📅 Najnovejši</option>
                <option value="closest">📍 Najbližji kraj</option>
                <option value="price_drop">📉 Padec cene</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={reset} className="text-xs gap-1">
              <X className="w-3 h-3" /> Počisti
            </Button>
            {totalFound > 0 && (
              <span className="text-xs text-muted-foreground">
                Najdenih <span className="font-bold text-foreground">{totalFound}</span> oglasov
                {cheapestPrice != null && (
                  <span className="ml-2 text-emerald-500">· najcenejši: <span className="font-bold">{cheapestPrice}€</span></span>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Saved Requests */}
      {savedRequests.length > 0 && (
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Save className="w-4 h-4 text-primary" /> Shranjena iskanja ({savedRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {savedRequests.map(r => (
              <div key={r.id} className={cn(
                'flex items-center gap-2 p-2 rounded-md border transition-colors',
                r.newMatchesCount > 0
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/50 hover:bg-accent/30'
              )}>
                <button
                  onClick={() => applySavedRequest(r)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-1.5">
                    {r.searchFor && <Badge variant="secondary" className="text-[9px]"><User className="w-2 h-2" /> {r.searchFor}</Badge>}
                    <span className="text-xs font-medium truncate">{r.title}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {[r.category, r.priceMin && `≥${r.priceMin}€`, r.priceMax && `≤${r.priceMax}€`, r.location, r.yearMin && `≥${r.yearMin}`].filter(Boolean).join(' · ') || 'Brez dodatnih filtrov'}
                    {r.lastRunAt && (
                      <span className="ml-1.5 text-muted-foreground/60">
                        · zadnjič: {timeAgo(r.lastRunAt)}
                      </span>
                    )}
                  </div>
                </button>
                {/* v8.76: "Prikaži ujemanja" button — shows matched listings */}
                {r.newMatchesCount > 0 ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 text-[10px] gap-1 bg-primary text-primary-foreground hover:bg-primary/90 animate-pulse"
                    onClick={() => viewMatches(r)}
                    disabled={matchLoading && matchViewing === r.id}
                  >
                    {matchLoading && matchViewing === r.id ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Eye className="w-2.5 h-2.5" />}
                    {r.newMatchesCount} novo
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-primary"
                    onClick={() => viewMatches(r)}
                    disabled={matchLoading && matchViewing === r.id}
                    title="Prikaži ujemanja"
                  >
                    {matchLoading && matchViewing === r.id ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Eye className="w-2.5 h-2.5" />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-400"
                  onClick={() => deleteRequest(r.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* v8.76: Match Results Panel — shows listings that matched a saved search */}
      {matchViewing && matchResults.length > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary" /> Ujemanja ({matchResults.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => { setMatchViewing(null); setMatchResults([]); }}
              >
                <X className="w-3 h-3" /> Zapri
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {matchResults.map((m, i) => {
              const l = m.listing;
              if (!l) return null;
              return (
                <div key={m.id} className="flex items-start gap-2 p-2 rounded-md border border-border/50 bg-card/50">
                  <div className={cn(
                    'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                    i === 0 ? 'bg-emerald-500/20 text-emerald-500' : 'bg-muted text-muted-foreground'
                  )}>
                    {i + 1}
                  </div>
                  {l.imageUrl && <img src={l.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{l.title}</span>
                      {l.price != null && <span className="text-sm font-bold text-emerald-500 font-mono shrink-0">{l.price}€</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                      {l.location && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {l.location}</span>}
                      {l.aiScore != null && <span className="text-primary">⭐ {l.aiScore}/10</span>}
                      {l.aiVerdict && <Badge variant="outline" className="text-[8px]">{l.aiVerdict}</Badge>}
                      {l.monitor?.source && (
                        <Badge variant="outline" className={cn('text-[8px] gap-0.5', sourceColor(l.monitor.source))}>
                          {sourceIcon(l.monitor.source)} {l.monitor.source}
                        </Badge>
                      )}
                      <span className="text-muted-foreground/60">· najdeno: {timeAgo(m.matchedAt)}</span>
                    </div>
                  </div>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-primary hover:text-primary/80">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {hasSearched && (
        <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-card animate-pulse rounded" />)}
            </div>
          ) : results.length === 0 ? (
            <Card className="bg-card/50">
              <CardContent className="p-8 text-center">
                <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">Ni najdenih oglasov za te kriterije.</p>
                <p className="text-xs text-muted-foreground mt-1">Poskusi širite iskalni niz ali zmanjšaj filtre.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {results.map((r, i) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  rank={i + 1}
                  expanded={expandedId === r.id}
                  onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  selected={selectedIds.has(r.id)}
                  onToggleSelect={() => toggleSelect(r.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shrani iskanje</DialogTitle>
            <DialogDescription>Shrani trenutne kriterije za kasnejšo uporabo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs uppercase">Iskalni niz</Label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase">Iščem za</Label>
              <Input
                placeholder="Oseba za kero iščeš (neobvezno)"
                value={saveSearchFor}
                onChange={(e) => setSaveSearchFor(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs uppercase">Opombe</Label>
              <Textarea
                placeholder="Dodatne informacije..."
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                className="mt-1 text-xs min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>Prekliči</Button>
            <Button onClick={saveCurrentAsRequest} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Save className="w-3.5 h-3.5" /> Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v8.72: Compare Dialog */}
      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-primary" /> Primerjava listingov
            </DialogTitle>
            <DialogDescription>
              {compareData?.summary ? `${compareData.summary.count} listings · cena ${compareData.summary.priceRange.min}€ - ${compareData.summary.priceRange.max}€ · avg buy score ${compareData.summary.avgBuyScore.toFixed(0)}` : 'Nalagam...'}
            </DialogDescription>
          </DialogHeader>
          {compareLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : compareData ? (
            <CompareContent data={compareData} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Napaka pri nalaganju primerjave.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompare(false)}>Zapri</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// v8.72: Compare Content — side-by-side table + AI advisor
function CompareContent({ data }: { data: any }) {
  const { compared, winner, cheapest, bestAI, advisorInsights, summary } = data;

  // Rows for the comparison table
  const rows: { label: string; getValue: (c: any) => React.ReactNode; highlight?: (c: any) => boolean }[] = [
    { label: 'Cena', getValue: c => <span className="font-mono font-bold">{c.price ?? '?'}€</span>, highlight: c => c.id === cheapest?.id },
    { label: 'Buy Score', getValue: c => <span className={c.buyScore >= 75 ? 'text-emerald-500 font-bold' : c.buyScore >= 55 ? 'text-primary' : 'text-amber-500'}>{c.buyScore} ({c.buyVerdict})</span>, highlight: c => c.id === winner?.id },
    { label: 'AI Score', getValue: c => c.aiScore != null ? `⭐ ${c.aiScore}/10` : '—', highlight: c => c.id === bestAI?.id },
    { label: 'AI Risk', getValue: c => c.aiRisk != null ? <span className={c.aiRisk >= 6 ? 'text-red-500' : c.aiRisk >= 4 ? 'text-amber-500' : 'text-emerald-500'}>🛡 {c.aiRisk}/10</span> : '—' },
    { label: 'AI Verdict', getValue: c => c.aiVerdict || '—' },
    { label: 'AI Ocena vrednosti', getValue: c => c.aiEstimatedValue != null ? `${c.aiEstimatedValue}€` : '—' },
    { label: 'Discount pod oceno', getValue: c => c.discountPercent != null && c.discountPercent > 0 ? <span className="text-emerald-500">-{c.discountPercent.toFixed(0)}%</span> : '—' },
    { label: 'Pričakovan ROI', getValue: c => c.expectedROI != null ? <span className="text-emerald-500">+{c.expectedROI.toFixed(0)}%</span> : '—' },
    { label: 'Letnik', getValue: c => c.year ?? '—' },
    { label: 'Lokacija', getValue: c => <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{c.location || '—'}</span> },
    { label: 'Prodajalec', getValue: c => c.sellerName || '—' },
    { label: 'Vir', getValue: c => c.monitor?.source || '—' },
    { label: 'Padec cene', getValue: c => c.priceDroppedAt != null ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">Da</Badge> : 'Ne' },
  ];

  return (
    <div className="space-y-4">
      {/* v8.72.2: Best of bad warning — if all candidates are weak (<35) */}
      {(() => {
        const allWeak = compared.every((c: any) => c.buyScore < 35);
        const allBelow55 = compared.every((c: any) => c.buyScore < 55);
        if (allWeak) {
          return (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-red-500">⚠️ Vsi kandidati so šibki (buy score &lt; 35).</span>{' '}
                <span className="text-foreground/80">AI ne priporoča nakupa nobenega. Razširi kriterije iskanja ali počakaj na boljše oglase.</span>
              </div>
            </div>
          );
        }
        if (allBelow55) {
          return (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-amber-600">🟡 Noben kandidat ni "BUY" (≥55).</span>{' '}
                <span className="text-foreground/80">Winner je najboljši med zmernimi možnostmi — premisli ali nakup splača.</span>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* AI Advisor insights */}
      <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 space-y-1.5">
        <div className="text-xs uppercase text-primary font-bold flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" /> AI Buy Advisor
        </div>
        {advisorInsights.map((insight: string, i: number) => {
          const isWarning = insight.includes('⚠️');
          return (
            <div key={i} className="text-xs flex items-start gap-1.5">
              {isWarning ? <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" /> : <span className="text-primary mt-0.5">→</span>}
              <span className="text-foreground/80">{insight}</span>
            </div>
          );
        })}
      </div>

      {/* Winner highlight — v8.72.2: distinguishes relative winner from absolute recommendation */}
      {winner && (() => {
        // v8.72.2: Absolute recommendation based on buy score threshold
        // Winner = "best among selected" (relative). Absolute = "should you actually buy?"
        const score = winner.buyScore;
        let absRec: { label: string; cls: string; icon: string };
        if (score >= 75) {
          absRec = { label: 'STRONG BUY', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40', icon: '🟢' };
        } else if (score >= 55) {
          absRec = { label: 'BUY', cls: 'bg-primary/10 text-primary border-primary/30', icon: '✓' };
        } else if (score >= 35) {
          absRec = { label: 'BUY WITH CAUTION', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30', icon: '🟡' };
        } else {
          absRec = { label: 'AVOID — best of bad options', cls: 'bg-red-500/10 text-red-500 border-red-500/30', icon: '✗' };
        }
        // Confidence label
        const conf = winner.confidenceLabel || 'LOW';
        const confCls = conf === 'HIGH' ? 'text-emerald-500' : conf === 'MEDIUM' ? 'text-amber-500' : 'text-muted-foreground';
        // Winner card color depends on absolute recommendation
        const cardCls = score >= 55
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : score >= 35
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-red-500/10 border-red-500/30';
        return (
          <div className={cn('border rounded-lg p-3', cardCls)}>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className={score >= 55 ? 'w-4 h-4 text-emerald-500' : score >= 35 ? 'w-4 h-4 text-amber-500' : 'w-4 h-4 text-red-500'} />
                <span className="text-sm font-bold">
                  {score >= 35 ? '🏆 Najboljša vrednost' : '⚠️ Najmanj slaba možnost'}
                </span>
              </div>
              {/* v8.72.2: Absolute Recommendation badge */}
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border', absRec.cls)}>
                {absRec.icon} {absRec.label}
              </span>
            </div>
            <div className="text-sm font-medium">{winner.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{winner.price}€ · buy score {winner.buyScore}/100 · {winner.location}</span>
              <span className={cn('text-[10px]', confCls)}>· Confidence: {conf}</span>
            </div>
            <p className="text-xs text-foreground/80 mt-1.5 italic">{winner.recommendation}</p>
            {/* v8.72.2: Clarification — relative vs absolute */}
            <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/30">
              ℹ️ "Winner" = najboljši med izbranimi kandidati. Absolutno priporočilo glede na buy score.
              {score < 55 && ' To ni objektivno dober nakup — premisli ali sploh kupovati.'}
            </div>
          </div>
        );
      })()}

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-2 text-muted-foreground uppercase text-[10px]">Kriterij</th>
              {compared.map((c: any) => (
                <th key={c.id} className={cn(
                  'text-left p-2 min-w-[140px] align-top',
                  c.id === winner?.id && 'bg-emerald-500/10'
                )}>
                  <div className="flex items-start gap-1.5">
                    {c.imageUrl && <img src={c.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate" title={c.title}>{c.title}</div>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                        <ExternalLink className="w-2 h-2" /> Odpri
                      </a>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="p-2 text-muted-foreground text-[10px] uppercase">{row.label}</td>
                {compared.map((c: any) => (
                  <td key={c.id} className={cn(
                    'p-2',
                    row.highlight?.(c) && 'bg-emerald-500/10 font-medium'
                  )}>
                    {row.getValue(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Število</div>
          <div className="font-bold">{summary.count}</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Cena min</div>
          <div className="font-bold text-emerald-500">{summary.priceRange.min}€</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Cena max</div>
          <div className="font-bold text-amber-500">{summary.priceRange.max}€</div>
        </div>
        <div className="bg-muted/20 rounded p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Avg buy score</div>
          <div className="font-bold text-primary">{summary.avgBuyScore.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, rank, expanded, onToggle, selected, onToggleSelect }: { result: SearchResult; rank: number; expanded: boolean; onToggle: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const verdictColor =
    result.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    result.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* v8.72: Selection checkbox */}
          {onToggleSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className={cn(
                'shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors',
                selected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-card border-border hover:border-primary/50'
              )}
              title={selected ? 'Odstrani iz primerjave' : 'Dodaj v primerjavo'}
            >
              {selected && <Check className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Rank badge */}
          <div className={cn(
            'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
            rank === 1 ? 'bg-emerald-500/20 text-emerald-500' :
            rank === 2 ? 'bg-primary/15 text-primary' :
            rank === 3 ? 'bg-amber-500/15 text-amber-500' :
            'bg-muted text-muted-foreground'
          )}>
            {rank}
          </div>

          {/* Image */}
          {result.imageUrl ? (
            <img src={result.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-muted shrink-0" loading="lazy" />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm truncate">{result.title}</h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {result.price != null && (
                    <span className="text-base font-bold text-emerald-500 font-mono">{result.price}€</span>
                  )}
                  {result.aiEstimatedValue != null && result.aiEstimatedValue !== result.price && (
                    <span className="text-[10px] text-muted-foreground line-through">{result.aiEstimatedValue}€ ocena</span>
                  )}
                  {result.previousPrice != null && result.previousPrice > (result.price ?? 0) && (
                    <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500">
                      <TrendingDown className="w-2.5 h-2.5" /> {result.previousPrice}€ → {result.price}€
                    </Badge>
                  )}
                </div>
              </div>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-primary hover:text-primary/80"
                title="Odpri oglas"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1.5 flex-wrap">
              {result.location && (
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {result.location}</span>
              )}
              {result.firstSeenAt && (
                <span className="flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" /> {new Date(result.firstSeenAt).toLocaleDateString('sl-SI')}</span>
              )}
              {result.aiScore != null && (
                <span className="flex items-center gap-0.5 text-primary"><Star className="w-2.5 h-2.5" /> {result.aiScore}/10</span>
              )}
              {result.aiRisk != null && (
                <span className="flex items-center gap-0.5 text-amber-400"><Shield className="w-2.5 h-2.5" /> {result.aiRisk}/10</span>
              )}
              {result.buyScore != null && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] font-bold',
                  result.buyScore >= 75 ? 'bg-emerald-500/15 text-emerald-500' :
                  result.buyScore >= 55 ? 'bg-primary/10 text-primary' :
                  result.buyScore >= 35 ? 'bg-amber-500/10 text-amber-600' :
                  'bg-red-500/10 text-red-500'
                )}>🛒 {result.buyScore}</span>
              )}
              {result.aiVerdict && (
                <Badge variant="outline" className={cn('text-[9px]', verdictColor)}>{result.aiVerdict}</Badge>
              )}
              {result.monitor?.source && (
                <Badge variant="outline" className={cn('text-[9px] gap-0.5', sourceColor(result.monitor.source))}>
                  {sourceIcon(result.monitor.source)} {result.monitor.source}
                </Badge>
              )}
            </div>

            {/* Description preview */}
            {result.description && !expanded && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{result.description}</p>
            )}

            {/* Expanded detail */}
            {expanded && (
              <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground">Cel opis oglasa:</span>
                  <p className="text-[11px] text-foreground/80 whitespace-pre-wrap mt-0.5">
                    {result.fullDescription || result.description || 'Brez opisa'}
                  </p>
                </div>
                {result.aiReason && (
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">AI razlog:</span>
                    <p className="text-[11px] text-foreground/70 italic mt-0.5">{result.aiReason}</p>
                  </div>
                )}
                {result.sellerName && (
                  <div className="text-[10px] text-muted-foreground">
                    Prodajalec: <span className="text-foreground">{result.sellerName}</span>
                    {result.monitor?.name && ` · ${result.monitor.name}`}
                  </div>
                )}
              </div>
            )}

            {/* Toggle button */}
            <button
              onClick={onToggle}
              className="text-[10px] text-primary hover:text-primary/80 mt-1.5"
            >
              {expanded ? '↑ Skrči' : '↓ Prikaži cel oglas'}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
