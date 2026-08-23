'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, FileText, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Trade } from './types';

interface AIListingGeneratorProps {
  trades: Trade[];
}

export function AIListingGenerator({ trades }: AIListingGeneratorProps) {
  const [listingGen, setListingGen] = useState<any>(null);
  const [listingGenLoading, setListingGenLoading] = useState<string | null>(null);
  const [listingGenPlatform, setListingGenPlatform] = useState<'bolha' | 'vinted' | 'facebook' | 'avtonet'>('bolha');
  const [listingGenCopied, setListingGenCopied] = useState<string | null>(null);

  return (
    <>
      {/* v6.14: Multi-Modal Listing Generator */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
        disabled={!!listingGenLoading}
        onClick={async () => {
          if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
          const firstHeld = trades.find((t: any) => t.status === 'held');
          if (!firstHeld) { toast.error('Ni held tradeov za prodajo'); return; }
          setListingGenLoading(firstHeld.id); setListingGen(null);
          try {
            const res = await fetch('/api/ai/multimodal-listing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tradeId: firstHeld.id, targetPlatform: listingGenPlatform, language: 'sl' }),
            });
            const data = await res.json();
            if (data.ok) { setListingGen(data); toast.success('✓ Listing generiran'); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
          finally { setListingGenLoading(null); }
        }}
        title="AI generira celovit listing za prodajo (naslov, opis, cene, slikovna strategija)"
      >
        {listingGenLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        Listing generator
      </Button>

      {/* v6.14: AI Multi-Modal Listing Generator results */}
      {listingGen && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Listing Generator</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
                {listingGen.listing?.priceStrategy && (
                  <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/40 uppercase">
                    {listingGen.listing.priceStrategy}
                  </Badge>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setListingGen(null)} className="h-6 text-xs">×</Button>
            </div>

            {listingGen.listing && (
              <div className="space-y-3">
                {/* Title + price */}
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase text-muted-foreground">Naslov ({listingGen.platform})</span>
                    <div className="text-right">
                      <div className="font-mono font-bold text-primary">{listingGen.listing.priceRecommendation}€</div>
                      <div className="text-[9px] text-muted-foreground">priporočena cena</div>
                    </div>
                  </div>
                  <div className="font-bold text-sm">{listingGen.listing.title}</div>
                </div>

                {/* Market benchmark */}
                {listingGen.marketBenchmark && (
                  <div className="text-[10px] text-muted-foreground">📊 {listingGen.marketBenchmark}</div>
                )}

                {/* Main description */}
                {listingGen.listing.mainDescription && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] uppercase text-muted-foreground">Glavni opis:</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(listingGen.listing.mainDescription);
                          setListingGenCopied('main');
                          setTimeout(() => setListingGenCopied(null), 1500);
                          toast.success('Opis kopiran');
                        }}
                        className="text-[9px] text-primary hover:underline flex items-center gap-1"
                      >
                        {listingGenCopied === 'main' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Kopiraj
                      </button>
                    </div>
                    <div className="bg-background/40 border rounded p-2 text-[11px] whitespace-pre-wrap">
                      {listingGen.listing.mainDescription}
                    </div>
                  </div>
                )}

                {/* Call to action */}
                {listingGen.listing.callToAction && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5 text-[11px]">
                    <span className="text-[9px] uppercase text-primary font-bold">📣 CTA: </span>
                    <span>{listingGen.listing.callToAction}</span>
                  </div>
                )}

                {/* Highlight features */}
                {listingGen.listing.highlightFeatures?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">✨ Highlight features:</div>
                    <div className="flex flex-wrap gap-1">
                      {listingGen.listing.highlightFeatures.map((f: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px] text-primary border-primary/30">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Honest disclosures */}
                {listingGen.listing.honestDisclosures?.length > 0 && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                    <div className="text-[10px] uppercase text-amber-400 mb-1">🔍 Poštene opombe:</div>
                    <ul className="space-y-0.5 ml-3">
                      {listingGen.listing.honestDisclosures.map((d: string, i: number) => (
                        <li key={i} className="text-[10px] list-disc list-outside">{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Platform adaptations */}
                {listingGen.listing.platformsAdaptations?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">📱 Prilagoditve po platformah:</div>
                    <div className="space-y-2">
                      {listingGen.listing.platformsAdaptations.map((p: any, i: number) => (
                        <div key={i} className="bg-background/40 border rounded p-2">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="text-[9px] uppercase">{p.platform}</Badge>
                            <span className="font-mono font-bold text-primary text-[11px]">{p.price}€</span>
                          </div>
                          <div className="font-bold text-[11px] mb-1">{p.title}</div>
                          <div className="text-[10px] text-muted-foreground whitespace-pre-wrap">{p.descriptionShort}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Image strategy */}
                {listingGen.listing.imageStrategy && (
                  <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2">
                    <div className="text-[10px] uppercase text-blue-400 mb-1">📸 Slikovna strategija:</div>
                    <div className="space-y-1 text-[10px]">
                      <div><span className="font-semibold">Glavna:</span> {listingGen.listing.imageStrategy.mainShot}</div>
                      {listingGen.listing.imageStrategy.detailShots?.length > 0 && (
                        <div>
                          <span className="font-semibold">Detalji:</span>
                          <ul className="ml-3">
                            {listingGen.listing.imageStrategy.detailShots.map((s: string, i: number) => (
                              <li key={i} className="list-disc list-outside">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div><span className="font-semibold">Kontekst:</span> {listingGen.listing.imageStrategy.contextShot}</div>
                      {listingGen.listing.imageStrategy.videoRecommended && (
                        <div className="text-primary font-medium">🎥 Video priporočen: {listingGen.listing.imageStrategy.videoDescription}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* SEO */}
                {listingGen.listing.seo && (
                  <div className="bg-background/40 border rounded p-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">🔍 SEO:</div>
                    <div className="text-[10px]">
                      <div><span className="font-semibold">Primarna ključna beseda:</span> {listingGen.listing.seo.primaryKeyword}</div>
                      {listingGen.listing.seo.searchTerms?.length > 0 && (
                        <div className="mt-1">
                          <span className="font-semibold">Iskalni izrazi:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {listingGen.listing.seo.searchTerms.map((s: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {listingGen.listing.tagsKeywords?.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">🏷️ Tags:</div>
                    <div className="flex flex-wrap gap-1">
                      {listingGen.listing.tagsKeywords.map((t: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px] text-muted-foreground">#{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
