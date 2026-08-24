'use client';

// v9.09: Extracted from inventory-view.tsx — AI Shrinkage Detector

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ShrinkageDetector() {
  const [shrinkage, setShrinkage] = useState<Record<string, any> | null>(null);
  const [shrinkageLoading, setShrinkageLoading] = useState(false);

  const runShrinkage = async () => {
    setShrinkageLoading(true); setShrinkage(null);
    try {
      const res = await fetch('/api/ai/inventory-shrinkage-detector', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setShrinkage(data); toast.success('✓ Shrinkage analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setShrinkageLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            AI Shrinkage Detector
          </span>
          <Button size="sm" variant="outline" onClick={runShrinkage} disabled={shrinkageLoading} className="h-6 text-xs gap-1.5">
            {shrinkageLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {shrinkageLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI detektira izgube (krađa, poškodbe, izguba)...
          </div>
        ) : shrinkage?.detector ? (
          <div className="space-y-2 text-xs">
            {shrinkage?.detector.overview && (
              <div className={cn('border rounded p-2',
                shrinkage?.detector?.overview.shrinkageGrade === 'F' || shrinkage?.detector?.overview.shrinkageGrade === 'D' ? 'bg-red-500/10 border-red-500/30' :
                shrinkage?.detector?.overview.shrinkageGrade === 'C' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-primary/10 border-primary/30')}>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px] uppercase font-bold">
                    Grade: {shrinkage?.detector.overview.shrinkageGrade}
                  </Badge>
                  <span className="font-mono font-bold text-[10px]">
                    {shrinkage?.detector.overview.shrinkagePct}% shrinkage
                  </span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">
                  {shrinkage?.detector.overview.totalShrinkageValueEur}€ izguba · {shrinkage?.detector.overview.revenueGapEur}€ gap
                </div>
              </div>
            )}
            {shrinkage?.detector.shrinkageEvents?.slice(0, 3).map((e: Record<string, any>, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px]">{e.eventType}</Badge>
                  <span className={cn('text-[9px] font-bold',
                    e.severity === 'critical' ? 'text-red-500' :
                    e.severity === 'high' ? 'text-amber-400' : 'text-muted-foreground')}>
                    {e.severity} · {e.lostValueEur}€
                  </span>
                </div>
                <div className="text-[10px] font-medium truncate">{e.itemTitle}</div>
                {e.preventiveAction && <div className="text-[9px] text-primary mt-0.5">→ {e.preventiveAction}</div>}
              </div>
            ))}
            {shrinkage?.detector.insights && (
              <div className="text-[9px] text-muted-foreground">💡 {shrinkage?.detector.insights}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI detektira izgube (krađa, poškodbe, izguba v tranzitu, zastarevanje).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
