'use client';

/**
 * v7.35: FlipStatusWidget — dashboard widget showing all held trades with flip progress.
 *
 * Shows each held item with:
 * - Days held (red if >30d)
 * - Flip checklist progress bar
 * - Quick toggle for next step
 *
 * Helps prevent "held inventory creep" — items sitting too long lose money.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Clock, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface FlipStep {
  key: string;
  completed: boolean;
}

interface HeldTrade {
  id: string;
  title: string;
  buyPrice: number;
  buyDate: string;
  category: string;
  imageUrl: string | null;
  flipChecklist: string;
}

export function FlipStatusWidget({ onNavigate }: { onNavigate?: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings') => void }) {
  const [trades, setTrades] = useState<HeldTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/trades?status=held');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setTrades(data.trades || data || []);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function toggleStep(tradeId: string, stepKey: string, currentSteps: FlipStep[]) {
    const newSteps = currentSteps.map(s =>
      s.key === stepKey
        ? { ...s, completed: !s.completed }
        : s
    );
    // Optimistic update
    setTrades(prev => prev.map(t =>
      t.id === tradeId
        ? { ...t, flipChecklist: JSON.stringify(newSteps.map(s => ({ key: s.key, completed: s.completed, completedAt: s.completed ? new Date().toISOString() : null }))) }
        : t
    ));
    try {
      await fetch(`/api/trades/${tradeId}/flip-checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: newSteps.map(s => ({ key: s.key, completed: s.completed, completedAt: s.completed ? new Date().toISOString() : null })) }),
      });
    } catch {
      toast.error('Napaka pri shranjevanju');
    }
  }

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4 text-xs text-muted-foreground">Nalagam flip status...</CardContent>
      </Card>
    );
  }

  if (trades.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" /> FLIP STATUS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Ni held tradeov. Dodaj nakup v Skladišče.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" /> FLIP STATUS
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">{trades.length} held</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-96 overflow-y-auto">
        {trades.slice(0, 10).map(trade => {
          const steps: FlipStep[] = (() => {
            try { return JSON.parse(trade.flipChecklist || '[]'); } catch { return []; }
          })();
          const completedCount = steps.filter(s => s.completed).length;
          const totalSteps = 9; // Standard flip workflow steps
          const progressPct = Math.round((completedCount / totalSteps) * 100);
          const daysHeld = Math.floor((Date.now() - new Date(trade.buyDate).getTime()) / 86400000);
          const isStuck = daysHeld > 30;
          const capitalTied = trade.buyPrice;

          // Find next incomplete step (not optional)
          const stepOrder = ['received', 'cleaned', 'photographed', 'described', 'listed_bolha', 'listed_vinted', 'price_review_7d', 'price_drop_14d', 'price_drop_30d'];
          const nextStep = stepOrder.find(key => !steps.find(s => s.key === key)?.completed);

          return (
            <div
              key={trade.id}
              className={cn(
                'p-2 rounded border text-xs',
                isStuck ? 'border-red-500/30 bg-red-500/5' : 'border-border/40 bg-background/30'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium truncate flex-1">{trade.title}</span>
                <span className={cn('font-mono text-[10px] shrink-0 ml-2', isStuck ? 'text-red-500' : 'text-muted-foreground')}>
                  {daysHeld}d
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full transition-all', isStuck ? 'bg-red-500' : 'bg-primary')}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{completedCount}/{totalSteps}</span>
                {capitalTied > 0 && (
                  <span className="text-[10px] font-mono text-amber-400 shrink-0">{capitalTied}€</span>
                )}
              </div>
              {nextStep && !isStuck && (
                <Button
                  onClick={() => toggleStep(trade.id, nextStep, steps)}
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] mt-1 p-0"
                >
                  ✓ {nextStep}
                </Button>
              )}
              {isStuck && (
                <div className="flex items-center gap-1 text-[10px] text-red-500 mt-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  Zastara — znižaj ceno!
                </div>
              )}
            </div>
          );
        })}
        {trades.length > 10 && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onNavigate?.('trades')}>
            Prikaži vse {trades.length} <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
