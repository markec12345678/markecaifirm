'use client';

/**
 * v6.97: ImageAnalysisPanel — izvlečen iz ListingDetailModal.
 *
 * Združuje 3 AI panel-e povezane z analizo slike, opisa in obnove:
 * 1. AI Image Quality Assessor — /api/ai/image-quality (v6.21)
 * 2. AI Description Optimizer — /api/ai/description-optimizer (v6.23)
 * 3. AI Refurbishment Cost Estimator — /api/ai/refurbishment-cost (v6.20)
 *
 * Prej: ~396 vrstic inline JSX + 7 useState znotraj ListingDetailModal.
 * Sedaj: samostojna komponenta z lastnim state.
 *
 * API:
 * <ImageAnalysisPanel
 *   listingId={listing.id}
 *   imageUrl={listing.imageUrl}
 *   title={listing.title}
 *   description={listing.description}
 *   detailDescription={listing.detailDescription}
 *   source={listing.monitor?.source}
 *   price={listing.price}
 * />
 */

import { useState } from 'react';
import { Camera, FileEdit, Wrench, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ImageAnalysisPanelProps {
  listingId: string;
  imageUrl?: string | null;
  title: string;
  description?: string;
  detailDescription?: string | null;
  source?: string;
  price?: number | null;
}

export function ImageAnalysisPanel({ listingId, imageUrl, title, description, detailDescription, source, price }: ImageAnalysisPanelProps) {
  // State za vse 3 panele (prej v ListingDetailModal)
  const [imageQuality, setImageQuality] = useState<any>(null);
  const [imageQualityLoading, setImageQualityLoading] = useState(false);
  const [descOpt, setDescOpt] = useState<any>(null);
  const [descOptLoading, setDescOptLoading] = useState(false);
  const [descOptCopied, setDescOptCopied] = useState<string | null>(null);
  const [refurb, setRefurb] = useState<any>(null);
  const [refurbLoading, setRefurbLoading] = useState(false);

  // ===== 1. Image Quality =====
  const runImageQuality = async () => {
    setImageQualityLoading(true);
    setImageQuality(null);
    try {
      const res = await fetch('/api/ai/image-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) { setImageQuality(data); toast.success('✓ Analiza kakovosti slike generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setImageQualityLoading(false); }
  };

  // ===== 2. Description Optimizer =====
  const runDescOpt = async () => {
    setDescOptLoading(true);
    setDescOpt(null);
    try {
      const res = await fetch('/api/ai/description-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentDescription: detailDescription || description,
          title,
          category: source,
          price,
          targetPlatform: 'bolha',
        }),
      });
      const data = await res.json();
      if (data.ok) { setDescOpt(data); toast.success('✓ Optimizacija opisa generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setDescOptLoading(false); }
  };

  // ===== 3. Refurbishment Cost =====
  const runRefurb = async () => {
    setRefurbLoading(true);
    setRefurb(null);
    try {
      const res = await fetch('/api/ai/refurbishment-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) { setRefurb(data); toast.success('✓ Refurbishment ocena generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setRefurbLoading(false); }
  };

  return (
    <>
      {/* 1. AI Image Quality Assessor (v6.21) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-blue-400" />
            AI Image Quality Assessor
            <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.21</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
            disabled={imageQualityLoading || !imageUrl}
            onClick={runImageQuality}
          >
            {imageQualityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
            Oceni sliko
          </Button>
        </div>
        {imageQualityLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira kakovost slike (osvetlitev, kompozicija, ostrina)...
          </div>
        ) : imageQuality?.assessment ? (
          <div className="space-y-2 text-[11px]">
            <div className={cn('border rounded p-2',
              imageQuality.assessment.overallScore >= 70 ? 'bg-primary/10 border-primary/30' :
              imageQuality.assessment.overallScore >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold uppercase text-[10px]">Skupna kakovost</span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  imageQuality.assessment.overallScore >= 70 ? 'text-primary border-primary/40' :
                  imageQuality.assessment.overallScore >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  {imageQuality.assessment.overallScore}/100
                </Badge>
              </div>
              {imageQuality.assessment.imageFindings && (
                <p className="text-[10px] italic">{imageQuality.assessment.imageFindings}</p>
              )}
            </div>
            {/* Quality factors grid */}
            <div className="grid grid-cols-5 gap-1 text-[9px]">
              {Object.entries(imageQuality.assessment.qualityFactors).map(([k, v]: [string, any]) => (
                <div key={k} className="bg-background/40 rounded p-1 border text-center">
                  <div className="text-[8px] uppercase text-muted-foreground truncate">{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                  <div className={cn('font-mono font-bold',
                    v >= 7 ? 'text-primary' : v >= 4 ? 'text-amber-400' : 'text-red-500')}>{v}/10</div>
                </div>
              ))}
            </div>
            {/* Issues */}
            {imageQuality.assessment.issues?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Težave:</div>
                <div className="space-y-1">
                  {imageQuality.assessment.issues.map((i: any, j: number) => (
                    <div key={j} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span><Badge variant="outline" className="text-[8px] mr-1">{i.type}</Badge> {i.description}</span>
                        <Badge variant="outline" className={cn('text-[8px]',
                          i.severity === 'high' ? 'text-red-500 border-red-500/30' :
                          i.severity === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{i.severity}</Badge>
                      </div>
                      <div className="text-[9px] text-primary">→ {i.fix}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Recommendations */}
            {imageQuality.assessment.recommendations?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                <div className="space-y-1">
                  {imageQuality.assessment.recommendations.map((r: any, j: number) => (
                    <div key={j} className="text-[10px] flex items-center justify-between">
                      <span>{r.action}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="outline" className={cn('text-[8px]',
                          r.impact === 'high' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>{r.impact}</Badge>
                        {r.estimatedValueIncreaseEur > 0 && <span className="font-mono text-primary">+{r.estimatedValueIncreaseEur}€</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Suggested shots */}
            {imageQuality.assessment.suggestedShots?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📸 Predlagane dodatne slike:</div>
                <div className="space-y-0.5">
                  {imageQuality.assessment.suggestedShots.map((s: any, j: number) => (
                    <div key={j} className="text-[10px] flex items-center justify-between">
                      <span><Badge variant="outline" className="text-[8px] mr-1">{s.type}</Badge> {s.description}</span>
                      <Badge variant="outline" className={cn('text-[8px]',
                        s.priority === 'high' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>{s.priority}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            {imageUrl ? 'AI oceni kakovost slike (osvetlitev, kompozicija, ostrina, prodajni potencial).' : 'Ni slike za analizo.'}
          </p>
        )}
      </div>

      {/* 2. AI Description Optimizer (v6.23) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileEdit className="w-3.5 h-3.5 text-pink-400" />
            AI Description Optimizer
            <Badge variant="outline" className="text-[10px] text-pink-400 border-pink-400/40">v6.23</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-pink-400/40 text-pink-400 hover:bg-pink-400/10"
            disabled={descOptLoading}
            onClick={runDescOpt}
          >
            {descOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileEdit className="w-3 h-3" />}
            Optimiziraj opis
          </Button>
        </div>
        {descOptLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI optimizira opis z 4 strategijami (BENEFIT/STORY/TECHNICAL/SCANNABLE)...
          </div>
        ) : descOpt?.optimization ? (
          <div className="space-y-2 text-[11px]">
            {/* Current analysis */}
            <div className="bg-background/40 border rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase text-muted-foreground">Trenutni opis:</span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  descOpt.optimization.currentAnalysis.score >= 70 ? 'text-primary border-primary/40' :
                  descOpt.optimization.currentAnalysis.score >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  Score: {descOpt.optimization.currentAnalysis.score}/100
                </Badge>
              </div>
              {descOpt.optimization.currentAnalysis.strengths?.length > 0 && (
                <div className="text-[9px] text-primary">✓ {descOpt.optimization.currentAnalysis.strengths.join(' · ')}</div>
              )}
              {descOpt.optimization.currentAnalysis.weaknesses?.length > 0 && (
                <div className="text-[9px] text-red-500">⚠️ {descOpt.optimization.currentAnalysis.weaknesses.join(' · ')}</div>
              )}
            </div>

            {/* Winner */}
            {descOpt.optimization.winner?.description && (
              <div className="bg-primary/10 border border-primary/30 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase text-primary font-bold">🏆 Zmagovalni opis:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(descOpt.optimization.winner.description);
                      setDescOptCopied('winner');
                      setTimeout(() => setDescOptCopied(null), 1500);
                      toast.success('Opis kopiran');
                    }}
                    className="text-[9px] text-primary hover:underline"
                  >
                    {descOptCopied === 'winner' ? '✓' : '📋'} Kopiraj
                  </button>
                </div>
                <div className="text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto">{descOpt.optimization.winner.description}</div>
                <div className="text-[9px] text-muted-foreground mt-1">{descOpt.optimization.winner.why}</div>
                {descOpt.optimization.winner.expectedImprovementPct > 0 && (
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/40 mt-1">
                    +{descOpt.optimization.winner.expectedImprovementPct}% izboljšava
                  </Badge>
                )}
              </div>
            )}

            {/* Variants */}
            {descOpt.optimization.variants?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Variante opisov:</div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {descOpt.optimization.variants.map((v: any, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-1.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[8px] text-pink-400 border-pink-400/30">{v.strategy.replace('_', ' ')}</Badge>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className={cn('text-[8px] font-mono',
                            v.overallScore >= 70 ? 'text-primary border-primary/40' : 'text-amber-400 border-amber-400/40')}>{v.overallScore}</Badge>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(v.description);
                              setDescOptCopied(`v${i}`);
                              setTimeout(() => setDescOptCopied(null), 1500);
                              toast.success('Varianta kopirana');
                            }}
                            className="text-[9px] text-pink-400 hover:underline"
                          >
                            {descOptCopied === `v${i}` ? '✓' : '📋'}
                          </button>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground line-clamp-2">{v.description.slice(0, 150)}...</div>
                      <div className="grid grid-cols-4 gap-1 text-[8px]">
                        <div className="text-center"><span className="text-muted-foreground">Berljivost:</span> <b className={v.readabilityScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.readabilityScore}</b></div>
                        <div className="text-center"><span className="text-muted-foreground">Prep.:</span> <b className={v.persuasivenessScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.persuasivenessScore}</b></div>
                        <div className="text-center"><span className="text-muted-foreground">SEO:</span> <b className={v.seoScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.seoScore}</b></div>
                        <div className="text-center"><span className="text-muted-foreground">Zaupanje:</span> <b className={v.trustScore >= 70 ? 'text-primary' : 'text-amber-400'}>{v.trustScore}</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SEO keywords */}
            {descOpt.optimization.seoKeywords?.length > 0 && (
              <div className="bg-background/40 border rounded p-1.5">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🔍 SEO ključne besede:</div>
                <div className="flex flex-wrap gap-1">
                  {descOpt.optimization.seoKeywords.map((k: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[8px]">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            AI optimizira opis z 4 strategijami (BENEFIT/STORY/TECHNICAL/SCANNABLE) in A/B testi.
          </p>
        )}
      </div>

      {/* 3. AI Refurbishment Cost Estimator (v6.20) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            AI Refurbishment Cost Estimator
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.20</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            disabled={refurbLoading}
            onClick={runRefurb}
          >
            {refurbLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
            Oceni obnovo
          </Button>
        </div>
        {refurbLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira sliko in ocenjuje stroške obnove...
          </div>
        ) : refurb?.estimate ? (
          <div className="space-y-2 text-[11px]">
            <div className={cn('border rounded p-2',
              refurb.estimate.recommendedAction === 'avoid' ? 'bg-red-500/5 border-red-500/20' :
              refurb.estimate.recommendedAction === 'buy_and_refurb' ? 'bg-primary/10 border-primary/30' :
              refurb.estimate.recommendedAction === 'marginal' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/40 border-border')}>
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                  refurb.estimate.recommendedAction === 'avoid' ? 'text-red-500 border-red-500/40' :
                  refurb.estimate.recommendedAction === 'buy_and_refurb' ? 'text-primary border-primary/40' :
                  refurb.estimate.recommendedAction === 'marginal' ? 'text-amber-400 border-amber-400/40' : 'text-muted-foreground')}>
                  {refurb.estimate.recommendedAction.replace('_', ' ')}
                </Badge>
                <span className="text-[9px]">{refurb.estimate.refurbStrategy.replace('_', ' ')}</span>
              </div>
              {refurb.estimate.imageFindings && (
                <p className="text-[10px] italic mb-1">📸 {refurb.estimate.imageFindings}</p>
              )}
              <p className="text-[10px]">{refurb.estimate.reasoning}</p>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[10px]">
              <div className="bg-background/40 rounded p-1 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Nakup</div>
                <div className="font-mono font-bold">{refurb.estimate.buyPrice}€</div>
              </div>
              <div className="bg-background/40 rounded p-1 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Obnova</div>
                <div className="font-mono font-bold text-amber-400">{refurb.estimate.totalRefurbCostEur}€</div>
              </div>
              <div className="bg-background/40 rounded p-1 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Prodaja</div>
                <div className="font-mono font-bold text-primary">{refurb.estimate.resaleValueEur}€</div>
              </div>
              <div className={cn('rounded p-1 border text-center',
                refurb.estimate.profitPotentialEur >= 0 ? 'bg-primary/10 border-primary/30' : 'bg-red-500/10 border-red-500/30')}>
                <div className="text-[9px] uppercase text-muted-foreground">Dobiček</div>
                <div className={cn('font-mono font-bold', refurb.estimate.profitPotentialEur >= 0 ? 'text-primary' : 'text-destructive')}>
                  {refurb.estimate.profitPotentialEur >= 0 ? '+' : ''}{refurb.estimate.profitPotentialEur}€
                </div>
              </div>
            </div>
            <div className="text-[9px] text-muted-foreground">
              ROI: <b className={refurb.estimate.roiPct >= 20 ? 'text-primary' : 'text-amber-400'}>{refurb.estimate.roiPct}%</b>
              {' · '}⏱ {refurb.estimate.timeRequiredDays}d
              {' · '}🔧 {refurb.estimate.skillsRequired}
            </div>
            {refurb.estimate.items?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Postopki obnove:</div>
                <div className="space-y-0.5">
                  {refurb.estimate.items.map((it: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center justify-between bg-background/40 rounded p-1 border">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={cn('text-[8px]',
                          it.complexity === 'hard' ? 'text-red-500 border-red-500/30' :
                          it.complexity === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                          {it.complexity}
                        </Badge>
                        {it.optional && <span className="text-[8px] text-muted-foreground">opcijsko</span>}
                        <span>{it.name}</span>
                      </div>
                      <span className="font-mono font-bold text-amber-400">{it.costEur}€</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {refurb.estimate.toolsNeeded?.length > 0 && (
              <div className="text-[9px] text-muted-foreground">
                🛠 Orodja: {refurb.estimate.toolsNeeded.join(' · ')}
              </div>
            )}
            {refurb.estimate.warnings?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Opozorila:</div>
                <ul className="space-y-0.5 ml-3">
                  {refurb.estimate.warnings.map((w: string, i: number) => <li key={i} className="text-[10px] list-disc list-outside">{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            AI oceni stroške obnove (vizualna analiza slike + kalkulacija dobička po preprodaji).
          </p>
        )}
      </div>
    </>
  );
}
