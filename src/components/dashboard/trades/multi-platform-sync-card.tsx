'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MultiPlatformSyncCardProps {
  data: Record<string, any>;
  onClear: () => void;
}

export function MultiPlatformSyncCard({ data, onClear }: MultiPlatformSyncCardProps) {
  if (!data) return null;

  return (
    <>
      {/* v6.5: Multi-Platform Sync results */}
      <Card className="bg-blue-400/5 border-blue-400/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Multi-Platform oglasi (AI sinhronizirani)
              <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.5</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={onClear} className="h-6 text-xs">×</Button>
          </div>
          <div className="space-y-2">
            {data.listings?.map((l: Record<string, any>, i: number) => (
              <div key={i} className="bg-background/30 rounded p-2 border border-blue-400/20">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40 uppercase">{l.platform}</Badge>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-primary">{l.price}€</span>
                    <span className={cn('font-mono', l.marginPct > 0 ? 'text-primary' : 'text-red-500')}>
                      {l.marginPct > 0 ? '+' : ''}{l.marginPct}%
                    </span>
                  </div>
                </div>
                <div className="font-bold text-xs mb-1">{l.title}</div>
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{l.description}</p>
                {l.tips?.length > 0 && (
                  <details className="text-[11px] mt-1">
                    <summary className="cursor-pointer text-blue-400">💡 Nasveti za {l.platform} ({l.tips.length})</summary>
                    <ul className="mt-0.5 list-disc list-inside space-y-0.5">
                      {l.tips.map((t: string, j: number) => <li key={j}>{t}</li>)}
                    </ul>
                  </details>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-1 h-6 text-[10px] gap-1"
                  onClick={() => {
                    navigator.clipboard.writeText(`${l.title}\n\n${l.description}\n\nCena: ${l.price}€`);
                    toast.success(`${l.platform} oglas kopiran`);
                  }}
                >
                  <Copy className="w-3 h-3" /> Kopiraj
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
