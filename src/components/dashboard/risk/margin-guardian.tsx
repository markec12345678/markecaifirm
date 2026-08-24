'use client';

// v9.09: Extracted from risk-view.tsx — AI Margin Guardian

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function MarginGuardian() {
  const [guardian, setGuardian] = useState<any>(null);
  const [guardianLoading, setGuardianLoading] = useState(false);

  const runGuardian = async () => {
    setGuardianLoading(true); setGuardian(null);
    try {
      const res = await fetch('/api/ai/margin-guardian', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setGuardian(data); toast.success('✓ Margin guardian aktiviran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setGuardianLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> AI Margin Guardian</span>
          <Button size="sm" variant="outline" onClick={runGuardian} disabled={guardianLoading} className="h-6 text-xs gap-1.5">
            {guardianLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {guardianLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI aktivira margin guardian...</div>
        ) : guardian?.guardian ? (
          <div className="space-y-2 text-xs">
            {guardian.guardian.alerts?.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className={cn('border rounded p-2',
                a.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                a.severity === 'high' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium truncate flex-1">{a.title || a.item}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1',
                    a.severity === 'critical' ? 'text-red-500 border-red-500/30' :
                    a.severity === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                    {a.severity}
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  Marža: {a.currentMargin ?? '?'}% → {a.targetMargin ?? '?'}% · {a.action || a.recommendation}
                </div>
              </div>
            ))}
            {guardian.guardian.insights && <div className="text-[9px] text-muted-foreground">💡 {guardian.guardian.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI avtomatsko spremlja marže in opozarja na iteme z nizko/zapadajočo maržo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
