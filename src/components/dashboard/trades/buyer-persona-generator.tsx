'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';

interface BuyerPersonaGeneratorProps {
  trades: Trade[];
}

export function BuyerPersonaGenerator({ trades }: BuyerPersonaGeneratorProps) {
  // v6.22: Buyer Persona
  const [personaData, setPersonaData] = useState<any>(null);
  const [personaLoading, setPersonaLoading] = useState(false);

  return (
    <>
      {/* v6.22: Buyer Persona Generator */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10"
        disabled={personaLoading}
        onClick={async () => {
          if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
          const firstHeld = trades.find((t: any) => t.status === 'held');
          if (!firstHeld) { toast.error('Ni held tradeov'); return; }
          setPersonaLoading(true); setPersonaData(null);
          try {
            const res = await fetch('/api/ai/buyer-persona', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tradeId: firstHeld.id }),
            });
            const data = await res.json();
            if (data.ok) { setPersonaData(data); toast.success('✓ Buyer persone generirane'); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setPersonaLoading(false); }
        }}
        title="AI ustvari buyer persone za ciljano trženje"
      >
        {personaLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
        Buyer persone
      </Button>

      {/* v6.22: AI Buyer Persona Generator results */}
      {personaData?.personas && (
        <Card className="bg-card/50 border-emerald-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold">AI Buyer Persona Generator</span>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/40">v6.22</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPersonaData(null)} className="h-6 text-xs">×</Button>
            </div>

            {personaData.insights && (
              <div className="bg-emerald-400/5 border border-emerald-400/20 rounded p-2 text-xs text-emerald-400">{personaData.insights}</div>
            )}

            {/* Marketing strategy */}
            {personaData.marketingStrategy && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🎯 Marketinška strategija:</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Primarna persona:</span> <b>{personaData.marketingStrategy.primaryPersona}</b></div>
                  <div><span className="text-muted-foreground">Sekundarna:</span> <b>{personaData.marketingStrategy.secondaryPersona}</b></div>
                  <div><span className="text-muted-foreground">Platforma:</span> <b className="capitalize">{personaData.marketingStrategy.recommendedPlatform}</b></div>
                  <div><span className="text-muted-foreground">Ton:</span> <b>{personaData.marketingStrategy.listingTone}</b></div>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">⏰ {personaData.marketingStrategy.optimalTiming}</div>
                {personaData.marketingStrategy.mustIncludeInListing?.length > 0 && (
                  <div className="text-[9px] mt-1">
                    <span className="text-primary font-semibold">✓ Vključi:</span> {personaData.marketingStrategy.mustIncludeInListing.join(' · ')}
                  </div>
                )}
                {personaData.marketingStrategy.avoidInListing?.length > 0 && (
                  <div className="text-[9px] mt-0.5">
                    <span className="text-red-500 font-semibold">⚠️ Izogni:</span> {personaData.marketingStrategy.avoidInListing.join(' · ')}
                  </div>
                )}
              </div>
            )}

            {/* Personas */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {personaData.personas.map((p: any, i: number) => {
                const typeCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  BUDGET_CONSCIOUS: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '💰' },
                  QUALITY_SEEKER: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '⭐' },
                  PREMIUM: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '👑' },
                  COLLECTOR: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '🎨' },
                  FLIPPER: { color: 'text-emerald-400', bg: 'border-emerald-400/20 bg-emerald-400/5', icon: '📈' },
                };
                const cfg = typeCfg[p.type] || typeCfg.BUDGET_CONSCIOUS;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px]">{p.name}</span>
                        <Badge variant="outline" className={cn('text-[8px] shrink-0', cfg.color)}>{p.type.replace('_', ' ')}</Badge>
                      </div>
                      <Badge variant="outline" className="text-[8px] shrink-0">💰 {p.willingnessToPayEur}€</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Starost:</span> <b>{p.ageRange}</b></div>
                      <div><span className="text-muted-foreground">Lokacija:</span> <b>{p.location}</b></div>
                      <div><span className="text-muted-foreground">Dohodek:</span> <b>{p.incomeRangeEur}€</b></div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      📅 Odločitev: {p.decisionTimeDays}d · 📉 Občutljivost: {p.priceSensitivity} · 📍 {p.preferredChannels.join(', ')}
                    </div>
                    {p.motivations?.length > 0 && (
                      <div className="text-[9px]"><span className="text-primary font-semibold">Motivacije:</span> {p.motivations.join(' · ')}</div>
                    )}
                    {p.painPoints?.length > 0 && (
                      <div className="text-[9px]"><span className="text-red-500 font-semibold">Skrbi:</span> {p.painPoints.join(' · ')}</div>
                    )}
                    {p.messaging?.hook && (
                      <div className="bg-background/40 rounded p-1 border text-[9px]">
                        <span className="text-primary font-semibold">🎯 Hook ({p.messaging.tone}):</span> {p.messaging.hook}
                        {p.messaging.keyArguments?.length > 0 && (
                          <div className="mt-0.5">📝 {p.messaging.keyArguments.join(' · ')}</div>
                        )}
                        <div className="mt-0.5 text-primary">📣 {p.messaging.callToAction}</div>
                      </div>
                    )}
                    {p.trustFactors?.length > 0 && (
                      <div className="text-[9px]"><span className="text-primary font-semibold">✓ Zaupanje:</span> {p.trustFactors.join(' · ')}</div>
                    )}
                    {p.objectionHandling?.length > 0 && (
                      <div className="text-[9px] space-y-0.5">
                        <div className="text-amber-400 font-semibold">🔄 Objection handling:</div>
                        {p.objectionHandling.map((o: any, j: number) => (
                          <div key={j} className="ml-2">
                            <div className="text-red-500">„{o.objection}"</div>
                            <div className="text-primary">→ {o.response}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
