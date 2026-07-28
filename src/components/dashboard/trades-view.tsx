'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag, Download, Sparkles, Check, Copy, AlertTriangle, Boxes, Flame, FileText, Receipt, Network, Clock, Type, Users, Globe, LineChart as LineChartIcon, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, LineChart, Line,
} from 'recharts';

interface Trade {
  id: string;
  listingId: string | null;
  title: string;
  category: string;
  imageUrl: string | null;
  url: string | null;
  buyPrice: number;
  buyDate: string;
  buyLocation: string;
  buyFees: number;
  sellPrice: number | null;
  sellDate: string | null;
  sellLocation: string;
  sellFees: number;
  status: string;
  notes: string;
  createdAt: string;
  listing?: { id: string; title: string; url: string; imageUrl: string | null; monitor?: { name: string } } | null;
}

interface TradeStats {
  totalTrades: number;
  heldCount: number;
  soldCount: number;
  realizedProfit: number;
  totalInvestedHeld: number;
  totalRealizedRevenue: number;
  totalRealizedCost: number;
  avgRoiPercent: number;
  byCategory: Array<{ category: string; count: number; profit: number; invested: number }>;
  byMonth: Array<{ month: string; profit: number; count: number }>;
  // v4.2: Profit goal
  thisMonthProfit: number;
  monthlyGoal: number;
  goalProgress: number;
}

const CATEGORIES = ['elektronika', 'avto', 'nepremičnina', 'pohištvo', 'oblačila', 'orodje', 'kolektorstvo', 'drugo'];

