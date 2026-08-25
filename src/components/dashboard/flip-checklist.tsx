'use client';

// v8.54: Flip Workflow Checklist UI — visual step-by-step guide for held trades.
// Kupim → Pregledam → Očistim → Fotografiram → Opišem → Bolha → Vinted → 7d → 14d → 30d → Prodano

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Circle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import { useLocalStorage } from '@/hooks/use-local-storage';

const FLIP_STEPS = [
  { id: 'received', label: 'Dobljeno', icon: '📦', description: 'Item fizično prejet' },
  { id: 'inspected', label: 'Pregledano', icon: '🔍', description: 'Stanje preverjeno' },
  { id: 'cleaned', label: 'Očiščeno', icon: '🧽', description: 'Počiščeno za fotografiranje' },
  { id: 'photographed', label: 'Fotografirano', icon: '📸', description: '6+ kvalitetnih slik' },
  { id: 'described', label: 'Opisano', icon: '✍️', description: 'AI optimiziran opis' },
  { id: 'listed_bolha', label: 'Bolha', icon: '🌐', description: 'Objavljeno na Bolha' },
  { id: 'listed_vinted', label: 'Vinted', icon: '👕', description: 'Objavljeno na Vinted' },
  { id: 'listed_other', label: 'Druga', icon: '📱', description: 'FB Marketplace / drugi' },
  { id: 'price_review_7d', label: '7d pregled', icon: '⏰', description: 'Po 7 dneh: prilagodi ceno' },
  { id: 'price_drop_14d', label: '14d znižanje', icon: '📉', description: 'Po 14 dneh: -10%' },
  { id: 'price_drop_30d', label: '30d znižanje', icon: '⚠️', description: 'Po 30 dneh: -20% ali umakni' },
] as const;

interface ChecklistEntry {
  step: string;
  completedAt: string | null;
}

interface FlipChecklistProps {
  tradeId: string;
  tradeTitle: string;
  initialChecklist?: ChecklistEntry[];
  onAllComplete?: () => void;
}

export function FlipChecklist({ tradeId, tradeTitle, initialChecklist, onAllComplete }: FlipChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistEntry[]>(initialChecklist || []);
  const [loading, setLoading] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useLocalStorage<boolean>('flip-checklist-collapsed', false);
  const haptic = useHaptic();

  // Build a map for quick lookup
  const checklistMap = new Map(checklist.map((c: ChecklistEntry) => [c.step, c.completedAt]));

  const toggleStep = useCallback(async (stepId: string) => {
    haptic.light();
    const isCompleted = checklistMap.has(stepId) && checklistMap.get(stepId) !== null;
    setLoading(stepId);

    try {
      const res = await fetch(`/api/trades/${tradeId}/flip-checklist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepId, completed: !isCompleted }),
      });
      const data = await res.json();

      if (data.ok || data.checklist) {
        const updated = data.checklist || data.flipChecklist || [];
        setChecklist(updated);

        // Check if all steps complete
        const allDone = FLIP_STEPS.every(s => {
          const entry = updated.find((c: ChecklistEntry) => c.step === s.id);
          return entry && entry.completedAt;
        });
        if (allDone && !isCompleted) {
          toast.success(`🎉 "${tradeTitle}" — vsi koraki dokončani! Item je pripravljen za prodajo.`);
          haptic.success();
          onAllComplete?.();
        } else if (!isCompleted) {
          toast.success(`✓ ${FLIP_STEPS.find(s => s.id === stepId)?.label}`);
        }
      }
    } catch {
      toast.error('Napaka pri posodobitvi checklista');
    } finally {
      setLoading(null);
    }
  }, [tradeId, tradeTitle, checklistMap, haptic, onAllComplete]);

  const completedCount = FLIP_STEPS.filter(s => checklistMap.has(s.id) && checklistMap.get(s.id) !== null).length;
  const progressPct = Math.round((completedCount / FLIP_STEPS.length) * 100);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span>🔄 Flip Checklist</span>
            <Badge variant="outline" className={cn(
              'text-[10px]',
              progressPct === 100 ? 'border-emerald-500/40 text-emerald-500' :
              progressPct >= 50 ? 'border-amber-500/40 text-amber-400' :
              'border-muted text-muted-foreground'
            )}>
              {completedCount}/{FLIP_STEPS.length} ({progressPct}%)
            </Badge>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </Button>
        </CardTitle>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-1">
          {/* Progress bar */}
          <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
            <div
              className={cn('h-full rounded-full transition-all', progressPct === 100 ? 'bg-emerald-500' : 'bg-primary')}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {FLIP_STEPS.map((step, idx) => {
            const completedAt = checklistMap.get(step.id);
            const isCompleted = !!completedAt;
            const isCurrent = !isCompleted && FLIP_STEPS.slice(0, idx).every(s => !!checklistMap.get(s.id));

            return (
              <button
                key={step.id}
                onClick={() => toggleStep(step.id)}
                disabled={loading === step.id}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left',
                  isCompleted && 'bg-emerald-500/5',
                  isCurrent && !isCompleted && 'bg-primary/5 ring-1 ring-primary/20',
                  'hover:bg-muted/50',
                  loading === step.id && 'opacity-50'
                )}
              >
                {/* Checkbox / icon */}
                <div className="shrink-0">
                  {loading === step.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : isCompleted ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  ) : (
                    <Circle className={cn('w-4 h-4', isCurrent ? 'text-primary' : 'text-muted-foreground/40')} />
                  )}
                </div>

                {/* Step icon + label */}
                <span className="text-base shrink-0">{step.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={cn('text-xs font-medium', isCompleted ? 'text-muted-foreground line-through' : 'text-foreground')}>
                    {step.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {step.description}
                  </div>
                </div>

                {/* Completed time */}
                {isCompleted && completedAt && (
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {new Date(completedAt).toLocaleDateString('sl-SI')}
                  </span>
                )}

                {/* Step number */}
                <span className="text-[9px] text-muted-foreground/50 shrink-0 font-mono">
                  {idx + 1}/{FLIP_STEPS.length}
                </span>
              </button>
            );
          })}

          {progressPct === 100 && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-center mt-2">
              <span className="text-xs text-emerald-500 font-medium">✅ Vsi koraki dokončani — item pripravljen za prodajo!</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
