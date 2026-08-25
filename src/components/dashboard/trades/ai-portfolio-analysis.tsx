'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AIPortfolioAnalysis() {
  const [portfolioAI, setPortfolioAI] = useState<Record<string, any> | null>(null);
  const [portfolioAILoading, setPortfolioAILoading] = useState(false);

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

  return (
    <>
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
                {portfolioAI.recommendations.map((rec: Record<string, any>, i: number) => {
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
    </>
  );
}
