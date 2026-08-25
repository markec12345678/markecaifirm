'use client';

// v9.04: WidgetWrapper — extracted from dashboard-view.tsx.

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


export function WidgetWrapper({ id, order, customizeMode, onMove, children }: {
  id: WidgetId;
  order: WidgetId[];
  customizeMode: boolean;
  onMove: (id: WidgetId, dir: 'up' | 'down') => void;
  children: React.ReactNode;
}) {
  const idx = order.indexOf(id);
  const isFirst = idx === 0;
  const isLast = idx === order.length - 1;

  if (!customizeMode) return <>{children}</>;

  return (
    <div className="relative border-2 border-dashed border-primary/30 rounded-lg p-1">
      <div className="absolute -top-3 left-2 flex items-center gap-1 bg-background px-2 z-10">
        <span className="text-[9px] text-primary font-mono uppercase">{id}</span>
        <button
          onClick={() => onMove(id, 'up')}
          disabled={isFirst}
          className="text-primary hover:bg-primary/10 p-0.5 rounded disabled:opacity-30"
        >
          <ArrowUp className="w-3 h-3" />
        </button>
        <button
          onClick={() => onMove(id, 'down')}
          disabled={isLast}
          className="text-primary hover:bg-primary/10 p-0.5 rounded disabled:opacity-30"
        >
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>
      <div className="pt-2">{children}</div>
    </div>
  );

}
