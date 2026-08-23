'use client';

// v9.04: ActivityFeed — extracted from dashboard-view.tsx.

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Bell, AlertTriangle, Target, TrendingUp, Play, RefreshCw, Clock, Zap, LayoutGrid, BarChart3, Bookmark, ShoppingCart, TrendingDown, ExternalLink, Check, Sparkles, ArrowUp, ArrowDown, Settings2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import { WIDGET_IDS } from './types';
import type { Stats, ViewProps, WidgetId } from './types';
import { formatDuration, formatTimeAgo } from './utils';


export function ActivityFeed() {
  const [feed, setFeed] = useState<Array<{
    type: string;
    timestamp: string;
    title: string;
    subtitle: string;
    url?: string;
    badge?: string;
    badgeColor?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/activity');
        if (res.ok) {
          const data = await res.json();
          setFeed(data.feed || []);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const typeIcons: Record<string, React.ReactNode> = {
    alert: <Bell className="w-3.5 h-3.5" />,
    trade_buy: <ShoppingCart className="w-3.5 h-3.5" />,
    trade_sell: <TrendingUp className="w-3.5 h-3.5" />,
    price_drop: <TrendingDown className="w-3.5 h-3.5" />,
  };

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Aktivnost (zadnjih 7 dni)
        </CardTitle>
        <CardDescription>Zadnji alerti, kupljene/prodane oglase, padci cen.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
          </div>
        ) : feed.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            <Activity className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Ni recentne aktivnosti.
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {feed.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded hover:bg-card/50 transition-colors">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  {typeIcons[item.type] || <Activity className="w-3.5 h-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{item.title}</span>
                    {item.badge && (
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', item.badgeColor)}>
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {item.subtitle} • {new Date(item.timestamp).toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary/50 hover:text-primary shrink-0">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


