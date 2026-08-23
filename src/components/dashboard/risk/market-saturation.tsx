'use client';

// v9.09: Extracted from risk-view.tsx — AI Market Saturation

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Waves } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function MarketSaturation() {
  const [saturation, setSaturation] = useState<any>(null);
  const [saturationLoading, setSaturationLoading] = useState(false);

  const runSaturation = async () => {
    setSaturationLoading(true); setSaturation(null);
    try {
      const res = await fetch('/api/ai/market-saturation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSaturation(data); toast.success('✓ Tržna saturacija analizirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setSaturationLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Waves className="w-4 h-4 text-cyan-400" /> AI Market Saturation</span>
          <Button size="sm" variant="outline" onClick={runSaturation} disabled={saturationLoading} className="h-6 text-xs gap-1.5">
            {saturationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Waves className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {saturationLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira saturacijo trga...</div>
        ) : saturation?.saturation ? (
          <div className="space-y-2 text-xs">
            {saturation.saturation.categories?.slice(0, 4).map((c: any, i: number) => (
              <div key={i} className={cn('border rounded p-2',
                c.level === 'saturated' ? 'bg-red-500/5 border-red-500/20' :
                c.level === 'blue_ocean' ? 'bg-primary/10 border-primary/30' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium">{c.category || c.name}</span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    c.level === 'saturated' ? 'text-red-500 border-red-500/30' :
                    c.level === 'blue_ocean' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                    {c.level || c.saturationLevel}
                  </Badge>
                </div>
                {c.opportunityRate != null && <div className="text-[9px] text-muted-foreground">{c.opportunityRate}% priložnosti</div>}
              </div>
            ))}
            {saturation.saturation.marketSignals?.slice(0, 2).map((s: any, i: number) => (
              <div key={i} className="bg-cyan-400/5 border border-cyan-400/20 rounded p-2 text-[10px]">{s.signal || s.description}</div>
            ))}
            {saturation.saturation.insights && <div className="text-[9px] text-muted-foreground">💡 {saturation.saturation.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI zazna saturacijo trga (5 nivojev: saturated → blue_ocean).</p>
        )}
      </CardContent>
    </Card>
  );
}
