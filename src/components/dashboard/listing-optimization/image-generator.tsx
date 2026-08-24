'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Image Generator

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Camera } from 'lucide-react';
import { toast } from 'sonner';

interface ImageGeneratorProps {
  selectedTradeId: string;
}

export function ImageGenerator({ selectedTradeId }: ImageGeneratorProps) {
  const [imageGen, setImageGen] = useState<Record<string, any> | null>(null);
  const [imageGenLoading, setImageGenLoading] = useState(false);

  const runImageGen = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setImageGenLoading(true); setImageGen(null);
    try {
      const res = await fetch('/api/ai/listing-image-generator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setImageGen(data); toast.success('✓ Image prompti generirani'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setImageGenLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Camera className="w-4 h-4 text-blue-400" /> AI Image Generator</span>
          <Button size="sm" variant="outline" onClick={runImageGen} disabled={imageGenLoading} className="h-6 text-xs gap-1.5">
            {imageGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {imageGenLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI generira VLM prompte za slike...</div>
        ) : imageGen?.generator ? (
          <div className="space-y-2 text-xs">
            {imageGen?.generator.imagePrompts?.slice(0, 3).map((p: Record<string, any>, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <Badge variant="outline" className="text-[9px] mb-1">{p.shotType || p.type}</Badge>
                <div className="text-[10px] font-mono text-primary">{p.prompt?.slice(0, 120)}...</div>
              </div>
            ))}
            {imageGen?.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {imageGen?.generator.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI generira VLM prompte za Midjourney/DALL-E (10 shot tipov, editing presets).</p>
        )}
      </CardContent>
    </Card>
  );
}
