'use client';

// v4.6: Watchlist — oglasi, ki jih uporabnik spremlja
// Prikaz bookmarkov + listingov s targetPrice, z live preview cen in距ljen do cilja

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Eye, Target, Bookmark, TrendingDown, TrendingUp, MapPin, Clock, Sparkles, ShoppingCart, Trash2, Zap, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { WatchlistItem, WatchlistStats, View } from './watchlist/types';
import { WatchlistItemCard } from './watchlist/watchlist-item-card';
import { SmartRulesModal } from './watchlist/smart-rules-modal';

export function WatchlistView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<{ watchlist: WatchlistItem[]; stats: WatchlistStats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'recent' | 'target' | 'price' | 'score'>('recent');
  // v5.3: Smart Rules modal
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/listings/watchlist?sort=${sort}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error('Ne morem naložiti watchlista');
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => { load(); }, [load]);

  const removeBookmark = async (id: string) => {
    try {
      await fetch('/api/listings/bookmark', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isBookmarked: false }),
      });
      toast.success('Odstranjeno iz watchlista');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const clearTarget = async (id: string) => {
    try {
      await fetch(`/api/listings/${id}/target`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: null }),
      });
      toast.success('Ciljna cena odstranjena');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-card animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const stats = data?.stats;
  const items = data?.watchlist ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Watchlist
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Oglasi, ki jih spremljaš — z shranjenimi zaznamki ali nastavljeno ciljno ceno.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="text-xs bg-card border border-border rounded px-2 py-1.5"
          >
            <option value="recent">Najnovejši</option>
            <option value="target">Najbližji cilju</option>
            <option value="price">Cena (najnižja)</option>
            <option value="score">AI ocena (najvišja)</option>
          </select>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
          {/* v5.3: Smart Rules button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRules(true)}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Zap className="w-3.5 h-3.5" />
            Smart pravila
          </Button>
        </div>
      </div>

      {/* v5.3: Smart Rules Modal */}
      <SmartRulesModal open={showRules} onOpenChange={setShowRules} />

      {/* Stats cards */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Skupaj</div>
              <div className="text-2xl font-bold font-mono">{stats.total}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.bookmarked} shranjenih • {stats.withTarget} s ciljem
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Cilj dosežen</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.targetsHit}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.targetsAbove} še čaka
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Vrednost</div>
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.totalValue.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                skupna vrednost watchlista
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Potencialni prihranek</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.totalPotentialSavings.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                če vsi dosežejo cilj
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Eye className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm mb-4">
              Watchlist je prazen. Dodaj oglase z:
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Bookmark className="w-3.5 h-3.5" />
                Shrani oglas
              </Button>
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Target className="w-3.5 h-3.5" />
                Nastavi ciljno ceno
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <WatchlistItemCard
              key={item.id}
              item={item}
              onRemoveBookmark={removeBookmark}
              onClearTarget={clearTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// WatchlistItemCard — v9.09: imported from ./watchlist/watchlistitem-card
// SmartRulesModal — v9.09: imported from ./watchlist/smartrules-modal
