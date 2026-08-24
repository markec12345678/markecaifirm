'use client';

// v9.03: PromptLibraryModal — extracted from monitors-view.tsx.

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Zap, AlertCircle, PauseCircle, Bell, Copy, Square, Tag, Sparkles, Check, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PROMPT_CATEGORIES, getPromptsByCategory } from '@/lib/ai-prompts';
import type { Source, Monitor } from './types';
import { SOURCE_LABELS, SOURCE_PRESETS, formatTimeAgo } from './utils';

export function PromptLibraryModal({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (prompt: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState('all');

  if (!open) return null;

  const templates = getPromptsByCategory(activeCategory);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto mx-4 sm:mx-6">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Knjižnica AI promptov
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.9</Badge>
          </DialogTitle>
          <DialogDescription>
            Prednastavljeni AI prompti za različne kategorije oglasov. Klikni za vstavljanje v polje "Dodatna AI navodila".
          </DialogDescription>
        </DialogHeader>

        {/* Category tabs */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {PROMPT_CATEGORIES.map((c: { id: string; label: string; icon?: string }) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'px-2 py-1 rounded text-xs border transition-colors',
                activeCategory === c.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              )}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {/* Templates grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {templates.map((tpl: { id?: string; title?: string; name?: string; prompt: string; category: string; icon?: string; description?: string }) => (
            <div
              key={tpl.id}
              className="bg-card/50 border border-border rounded p-3 hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => onPick(tpl.prompt)}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <span className="text-2xl shrink-0">{tpl.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm">{tpl.name}</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground bg-background/30 rounded p-2 max-h-24 overflow-y-auto line-clamp-4">
                {tpl.prompt}
              </div>
              <Button size="sm" className="w-full mt-2 h-7 text-xs gap-1">
                <Sparkles className="w-3 h-3" />
                Uporabi ta prompt
              </Button>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border">
          💡 Prompt bo dodan k obstoječemu besedilu. Po potrebi ga uredi.
        </div>
      </DialogContent>
    </Dialog>
  );
}

