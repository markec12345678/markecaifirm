'use client';

// v9.09: Extracted from pricing-view.tsx — AI Geo Price Map

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, MapPin } from 'lucide-react';
import { toast } from 'sonner';

export function GeoPriceMap() {
  const [geoPrice, setGeoPrice] = useState<any>(null);
  const [geoPriceLoading, setGeoPriceLoading] = useState(false);

  const runGeoPrice = async () => { setGeoPriceLoading(true); setGeoPrice(null); try { const r = await fetch('/api/ai/geo-price-map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setGeoPrice(d); toast.success('✓ Geo price map generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setGeoPriceLoading(false); } };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-cyan-400" /> AI Geo Price Map</span>
          <Button size="sm" variant="outline" onClick={runGeoPrice} disabled={geoPriceLoading} className="h-6 text-xs gap-1.5">
            {geoPriceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {geoPriceLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI gradi geo price map...</div>
        ) : geoPrice?.map ? (
          <div className="space-y-2 text-xs">
            {geoPrice.map.regions?.slice(0, 4).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium">{r.region || r.location || r.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">{r.listingCount ?? r.count} oglasov</span>
                  <span className="font-mono text-primary text-[10px]">{r.avgPrice ?? r.averagePrice ?? '?'}€</span>
                </div>
              </div>
            ))}
            {geoPrice.map.insights && <div className="text-[9px] text-muted-foreground">💡 {geoPrice.map.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI gradi zemljevid cen po regijah (kje je najdražje/najceneje prodati).</p>
        )}
      </CardContent>
    </Card>
  );
}
