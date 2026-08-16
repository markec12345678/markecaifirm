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
import { Search, MapPin, Euro, Calendar, ExternalLink, Star, Shield, Save, Trash2, User, X, RefreshCw, TrendingDown, Filter } from 'lucide-react';
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
  createdAt: string;
}

const CATEGORIES = ['elektronika', 'avto', 'oblačila', 'obutev', 'orodje', 'pohištvo', 'nepremičnina', 'kolektorstvo', 'drugo'];

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

  // Saved requests state
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveSearchFor, setSaveSearchFor] = useState('');
  const [saveNotes, setSaveNotes] = useState('');

  // Expanded listing detail
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    toast.info(`Naloženo: "${req.title}"${req.searchFor ? ` za ${req.searchFor}` : ''}`);
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSaveSearchFor(searchFor); setShowSaveDialog(true); }}
          disabled={!query.trim()}
          className="gap-2"
        >
          <Save className="w-3.5 h-3.5" /> Shrani iskanje
        </Button>
      </div>

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
              <div key={r.id} className="flex items-center gap-2 p-2 rounded-md border border-border/50 hover:bg-accent/30 transition-colors">
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
                  </div>
                </button>
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
    </div>
  );
}

function ResultCard({ result, rank, expanded, onToggle }: { result: SearchResult; rank: number; expanded: boolean; onToggle: () => void }) {
  const verdictColor =
    result.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    result.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
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
                <span className="text-muted-foreground">{result.monitor.source}</span>
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
