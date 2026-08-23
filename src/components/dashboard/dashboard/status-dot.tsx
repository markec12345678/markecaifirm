'use client';

// v9.04: StatusDot — extracted from dashboard-view.tsx.

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


export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-primary' :
    status === 'error' ? 'bg-destructive' :
    'bg-muted-foreground';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', color)} />;
}