export function TradesView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  // v5.4: Portfolio AI
  const [portfolioAI, setPortfolioAI] = useState<any>(null);
  const [portfolioAILoading, setPortfolioAILoading] = useState(false);
  // v6.3: Auto-reprice
  const [repriceData, setRepriceData] = useState<any>(null);
  const [repriceLoading, setRepriceLoading] = useState(false);
  // v6.3: Auto-listing generator
  const [generatedListing, setGeneratedListing] = useState<any>(null);
  const [genListingLoading, setGenListingLoading] = useState<string | null>(null);
  // v6.5: Multi-platform sync
  const [syncData, setSyncData] = useState<any>(null);
  const [syncLoading, setSyncLoading] = useState<string | null>(null);
  // v6.7: Aging alerts + Restock
  const [agingData, setAgingData] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(false);
  const [restockData, setRestockData] = useState<any>(null);
  const [restockLoading, setRestockLoading] = useState(false);
  // v6.9: Tax report + Exit strategy
  const [exitData, setExitData] = useState<any>(null);
  const [exitLoading, setExitLoading] = useState<string | null>(null);
  // v6.10: Bundle Optimizer + Liquidation
  const [bundleData, setBundleData] = useState<any>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [liquidationData, setLiquidationData] = useState<any>(null);
  const [liquidationLoading, setLiquidationLoading] = useState(false);
  // v6.14: Multi-Modal Listing Generator
  const [listingGen, setListingGen] = useState<any>(null);
  const [listingGenLoading, setListingGenLoading] = useState<string | null>(null);
  const [listingGenPlatform, setListingGenPlatform] = useState<'bolha' | 'vinted' | 'facebook' | 'avtonet'>('bolha');
  const [listingGenCopied, setListingGenCopied] = useState<string | null>(null);
  // v6.15: Tax Loss Harvesting
  const [taxHarvestData, setTaxHarvestData] = useState<any>(null);
  const [taxHarvestLoading, setTaxHarvestLoading] = useState(false);
  const [taxHarvestYear, setTaxHarvestYear] = useState(String(new Date().getFullYear()));
  // v6.16: Multi-Vendor Bundle
  const [multiVendorData, setMultiVendorData] = useState<any>(null);
  const [multiVendorLoading, setMultiVendorLoading] = useState(false);
  // v6.21: Optimal Time Predictor
  const [optimalTimeData, setOptimalTimeData] = useState<any>(null);
  const [optimalTimeLoading, setOptimalTimeLoading] = useState(false);
  // v6.22: Title A/B Test + Buyer Persona
  const [titleAbTestData, setTitleAbTestData] = useState<any>(null);
  const [titleAbTestLoading, setTitleAbTestLoading] = useState(false);
  const [titleAbTestCopied, setTitleAbTestCopied] = useState<string | null>(null);
  const [personaData, setPersonaData] = useState<any>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  // v6.23: Cross-Platform Price + Depreciation
  const [crossPriceData, setCrossPriceData] = useState<any>(null);
  const [crossPriceLoading, setCrossPriceLoading] = useState(false);
  const [depreciationData, setDepreciationData] = useState<any>(null);
  const [depreciationLoading, setDepreciationLoading] = useState(false);
  // v6.24: Listing Performance Tracker
  const [perfData, setPerfData] = useState<any>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  // v5.7: Bulk trade operations
  const [bulkTradeIds, setBulkTradeIds] = useState<Set<string>>(new Set());
  const [bulkTradeLoading, setBulkTradeLoading] = useState(false);
  const [bulkSellPrice, setBulkSellPrice] = useState('');

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

  // v5.4: Load AI portfolio analysis
  const loadPortfolioAI = useCallback(async () => {
    setPortfolioAILoading(true);
    try {
      const res = await fetch('/api/trades/portfolio-ai');
      if (res.ok) {
        setPortfolioAI(await res.json());
      }
    } catch { /* ignore */ }
    finally { setPortfolioAILoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter);

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
          {/* v5.4: AI Portfolio button */}
          <Button
            size="sm"
            variant="outline"
            onClick={loadPortfolioAI}
            disabled={portfolioAILoading}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            title="AI analiza portfolia — kdaj prodati, kdaj držati"
          >
            {portfolioAILoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI Portfolio
          </Button>
          {/* v6.3: Auto-reprice button */}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              setRepriceLoading(true); setRepriceData(null);
              try {
                const res = await fetch('/api/trades/auto-reprice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setRepriceData(data); toast.success(`✓ ${data.needsReprice} od ${data.totalHeld} potrebuje reprice`); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setRepriceLoading(false); }
            }}
            disabled={repriceLoading}
            className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            title="AI predlagaj cene za neprodane tradee"
          >
            {repriceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingDown className="w-3.5 h-3.5" />}
            Auto-reprice
          </Button>
          {/* v6.7: Aging alerts */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-red-500/40 text-red-500 hover:bg-red-500/10"
            disabled={agingLoading}
            onClick={async () => {
              setAgingLoading(true);
              try {
                const res = await fetch('/api/trades/aging-alerts');
                const data = await res.json();
                if (data.ok) { setAgingData(data); toast.success(`✓ ${data.summary.critical} kritičnih, ${data.summary.high} visokih`); }
                else toast.error(data.error ?? 'Napaka');
              } catch { toast.error('Napaka'); }
              finally { setAgingLoading(false); }
            }}
            title="AI aging alerts — kateri itemi izgubljajo vrednost?"
          >
            {agingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            Aging alerti
          </Button>
          {/* v6.7: Restock recommendations */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-green-400/40 text-green-400 hover:bg-green-400/10"
            disabled={restockLoading}
            onClick={async () => {
              setRestockLoading(true);
              try {
                const res = await fetch('/api/ai/restock');
                const data = await res.json();
                if (data.ok) { setRestockData(data); toast.success(`✓ ${data.recommendations.length} priporočil, ${data.totalOpportunities} priložnosti`); }
                else toast.error(data.error ?? 'Napaka');
              } catch { toast.error('Napaka'); }
              finally { setRestockLoading(false); }
            }}
            title="AI restock — kaj ponovno kupiti za preprodajo?"
          >
            {restockLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            AI Restock
          </Button>
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
          {/* v6.10: Bundle Optimizer */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            disabled={bundleLoading}
            onClick={async () => {
              setBundleLoading(true); setBundleData(null);
              try {
                const ids = Array.from(bulkTradeIds);
                const res = await fetch('/api/ai/bundle-optimizer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(ids.length > 0 ? { tradeIds: ids } : {}),
                });
                const data = await res.json();
                if (data.ok) { setBundleData(data); toast.success('✓ Bundle predlogi generirani'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setBundleLoading(false); }
            }}
            title="AI kombinira inventar v bundle za maksimalni profit"
          >
            {bundleLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Boxes className="w-3.5 h-3.5" />}
            Bundle optimizer
          </Button>
          {/* v6.10: Liquidation Strategy */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            disabled={liquidationLoading}
            onClick={async () => {
              setLiquidationLoading(true); setLiquidationData(null);
              try {
                const ids = Array.from(bulkTradeIds);
                const res = await fetch('/api/ai/liquidation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(ids.length > 0 ? { tradeIds: ids } : {}),
                });
                const data = await res.json();
                if (data.ok) { setLiquidationData(data); toast.success('✓ Likvidacijska strategija generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setLiquidationLoading(false); }
            }}
            title="AI predlaga kako hitro likvidirati stalled inventar"
          >
            {liquidationLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
            Likvidacija
          </Button>
          {/* v6.14: Multi-Modal Listing Generator */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            disabled={!!listingGenLoading}
            onClick={async () => {
              if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
              const firstHeld = trades.find((t: any) => t.status === 'held');
              if (!firstHeld) { toast.error('Ni held tradeov za prodajo'); return; }
              setListingGenLoading(firstHeld.id); setListingGen(null);
              try {
                const res = await fetch('/api/ai/multimodal-listing', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tradeId: firstHeld.id, targetPlatform: listingGenPlatform, language: 'sl' }),
                });
                const data = await res.json();
                if (data.ok) { setListingGen(data); toast.success('✓ Listing generiran'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setListingGenLoading(null); }
            }}
            title="AI generira celovit listing za prodajo (naslov, opis, cene, slikovna strategija)"
          >
            {listingGenLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Listing generator
          </Button>
          {/* v6.15: Tax Loss Harvesting */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            disabled={taxHarvestLoading}
            onClick={async () => {
              setTaxHarvestLoading(true); setTaxHarvestData(null);
              try {
                const res = await fetch('/api/ai/tax-loss-harvesting', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ year: Number(taxHarvestYear) }),
                });
                const data = await res.json();
                if (data.ok) { setTaxHarvestData(data); toast.success('✓ Davčna optimizacija generirana'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setTaxHarvestLoading(false); }
            }}
            title="AI identificira izgube za davčno optimizacijo (loss harvesting)"
          >
            {taxHarvestLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
            Tax harvesting
          </Button>
          {/* v6.16: Multi-Vendor Bundle */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            disabled={multiVendorLoading}
            onClick={async () => {
              setMultiVendorLoading(true); setMultiVendorData(null);
              try {
                const ids = Array.from(bulkTradeIds);
                const res = await fetch('/api/ai/multi-vendor-bundle', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ maxItems: 8 }),
                });
                const data = await res.json();
                if (data.ok) { setMultiVendorData(data); toast.success('✓ Multi-vendor bundle-i generirani'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setMultiVendorLoading(false); }
            }}
            title="AI kombinira inventar iz različnih virov v bundle"
          >
            {multiVendorLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
            Multi-vendor
          </Button>
          {/* v6.21: Optimal Listing Time Predictor */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
            disabled={optimalTimeLoading}
            onClick={async () => {
              setOptimalTimeLoading(true); setOptimalTimeData(null);
              try {
                const res = await fetch('/api/ai/optimal-time', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setOptimalTimeData(data); toast.success('✓ Optimalni čas objave generiran'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setOptimalTimeLoading(false); }
            }}
            title="AI napove kdaj objaviti oglas za max dobiček"
          >
            {optimalTimeLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
            Optimalni čas
          </Button>
          {/* v6.22: Title A/B Tester */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-purple-400/40 text-purple-400 hover:bg-purple-400/10"
            disabled={titleAbTestLoading}
            onClick={async () => {
              if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
              const firstHeld = trades.find((t: any) => t.status === 'held');
              if (!firstHeld) { toast.error('Ni held tradeov'); return; }
              setTitleAbTestLoading(true); setTitleAbTestData(null);
              try {
                const res = await fetch('/api/ai/title-abtest', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tradeId: firstHeld.id }),
                });
                const data = await res.json();
                if (data.ok) { setTitleAbTestData(data); toast.success('✓ A/B test naslovov generiran'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setTitleAbTestLoading(false); }
            }}
            title="AI generira in testira naslove oglasov za maksimalen CTR"
          >
            {titleAbTestLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Type className="w-3.5 h-3.5" />}
            Title A/B test
          </Button>
          {/* v6.22: Buyer Persona Generator */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10"
            disabled={personaLoading}
            onClick={async () => {
              if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
              const firstHeld = trades.find((t: any) => t.status === 'held');
              if (!firstHeld) { toast.error('Ni held tradeov'); return; }
              setPersonaLoading(true); setPersonaData(null);
              try {
                const res = await fetch('/api/ai/buyer-persona', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tradeId: firstHeld.id }),
                });
                const data = await res.json();
                if (data.ok) { setPersonaData(data); toast.success('✓ Buyer persone generirane'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setPersonaLoading(false); }
            }}
            title="AI ustvari buyer persone za ciljano trženje"
          >
            {personaLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
            Buyer persone
          </Button>
          {/* v6.23: Cross-Platform Price Comparison */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-indigo-400/40 text-indigo-400 hover:bg-indigo-400/10"
            disabled={crossPriceLoading}
            onClick={async () => {
              if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
              const firstHeld = trades.find((t: any) => t.status === 'held');
              if (!firstHeld) { toast.error('Ni held tradeov'); return; }
              setCrossPriceLoading(true); setCrossPriceData(null);
              try {
                const res = await fetch('/api/ai/cross-platform-price', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tradeId: firstHeld.id }),
                });
                const data = await res.json();
                if (data.ok) { setCrossPriceData(data); toast.success('✓ Cross-platform primerjava generirana'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setCrossPriceLoading(false); }
            }}
            title="AI primerja cene na 10 platformah in identificira arbitražo"
          >
            {crossPriceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            Cross-platform
          </Button>
          {/* v6.23: Inventory Depreciation Forecaster */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-orange-400/40 text-orange-400 hover:bg-orange-400/10"
            disabled={depreciationLoading}
            onClick={async () => {
              setDepreciationLoading(true); setDepreciationData(null);
              try {
                const res = await fetch('/api/ai/depreciation-forecast', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setDepreciationData(data); toast.success('✓ Napoved amortizacije generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setDepreciationLoading(false); }
            }}
            title="AI napove padec vrednosti inventarja in kdaj prodati"
          >
            {depreciationLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LineChartIcon className="w-3.5 h-3.5" />}
            Amortizacija
          </Button>
          {/* v6.24: Listing Performance Tracker */}
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-teal-400/40 text-teal-400 hover:bg-teal-400/10"
            disabled={perfLoading}
            onClick={async () => {
              setPerfLoading(true); setPerfData(null);
              try {
                const res = await fetch('/api/ai/listing-performance', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setPerfData(data); toast.success('✓ Analiza uspešnosti generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setPerfLoading(false); }
            }}
            title="AI analizira uspešnost prodaj in priporoči optimizacije"
          >
            {perfLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Uspešnost
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/api/trades?format=csv`, '_blank')}
            className="gap-2"
            title="Izvozi v CSV za Excel/računovodstvo"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-3.5 h-3.5" /> Nov trade
          </Button>
        </div>
      </div>

      {/* v5.4: AI Portfolio Analysis */}
      {portfolioAI && !portfolioAILoading && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Portfolio analiza
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.4</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setPortfolioAI(null)} className="h-6 text-xs">
                ×
              </Button>
            </div>

            {/* AI Overview */}
            {portfolioAI.portfolioSummary?.aiOverview && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs mb-2">
                <div className="text-[10px] uppercase tracking-wider text-primary mb-1">📊 Pregled</div>
                <p>{portfolioAI.portfolioSummary.aiOverview}</p>
              </div>
            )}

            {/* Strategy */}
            {portfolioAI.portfolioSummary?.aiStrategy && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs mb-3">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">💡 Strategija</div>
                <p>{portfolioAI.portfolioSummary.aiStrategy}</p>
              </div>
            )}

            {/* Recommendations */}
            {portfolioAI.recommendations?.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Priporočila za vsak trade ({portfolioAI.recommendations.length})
                </div>
                {portfolioAI.recommendations.map((rec: any, i: number) => {
                  const actionConfig: Record<string, { color: string; icon: string; label: string }> = {
                    sell: { color: 'text-primary border-primary/40', icon: '💰', label: 'PRODAJ' },
                    hold: { color: 'text-muted-foreground border-border', icon: '✋', label: 'DRŽI' },
                    reduce: { color: 'text-amber-400 border-amber-400/40', icon: '📉', label: 'ZNIŽAJ' },
                    monitor: { color: 'text-blue-400 border-blue-400/40', icon: '👀', label: 'SPREMLJAJ' },
                  };
                  const cfg = actionConfig[rec.action] || actionConfig.hold;
                  return (
                    <div key={i} className="flex items-start gap-2 p-2 bg-background/30 rounded text-xs">
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', cfg.color)}>
                        {cfg.icon} {cfg.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{rec.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {rec.buyPrice}€ kupljeno • {rec.daysHeld} dni v skladišču
                          {rec.suggestedSellPrice && (
                            <span className="text-primary ml-1">→ predlagana prodajna: {rec.suggestedSellPrice}€</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground italic mt-0.5">{rec.reasoning}</div>
                      </div>
                      {rec.urgency === 'high' && (
                        <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40 shrink-0">
                          🔥 NUJNO
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.3: Auto-reprice results */}
      {repriceData && !repriceLoading && (
        <Card className="bg-amber-400/5 border-amber-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                AI Auto-Reprice — {repriceData.needsReprice} od {repriceData.totalHeld} potrebuje popust
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.3</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRepriceData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {repriceData.repricing.filter((r: any) => r.needsReprice).map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-background/30 rounded text-xs border border-amber-400/20">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.currentPrice}€ → <span className="text-amber-400 font-bold">{r.suggestedPrice}€</span>
                      {' '}({r.dropPct > 0 ? '-' : '+'}{Math.abs(r.dropPct)}%)
                      {' • '}{r.daysHeld}d v skladišču
                      {r.marketAvg && ` • tržno povp: ${r.marketAvg}€`}
                    </div>
                    <div className="text-[10px] italic text-muted-foreground mt-0.5">{r.reason}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 shrink-0"
                    onClick={async () => {
                      try {
                        await fetch('/api/trades', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: r.tradeId, sellPrice: r.suggestedPrice }),
                        });
                        toast.success(`Cena posodobljena: ${r.suggestedPrice}€`);
                        await load();
                      } catch { toast.error('Napaka'); }
                    }}
                  >
                    <Check className="w-3 h-3" /> Uporabi
                  </Button>
                </div>
              ))}
              {repriceData.repricing.filter((r: any) => r.needsReprice).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">✅ Vsi tradei imajo ustrezno ceno — reprice ni potreben.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.3: Auto-listing generator result */}
      {generatedListing && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Generiran oglas za preprodajo
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.3</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setGeneratedListing(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Naslov</div>
                <div className="font-bold">{generatedListing.title}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Cena</div>
                  <div className="font-mono font-bold text-primary">{generatedListing.price}€</div>
                </div>
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Marža</div>
                  <div className="font-mono font-bold text-primary">{generatedListing.marginPct > 0 ? '+' : ''}{generatedListing.marginPct}%</div>
                </div>
                <div className="bg-background/30 rounded p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase">Čas prodaje</div>
                  <div className="font-mono font-bold">~{generatedListing.expectedSellTimeDays}d</div>
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Opis</div>
                <p className="whitespace-pre-wrap text-[11px]">{generatedListing.description}</p>
              </div>
              {generatedListing.tags?.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {generatedListing.tags.map((t: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">#{t}</Badge>
                  ))}
                </div>
              )}
              {generatedListing.tips?.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-primary">💡 Nasveti za prodajo ({generatedListing.tips.length})</summary>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {generatedListing.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ul>
                </details>
              )}
              <Button
                size="sm"
                className="w-full gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(`${generatedListing.title}\n\n${generatedListing.description}\n\nCena: ${generatedListing.price}€`);
                  toast.success('Oglas kopiran — prilepi na Bolha/Vinted');
                }}
              >
                <Copy className="w-3 h-3" /> Kopiraj oglas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.5: Multi-Platform Sync results */}
      {syncData && (
        <Card className="bg-blue-400/5 border-blue-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Multi-Platform oglasi (AI sinhronizirani)
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.5</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setSyncData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2">
              {syncData.listings?.map((l: any, i: number) => (
                <div key={i} className="bg-background/30 rounded p-2 border border-blue-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40 uppercase">{l.platform}</Badge>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-primary">{l.price}€</span>
                      <span className={cn('font-mono', l.marginPct > 0 ? 'text-primary' : 'text-red-500')}>
                        {l.marginPct > 0 ? '+' : ''}{l.marginPct}%
                      </span>
                    </div>
                  </div>
                  <div className="font-bold text-xs mb-1">{l.title}</div>
                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{l.description}</p>
                  {l.tips?.length > 0 && (
                    <details className="text-[11px] mt-1">
                      <summary className="cursor-pointer text-blue-400">💡 Nasveti za {l.platform} ({l.tips.length})</summary>
                      <ul className="mt-0.5 list-disc list-inside space-y-0.5">
                        {l.tips.map((t: string, j: number) => <li key={j}>{t}</li>)}
                      </ul>
                    </details>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-1 h-6 text-[10px] gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(`${l.title}\n\n${l.description}\n\nCena: ${l.price}€`);
                      toast.success(`${l.platform} oglas kopiran`);
                    }}
                  >
                    <Copy className="w-3 h-3" /> Kopiraj
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.7: Aging Alerts */}
      {agingData && !agingLoading && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-red-500 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Aging Alerti — {agingData.summary.critical}🚨 {agingData.summary.high}🔴 {agingData.summary.medium}🟡
                <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setAgingData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs mb-2">
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Skupna izguba</div><div className="font-mono font-bold text-red-500">{agingData.summary.totalValueLoss}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Holding cost</div><div className="font-mono font-bold text-amber-400">{agingData.summary.totalHoldingCost}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Investirano</div><div className="font-mono font-bold">{agingData.summary.totalInvested}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Itemi</div><div className="font-mono font-bold">{agingData.summary.totalItems}</div></div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {agingData.alerts.filter((a: any) => a.urgency !== 'low').map((a: any, i: number) => (
                <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded text-xs border',
                  a.urgency === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                  a.urgency === 'high' ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-400/5 border-amber-400/20')}>
                  <span className={cn('font-bold shrink-0 text-[10px]', a.color)}>{a.urgencyLabel}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-[9px] text-muted-foreground">
                      {a.daysHeld}d • {a.buyPrice}€ → ~{a.estimatedCurrentValue}€ ({a.valueLossPct}% izguba) • holding: {a.totalHoldingCost}€
                    </div>
                    <div className="text-[9px] text-muted-foreground italic">{a.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.7: Restock Recommendations */}
      {restockData && !restockLoading && (
        <Card className="bg-green-400/5 border-green-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-green-400 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                AI Restock — {restockData.recommendations.length} priporočil, {restockData.totalOpportunities} priložnosti
                <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRestockData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {restockData.recommendations.map((r: any, i: number) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-green-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-green-400 border-green-400/40">{r.category}</Badge>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-primary font-mono font-bold">{r.avgRoi > 0 ? '+' : ''}{r.avgRoi}% ROI</span>
                      <span className="text-muted-foreground">{r.soldCount} prodaj</span>
                      <span className="text-muted-foreground">~{r.avgDaysToSell}d</span>
                      <span className="text-primary font-mono">+{r.avgProfit}€ skupno</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1">{r.reason}</p>
                  <div className="space-y-0.5">
                    {r.opportunities.map((o: any, j: number) => (
                      <a key={j} href={o.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 p-1 hover:bg-card/50 rounded text-[10px]">
                        <span className="truncate flex-1">{o.title}</span>
                        <span className="font-mono text-amber-400 shrink-0">{o.priceText}</span>
                        {o.dealScore != null && <Badge variant="outline" className="text-[8px] text-primary border-primary/40 shrink-0">🎯{o.dealScore}</Badge>}
                        <span className="font-mono text-green-400 shrink-0">+{o.potentialProfit}€</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.9: AI Exit Strategy results */}
      {exitData && (
        <Card className="bg-amber-400/5 border-amber-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Target className="w-4 h-4" />
                AI Izhodna strategija
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.9</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setExitData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 text-xs">
              <div className={cn('border rounded p-2',
                exitData.strategy.recommendation === 'sell_now' ? 'bg-red-500/5 border-red-500/20' :
                exitData.strategy.recommendation === 'sell_soon' ? 'bg-amber-400/5 border-amber-400/20' :
                exitData.strategy.recommendation === 'hold' ? 'bg-primary/5 border-primary/20' :
                'bg-blue-400/5 border-blue-400/20')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">
                    {exitData.strategy.recommendation === 'sell_now' ? '🔴 PRODAJ TAKOJ' :
                     exitData.strategy.recommendation === 'sell_soon' ? '🟡 PRODAJ KMALU' :
                     exitData.strategy.recommendation === 'hold' ? '🟢 OBDRŽI' : '📦 PAKETNA PRODAJA'}
                  </span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    exitData.strategy.confidence >= 70 ? 'text-primary border-primary/40' : 'text-muted-foreground')}>
                    🎯 {exitData.strategy.confidence}%
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Cena:</span> <span className="font-mono font-bold text-primary">{exitData.strategy.suggestedPrice}€</span></div>
                  <div><span className="text-muted-foreground">Timing:</span> <span className="font-bold">{exitData.strategy.timing}</span></div>
                  <div><span className="text-muted-foreground">Strategija:</span> <span className="font-bold">{exitData.strategy.pricingStrategy}</span></div>
                </div>
                <p className="text-[10px] italic mt-1">{exitData.strategy.reasoning}</p>
              </div>
              {exitData.strategy.alternatives?.length > 0 && (
                <div className="bg-background/30 rounded p-2">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">💡 Alternative prodajne poti</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                    {exitData.strategy.alternatives.map((alt: string, i: number) => <li key={i}>{alt}</li>)}
                  </ul>
                </div>
              )}
              <div className="bg-background/30 rounded p-2 text-[10px] text-muted-foreground">
                📊 Tržno povprečje: {exitData.trade.marketAvg}€ • Konkurenca: {exitData.trade.marketCount} oglasov
                • {exitData.trade.daysHeld}d v skladišču • Kategorija ROI: {exitData.trade.avgCatROI}%
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.10: AI Bundle Optimizer results */}
      {bundleData && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Bundle optimizer</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.10</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setBundleData(null)} className="h-6 text-xs">×</Button>
            </div>
            {bundleData.strategy && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary">{bundleData.strategy}</div>
            )}
            {bundleData.summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle-i</div>
                  <div className="font-bold text-primary">{bundleData.summary.bundleItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Posamično</div>
                  <div className="font-bold">{bundleData.summary.individualItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle dobiček</div>
                  <div className="font-bold text-primary">{bundleData.summary.totalBundleProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Posamični dobiček</div>
                  <div className="font-bold">{bundleData.summary.totalIndividualProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. popust</div>
                  <div className="font-bold text-amber-400">{bundleData.summary.avgBundleSavings ?? 0}%</div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {bundleData.bundles?.map((b: any, i: number) => (
                <div key={i} className="border border-primary/20 bg-primary/5 rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs">{b.name}</span>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40">{b.strategy}</Badge>
                      <Badge variant="outline" className="text-[9px]">{b.items?.length ?? 0} itemov</Badge>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-primary text-xs">{b.bundlePrice}€</div>
                      <div className="text-[9px] text-muted-foreground line-through">{b.individualTotal}€</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{b.bundleCost}€</span></div>
                    <div><span className="text-muted-foreground">Dobiček:</span> <span className="font-mono font-bold text-primary">{b.expectedProfit}€</span></div>
                    <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{b.expectedSellTimeDays}d</span></div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    <span className="text-amber-400">−{b.savingsPct}%</span> popust · {b.reasoning}
                  </div>
                  <div className="text-[10px]">
                    {b.items?.map((it: any, j: number) => (
                      <span key={j} className="inline-block bg-background/60 px-1.5 py-0.5 rounded mr-1 mb-1 text-[9px]">{it.title}</span>
                    ))}
                  </div>
                </div>
              ))}
              {bundleData.bundles?.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">AI ni našel ugodnih bundle kombinacij.</p>
              )}
            </div>
            {bundleData.individualSale?.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                <span className="font-semibold">Za posamično prodajo:</span>{' '}
                {bundleData.individualSale.map((it: any) => it.title).join(', ')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.10: AI Liquidation Strategy results */}
      {liquidationData && (
        <Card className="bg-card/50 border-amber-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold">AI Likvidacijska strategija</span>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.10</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setLiquidationData(null)} className="h-6 text-xs">×</Button>
            </div>
            {liquidationData.summary && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs text-amber-400">{liquidationData.summary}</div>
            )}
            {liquidationData.totals && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{liquidationData.totals.itemCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Stalled</div>
                  <div className="font-bold text-amber-400">{liquidationData.totals.stalledCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Projekt. prihodek</div>
                  <div className="font-bold text-primary">{liquidationData.totals.totalProjectedRevenue ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Projekt. izguba</div>
                  <div className={cn('font-bold', (liquidationData.totals.totalProjectedLoss ?? 0) >= 0 ? 'text-primary' : 'text-destructive')}>
                    {(liquidationData.totals.totalProjectedLoss ?? 0) >= 0 ? '+' : ''}{liquidationData.totals.totalProjectedLoss ?? 0}€
                  </div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. čas</div>
                  <div className="font-bold">{liquidationData.totals.avgDaysToSell ?? 0}d</div>
                </div>
              </div>
            )}
            {liquidationData.totals?.urgencyBreakdown && (
              <div className="flex gap-1 text-[10px]">
                {(['critical', 'high', 'medium', 'low'] as const).map((u) => {
                  const cfg: Record<string, string> = {
                    critical: 'text-red-500 bg-red-500/5 border-red-500/20',
                    high: 'text-amber-400 bg-amber-400/5 border-amber-400/20',
                    medium: 'text-blue-400 bg-blue-400/5 border-blue-400/20',
                    low: 'text-muted-foreground bg-background/40 border-border',
                  };
                  return (
                    <span key={u} className={cn('px-2 py-0.5 rounded border', cfg[u])}>
                      {u === 'critical' ? '🔴' : u === 'high' ? '🟡' : u === 'medium' ? '🔵' : '⚪'} {u}: <b>{liquidationData.totals.urgencyBreakdown[u] ?? 0}</b>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="space-y-2">
              {liquidationData.items?.map((it: any, i: number) => {
                const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  low: { color: 'text-muted-foreground', bg: 'border-border bg-background/30', icon: '⚪' },
                };
                const cfg = urgencyCfg[it.urgency] || urgencyCfg.medium;
                const strategyLabels: Record<string, string> = {
                  discount_progressive: 'Progresivni popust',
                  auction_online: 'Online dražba',
                  bundle_with_hot: 'Bundle s hitrim',
                  part_out: 'Razstavi na dele',
                  flash_sale: 'Flash sale',
                  trade_in: 'Trade-in',
                  wait_seasonal: 'Čakaj sezono',
                  donation_tax: 'Donacija',
                  relist_refresh: 'Ponovna objava',
                };
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs">{cfg.icon}</span>
                        <span className="font-bold text-xs">{it.title}</span>
                        <Badge variant="outline" className="text-[9px]">{it.category}</Badge>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] border', cfg.color)}>
                        {strategyLabels[it.strategy] || it.strategy}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Cena:</span> <span className="font-mono font-bold text-primary">{it.expectedPrice}€</span></div>
                      <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{it.cost}€</span></div>
                      <div><span className="text-muted-foreground">Izguba:</span> <span className={cn('font-mono font-bold', it.projectedLoss >= 0 ? 'text-primary' : 'text-destructive')}>{it.projectedLoss >= 0 ? '+' : ''}{it.projectedLoss}€</span></div>
                      <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{it.timeToSellDays}d</span></div>
                    </div>
                    {it.steps?.length > 0 && (
                      <ol className="text-[10px] list-decimal list-inside space-y-0.5">
                        {it.steps.map((s: string, j: number) => <li key={j}>{s}</li>)}
                      </ol>
                    )}
                    <div className="text-[9px] text-muted-foreground italic">⏱ {it.daysHeld}d v skladišču · {it.reasoning}</div>
                  </div>
                );
              })}
              {liquidationData.items?.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">Ni itemov za likvidacijo.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.14: AI Multi-Modal Listing Generator results */}
      {listingGen && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Listing Generator</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
                {listingGen.listing?.priceStrategy && (
                  <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/40 uppercase">
                    {listingGen.listing.priceStrategy}
                  </Badge>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setListingGen(null)} className="h-6 text-xs">×</Button>
            </div>

            {listingGen.listing && (
              <div className="space-y-3">
                {/* Title + price */}
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase text-muted-foreground">Naslov ({listingGen.platform})</span>
                    <div className="text-right">
                      <div className="font-mono font-bold text-primary">{listingGen.listing.priceRecommendation}€</div>
                      <div className="text-[9px] text-muted-foreground">priporočena cena</div>
                    </div>
                  </div>
                  <div className="font-bold text-sm">{listingGen.listing.title}</div>
                </div>

                {/* Market benchmark */}
                {listingGen.marketBenchmark && (
                  <div className="text-[10px] text-muted-foreground">📊 {listingGen.marketBenchmark}</div>
                )}

                {/* Main description */}
                {listingGen.listing.mainDescription && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] uppercase text-muted-foreground">Glavni opis:</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(listingGen.listing.mainDescription);
                          setListingGenCopied('main');
                          setTimeout(() => setListingGenCopied(null), 1500);
                          toast.success('Opis kopiran');
                        }}
                        className="text-[9px] text-primary hover:underline flex items-center gap-1"
                      >
                        {listingGenCopied === 'main' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Kopiraj
                      </button>
                    </div>
                    <div className="bg-background/40 border rounded p-2 text-[11px] whitespace-pre-wrap">
                      {listingGen.listing.mainDescription}
                    </div>
                  </div>
                )}

                {/* Call to action */}
                {listingGen.listing.callToAction && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5 text-[11px]">
                    <span className="text-[9px] uppercase text-primary font-bold">📣 CTA: </span>
                    <span>{listingGen.listing.callToAction}</span>
                  </div>
                )}

                {/* Highlight features */}
                {listingGen.listing.highlightFeatures?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">✨ Highlight features:</div>
                    <div className="flex flex-wrap gap-1">
                      {listingGen.listing.highlightFeatures.map((f: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px] text-primary border-primary/30">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Honest disclosures */}
                {listingGen.listing.honestDisclosures?.length > 0 && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                    <div className="text-[10px] uppercase text-amber-400 mb-1">🔍 Poštene opombe:</div>
                    <ul className="space-y-0.5 ml-3">
                      {listingGen.listing.honestDisclosures.map((d: string, i: number) => (
                        <li key={i} className="text-[10px] list-disc list-outside">{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Platform adaptations */}
                {listingGen.listing.platformsAdaptations?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">📱 Prilagoditve po platformah:</div>
                    <div className="space-y-2">
                      {listingGen.listing.platformsAdaptations.map((p: any, i: number) => (
                        <div key={i} className="bg-background/40 border rounded p-2">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="text-[9px] uppercase">{p.platform}</Badge>
                            <span className="font-mono font-bold text-primary text-[11px]">{p.price}€</span>
                          </div>
                          <div className="font-bold text-[11px] mb-1">{p.title}</div>
                          <div className="text-[10px] text-muted-foreground whitespace-pre-wrap">{p.descriptionShort}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Image strategy */}
                {listingGen.listing.imageStrategy && (
                  <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2">
                    <div className="text-[10px] uppercase text-blue-400 mb-1">📸 Slikovna strategija:</div>
                    <div className="space-y-1 text-[10px]">
                      <div><span className="font-semibold">Glavna:</span> {listingGen.listing.imageStrategy.mainShot}</div>
                      {listingGen.listing.imageStrategy.detailShots?.length > 0 && (
                        <div>
                          <span className="font-semibold">Detalji:</span>
                          <ul className="ml-3">
                            {listingGen.listing.imageStrategy.detailShots.map((s: string, i: number) => (
                              <li key={i} className="list-disc list-outside">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div><span className="font-semibold">Kontekst:</span> {listingGen.listing.imageStrategy.contextShot}</div>
                      {listingGen.listing.imageStrategy.videoRecommended && (
                        <div className="text-primary font-medium">🎥 Video priporočen: {listingGen.listing.imageStrategy.videoDescription}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* SEO */}
                {listingGen.listing.seo && (
                  <div className="bg-background/40 border rounded p-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">🔍 SEO:</div>
                    <div className="text-[10px]">
                      <div><span className="font-semibold">Primarna ključna beseda:</span> {listingGen.listing.seo.primaryKeyword}</div>
                      {listingGen.listing.seo.searchTerms?.length > 0 && (
                        <div className="mt-1">
                          <span className="font-semibold">Iskalni izrazi:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {listingGen.listing.seo.searchTerms.map((s: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {listingGen.listing.tagsKeywords?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">🏷️ Tags:</div>
                    <div className="flex flex-wrap gap-1">
                      {listingGen.listing.tagsKeywords.map((t: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px] text-muted-foreground">#{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.15: AI Tax Loss Harvesting results */}
      {taxHarvestData && (
        <Card className="bg-card/50 border-amber-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold">AI Tax Loss Harvesting</span>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.15</Badge>
                <Badge variant="outline" className="text-[9px]">leto {taxHarvestData.harvesting?.year}</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTaxHarvestData(null)} className="h-6 text-xs">×</Button>
            </div>

            {taxHarvestData.harvesting && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Dobički</div>
                  <div className="font-bold text-primary">{taxHarvestData.harvesting.realizedGains}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Izgube</div>
                  <div className="font-bold text-destructive">−{taxHarvestData.harvesting.realizedLosses}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Neto</div>
                  <div className={cn('font-bold', taxHarvestData.harvesting.netGain >= 0 ? 'text-primary' : 'text-destructive')}>
                    {taxHarvestData.harvesting.netGain}€
                  </div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Davek (40%)</div>
                  <div className="font-bold text-destructive">{taxHarvestData.harvesting.taxDue}€</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                  <div className="text-amber-400 uppercase">Po carryforward</div>
                  <div className="font-bold text-amber-400">{taxHarvestData.harvesting.taxDueAfterCarryforward}€</div>
                  <div className="text-[9px] text-primary">−{taxHarvestData.harvesting.taxSavedByCarryforward}€</div>
                </div>
              </div>
            )}

            {taxHarvestData.taxStrategy && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs text-amber-400">
                📋 {taxHarvestData.taxStrategy}
              </div>
            )}

            {/* Year-end plan */}
            {taxHarvestData.yearEndPlan && taxHarvestData.yearEndPlan.shouldHarvest && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">
                  🎯 Year-end harvesting načrt:
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
                  <div><span className="text-muted-foreground">Cilj izgube:</span> <b className="font-mono">{taxHarvestData.yearEndPlan.targetLossEur}€</b></div>
                  <div><span className="text-muted-foreground">Prihranek davka:</span> <b className="font-mono text-primary">{taxHarvestData.yearEndPlan.taxSavingsEur}€</b></div>
                  <div><span className="text-muted-foreground">Rok:</span> <b>{taxHarvestData.yearEndPlan.deadline}</b></div>
                </div>
                {taxHarvestData.yearEndPlan.steps?.length > 0 && (
                  <ol className="space-y-0.5 ml-3">
                    {taxHarvestData.yearEndPlan.steps.map((s: string, i: number) => (
                      <li key={i} className="text-[10px] list-decimal list-outside">{s}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {/* Carryforward analysis */}
            {taxHarvestData.carryforwardAnalysis && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Loss carryforward analiza:</div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Na voljo:</span> <b className="font-mono">{taxHarvestData.carryforwardAnalysis.availableLossesEur}€</b></div>
                  <div><span className="text-muted-foreground">Letos uporabljeno:</span> <b className="font-mono text-primary">{taxHarvestData.carryforwardAnalysis.utilizedThisYearEur}€</b></div>
                  <div><span className="text-muted-foreground">Za prihodnje:</span> <b className="font-mono">{taxHarvestData.carryforwardAnalysis.remainingForFutureEur}€</b></div>
                </div>
                {taxHarvestData.carryforwardAnalysis.optimalUsage && (
                  <div className="text-[9px] text-muted-foreground italic mt-1">{taxHarvestData.carryforwardAnalysis.optimalUsage}</div>
                )}
              </div>
            )}

            {/* Harvesting candidates */}
            {taxHarvestData.recommendations?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🌱 Kandidati za harvesting ({taxHarvestData.recommendations.length}):</div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {taxHarvestData.recommendations.map((r: any, i: number) => {
                    const actCfg: Record<string, { color: string; bg: string; icon: string }> = {
                      harvest_now: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                      wait_year_end: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                      wait_3yr_holding: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                      hold: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                      bundle_with_gain: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                    };
                    const cfg = actCfg[r.action] || actCfg.hold;
                    return (
                      <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span>{cfg.icon}</span>
                            <span className="font-bold text-[11px] truncate">{r.title}</span>
                          </div>
                          <Badge variant="outline" className={cn('text-[9px] uppercase shrink-0', cfg.color)}>
                            {r.action.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-[9px]">
                          <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{r.cost}€</span></div>
                          <div><span className="text-muted-foreground">Est. prodaja:</span> <span className="font-mono">{r.estimatedValue}€</span></div>
                          <div><span className="text-muted-foreground">Izguba:</span> <span className="font-mono text-destructive">−{r.projectedLoss}€</span></div>
                          <div><span className="text-muted-foreground">Davek:</span> <span className="font-mono text-primary">+{r.taxBenefitEur}€</span></div>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          ⏱ {r.daysHeld}d ({r.daysHeldYears} let) · Rok: {r.deadline || '—'}
                        </div>
                        {r.reasoning && <div className="text-[9px] italic">{r.reasoning}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Warnings */}
            {taxHarvestData.warnings?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Davčna opozorila:</div>
                <ul className="space-y-0.5 ml-3">
                  {taxHarvestData.warnings.map((w: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.16: AI Multi-Vendor Bundle results */}
      {multiVendorData && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Multi-Vendor Bundle Deals</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setMultiVendorData(null)} className="h-6 text-xs">×</Button>
            </div>

            {multiVendorData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary">{multiVendorData.insights}</div>
            )}

            {multiVendorData.summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle-i</div>
                  <div className="font-bold text-primary">{multiVendorData.summary.totalDeals ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{multiVendorData.summary.bundledItems ?? 0}/{multiVendorData.summary.totalItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Dobiček</div>
                  <div className="font-bold text-primary">{multiVendorData.summary.totalBundleProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. popust</div>
                  <div className="font-bold text-amber-400">{multiVendorData.summary.avgSavings ?? 0}%</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Virov</div>
                  <div className="font-bold">{multiVendorData.summary.sourcesAnalyzed ?? 0}</div>
                </div>
              </div>
            )}

            {/* Bundle deals */}
            {multiVendorData.deals?.length > 0 && (
              <div className="space-y-2">
                {multiVendorData.deals.map((d: any, i: number) => (
                  <div key={i} className="border border-primary/20 bg-primary/5 rounded p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs">{d.name}</span>
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40">{d.strategy.replace('_', ' ')}</Badge>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-primary text-xs">{d.bundlePrice}€</div>
                        <div className="text-[9px] text-muted-foreground line-through">{d.individualTotal}€</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {d.sources?.map((s: string, j: number) => (
                        <Badge key={j} variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">📍 {s}</Badge>
                      ))}
                      <Badge variant="outline" className="text-[9px]">{d.items?.length} itemov</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{d.totalCost}€</span></div>
                      <div><span className="text-muted-foreground">Dobiček:</span> <span className="font-mono font-bold text-primary">{d.expectedProfit}€</span></div>
                      <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{d.expectedSellTimeDays}d</span></div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      <span className="text-amber-400">−{d.savingsPct}%</span> popust · 🎯 {d.targetBuyer}
                    </div>
                    {d.reasoning && <div className="text-[10px] italic">{d.reasoning}</div>}
                    <div className="text-[10px]">
                      {d.items?.map((it: any, j: number) => (
                        <span key={j} className="inline-block bg-background/60 px-1.5 py-0.5 rounded mr-1 mb-1 text-[9px]">
                          {it.title} ({it.source})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Unbundled items */}
            {multiVendorData.unbundledItems?.length > 0 && (
              <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                <span className="font-semibold">Ne-bundlani itemi ({multiVendorData.unbundledItems.length}):</span>{' '}
                {multiVendorData.unbundledItems.slice(0, 5).map((it: any) => it.title).join(', ')}
                {multiVendorData.unbundledItems.length > 5 && '...'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.21: AI Optimal Listing Time Predictor results */}
      {optimalTimeData && (
        <Card className="bg-card/50 border-blue-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold">AI Optimal Listing Time</span>
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.21</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOptimalTimeData(null)} className="h-6 text-xs">×</Button>
            </div>

            {optimalTimeData.insights && (
              <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-xs text-blue-400">{optimalTimeData.insights}</div>
            )}

            {optimalTimeData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{optimalTimeData.summary.totalItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. cena</div>
                  <div className="font-bold text-primary">{optimalTimeData.summary.avgExpectedPrice ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. čas</div>
                  <div className="font-bold">{optimalTimeData.summary.avgTimeToSell ?? 0}d</div>
                </div>
                <div className="bg-blue-400/5 border border-blue-400/20 rounded p-1.5">
                  <div className="text-blue-400 uppercase">Skupni prihodek</div>
                  <div className="font-bold text-primary">{optimalTimeData.summary.totalExpectedRevenue ?? 0}€</div>
                </div>
              </div>
            )}

            {/* Predictions */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {optimalTimeData.predictions?.map((p: any, i: number) => {
                const stratCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  premium_time: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '⭐' },
                  off_peak: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  flash_sale: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔥' },
                  staggered: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '📅' },
                  wait_seasonal: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '🎄' },
                };
                const cfg = stratCfg[p.strategy] || stratCfg.premium_time;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{p.title}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', cfg.color)}>{p.strategy.replace('_', ' ')}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div>
                        <div className="text-muted-foreground">📅 Dan</div>
                        <div className="font-bold capitalize">{p.optimalDay}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">⏰ Ura</div>
                        <div className="font-mono font-bold">{String(p.optimalHour).padStart(2, '0')}:00</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">📍 Platforma</div>
                        <div className="font-bold capitalize">{p.optimalPlatform}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">💰 Cena</div>
                        <div className="font-mono font-bold text-primary">{p.expectedPriceEur}€</div>
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      ⏱ {p.expectedTimeToSellDays}d prodaja · {p.seasonalityNote}
                    </div>
                    {p.reasoning && <div className="text-[9px] italic">{p.reasoning}</div>}
                  </div>
                );
              })}
            </div>

            {/* Historical data */}
            {optimalTimeData.historicalData?.salesByDay?.some((d: any) => d.count > 0) && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Zgodovina prodaj po dnevih:</div>
                <div className="grid grid-cols-7 gap-1 text-[9px]">
                  {optimalTimeData.historicalData.salesByDay.map((d: any, j: number) => (
                    <div key={j} className="text-center">
                      <div className="text-muted-foreground capitalize truncate">{d.day.slice(0, 3)}</div>
                      <div className={cn('font-mono font-bold', d.count > 0 ? 'text-primary' : 'text-muted-foreground')}>{d.count}</div>
                      {d.count > 0 && <div className="text-[8px] text-muted-foreground">{d.avgProfit}€</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.22: AI Title A/B Tester results */}
      {titleAbTestData?.test && (
        <Card className="bg-card/50 border-purple-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-bold">AI Title A/B Tester</span>
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/40">v6.22</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTitleAbTestData(null)} className="h-6 text-xs">×</Button>
            </div>

            {/* Current title analysis */}
            <div className="bg-background/40 border rounded p-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">Trenutni naslov:</div>
              <div className="font-bold text-[12px]">{titleAbTestData.test.currentTitle}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  titleAbTestData.test.currentTitleAnalysis.score >= 70 ? 'text-primary border-primary/40' :
                  titleAbTestData.test.currentTitleAnalysis.score >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  Score: {titleAbTestData.test.currentTitleAnalysis.score}/100
                </Badge>
              </div>
            </div>

            {/* Winner */}
            {titleAbTestData.test.winner?.title && (
              <div className="bg-primary/10 border border-primary/30 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🏆 Zmagovalni naslov:</div>
                <div className="font-bold text-[12px] text-primary">{titleAbTestData.test.winner.title}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{titleAbTestData.test.winner.why}</div>
                {titleAbTestData.test.winner.expectedImprovementPct > 0 && (
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/40 mt-1">
                    +{titleAbTestData.test.winner.expectedImprovementPct}% izboljšava
                  </Badge>
                )}
              </div>
            )}

            {/* Variants */}
            {titleAbTestData.test.variants?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Variante naslovov:</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {titleAbTestData.test.variants.map((v: any, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-[11px] flex-1">{v.title}</div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px] text-purple-400 border-purple-400/30">{v.strategy.replace('_', ' ')}</Badge>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(v.title);
                              setTitleAbTestCopied(`v${i}`);
                              setTimeout(() => setTitleAbTestCopied(null), 1500);
                              toast.success('Naslov kopiran');
                            }}
                            className="text-[9px] text-purple-400 hover:underline"
                          >
                            {titleAbTestCopied === `v${i}` ? '✓' : '📋'}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">CTR</div>
                          <div className={cn('font-mono font-bold', v.ctrScore >= 70 ? 'text-primary' : v.ctrScore >= 40 ? 'text-amber-400' : 'text-red-500')}>{v.ctrScore}</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">Search</div>
                          <div className={cn('font-mono font-bold', v.searchVisibility >= 70 ? 'text-primary' : 'text-amber-400')}>{v.searchVisibility}</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">Convert</div>
                          <div className={cn('font-mono font-bold', v.conversionScore >= 70 ? 'text-primary' : 'text-amber-400')}>{v.conversionScore}</div>
                        </div>
                        <div className={cn('rounded p-1 border text-center',
                          v.overallScore >= 70 ? 'bg-primary/5 border-primary/20' : 'bg-background/40 border')}>
                          <div className="text-[8px] uppercase text-muted-foreground">Skupno</div>
                          <div className={cn('font-mono font-bold', v.overallScore >= 70 ? 'text-primary' : 'text-amber-400')}>{v.overallScore}</div>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        📝 {v.characterCount} znakov · 📍 {v.bestForPlatform}
                      </div>
                      {v.strengths?.length > 0 && (
                        <div className="text-[9px] text-primary">✓ {v.strengths.join(' · ')}</div>
                      )}
                      {v.weaknesses?.length > 0 && (
                        <div className="text-[9px] text-red-500">⚠️ {v.weaknesses.join(' · ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Platform-specific titles */}
            {titleAbTestData.test.platformSpecificTitles && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📱 Platform-specific naslovi:</div>
                <div className="space-y-1">
                  {Object.entries(titleAbTestData.test.platformSpecificTitles).map(([platform, title]: [string, any]) => (
                    title ? (
                      <div key={platform} className="text-[10px] flex items-center justify-between gap-2">
                        <span><Badge variant="outline" className="text-[8px] mr-1 capitalize">{platform}</Badge> {String(title)}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(String(title));
                            setTitleAbTestCopied(`p${platform}`);
                            setTimeout(() => setTitleAbTestCopied(null), 1500);
                            toast.success(`${platform} naslov kopiran`);
                          }}
                          className="text-[9px] text-purple-400 hover:underline shrink-0"
                        >
                          {titleAbTestCopied === `p${platform}` ? '✓' : '📋'}
                        </button>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            {titleAbTestData.test.tips?.length > 0 && (
              <div className="bg-purple-400/5 border border-purple-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-purple-400 mb-1">💡 Nasveti:</div>
                <ul className="space-y-0.5 ml-3">
                  {titleAbTestData.test.tips.map((t: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.22: AI Buyer Persona Generator results */}
      {personaData?.personas && (
        <Card className="bg-card/50 border-emerald-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold">AI Buyer Persona Generator</span>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/40">v6.22</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPersonaData(null)} className="h-6 text-xs">×</Button>
            </div>

            {personaData.insights && (
              <div className="bg-emerald-400/5 border border-emerald-400/20 rounded p-2 text-xs text-emerald-400">{personaData.insights}</div>
            )}

            {/* Marketing strategy */}
            {personaData.marketingStrategy && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🎯 Marketinška strategija:</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Primarna persona:</span> <b>{personaData.marketingStrategy.primaryPersona}</b></div>
                  <div><span className="text-muted-foreground">Sekundarna:</span> <b>{personaData.marketingStrategy.secondaryPersona}</b></div>
                  <div><span className="text-muted-foreground">Platforma:</span> <b className="capitalize">{personaData.marketingStrategy.recommendedPlatform}</b></div>
                  <div><span className="text-muted-foreground">Ton:</span> <b>{personaData.marketingStrategy.listingTone}</b></div>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">⏰ {personaData.marketingStrategy.optimalTiming}</div>
                {personaData.marketingStrategy.mustIncludeInListing?.length > 0 && (
                  <div className="text-[9px] mt-1">
                    <span className="text-primary font-semibold">✓ Vključi:</span> {personaData.marketingStrategy.mustIncludeInListing.join(' · ')}
                  </div>
                )}
                {personaData.marketingStrategy.avoidInListing?.length > 0 && (
                  <div className="text-[9px] mt-0.5">
                    <span className="text-red-500 font-semibold">⚠️ Izogni:</span> {personaData.marketingStrategy.avoidInListing.join(' · ')}
                  </div>
                )}
              </div>
            )}

            {/* Personas */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {personaData.personas.map((p: any, i: number) => {
                const typeCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  BUDGET_CONSCIOUS: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '💰' },
                  QUALITY_SEEKER: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '⭐' },
                  PREMIUM: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '👑' },
                  COLLECTOR: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '🎨' },
                  FLIPPER: { color: 'text-emerald-400', bg: 'border-emerald-400/20 bg-emerald-400/5', icon: '📈' },
                };
                const cfg = typeCfg[p.type] || typeCfg.BUDGET_CONSCIOUS;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px]">{p.name}</span>
                        <Badge variant="outline" className={cn('text-[8px] shrink-0', cfg.color)}>{p.type.replace('_', ' ')}</Badge>
                      </div>
                      <Badge variant="outline" className="text-[8px] shrink-0">💰 {p.willingnessToPayEur}€</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Starost:</span> <b>{p.ageRange}</b></div>
                      <div><span className="text-muted-foreground">Lokacija:</span> <b>{p.location}</b></div>
                      <div><span className="text-muted-foreground">Dohodek:</span> <b>{p.incomeRangeEur}€</b></div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      📅 Odločitev: {p.decisionTimeDays}d · 📉 Občutljivost: {p.priceSensitivity} · 📍 {p.preferredChannels.join(', ')}
                    </div>
                    {p.motivations?.length > 0 && (
                      <div className="text-[9px]"><span className="text-primary font-semibold">Motivacije:</span> {p.motivations.join(' · ')}</div>
                    )}
                    {p.painPoints?.length > 0 && (
                      <div className="text-[9px]"><span className="text-red-500 font-semibold">Skrbi:</span> {p.painPoints.join(' · ')}</div>
                    )}
                    {p.messaging?.hook && (
                      <div className="bg-background/40 rounded p-1 border text-[9px]">
                        <span className="text-primary font-semibold">🎯 Hook ({p.messaging.tone}):</span> {p.messaging.hook}
                        {p.messaging.keyArguments?.length > 0 && (
                          <div className="mt-0.5">📝 {p.messaging.keyArguments.join(' · ')}</div>
                        )}
                        <div className="mt-0.5 text-primary">📣 {p.messaging.callToAction}</div>
                      </div>
                    )}
                    {p.trustFactors?.length > 0 && (
                      <div className="text-[9px]"><span className="text-primary font-semibold">✓ Zaupanje:</span> {p.trustFactors.join(' · ')}</div>
                    )}
                    {p.objectionHandling?.length > 0 && (
                      <div className="text-[9px] space-y-0.5">
                        <div className="text-amber-400 font-semibold">🔄 Objection handling:</div>
                        {p.objectionHandling.map((o: any, j: number) => (
                          <div key={j} className="ml-2">
                            <div className="text-red-500">„{o.objection}"</div>
                            <div className="text-primary">→ {o.response}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.23: AI Cross-Platform Price Comparison results */}
      {crossPriceData?.comparison && (
        <Card className="bg-card/50 border-indigo-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold">AI Cross-Platform Price Comparison</span>
                <Badge variant="outline" className="text-[10px] text-indigo-400 border-indigo-400/40">v6.23</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setCrossPriceData(null)} className="h-6 text-xs">×</Button>
            </div>

            <div className="text-[10px] text-muted-foreground">Item: <b>{crossPriceData.comparison.itemTitle}</b></div>

            {/* Recommendation */}
            {crossPriceData.comparison.recommendation && (
              <div className={cn('border rounded p-2',
                crossPriceData.comparison.recommendation.action === 'buy_now' ? 'bg-primary/10 border-primary/30' :
                crossPriceData.comparison.recommendation.action === 'avoid' ? 'bg-red-500/10 border-red-500/30' :
                'bg-amber-400/10 border-amber-400/30')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase font-bold">
                    → {crossPriceData.comparison.recommendation.action.replace('_', ' ')}
                  </span>
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                    Pričakovan dobiček: {crossPriceData.comparison.recommendation.expectedProfitEur}€
                  </Badge>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  🛒 Kupi na: <b>{crossPriceData.comparison.recommendation.bestBuyPlatform}</b> · 💰 Prodaj na: <b>{crossPriceData.comparison.recommendation.bestSellPlatform}</b>
                </div>
                <p className="text-[9px] italic mt-1">{crossPriceData.comparison.recommendation.reasoning}</p>
              </div>
            )}

            {/* Prices table */}
            {crossPriceData.comparison.prices?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">💰 Cene po platformah:</div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {crossPriceData.comparison.prices.map((p: any, i: number) => (
                    <div key={i} className={cn('border rounded p-1.5 flex items-center justify-between gap-2',
                      p === crossPriceData.comparison.cheapest ? 'bg-primary/5 border-primary/20' : 'bg-background/40')}>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-[10px] font-bold truncate">{p.platformName}</span>
                        <Badge variant="outline" className="text-[8px] shrink-0">{p.country}</Badge>
                        <Badge variant="outline" className={cn('text-[8px] shrink-0',
                          p.demandLevel === 'high' ? 'text-primary border-primary/30' :
                          p.demandLevel === 'low' ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                          {p.demandLevel}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-[11px]">{p.estimatedPriceEur}€</div>
                        <div className="text-[8px] text-muted-foreground">neto {p.netRevenueEur}€</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Arbitrage opportunities */}
            {crossPriceData.comparison.arbitrageOpportunities?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">⚡ Arbitražne priložnosti:</div>
                <div className="space-y-1">
                  {crossPriceData.comparison.arbitrageOpportunities.map((a: any, i: number) => (
                    <div key={i} className="bg-indigo-400/5 border border-indigo-400/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span><Badge variant="outline" className="text-[8px] mr-1">{a.strategy.replace('_', ' ')}</Badge> {a.buyPlatform} → {a.sellPlatform}</span>
                        <Badge variant="outline" className="text-[8px] text-primary border-primary/30">+{a.netProfitEur}€ ({a.roiPct}%)</Badge>
                      </div>
                      <div className="text-[8px] text-muted-foreground mt-0.5">
                        Kupi {a.buyPriceEur}€ · Prodaj {a.sellPriceEur}€ · Shipping {a.shippingEur}€ · Provizije {a.feesEur}€ · {a.timeRequiredDays}d · {a.feasibility}
                      </div>
                      <div className="text-[8px] italic">{a.reasoning}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {crossPriceData.insights && (
              <div className="bg-indigo-400/5 border border-indigo-400/20 rounded p-2 text-xs text-indigo-400">{crossPriceData.insights}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.23: AI Inventory Depreciation Forecaster results */}
      {depreciationData && (
        <Card className="bg-card/50 border-orange-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LineChartIcon className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold">AI Inventory Depreciation Forecaster</span>
                <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/40">v6.23</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDepreciationData(null)} className="h-6 text-xs">×</Button>
            </div>

            {depreciationData.insights && (
              <div className="bg-orange-400/5 border border-orange-400/20 rounded p-2 text-xs text-orange-400">{depreciationData.insights}</div>
            )}

            {/* Portfolio summary */}
            {depreciationData.portfolioSummary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Trenutna vrednost</div>
                  <div className="font-bold text-primary">{depreciationData.portfolioSummary.totalCurrentValueEur}€</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                  <div className="text-amber-400 uppercase">Izguba 6m</div>
                  <div className="font-bold text-amber-400">−{depreciationData.portfolioSummary.projectedLoss6mEur}€</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                  <div className="text-red-500 uppercase">Izguba 12m</div>
                  <div className="font-bold text-red-500">−{depreciationData.portfolioSummary.projectedLoss12mEur}€</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                  <div className="text-red-500 uppercase">Izguba 24m</div>
                  <div className="font-bold text-red-500">−{depreciationData.portfolioSummary.projectedLoss24mEur}€</div>
                </div>
              </div>
            )}

            {/* Forecasts per item */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {depreciationData.forecasts?.map((f: any, i: number) => {
                const actionCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  sell_now: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  sell_soon: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  monitor: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  hold: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                  vintage_holding: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '👑' },
                };
                const cfg = actionCfg[f.action] || actionCfg.monitor;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{f.title}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[8px] uppercase shrink-0', cfg.color)}>
                        {f.action.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">Trenutno</div>
                        <div className="font-mono font-bold">{f.currentValue}€</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">6m</div>
                        <div className="font-mono font-bold text-amber-400">{f.projectedValue6mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss6mPct}%</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">12m</div>
                        <div className="font-mono font-bold text-orange-400">{f.projectedValue12mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss12mPct}%</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">24m</div>
                        <div className="font-mono font-bold text-red-500">{f.projectedValue24mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss24mPct}%</div>
                      </div>
                    </div>
                    {f.monthsToZeroProfit != null && (
                      <div className="text-[9px] text-amber-400">⏱ Do izgube dobička: <b>{f.monthsToZeroProfit} mesecev</b></div>
                    )}
                    {f.optimalSellWindow && (
                      <div className="text-[9px] text-primary">📅 Optimalen čas prodaje: {f.optimalSellWindow}</div>
                    )}
                    {f.reasoning && <div className="text-[9px] italic">{f.reasoning}</div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.24: AI Listing Performance Tracker results */}
      {perfData && (
        <Card className="bg-card/50 border-teal-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-bold">AI Listing Performance Tracker</span>
                <Badge variant="outline" className="text-[10px] text-teal-400 border-teal-400/40">v6.24</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPerfData(null)} className="h-6 text-xs">×</Button>
            </div>

            {perfData.insights && (
              <div className="bg-teal-400/5 border border-teal-400/20 rounded p-2 text-xs text-teal-400">{perfData.insights}</div>
            )}

            {/* Summary */}
            {perfData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Skupni dobiček</div><div className="font-bold text-primary">{perfData.summary.totalProfitEur ?? 0}€</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Povp. ROI</div><div className="font-bold text-primary">{perfData.summary.avgRoiPct ?? 0}%</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Povp. dni prodaje</div><div className="font-bold">{perfData.summary.avgDaysToSell ?? 0}d</div></div>
                <div className="bg-teal-400/5 border border-teal-400/20 rounded p-1.5"><div className="text-teal-400 uppercase">Strategija</div><div className="font-bold text-teal-400">{(perfData.summary.recommendedStrategy ?? 'double_down').replace('_', ' ')}</div></div>
              </div>
            )}

            {/* Category performance */}
            {perfData.categoryPerformance?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Uspešnost po kategorijah:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.categoryPerformance.map((c: any, i: number) => {
                    const recCfg: Record<string, { color: string; icon: string }> = {
                      double_down: { color: 'text-primary', icon: '📈' },
                      pivot: { color: 'text-amber-400', icon: '🔄' },
                      scale_up: { color: 'text-primary', icon: '⬆️' },
                      diversify: { color: 'text-blue-400', icon: '➕' },
                      exit: { color: 'text-red-500', icon: '❌' },
                    };
                    const cfg = recCfg[c.recommendation] || recCfg.double_down;
                    return (
                      <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <Badge variant="outline" className="text-[8px] shrink-0">{c.category}</Badge>
                          <span className="text-muted-foreground">{c.avgDaysToSell}d · {c.successRatePct}% uspeh</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-primary">{c.totalProfitEur}€</span>
                          <Badge variant="outline" className={cn('text-[8px]', cfg.color)}>{c.recommendation.replace('_', ' ')}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top performers */}
            {perfData.topPerformersAnalysis?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-primary mb-1">🏆 Top uspešne prodaje:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.topPerformersAnalysis.map((t: any, i: number) => (
                    <div key={i} className="bg-primary/5 border border-primary/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{t.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px] text-primary border-primary/30">{t.roiPct}% ROI</Badge>
                          <span className="font-mono font-bold text-primary">{t.profitEur}€</span>
                        </div>
                      </div>
                      {t.successFactors?.length > 0 && <div className="text-[9px] text-muted-foreground mt-0.5">✓ {t.successFactors.join(' · ')}</div>}
                      {t.replicate && <div className="text-[9px] text-primary italic mt-0.5">🔄 {t.replicate}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Worst performers */}
            {perfData.worstPerformersAnalysis?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Neuspešne prodaje:</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {perfData.worstPerformersAnalysis.map((t: any, i: number) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{t.title}</span>
                        <span className="font-mono font-bold text-destructive">{t.profitEur}€</span>
                      </div>
                      {t.failureReasons?.length > 0 && <div className="text-[9px] text-red-500 mt-0.5">❌ {t.failureReasons.join(' · ')}</div>}
                      {t.lesson && <div className="text-[9px] text-amber-400 italic mt-0.5">💡 {t.lesson}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Held items forecast */}
            {perfData.heldItemsForecast?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🔮 Napoved za held iteme:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.heldItemsForecast.map((h: any, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{h.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px]">{h.confidencePct}%</Badge>
                          <span className="font-mono font-bold text-primary">{h.predictedProfitEur}€</span>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        📅 {h.predictedDaysToSell}d · 💰 {h.recommendedPriceEur}€ · 📍 {h.recommendedPlatform}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {perfData.recommendations?.length > 0 && (
              <div className="bg-teal-400/5 border border-teal-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-teal-400 mb-1">💡 Priporočila:</div>
                <ul className="space-y-0.5 ml-3">
                  {perfData.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Trades list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-card animate-pulse rounded" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Še ni tradov. Dodaj prvi trade z gumbom "Nov trade".</p>
            <p className="text-xs text-muted-foreground mt-1">Ko v Listings klikneš "Kupi", se bo samodejno dodal sem.</p>
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
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <TradeFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} onSaved={() => { setShowForm(false); load(); }} />
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Card className="bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={color}>{icon}</span>
        </div>
        <div className={cn('text-lg font-bold font-mono', color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade, onEdit, onDelete, onSync, onExit }: { trade: Trade; onEdit: () => void; onDelete: () => void; onSync?: (tradeId: string) => void; onExit?: (tradeId: string) => void }) {
  const totalCost = trade.buyPrice + (trade.buyFees || 0);
  const revenue = trade.sellPrice != null ? trade.sellPrice - (trade.sellFees || 0) : null;
  const profit = revenue != null ? revenue - totalCost : null;
  const roi = (profit != null && totalCost > 0) ? (profit / totalCost) * 100 : null;

  const statusBadge =
    trade.status === 'held' ? { text: 'V SKLADIŠČU', cls: 'border-amber-400/40 text-amber-400' } :
    trade.status === 'sold' ? { text: 'PRODANO', cls: 'border-primary/40 text-primary' } :
    { text: 'PREKlicano', cls: 'border-muted text-muted-foreground' };

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {trade.imageUrl ? (
            <img src={trade.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-muted shrink-0" loading="lazy" />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className={cn('text-[10px] uppercase', statusBadge.cls)}>{statusBadge.text}</Badge>
              {trade.category && <Badge variant="outline" className="text-[10px]">{trade.category}</Badge>}
              {trade.listing && (
                <a href={trade.listing.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> izvirni oglas
                </a>
              )}
            </div>
            <h3 className="font-bold text-sm truncate">{trade.title}</h3>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
              <span className="text-amber-400">Kupljeno: {trade.buyPrice} €</span>
              <span>• {new Date(trade.buyDate).toLocaleDateString('sl-SI')}</span>
              {trade.sellPrice != null && (
                <>
                  <span className="text-primary">Prodano: {trade.sellPrice} €</span>
                  {profit != null && (
                    <span className={profit >= 0 ? 'text-primary font-bold' : 'text-destructive font-bold'}>
                      {profit >= 0 ? '+' : ''}{profit.toFixed(2)} € ({roi?.toFixed(0)}% ROI)
                    </span>
                  )}
                </>
              )}
            </div>
            {trade.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{trade.notes}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
            {/* v6.3: Generate listing for resale */}
            {trade.status === 'held' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-primary"
                title="AI generiraj oglas za preprodajo"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/ai/generate-listing', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tradeId: trade.id }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      // Copy to clipboard
                      navigator.clipboard.writeText(`${data.listing.title}\n\n${data.listing.description}\n\nCena: ${data.listing.price}€`);
                      toast.success(`✓ Oglas generiran (${data.listing.marginPct > 0 ? '+' : ''}${data.listing.marginPct}% marže, kopirano v odložišče)`);
                    } else { toast.error(data.error ?? 'Napaka'); }
                  } catch { toast.error('Napaka'); }
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* v6.5: Multi-Platform Sync */}
            {trade.status === 'held' && onSync && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-blue-400"
                title="AI generiraj oglase za Bolha + Vinted"
                onClick={() => onSync(trade.id)}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* v6.9: AI Exit Strategy */}
            {trade.status === 'held' && onExit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-amber-400"
                title="AI izhodna strategija — kdaj in kako prodati"
                onClick={() => onExit(trade.id)}
              >
                <Target className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeFormDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Trade | null; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('elektronika');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [buyLocation, setBuyLocation] = useState('Bolha');
  const [buyFees, setBuyFees] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState('');
  const [sellLocation, setSellLocation] = useState('');
  const [sellFees, setSellFees] = useState('');
  const [status, setStatus] = useState('held');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setCategory(editing.category || 'elektronika');
      setBuyPrice(String(editing.buyPrice));
      setBuyDate(editing.buyDate ? new Date(editing.buyDate).toISOString().slice(0, 10) : '');
      setBuyLocation(editing.buyLocation || 'Bolha');
      setBuyFees(String(editing.buyFees || ''));
      setSellPrice(editing.sellPrice != null ? String(editing.sellPrice) : '');
      setSellDate(editing.sellDate ? new Date(editing.sellDate).toISOString().slice(0, 10) : '');
      setSellLocation(editing.sellLocation || '');
      setSellFees(String(editing.sellFees || ''));
      setStatus(editing.status);
      setNotes(editing.notes);
    } else {
      setTitle(''); setCategory('elektronika'); setBuyPrice('');
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyLocation('Bolha'); setBuyFees('');
      setSellPrice(''); setSellDate(''); setSellLocation(''); setSellFees('');
      setStatus('held'); setNotes('');
    }
  }, [editing, open]);

  const save = async () => {
    if (!title.trim() || !buyPrice) {
      toast.error('Ime in kupna cena sta obvezna');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        category,
        buyPrice: parseFloat(buyPrice),
        buyDate: buyDate ? new Date(buyDate).toISOString() : undefined,
        buyLocation: buyLocation.trim(),
        buyFees: buyFees ? parseFloat(buyFees) : 0,
        sellPrice: sellPrice ? parseFloat(sellPrice) : null,
        sellDate: sellDate ? new Date(sellDate).toISOString() : null,
        sellLocation: sellLocation.trim(),
        sellFees: sellFees ? parseFloat(sellFees) : 0,
        status,
        notes: notes.trim(),
      };
      const res = await fetch(
        editing ? `/api/trades/${editing.id}` : '/api/trades',
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error();
      toast.success(editing ? 'Trade posodobljen' : 'Trade dodan');
      onSaved();
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Uredi trade' : 'Nov trade'}</DialogTitle>
          <DialogDescription>Sledi nakup, morebitno prodajo in profit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs uppercase">Ime artikla *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="npr. iPhone 13 Pro 256GB" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase">Kategorija</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="held">V skladišču</SelectItem>
                  <SelectItem value="sold">Prodano</SelectItem>
                  <SelectItem value="cancelled">Preklicano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-amber-400 mb-2">Kupna stran</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Kupna cena (€) *</Label>
                <Input type="number" step="0.01" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum nakupa</Label>
                <Input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija nakupa</Label>
                <Input value={buyLocation} onChange={e => setBuyLocation(e.target.value)} placeholder="Bolha, FB, trgovina" className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine nakupa (€)</Label>
                <Input type="number" step="0.01" value={buyFees} onChange={e => setBuyFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-primary mb-2">Prodajna stran (izpolni ob prodaji)</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Prodajna cena (€)</Label>
                <Input type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="prazno = ni še prodano" className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum prodaje</Label>
                <Input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija prodaje</Label>
                <Input value={sellLocation} onChange={e => setSellLocation(e.target.value)} placeholder="Bolha, FB..." className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine prodaje (€)</Label>
                <Input type="number" step="0.01" value={sellFees} onChange={e => setSellFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase">Opombe</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Stanje, dodatna oprema, kontakt prodajalca..." className="mt-1 text-xs min-h-[60px]" />
          </div>
          {buyPrice && sellPrice && (
            <div className="bg-primary/5 border border-primary/30 rounded p-3 text-sm">
              <span className="text-muted-foreground">Profit: </span>
              <span className="text-primary font-bold">
                +{(parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)).toFixed(2)} €
              </span>
              <span className="text-muted-foreground ml-2">ROI: </span>
              <span className="text-primary font-bold">
                {(((parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)) / parseFloat(buyPrice)) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Shrani' : 'Dodaj trade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
