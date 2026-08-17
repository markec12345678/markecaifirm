'use client';

// v8.83: Setup Health Banner — dismissible banner at top of dashboard.
// Shows setup completion % + checklist of pending items.
// Auto-hides when all items are done.

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  link: string;
}

interface SetupStatus {
  ok: boolean;
  checklist: ChecklistItem[];
  doneCount: number;
  totalCount: number;
  allDone: boolean;
  onboardingCompleted: boolean;
}

export function SetupHealthBanner() {
  const [data, setData] = useState<SetupStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for dismissed state
    const stored = typeof window !== 'undefined' ? localStorage.getItem('setup-banner-dismissed') : null;
    if (stored === 'true') {
      setDismissed(true);
      return;
    }

    fetch('/api/setup-status').then(r => r.json()).then(d => {
      if (d?.ok) setData(d);
    }).catch(() => {});
  }, []);

  // Don't render if dismissed or all done
  if (dismissed || !data || data.allDone) return null;

  const pendingItems = data.checklist.filter(c => !c.done);
  const pct = Math.round((data.doneCount / data.totalCount) * 100);

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('setup-banner-dismissed', 'true');
    }
  };

  return (
    <Card className={cn(
      'border-2',
      pct < 50 ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'
    )}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <AlertCircle className={cn('w-4 h-4', pct < 50 ? 'text-red-500' : 'text-amber-500')} />
            <span className="text-sm font-bold">
              Setup {pct}% ({data.doneCount}/{data.totalCount})
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={dismiss}>
            <X className="w-3 h-3" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              pct < 50 ? 'bg-red-500' : pct < 100 ? 'bg-amber-500' : 'bg-emerald-500'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Pending items */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {pendingItems.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-2 p-1.5 rounded-md border border-border/50 bg-card/50 text-xs"
            >
              <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{item.detail}</div>
              </div>
              {item.link && (
                <a href={item.link} className="shrink-0 text-primary hover:text-primary/80" title="Pojdi">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Done items (collapsed summary) */}
        {data.doneCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
            Opravljeno: {data.checklist.filter(c => c.done).map(c => c.label).join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
