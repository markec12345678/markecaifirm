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

import type { SearchResult, SearchResponse, SavedRequest } from './iskalnik/types';
import { CATEGORIES, SOURCE_META, sourceIcon, sourceColor, timeAgo } from './iskalnik/utils';
import { CompareContent } from './iskalnik/compare-content';
import { ResultCard } from './iskalnik/result-card';

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

  // v8.77: Deep link — ?matchRequestId=xxx auto-opens match panel
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const matchRequestId = url.searchParams.get('matchRequestId');
    if (!matchRequestId) return;
    // Find the saved request
    const req = savedRequests.find(r => r.id === matchRequestId);
    if (!req) return;
    // Directly fetch matches and show them
    (async () => {
      setMatchLoading(true);
      setMatchViewing(req.id);
      try {
        const res = await fetch(`/api/buy-requests/${req.id}/matches`);
        const data = await res.json();
        if (data?.ok) {
          setMatchResults(data.matches || []);
          setQuery(req.title);
          setCategory(req.category);
          setPriceMin(req.priceMin?.toString() ?? '');
          setPriceMax(req.priceMax?.toString() ?? '');
          setLocation(req.location);
          setYearMin(req.yearMin?.toString() ?? '');
          setYearMax(req.yearMax?.toString() ?? '');
          setSortBy(req.sortBy as any || 'cheapest');
          setSearchFor(req.searchFor);
          if (data.matches.length > 0) {
            toast.success(`✓ ${data.matches.length} ujemanj najdenih`);
          }
          setSavedRequests(prev => prev.map(r => r.id === req.id ? { ...r, newMatchesCount: 0 } : r));
        }
      } catch {
        toast.error('Napaka pri nalaganju ujemanj');
      } finally {
        setMatchLoading(false);
      }
    })();
    // Clean URL
    url.searchParams.delete('matchRequestId');
    window.history.replaceState({}, '', url.toString());
   
  }, [savedRequests]);

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
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedIds(new Set())} aria-label="Počisti izbiro vseh oglasov">
              <X className="w-3 h-3" /> Počisti
            </Button>
            {selectedIds.size >= 2 && (
              <Button size="sm" onClick={runCompare} className="h-6 text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90" aria-label="Primerjaj izbrane oglase">
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
                aria-label="Iskalni niz — vnesi artikel za iskanje"
              />
              <Button onClick={search} disabled={loading} aria-label="Išči oglase" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
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
            <Button variant="ghost" size="sm" onClick={reset} aria-label="Počisti iskalne filtre" className="text-xs gap-1">
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
                  aria-label={`Naloži iskanje: ${r.title}`}
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
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} aria-label="Prekliči shranjevanje iskanja">Prekliči</Button>
            <Button onClick={saveCurrentAsRequest} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90" aria-label="Shrani trenutno iskanje">
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
            <Button variant="outline" onClick={() => setShowCompare(false)} aria-label="Zapri primerjavo oglasov">Zapri</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// v8.72: Compare Content — side-by-side table + AI advisor
// CompareContent — v9.06: imported from ./iskalnik/compare-content
// ResultCard — v9.06: imported from ./iskalnik/result-card
