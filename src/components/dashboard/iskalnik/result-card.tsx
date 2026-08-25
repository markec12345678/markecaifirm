'use client';

// v9.06: ResultCard — extracted from iskalnik-view.tsx.

import { useState, useCallback, useEffect, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, MapPin, Euro, Calendar, ExternalLink, Star, Shield, Save, Trash2, User, X, RefreshCw, TrendingDown, Filter, GitCompare, Check, Trophy, AlertTriangle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SearchResult } from './types';
import { sourceIcon, sourceColor, timeAgo } from './utils';

export const ResultCard = memo(function ResultCard({ result, rank, expanded, onToggle, selected, onToggleSelect }: { result: SearchResult; rank: number; expanded: boolean; onToggle: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const verdictColor =
    result.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    result.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* v8.72: Selection checkbox */}
          {onToggleSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className={cn(
                'shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors',
                selected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-card border-border hover:border-primary/50'
              )}
              title={selected ? 'Odstrani iz primerjave' : 'Dodaj v primerjavo'}
              aria-label={selected ? `Odstrani ${result.title} iz primerjave` : `Dodaj ${result.title} v primerjavo`}
              aria-pressed={selected}
            >
              {selected && <Check className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Rank badge */}
          <div className={cn(
            'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
            rank === 1 ? 'bg-emerald-500/20 text-emerald-500' :
            rank === 2 ? 'bg-primary/15 text-primary' :
            rank === 3 ? 'bg-amber-500/15 text-amber-500' :
            'bg-muted text-muted-foreground'
          )}>
            {rank}
          </div>

          {/* Image */}
          {result.imageUrl ? (
            <img src={result.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-muted shrink-0" loading="lazy" />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm truncate">{result.title}</h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {result.price != null && (
                    <span className="text-base font-bold text-emerald-500 font-mono">{result.price}€</span>
                  )}
                  {result.aiEstimatedValue != null && result.aiEstimatedValue !== result.price && (
                    <span className="text-[10px] text-muted-foreground line-through">{result.aiEstimatedValue}€ ocena</span>
                  )}
                  {result.previousPrice != null && result.previousPrice > (result.price ?? 0) && (
                    <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500">
                      <TrendingDown className="w-2.5 h-2.5" /> {result.previousPrice}€ → {result.price}€
                    </Badge>
                  )}
                </div>
              </div>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-primary hover:text-primary/80"
                title="Odpri oglas"
                aria-label={`Odpri oglas: ${result.title} v novem oknu`}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1.5 flex-wrap">
              {result.location && (
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {result.location}</span>
              )}
              {result.firstSeenAt && (
                <span className="flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" /> {new Date(result.firstSeenAt).toLocaleDateString('sl-SI')}</span>
              )}
              {result.aiScore != null && (
                <span className="flex items-center gap-0.5 text-primary"><Star className="w-2.5 h-2.5" /> {result.aiScore}/10</span>
              )}
              {result.aiRisk != null && (
                <span className="flex items-center gap-0.5 text-amber-400"><Shield className="w-2.5 h-2.5" /> {result.aiRisk}/10</span>
              )}
              {result.buyScore != null && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] font-bold',
                  result.buyScore >= 75 ? 'bg-emerald-500/15 text-emerald-500' :
                  result.buyScore >= 55 ? 'bg-primary/10 text-primary' :
                  result.buyScore >= 35 ? 'bg-amber-500/10 text-amber-600' :
                  'bg-red-500/10 text-red-500'
                )}>🛒 {result.buyScore}</span>
              )}
              {result.aiVerdict && (
                <Badge variant="outline" className={cn('text-[9px]', verdictColor)}>{result.aiVerdict}</Badge>
              )}
              {result.monitor?.source && (
                <Badge variant="outline" className={cn('text-[9px] gap-0.5', sourceColor(result.monitor.source))}>
                  {sourceIcon(result.monitor.source)} {result.monitor.source}
                </Badge>
              )}
            </div>

            {/* Description preview */}
            {result.description && !expanded && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{result.description}</p>
            )}

            {/* Expanded detail */}
            {expanded && (
              <div className="mt-2 space-y-2 border-t border-border/30 pt-2">
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground">Cel opis oglasa:</span>
                  <p className="text-[11px] text-foreground/80 whitespace-pre-wrap mt-0.5">
                    {result.fullDescription || result.description || 'Brez opisa'}
                  </p>
                </div>
                {result.aiReason && (
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground">AI razlog:</span>
                    <p className="text-[11px] text-foreground/70 italic mt-0.5">{result.aiReason}</p>
                  </div>
                )}
                {result.sellerName && (
                  <div className="text-[10px] text-muted-foreground">
                    Prodajalec: <span className="text-foreground">{result.sellerName}</span>
                    {result.monitor?.name && ` · ${result.monitor.name}`}
                  </div>
                )}
              </div>
            )}

            {/* Toggle button */}
            <button
              onClick={onToggle}
              className="text-[10px] text-primary hover:text-primary/80 mt-1.5"
              aria-label={expanded ? `Skrči oglas: ${result.title}` : `Prikaži cel oglas: ${result.title}`}
              aria-expanded={expanded}
            >
              {expanded ? '↑ Skrči' : '↓ Prikaži cel oglas'}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

})
