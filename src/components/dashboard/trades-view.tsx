'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, Wallet, Target, ShoppingCart, Tag, Download, Sparkles, Flame, Upload } from 'lucide-react';
import { FlipChecklist } from '@/components/dashboard/flip-checklist';
import { TagsInput } from '@/components/ui/tags-input';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { triggerGlobalRefresh } from '@/hooks/use-global-refresh';
import { useDebounce } from '@/hooks/use-debounce';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useHaptic } from '@/hooks/use-haptic';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, LineChart, Line,
} from 'recharts';

import { CATEGORIES, parseTagsLocal } from './trades/utils';
import type { Trade, TradeStats, SavedViewFilters, SavedView } from './trades/types';
import { StatBox } from './trades/stat-box';
import { TradeRow } from './trades/trade-row';
import { TradeFormDialog } from './trades/trade-form-dialog';
import { CsvImportDialog } from './trades/csv-import-dialog';
import { AIPortfolioAnalysis } from './trades/ai-portfolio-analysis';
import { AutoReprice } from './trades/auto-reprice';
import { AutoListingGeneratorCard } from './trades/auto-listing-generator-card';
import { MultiPlatformSyncCard } from './trades/multi-platform-sync-card';
import { AgingAlerts } from './trades/aging-alerts';
import { RestockRecommendations } from './trades/restock-recommendations';
import { AIExitStrategyCard } from './trades/ai-exit-strategy-card';
import { AIBundleOptimizer } from './trades/ai-bundle-optimizer';
import { AILiquidationStrategy } from './trades/ai-liquidation-strategy';
import { AIListingGenerator } from './trades/ai-listing-generator';
import { TaxLossHarvesting } from './trades/tax-loss-harvesting';
import { MultiVendorBundle } from './trades/multi-vendor-bundle';
import { OptimalTimePredictor } from './trades/optimal-time-predictor';
import { TitleABTester } from './trades/title-ab-tester';
import { BuyerPersonaGenerator } from './trades/buyer-persona-generator';
import { CrossPlatformPriceComparison } from './trades/cross-platform-price-comparison';
import { InventoryDepreciation } from './trades/inventory-depreciation';
import { ListingPerformanceTracker } from './trades/listing-performance-tracker';

