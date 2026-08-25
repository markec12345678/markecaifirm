'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface AutoListingGeneratorCardProps {
  data: Record<string, any>;
  onClear: () => void;
}

export function AutoListingGeneratorCard({ data, onClear }: AutoListingGeneratorCardProps) {
  if (!data) return null;

  return (
    <>
      {/* v6.3: Auto-listing generator result */}
      <Card className="bg-primary/5 border-primary/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Generiran oglas za preprodajo
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.3</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={onClear} className="h-6 text-xs">×</Button>
          </div>
          <div className="space-y-2 text-xs">
            <div className="bg-background/30 rounded p-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-0.5">Naslov</div>
              <div className="font-bold">{data.title}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Cena</div>
                <div className="font-mono font-bold text-primary">{data.price}€</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Marža</div>
                <div className="font-mono font-bold text-primary">{data.marginPct > 0 ? '+' : ''}{data.marginPct}%</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Čas prodaje</div>
                <div className="font-mono font-bold">~{data.expectedSellTimeDays}d</div>
              </div>
            </div>
            <div className="bg-background/30 rounded p-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">Opis</div>
              <p className="whitespace-pre-wrap text-[11px]">{data.description}</p>
            </div>
            {data.tags?.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {data.tags.map((t: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[9px]">#{t}</Badge>
                ))}
              </div>
            )}
            {data.tips?.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-primary">💡 Nasveti za prodajo ({data.tips.length})</summary>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {data.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
                </ul>
              </details>
            )}
            <Button
              size="sm"
              className="w-full gap-1"
              onClick={() => {
                navigator.clipboard.writeText(`${data.title}\n\n${data.description}\n\nCena: ${data.price}€`);
                toast.success('Oglas kopiran — prilepi na Bolha/Vinted');
              }}
            >
              <Copy className="w-3 h-3" /> Kopiraj oglas
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
