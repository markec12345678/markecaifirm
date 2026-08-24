'use client';

// v9.03: TemplateModal — extracted from monitors-view.tsx.

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

export function TemplateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/monitors/from-template');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const createFromTemplate = async (tpl: { id?: string; source: string; label: string; url: string; hint: string }) => {
    setCreating(tpl.id ?? null);
    try {
      const res = await fetch('/api/monitors/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tpl.id }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Monitor ustvarjen: ${data.monitor.name}`);
        onCreated();
      } else {
        if (data.existingId) {
          toast.error(`Monitor s tem imenom/URL že obstaja`);
        } else {
          toast.error(data.error ?? 'Napaka');
        }
      }
    } catch {
      toast.error('Napaka pri ustvarjanju');
    } finally {
      setCreating(null);
    }
  };

  if (!open) return null;

  const categories = [
    { id: 'all', label: 'Vse', icon: '📋' },
    { id: 'elektronika', label: 'Elektronika', icon: '📱' },
    { id: 'avto', label: 'Avto', icon: '🚗' },
    { id: 'nepremicnine', label: 'Nepremičnine', icon: '🏠' },
    { id: 'moda', label: 'Moda', icon: '👕' },
    { id: 'orodje', label: 'Orodje', icon: '🔧' },
    { id: 'sport', label: 'Sport', icon: '⚽' },
    { id: 'drugo', label: 'Drugo', icon: '📦' },
  ];

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Knjižnica predlog monitorjev
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.6</Badge>
          </DialogTitle>
          <DialogDescription>
            Prednastavljeni monitorji za običajne scenarije. Vsaka predloga vsebuje vir, filtre, cene in AI navodila.
          </DialogDescription>
        </DialogHeader>

        {/* Category tabs */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {categories.map(c => (
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

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Nalagam predloge...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            V tej kategoriji ni predlog.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filtered.map(tpl => (
              <div
                key={tpl.id}
                className="bg-card/50 border border-border rounded p-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="text-2xl shrink-0">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm">{tpl.name}</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <Badge variant="outline" className="text-[9px]">{tpl.source}</Badge>
                  {tpl.minPrice != null && tpl.maxPrice != null && (
                    <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30">
                      {tpl.minPrice}–{tpl.maxPrice}€
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">
                    vsakih {tpl.intervalMinutes}min
                  </Badge>
                  {tpl.tags && tpl.tags.split(',').slice(0, 2).map((tag: string) => (
                    <span key={tag} className="text-[9px] text-primary/70">#{tag.trim()}</span>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  onClick={() => createFromTemplate(tpl)}
                  disabled={creating === tpl.id}
                >
                  {creating === tpl.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Ustvari monitor
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border">
          💡 Po ustvarjanju lahko monitor urediš (URL, cene, AI navodila) v standardni formi.
        </div>
      </DialogContent>
    </Dialog>
  );
}

