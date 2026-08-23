'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Persona

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, User } from 'lucide-react';
import { toast } from 'sonner';

interface BuyerPersonaProps {
  selectedBuyer: string;
}

export function BuyerPersona({ selectedBuyer }: BuyerPersonaProps) {
  const [persona, setPersona] = useState<any>(null);
  const [personaLoading, setPersonaLoading] = useState(false);

  const runPersona = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setPersonaLoading(true);
    setPersona(null);
    try {
      const res = await fetch('/api/ai/buyer-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setPersona(data); toast.success('✓ Persona generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setPersonaLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <User className="w-4 h-4 text-blue-400" />
            AI Buyer Persona
          </span>
          <Button size="sm" variant="outline" onClick={runPersona} disabled={personaLoading} className="h-6 text-xs gap-1.5">
            {personaLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <User className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {personaLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI kategorizira kupca...
          </div>
        ) : persona?.personas?.length > 0 ? (
          <div className="space-y-2 text-xs">
            {persona.personas.slice(0, 3).map((p: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/40">{p.type || p.archetype}</Badge>
                  <span className="text-[9px] text-muted-foreground">{p.confidence || ''}%</span>
                </div>
                <div className="font-medium">{p.name || p.title}</div>
                {p.description && <div className="text-[10px] text-muted-foreground mt-1">{p.description}</div>}
                {p.preferredCategories?.length > 0 && (
                  <div className="text-[9px] text-muted-foreground mt-1">
                    📦 Kategorije: {p.preferredCategories.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI določi osebnost kupca (bargain hunter, collector, flipper...).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
