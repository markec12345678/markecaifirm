'use client';

// v9.09: Extracted from risk-view.tsx — AI Anomaly Detection

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AnomalyDetection() {
  const [anomalies, setAnomalies] = useState<any>(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);

  const runAnomalies = async () => { setAnomaliesLoading(true); setAnomalies(null); try { const r = await fetch('/api/ai/detect-anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setAnomalies(d); toast.success('✓ Anomalije detektirane'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setAnomaliesLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-500" /> AI Anomaly Detection</span>
          <Button size="sm" variant="outline" onClick={runAnomalies} disabled={anomaliesLoading} className="h-6 text-xs gap-1.5">
            {anomaliesLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {anomaliesLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI detektira anomalije...</div>
        ) : anomalies?.anomalies?.length > 0 ? (
          <div className="space-y-2 text-xs">
            {anomalies.anomalies.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className={cn('border rounded p-2', a.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium truncate flex-1">{a.title || a.description}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1', a.severity === 'critical' ? 'text-red-500 border-red-500/30' : a.severity === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{a.severity}</Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">{a.action || a.recommendation}</div>
              </div>
            ))}
            {anomalies.insights && <div className="text-[9px] text-muted-foreground">💡 {anomalies.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI detektira anomalije v cenah, vedenju, vzorcih nakupov.</p>
        )}
      </CardContent>
    </Card>
  );
}