export function TradesView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  // v8.55: Search + Sort + Category/Source filters
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300); // v8.58: debounce search
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'profit_desc' | 'profit_asc' | 'roi_desc' | 'roi_asc' | 'title_asc' | 'price_desc' | 'priority_desc' | 'outcome_desc'>('date_desc');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string>('all'); // v8.63
  // v6.3: Auto-listing generator (state set from per-trade actions; card extracted)
  const [generatedListing, setGeneratedListing] = useState<any>(null);
  // v6.5: Multi-platform sync (state set from TradeRow onSync callback; card extracted)
  const [syncData, setSyncData] = useState<any>(null);
  const [syncLoading, setSyncLoading] = useState<string | null>(null);
  // v6.9: AI Exit Strategy (state set from TradeRow onExit + priority card button; card extracted)
  const [exitData, setExitData] = useState<any>(null);
  const [exitLoading, setExitLoading] = useState<string | null>(null);
  // v8.65: Sell Priority — per-held-trade urgency score 0-100
  const [priorityMap, setPriorityMap] = useState<Record<string, { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW'; daysHeld: number; reasons: string[]; recommendedAction: string }>>({});
  const [priorityLoading, setPriorityLoading] = useState(false);
  // v8.66: Smart Pricing — per-held-trade suggested sell price
  const [priceMap, setPriceMap] = useState<Record<string, { suggestedMin: number; suggestedMax: number; suggestedOptimal: number; expectedProfit: number; expectedROI: number; confidence: number; confidenceLabel: 'HIGH' | 'MEDIUM' | 'LOW'; reasoning: string[]; comparablesCount: number }>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  // v8.67: Outcome Score — per-sold-trade post-sale quality analysis
  const [outcomeMap, setOutcomeMap] = useState<Record<string, { overallScore: number; verdict: 'PERFECT' | 'GOOD' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'LOSS'; leftOnTable: number; pricingScore: number; timingScore: number; outcomeScore: number; lessons: string[]; reasoning: string[] }>>({});
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  // v5.7: Bulk trade operations
  const [bulkTradeIds, setBulkTradeIds] = useState<Set<string>>(new Set());
  const [bulkTradeLoading, setBulkTradeLoading] = useState(false);
  const [bulkSellPrice, setBulkSellPrice] = useState('');
  // v8.36: CSV Import dialog
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tradesRes, statsRes] = await Promise.all([
        fetch('/api/trades'),
        fetch('/api/trades/stats'),
      ]);
      if (tradesRes.ok) setTrades(await tradesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      toast.error('Ne morem naložiti tradov');
    } finally {
      setLoading(false);
    }
  }, []);

  // v5.4: AI Portfolio analysis — extracted to ./trades/ai-portfolio-analysis (self-contained component with its own fetch + button + card).

  useEffect(() => { load(); }, [load]);

  // v8.65: Fetch sell priority for held trades (auto-refresh)
  const loadPriority = useCallback(async () => {
    setPriorityLoading(true);
    try {
      const res = await fetch('/api/analytics/sell-priority');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          const map: Record<string, { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW'; daysHeld: number; reasons: string[]; recommendedAction: string }> = {};
          for (const r of [...data.highPriority, ...data.mediumPriority, ...data.lowPriority]) {
            map[r.tradeId] = {
              score: r.score,
              level: r.level,
              daysHeld: r.daysHeld,
              reasons: r.reasons?.map((rr: any) => rr.label) ?? [],
              recommendedAction: r.recommendedAction,
            };
          }
          setPriorityMap(map);
        }
      }
    } catch { /* non-critical */ }
    finally { setPriorityLoading(false); }
  }, []);

  useEffect(() => { loadPriority(); }, [loadPriority]);
  // Re-fetch priority when trades change (after add/sell/delete)
  useEffect(() => {
    if (trades.length > 0) {
      const heldIds = trades.filter(t => t.status === 'held').map(t => t.id);
      if (heldIds.some(id => !priorityMap[id])) loadPriority();
    }
     
  }, [trades]);

  // v8.66: Fetch smart prices for held trades (auto-refresh)
  const loadPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      const res = await fetch('/api/analytics/smart-pricing');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && Array.isArray(data.results)) {
          const map: Record<string, any> = {};
          for (const r of data.results) {
            map[r.tradeId] = {
              suggestedMin: r.suggestedMin,
              suggestedMax: r.suggestedMax,
              suggestedOptimal: r.suggestedOptimal,
              expectedProfit: r.expectedProfit,
              expectedROI: r.expectedROI,
              confidence: r.confidence,
              confidenceLabel: r.confidenceLabel,
              reasoning: r.reasoning?.map((rr: any) => rr.label) ?? [],
              comparablesCount: r.comparables?.length ?? 0,
            };
          }
          setPriceMap(map);
        }
      }
    } catch { /* non-critical */ }
    finally { setPriceLoading(false); }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  // v8.67: Fetch outcome scores for sold trades (auto-refresh)
  const loadOutcomes = useCallback(async () => {
    setOutcomeLoading(true);
    try {
      const res = await fetch('/api/analytics/outcome-score');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          // Fetch per-trade outcomes (batch the requests)
          const soldIds = trades.filter(t => t.status === 'sold').map(t => t.id);
          const map: Record<string, any> = {};
          // The summary endpoint gives aggregates; we need per-trade.
          // Make individual requests in parallel (max 5 at a time).
          const chunks: string[][] = [];
          for (let i = 0; i < soldIds.length; i += 5) {
            chunks.push(soldIds.slice(i, i + 5));
          }
          for (const chunk of chunks) {
            const results = await Promise.all(
              chunk.map(id => fetch(`/api/analytics/outcome-score?tradeId=${id}`).then(r => r.json()).catch(() => null))
            );
            for (const r of results) {
              // Single endpoint returns OutcomeResult directly (with tradeId), not wrapped in {ok: true}
              if (r && r.tradeId && r.verdict) {
                map[r.tradeId] = {
                  overallScore: r.overallScore,
                  verdict: r.verdict,
                  leftOnTable: r.leftOnTable,
                  pricingScore: r.pricingScore,
                  timingScore: r.timingScore,
                  outcomeScore: r.outcomeScore,
                  lessons: r.lessons ?? [],
                  reasoning: r.reasoning?.map((rr: any) => rr.label) ?? [],
                };
              }
            }
          }
          setOutcomeMap(map);
        }
      }
    } catch { /* non-critical */ }
    finally { setOutcomeLoading(false); }
   
  }, [trades]);

  useEffect(() => { loadOutcomes(); }, [loadOutcomes]);

  // v5.7: Bulk trade operations
  const bulkSell = async () => {
    if (bulkTradeIds.size === 0 || !bulkSellPrice.trim()) {
      toast.error('Izberi tradee in vnesi prodajno ceno');
      return;
    }
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sell',
          tradeIds: Array.from(bulkTradeIds),
          data: { sellPrice: parseInt(bulkSellPrice, 10) },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Prodanih ${data.updated} tradeov`);
        triggerGlobalRefresh('bulk-sell'); // v8.57
        setBulkTradeIds(new Set());
        setBulkSellPrice('');
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const bulkCategorize = async () => {
    if (bulkTradeIds.size === 0) return;
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'categorize', tradeIds: Array.from(bulkTradeIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Kategoriziranih ${data.updated} tradeov`);
        triggerGlobalRefresh('bulk-categorize'); // v8.57
        setBulkTradeIds(new Set());
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const bulkDelete = async () => {
    if (bulkTradeIds.size === 0) return;
    if (!confirm(`Izbrišem ${bulkTradeIds.size} tradeov?`)) return;
    setBulkTradeLoading(true);
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', tradeIds: Array.from(bulkTradeIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Izbrisanih ${data.updated} tradeov`);
        triggerGlobalRefresh('bulk-delete'); // v8.57
        setBulkTradeIds(new Set());
        await load();
      } else { toast.error(data.error ?? 'Napaka'); }
    } catch { toast.error('Napaka'); }
    finally { setBulkTradeLoading(false); }
  };

  const toggleBulkTrade = (id: string) => {
    setBulkTradeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteTrade = async (t: Trade) => {
    if (!confirm(`Izbrišem trade "${t.title}"?`)) return;
    try {
      await fetch(`/api/trades/${t.id}`, { method: 'DELETE' });
      toast.success('Trade izbrisan');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  // v8.55: Comprehensive filter + search + sort
  const filtered = useMemo(() => {
    let result = filter === 'all' ? trades : trades.filter(t => t.status === filter);

    // Search
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.buyLocation.toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filterCategory !== 'all') {
      result = result.filter(t => t.category === filterCategory);
    }

    // Source filter
    if (filterSource !== 'all') {
      result = result.filter(t => t.buyLocation === filterSource);
    }

    // v8.63: Tag filter
    if (filterTag !== 'all') {
      result = result.filter(t => {
        const tags = t.tagsArray ?? parseTagsLocal(t.tags);
        return tags.includes(filterTag);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'date_desc': return new Date(b.buyDate).getTime() - new Date(a.buyDate).getTime();
        case 'date_asc': return new Date(a.buyDate).getTime() - new Date(b.buyDate).getTime();
        case 'profit_desc': {
          const pa = a.sellPrice ? (a.sellPrice - a.sellFees - a.buyPrice - a.buyFees) : -Infinity;
          const pb = b.sellPrice ? (b.sellPrice - b.sellFees - b.buyPrice - b.buyFees) : -Infinity;
          return pb - pa;
        }
        case 'profit_asc': {
          const pa = a.sellPrice ? (a.sellPrice - a.sellFees - a.buyPrice - a.buyFees) : Infinity;
          const pb = b.sellPrice ? (b.sellPrice - b.sellFees - b.buyPrice - b.buyFees) : Infinity;
          return pa - pb;
        }
        case 'roi_desc': {
          const ca = a.buyPrice + a.buyFees;
          const cb = b.buyPrice + b.buyFees;
          const ra = a.sellPrice ? ((a.sellPrice - a.sellFees - ca) / ca) * 100 : -Infinity;
          const rb = b.sellPrice ? ((b.sellPrice - b.sellFees - cb) / cb) * 100 : -Infinity;
          return rb - ra;
        }
        case 'roi_asc': {
          const ca = a.buyPrice + a.buyFees;
          const cb = b.buyPrice + b.buyFees;
          const ra = a.sellPrice ? ((a.sellPrice - a.sellFees - ca) / ca) * 100 : Infinity;
          const rb = b.sellPrice ? ((b.sellPrice - b.sellFees - cb) / cb) * 100 : Infinity;
          return ra - rb;
        }
        case 'title_asc': return a.title.localeCompare(b.title);
        case 'price_desc': return b.buyPrice - a.buyPrice;
        case 'priority_desc': {
          // v8.65: Sort held trades by sell urgency score (desc)
          const pa = priorityMap[a.id]?.score ?? -1;
          const pb = priorityMap[b.id]?.score ?? -1;
          return pb - pa;
        }
        case 'outcome_desc': {
          // v8.67: Sort sold trades by outcome score (desc)
          const oa = outcomeMap[a.id]?.overallScore ?? -1;
          const ob = outcomeMap[b.id]?.overallScore ?? -1;
          return ob - oa;
        }
        default: return 0;
      }
    });

    return result;
  }, [trades, filter, debouncedSearch, filterCategory, filterSource, filterTag, sortBy, priorityMap, outcomeMap]);

  // v8.55: Derive categories + sources from trades
  const categories = useMemo(() => {
    const set = new Set<string>();
    trades.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set).sort();
  }, [trades]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    trades.forEach(t => { if (t.buyLocation) set.add(t.buyLocation); });
    return Array.from(set).sort();
  }, [trades]);

  // v8.63: Derive all tags from trades (for filter dropdown)
  const allTags = useMemo(() => {
    const set = new Set<string>();
    trades.forEach(t => {
      const tags = t.tagsArray ?? parseTagsLocal(t.tags);
      tags.forEach(tag => set.add(tag));
    });
    return Array.from(set).sort();
  }, [trades]);

  // v8.64: Saved Views — persisted filter combinations in localStorage
  const [savedViews, setSavedViews] = useLocalStorage<SavedView[]>('trade-saved-views', []);
  const [activeViewName, setActiveViewName] = useState<string | null>(null);
  const [showSaveViewInput, setShowSaveViewInput] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // v8.64: Capture current filter state as a snapshot
  const currentFilterSnapshot = useCallback((): SavedViewFilters => ({
    status: filter,
    category: filterCategory,
    source: filterSource,
    tag: filterTag,
    search: searchQuery,
    sortBy,
  }), [filter, filterCategory, filterSource, filterTag, searchQuery, sortBy]);

  // v8.64: Check if current filters differ from the active view (to mark "unsaved")
  const isDirty = useMemo(() => {
    if (!activeViewName) return false;
    const v = savedViews.find(s => s.name === activeViewName);
    if (!v) return false;
    const c = currentFilterSnapshot();
    return JSON.stringify(v.filters) !== JSON.stringify(c);
  }, [activeViewName, savedViews, currentFilterSnapshot]);

  const applyView = useCallback((view: SavedView) => {
    const f = view.filters;
    setFilter(f.status || 'all');
    setFilterCategory(f.category || 'all');
    setFilterSource(f.source || 'all');
    setFilterTag(f.tag || 'all');
    setSearchQuery(f.search || '');
    setSortBy((f.sortBy || 'date_desc') as 'date_desc' | 'date_asc' | 'profit_desc' | 'profit_asc' | 'roi_desc' | 'roi_asc' | 'title_asc' | 'price_desc' | 'priority_desc' | 'outcome_desc');
    setActiveViewName(view.name);
  }, []);

  const saveCurrentAsView = useCallback(() => {
    const name = newViewName.trim();
    if (!name) {
      toast.error('Ime pogleda je obvezno');
      return;
    }
    const view: SavedView = {
      name,
      filters: currentFilterSnapshot(),
      createdAt: new Date().toISOString(),
      custom: true,
    };
    // If name exists, replace
    const others = savedViews.filter(v => v.name !== name);
    setSavedViews([...others, view]);
    setActiveViewName(name);
    setShowSaveViewInput(false);
    setNewViewName('');
    toast.success(`✓ Pogled "${name}" shranjen`);
  }, [newViewName, currentFilterSnapshot, savedViews, setSavedViews]);

  const deleteSavedView = useCallback((name: string) => {
    setSavedViews(savedViews.filter(v => v.name !== name));
    if (activeViewName === name) setActiveViewName(null);
    toast.success(`Pogled "${name}" izbrisan`);
  }, [savedViews, setSavedViews, activeViewName]);

  // v8.64: Auto-generate default views from top tags (always available)
  const defaultViews = useMemo<SavedView[]>(() => {
    const views: SavedView[] = [
      { name: 'Vsi', filters: { status: 'all', category: 'all', source: 'all', tag: 'all', search: '', sortBy: 'date_desc' }, createdAt: '', custom: false },
      { name: 'V skladišču', filters: { status: 'held', category: 'all', source: 'all', tag: 'all', search: '', sortBy: 'date_desc' }, createdAt: '', custom: false },
      { name: 'Prodani', filters: { status: 'sold', category: 'all', source: 'all', tag: 'all', search: '', sortBy: 'date_desc' }, createdAt: '', custom: false },
    ];
    // Add top 3 tags as quick views
    const tagCount: Record<string, number> = {};
    trades.forEach(t => {
      const tags = t.tagsArray ?? parseTagsLocal(t.tags);
      tags.forEach(tag => { tagCount[tag] = (tagCount[tag] || 0) + 1; });
    });
    Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([tag]) => {
        views.push({
          name: `#${tag}`,
          filters: { status: 'all', category: 'all', source: 'all', tag, search: '', sortBy: 'date_desc' },
          createdAt: '',
          custom: false,
        });
      });
    return views;
  }, [trades]);

  // v8.64: URL sync — read ?view= AND ?tag= on mount, apply filter
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    // ?tag=hitri-flip → set tag filter (deep link from TagPerformanceCard)
    const tagParam = url.searchParams.get('tag');
    if (tagParam) {
      setFilterTag(tagParam.toLowerCase());
      setActiveViewName(`#${tagParam.toLowerCase()}`);
    }
    // ?view=V skladišču → apply saved view by name
    const viewName = url.searchParams.get('view');
    if (viewName) {
      const view = savedViews.find(v => v.name === viewName) || defaultViews.find(v => v.name === viewName);
      if (view) applyView(view);
    }
     
  }, []);

  const allViews = useMemo(() => [...defaultViews, ...savedViews], [defaultViews, savedViews]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Skladišče
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sledi kupljene in prodane oglase — izračunaj profit in ROI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v6.9: Tax Report */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => window.open(`/api/trades/tax-report?year=${new Date().getFullYear()}`, '_blank')}
            title="Generiraj davčno poročilo za računovodjo"
          >
            <Download className="w-3.5 h-3.5" />
            Davčno poročilo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // v8.60: Export FILTERED trades as CSV — includes current search/sort/filter
              const params = new URLSearchParams({ format: 'csv' });
              if (filter !== 'all') params.set('status', filter);
              if (filterCategory !== 'all') params.set('category', filterCategory);
              if (filterSource !== 'all') params.set('source', filterSource);
              if (filterTag !== 'all') params.set('tag', filterTag); // v8.63
              if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
              window.open(`/api/trades?${params.toString()}`, '_blank');
            }}
            className="gap-2"
            title="Izvozi filtrirane trade-e v CSV (uposteva search/filter/sort)"
          >
            <Download className="w-3.5 h-3.5" /> CSV ({filtered.length})
          </Button>
          {/* v8.36: CSV Import button — opens import dialog */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowImport(true)}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            title="Uvozi trades iz CSV datoteke (Bolha/Vinted/Excel export)"
          >
            <Upload className="w-3.5 h-3.5" /> Uvozi CSV
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-3.5 h-3.5" /> Nov trade
          </Button>
        </div>
      </div>
      {/* v5.4: AI Portfolio Analysis — self-contained: button + state + card (fetch: /api/trades/portfolio-ai) */}
      <AIPortfolioAnalysis />

      {/* v6.3: Auto-reprice — self-contained: button + state + card (fetch: POST /api/trades/auto-reprice) */}
      <AutoReprice onApplied={load} />

      {/* v6.3: Auto-listing generator — presentational card (state set from per-trade actions; preserved in parent) */}
      <AutoListingGeneratorCard data={generatedListing} onClear={() => setGeneratedListing(null)} />

      {/* v6.5: Multi-Platform Sync — presentational card (state set from TradeRow onSync; preserved in parent) */}
      <MultiPlatformSyncCard data={syncData} onClear={() => setSyncData(null)} />

      {/* v6.7: Aging Alerts — self-contained: button + state + card (fetch: GET /api/trades/aging-alerts) */}
      <AgingAlerts />

      {/* v6.7: Restock Recommendations — self-contained: button + state + card (fetch: GET /api/ai/restock) */}
      <RestockRecommendations />

      {/* v6.9: AI Exit Strategy — presentational card (state set from TradeRow onExit + priority card button; preserved in parent) */}
      <AIExitStrategyCard data={exitData} onClear={() => setExitData(null)} />

      {/* v6.10: AI Bundle Optimizer — self-contained: button + state + card (fetch: POST /api/ai/bundle-optimizer; uses bulkTradeIds) */}
      <AIBundleOptimizer bulkTradeIds={bulkTradeIds} />

      {/* v6.10: AI Liquidation Strategy — self-contained: button + state + card (fetch: POST /api/ai/liquidation; uses bulkTradeIds) */}
      <AILiquidationStrategy bulkTradeIds={bulkTradeIds} />

      {/* v6.14: AI Multi-Modal Listing Generator — self-contained: button + state + card (fetch: POST /api/ai/multimodal-listing; uses trades) */}
      <AIListingGenerator trades={trades} />

      <TaxLossHarvesting />

      <MultiVendorBundle bulkTradeIds={bulkTradeIds} />

      <OptimalTimePredictor />

      <TitleABTester trades={trades} />

      <BuyerPersonaGenerator trades={trades} />

      <CrossPlatformPriceComparison trades={trades} />

      <InventoryDepreciation />

      <ListingPerformanceTracker />

      {/* Stats overview */}
      {stats && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox
            icon={<Wallet className="w-4 h-4" />}
            label="Realiziran profit"
            value={`${stats.realizedProfit >= 0 ? '+' : ''}${stats.realizedProfit.toFixed(2)} €`}
            color={stats.realizedProfit >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<Target className="w-4 h-4" />}
            label="Povprečni ROI"
            value={`${stats.avgRoiPercent >= 0 ? '+' : ''}${stats.avgRoiPercent}%`}
            color={stats.avgRoiPercent >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<ShoppingCart className="w-4 h-4" />}
            label="V skladišču"
            value={`${stats.heldCount} (${stats.totalInvestedHeld.toFixed(0)} €)`}
            color="text-amber-400"
          />
          <StatBox
            icon={<TrendingUp className="w-4 h-4" />}
            label="Prodani"
            value={`${stats.soldCount} (${stats.totalRealizedRevenue.toFixed(0)} €)`}
            color="text-primary"
          />
        </div>

        {/* v3.8: Profit chart */}
        {stats.byMonth.some(m => m.count > 0) && (
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Profit po mesecih
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={stats.byMonth}>
                  <defs>
                    <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                  <RTooltip
                    contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                    labelStyle={{ color: '#d4d4d4' }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} €`, 'Profit']}
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="#4ade80"
                    strokeWidth={2}
                    fill="url(#profitGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* v3.8: Profit by category */}
        {stats.byCategory.length > 0 && (
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Profit po kategorijah
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.byCategory
                  .sort((a, b) => b.profit - a.profit)
                  .map(cat => (
                    <div key={cat.category} className="flex items-center justify-between p-2 bg-background/30 rounded text-xs">
                      <div>
                        <div className="font-medium">{cat.category || 'brez kategorije'}</div>
                        <div className="text-[10px] text-muted-foreground">{cat.count} tradev • {cat.invested.toFixed(0)}€ investirano</div>
                      </div>
                      <div className={cn('font-bold font-mono', cat.profit >= 0 ? 'text-primary' : 'text-destructive')}>
                        {cat.profit >= 0 ? '+' : ''}{cat.profit.toFixed(2)} €
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* v4.1: This month P&L card + v4.2: Goal progress */}
        {stats.byMonth.length > 0 && (() => {
          const now = new Date();
          const thisMonthKey = now.toISOString().slice(0, 7);
          const lastMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
          const thisMonth = stats.byMonth.find(m => m.month === thisMonthKey);
          const lastMonth = stats.byMonth.find(m => m.month === lastMonthKey);
          const monthName = now.toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });
          return (
            <Card className={cn(
              'bg-card/50 border',
              (thisMonth?.profit ?? 0) >= 0 ? 'border-primary/20' : 'border-destructive/20'
            )}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ta mesec — {monthName}</p>
                    <p className={cn(
                      'text-2xl font-bold font-mono mt-1',
                      (thisMonth?.profit ?? 0) >= 0 ? 'text-primary terminal-glow' : 'text-destructive'
                    )}>
                      {(thisMonth?.profit ?? 0) >= 0 ? '+' : ''}{(thisMonth?.profit ?? 0).toFixed(2)} €
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {thisMonth?.count ?? 0} prodanih tradev
                      {lastMonth && (
                        <span className="ml-2">
                          • Prejšnji mesec: {lastMonth.profit >= 0 ? '+' : ''}{lastMonth.profit.toFixed(2)} €
                          {thisMonth && lastMonth.profit !== 0 && thisMonth.profit !== 0 && (
                            <span className={cn(
                              'ml-1 font-bold',
                              thisMonth.profit > lastMonth.profit ? 'text-primary' : 'text-destructive'
                            )}>
                              ({thisMonth.profit > lastMonth.profit ? '↑' : '↓'} {Math.abs(thisMonth.profit - lastMonth.profit).toFixed(2)} €)
                            </span>
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                  <TrendingUp className={cn('w-8 h-8', (thisMonth?.profit ?? 0) >= 0 ? 'text-primary' : 'text-destructive')} />
                </div>
                {/* v4.2: Goal progress bar */}
                {stats.monthlyGoal > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground uppercase tracking-wider">Cilj: {stats.monthlyGoal}€</span>
                      <span className={cn('font-bold', stats.goalProgress >= 100 ? 'text-primary' : 'text-amber-400')}>
                        {stats.goalProgress}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          stats.goalProgress >= 100 ? 'bg-primary' :
                          stats.goalProgress >= 50 ? 'bg-primary/70' : 'bg-amber-400/70'
                        )}
                        style={{ width: `${Math.min(100, stats.goalProgress)}%` }}
                      />
                    </div>
                    {stats.goalProgress >= 100 ? (
                      <p className="text-[10px] text-primary mt-1">🎉 Cilj dosežen!</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Še {(stats.monthlyGoal - stats.thisMonthProfit).toFixed(2)}€ do cilja
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* v4.3: Cumulative profit timeline */}
        {stats.byMonth.some(m => m.count > 0) && (() => {
          let cumulative = 0;
          const cumulativeData = stats.byMonth.map(m => {
            cumulative += m.profit;
            return { month: m.month, cumulative: Math.round(cumulative * 100) / 100, monthly: m.profit };
          });
          return (
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Kumulativni profit (zadnjih 12 mesecev)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <RTooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                      formatter={(value: any, name: any) => [
                        `${Number(value).toFixed(2)} €`,
                        name === 'cumulative' ? 'Kumulativno' : 'Mesečno'
                      ]}
                    />
                    <Line type="monotone" dataKey="cumulative" stroke="#4ade80" strokeWidth={2} dot={{ fill: '#4ade80', r: 3 }} />
                    <Line type="monotone" dataKey="monthly" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block" /> Kumulativni profit</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" style={{borderTop: '1px dashed'}} /> Mesečni profit</span>
                </div>
              </CardContent>
            </Card>
          );
        })()}
        </>
      )}

        {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'held', 'sold', 'cancelled'].map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className={cn('h-7 text-xs uppercase', filter === f && 'bg-primary text-primary-foreground')}
          >
            {f === 'all' ? 'Vsi' : f === 'held' ? 'V skladišču' : f === 'sold' ? 'Prodani' : 'Preklicani'}
          </Button>
        ))}
      </div>

      {/* v8.64: Saved Views bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase text-muted-foreground shrink-0">📊 Pogledi:</span>
        <div className="flex items-center gap-1 flex-wrap">
          {allViews.map(v => (
            <button
              key={v.name}
              onClick={() => applyView(v)}
              className={cn(
                'h-7 px-2.5 text-xs rounded border transition-colors flex items-center gap-1',
                activeViewName === v.name && !isDirty
                  ? 'bg-primary text-primary-foreground border-primary'
                  : activeViewName === v.name && isDirty
                    ? 'bg-amber-500/15 text-amber-600 border-amber-500/40'
                    : 'bg-card border-border hover:bg-accent hover:border-primary/40'
              )}
              title={v.custom ? `Shranjeno: ${new Date(v.createdAt).toLocaleString('sl-SI')}` : 'Privzet pogled'}
            >
              {v.name}
              {activeViewName === v.name && isDirty && <span className="text-[9px]">•</span>}
              {v.custom && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); deleteSavedView(v.name); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); deleteSavedView(v.name); } }}
                  className="ml-0.5 text-[10px] opacity-50 hover:opacity-100 hover:text-destructive"
                  title="Izbriši pogled"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          {/* Save current as new view */}
          {!showSaveViewInput ? (
            <button
              onClick={() => setShowSaveViewInput(true)}
              className="h-7 px-2.5 text-xs rounded border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              title="Shrani trenutne filtre kot pogled"
            >
              + Shrani pogled
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                placeholder="Ime pogleda..."
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCurrentAsView();
                  if (e.key === 'Escape') { setShowSaveViewInput(false); setNewViewName(''); }
                }}
                className="h-7 w-32 text-xs"
              />
              <Button size="sm" onClick={saveCurrentAsView} className="h-7 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                ✓
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowSaveViewInput(false); setNewViewName(''); }} className="h-7 px-2 text-xs">
                ✕
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* v8.55: Search + Sort + Category + Source filters */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <Input
          placeholder="🔍 Išči po naslovu, kategoriji, viru, opombah..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="h-8 text-xs bg-card border border-border rounded px-2 cursor-pointer"
        >
          <option value="date_desc">📅 Najnovejši</option>
          <option value="date_asc">📅 Najstarejši</option>
          <option value="profit_desc">💰 Profit ↓</option>
          <option value="profit_asc">💰 Profit ↑</option>
          <option value="roi_desc">📊 ROI ↓</option>
          <option value="roi_asc">📊 ROI ↑</option>
          <option value="price_desc">💵 Cena ↓</option>
          <option value="title_asc">🔤 Naslov A-Z</option>
          <option value="priority_desc">🔥 Prioriteta ↓</option>
          <option value="outcome_desc">🏆 Outcome ↓</option>
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="h-8 text-xs bg-card border border-border rounded px-2 cursor-pointer"
        >
          <option value="all">📦 Vse kategorije</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="h-8 text-xs bg-card border border-border rounded px-2 cursor-pointer"
        >
          <option value="all">🏪 Vsi viri</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* v8.63: Tag filter */}
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="h-8 text-xs bg-card border border-border rounded px-2 cursor-pointer"
          >
            <option value="all">#️⃣ Vsi tagi</option>
            {allTags.map(t => <option key={t} value={t}>#{t}</option>)}
          </select>
        )}
      </div>

      {/* v8.55: Result count */}
      <div className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? 'trade' : 'trade-ov'}
        {searchQuery && ` za "${searchQuery}"`}
        {(filterCategory !== 'all' || filterSource !== 'all' || filterTag !== 'all') && ' (filtrirano)'}
      </div>

      {/* v8.65: Held Inventory Action Panel — top 3 priority trades z quick actions */}
      {filter === 'held' && Object.keys(priorityMap).length > 0 && (() => {
        const heldWithPriority = trades
          .filter(t => t.status === 'held' && priorityMap[t.id])
          .map(t => ({ trade: t, p: priorityMap[t.id] }))
          .sort((a, b) => b.p.score - a.p.score)
          .slice(0, 3);
        if (heldWithPriority.length === 0) return null;
        return (
          <Card className="bg-card/80 border-primary/30">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-bold uppercase tracking-tight">Top 3 za prodajo</h3>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setSortBy('priority_desc')}
                  title="Sortiraj vse held trade-e po prioriteti"
                >
                  Sortiraj po prioriteti →
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {heldWithPriority.map(({ trade: t, p }, idx) => (
                  <div
                    key={t.id}
                    className={cn(
                      'rounded-md border p-2 space-y-1.5',
                      p.level === 'HIGH'
                        ? 'bg-red-500/5 border-red-500/30'
                        : p.level === 'MEDIUM'
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : 'bg-emerald-500/5 border-emerald-500/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-xs font-medium truncate flex-1">{t.title}</span>
                      <span className={cn(
                        'text-xs font-bold font-mono shrink-0',
                        p.level === 'HIGH' ? 'text-red-500' : p.level === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {p.level === 'HIGH' ? '🔥' : p.level === 'MEDIUM' ? '🟡' : '🟢'} {p.score}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.daysHeld} dni · {t.buyPrice}€ kupljeno · {(t.tagsArray ?? parseTagsLocal(t.tags)).slice(0, 2).map(tg => `#${tg}`).join(' ') || 'brez tagov'}
                    </div>
                    {/* v8.66: Smart price suggestion */}
                    {priceMap[t.id] && (
                      <div className="text-[10px] bg-primary/5 border border-primary/20 rounded px-1.5 py-1 flex items-center justify-between gap-1">
                        <span className="text-muted-foreground">💡 Predlagana cena:</span>
                        <span className="font-mono font-bold text-primary" title={`Obseg: ${priceMap[t.id].suggestedMin}€ - ${priceMap[t.id].suggestedMax}€\nPričakovan ROI: +${priceMap[t.id].expectedROI.toFixed(0)}% (+${priceMap[t.id].expectedProfit.toFixed(0)}€)\nZaupanje: ${priceMap[t.id].confidenceLabel} (${priceMap[t.id].confidence}%)\n${priceMap[t.id].comparablesCount > 0 ? `${priceMap[t.id].comparablesCount} podobnih prodaj` : 'Brez comparables'}`}>
                          {priceMap[t.id].suggestedOptimal}€
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-foreground/80 italic line-clamp-2" title={p.recommendedAction}>
                      💡 {p.recommendedAction}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 flex-1"
                        onClick={() => { setEditing(t); setShowForm(true); }}
                        title="Odpri v editorju"
                      >
                        <Pencil className="w-2.5 h-2.5" /> Uredi
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 flex-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                        onClick={async () => {
                          setExitLoading(t.id);
                          try {
                            const res = await fetch('/api/ai/exit-strategy', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ tradeId: t.id }),
                            });
                            const data = await res.json();
                            if (data.ok) { setExitData(data); toast.success(`✓ Izhodna strategija: ${data.strategy.recommendation}`); }
                            else toast.error(data.error ?? 'Napaka');
                          } catch { toast.error('Napaka'); }
                          finally { setExitLoading(null); }
                        }}
                        title="AI izhodna strategija"
                      >
                        {exitLoading === t.id ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />} AI Izhod
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Trades list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-card animate-pulse rounded" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <EmptyState
              icon={<TrendingUp className="w-12 h-12" />}
              title="Še ni trgovin"
              description="Sledi svoje nakupe in prodaje — dodaj prvi trade ali kupi oglas iz Oglasi. Sistem bo samodejno izračunal profit, ROI in sell priority."
              action={{
                label: 'Dodaj prvi trade',
                onClick: () => { setEditing(null); setShowForm(true); },
                icon: <Plus className="w-3.5 h-3.5" />,
              }}
              actionHref={{
                label: 'Išči oglase',
                href: '/?view=iskalnik',
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* v5.7: Bulk trade toolbar */}
          {bulkTradeIds.size > 0 && (
            <Card className="bg-primary/5 border-primary/30">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-medium text-primary">{bulkTradeIds.size} izbranih</span>
                  <Input
                    type="number"
                    value={bulkSellPrice}
                    onChange={(e) => setBulkSellPrice(e.target.value)}
                    placeholder="Prodajna cena (€)"
                    className="h-7 w-32 text-xs font-mono"
                  />
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={bulkSell} disabled={bulkTradeLoading}>
                    {bulkTradeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                    Prodaj vse
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={bulkCategorize} disabled={bulkTradeLoading}>
                    <Tag className="w-3 h-3" /> Kategoriziraj
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-500" onClick={bulkDelete} disabled={bulkTradeLoading}>
                    <Trash2 className="w-3 h-3" /> Izbriši
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkTradeIds(new Set())}>
                    Počisti
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {filtered.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bulkTradeIds.has(t.id)}
                onChange={() => toggleBulkTrade(t.id)}
                className="w-4 h-4 rounded border-border shrink-0"
              />
              <div className="flex-1 min-w-0">
                <TradeRow trade={t} onEdit={() => { setEditing(t); setShowForm(true); }} onDelete={() => deleteTrade(t)}
                onSync={async (tradeId) => {
                  setSyncLoading(tradeId);
                  try {
                    const res = await fetch('/api/trades/sync-listing', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tradeId, platforms: ['bolha', 'vinted'] }),
                    });
                    const data = await res.json();
                    if (data.ok) { setSyncData(data); toast.success(`✓ ${data.listings.length} platformnih oglasov generiranih`); }
                    else toast.error(data.error ?? 'Napaka');
                  } catch { toast.error('Napaka'); }
                  finally { setSyncLoading(null); }
                }}
                onExit={async (tradeId) => {
                  setExitLoading(tradeId);
                  try {
                    const res = await fetch('/api/ai/exit-strategy', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tradeId }),
                    });
                    const data = await res.json();
                    if (data.ok) { setExitData(data); toast.success(`✓ Izhodna strategija: ${data.strategy.recommendation}`); }
                    else toast.error(data.error ?? 'Napaka');
                  } catch { toast.error('Napaka'); }
                  finally { setExitLoading(null); }
                }}
                onTagClick={(tag) => setFilterTag(tag)} // v8.64: clickable tag chips
                priority={priorityMap[t.id] ?? null} // v8.65: sell priority badge
                priceHint={priceMap[t.id] ?? null} // v8.66: smart price hint
                outcome={outcomeMap[t.id] ?? null} // v8.67: outcome scorecard badge
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <TradeFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} onSaved={() => { setShowForm(false); load(); }} />
      {/* v8.36: CSV Import dialog — file upload + preview + bulk create */}
      <CsvImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImported={() => { setShowImport(false); load(); }}
      />
    </div>
  );
}

// StatBox — v8.99: imported from ./trades/stat-box
// TradeRow — v8.99: imported from ./trades/trade-row
// TradeFormDialog — v8.99: imported from ./trades/trade-form-dialog
// CsvImportDialog — v8.99: imported from ./trades/csv-import-dialog

