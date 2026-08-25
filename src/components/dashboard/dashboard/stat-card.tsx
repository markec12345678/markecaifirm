'use client';

// v9.04: StatCard — extracted from dashboard-view.tsx.

import { useEffect, useState, useCallback, memo } from 'react';
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


export const StatCard = memo(function StatCard({
  icon,
  label,
  value,
  total,
  subtext,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total?: number;
  subtext?: string;
  color: 'primary' | 'amber';
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        'bg-card/50 hover:bg-card transition-colors',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={cn(color === 'primary' ? 'text-primary' : 'text-amber-400')}>
            {icon}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'text-2xl sm:text-3xl font-bold',
            color === 'primary' ? 'text-primary terminal-glow' : 'text-amber-400 amber-glow'
          )}>
            {value}
          </span>
          {total != null && (
            <span className="text-sm text-muted-foreground">/ {total}</span>
          )}
        </div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  );
})

