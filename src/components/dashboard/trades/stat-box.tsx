'use client';

// v8.99: StatBox — extracted from trades-view.tsx.

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag, Download, Sparkles, Check, Copy, AlertTriangle, Boxes, Flame, FileText, Receipt, Network, Clock, Type, Users, Globe, Activity, Upload, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { FlipChecklist } from '@/components/dashboard/flip-checklist';
import { TagsInput } from '@/components/ui/tags-input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';


export function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
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

