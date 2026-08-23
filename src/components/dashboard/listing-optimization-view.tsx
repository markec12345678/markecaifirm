'use client';

/**
 * v7.05: ListingOptimizationView — nov pogled za AI optimizacijo oglasov.
 *
 * Backend ima 40+ listing optimization AI endpointov, a frontend jih ni imel
 * v dedicated UI (samo description-optimizer in image-quality v ListingDetailModal).
 *
 * Integrira 5 najboljših:
 * 1. Listing Image Generator — /api/ai/listing-image-generator (VLM prompti za Midjourney/DALL-E)
 * 2. Description Generator v3 — /api/ai/listing-description-generator-v3 (10 stilov, A/B test)
 * 3. SEO Optimizer v2 — /api/ai/listing-seo-optimizer-v2 (keyword research, competitor analysis)
 * 4. Virality Predictor — /api/ai/listing-virality-predictor (8 heuristik v TS, viral potential)
 * 5. CTR Optimizer — /api/ai/listing-ctr-optimizer (optimizacija click-through rate)
 *
 * v9.09: 10 AI sekcij ekstraktiranih v ./listing-optimization/ module (vsaka z lastnim state-om + fetch-om).
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Trade } from './listing-optimization/types';
import { ImageGenerator } from './listing-optimization/image-generator';
import { DescriptionGenerator } from './listing-optimization/description-generator';
import { SeoOptimizer } from './listing-optimization/seo-optimizer';
import { ViralityPredictor } from './listing-optimization/virality-predictor';
import { CtrOptimizer } from './listing-optimization/ctr-optimizer';
import { TitleGenerator } from './listing-optimization/title-generator';
import { TagOptimizer } from './listing-optimization/tag-optimizer';
import { ThumbnailOptimizer } from './listing-optimization/thumbnail-optimizer';
import { SocialProofOptimizer } from './listing-optimization/social-proof-optimizer';
import { ListingRefresh } from './listing-optimization/listing-refresh';

export function ListingOptimizationView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTradeId, setSelectedTradeId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades?status=held');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti tradeov');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTrade = trades.find(t => t.id === selectedTradeId);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Optimizacija oglasov AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI generira slike, opise, SEO, viralnost in CTR za tvoje oglase.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Osveži
          </Button>
        </div>
      </div>

      {/* Trade selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Izberi item za optimizacijo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Item v skladišču</Label>
              <Select value={selectedTradeId} onValueChange={setSelectedTradeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="— izberi item —" />
                </SelectTrigger>
                <SelectContent>
                  {trades.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title.slice(0, 50)} ({t.buyPrice}€)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedTrade && (
            <div className="text-xs text-muted-foreground bg-card/30 border border-border rounded p-2 mt-2">
              <b>{selectedTrade.title}</b> — {selectedTrade.category || 'brez kategorije'} · {selectedTrade.buyPrice}€
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Panels */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Image Generator */}
        <ImageGenerator selectedTradeId={selectedTradeId} />

        {/* 2. Description Generator v3 */}
        <DescriptionGenerator selectedTradeId={selectedTradeId} />

        {/* 3. SEO Optimizer v2 */}
        <SeoOptimizer selectedTradeId={selectedTradeId} />

        {/* 4. Virality Predictor */}
        <ViralityPredictor selectedTradeId={selectedTradeId} />

        {/* 5. CTR Optimizer */}
        <CtrOptimizer selectedTradeId={selectedTradeId} />
      </div>

      {/* v7.15: 5 novih listing AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Title Generator v2 */}
        <TitleGenerator selectedTradeId={selectedTradeId} />

        {/* 7. Tag Optimizer */}
        <TagOptimizer selectedTradeId={selectedTradeId} />

        {/* 8. Thumbnail Optimizer */}
        <ThumbnailOptimizer selectedTradeId={selectedTradeId} />

        {/* 9. Social Proof Optimizer */}
        <SocialProofOptimizer selectedTradeId={selectedTradeId} />

        {/* 10. Listing Refresh */}
        <ListingRefresh selectedTradeId={selectedTradeId} />
      </div>

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            📝 <b>Optimizacija oglasov AI</b> integrira 5 AI funkcij.
            Backend ima še 35+ listing AI endpointov (listing-title-generator, listing-tag-optimizer,
            listing-thumbnail-optimizer, listing-social-proof, listing-emotional-trigger...) — vse najdeš v AI Hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
