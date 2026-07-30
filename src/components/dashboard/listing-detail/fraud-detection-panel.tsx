'use client';

/**
 * v6.96: FraudDetectionPanel — izvlečen iz ListingDetailModal.
 *
 * Združuje 3 AI panel-e povezane z odkrivanjem prevare:
 * 1. AI Fraud Detection (hevristika + ML signali) — /api/ai/fraud-detection (v6.13)
 * 2. AI Fake Detection (pristnost izdelka, luksus/elektronika) — /api/ai/fake-detection (v6.21)
 * 3. AI Reverse Image Search (stock foto detekcija) — /api/ai/reverse-image-search (v6.22)
 *
 * Prej: 434 vrstic inline JSX + 6 useState znotraj ListingDetailModal.
 * Sedaj: samostojna komponenta z lastnim state.
 *
 * API: <FraudDetectionPanel listingId={listing.id} imageUrl={listing.imageUrl} />
 */

import { useState } from 'react';
import { ShieldAlert, ScanSearch, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ===== Tipi za AI response =====
interface FraudResult {
  analysis: {
    riskLevel: 'critical' | 'high' | 'medium' | 'low' | string;
    scamType: string;
    fraudScore: number;
    hevristicScore: number;
    aiScore: number;
    aiAssessment: string;
    reasoning?: string;
    recommendation: 'avoid' | 'report' | 'verify_first' | 'proceed' | string;
    redFlags?: Array<{ pattern: string; weight: number; [k: string]: any }>;
    mlSignals?: Array<{ signal: string; riskContribution: number; [k: string]: any }>;
    additionalRedFlags?: string[];
    verificationSteps?: string[];
    similarFraudPatterns?: any[];
  };
}

interface FakeDetectResult {
  detection: {
    isLikelyFake: boolean;
    authenticityScore: number;
    fakeProbabilityPct: number;
    detectedBrand?: string;
    imageFindings?: string;
    recommendation: 'avoid' | 'report' | 'verify_first' | 'proceed' | string;
    reasoning?: string;
    indicators?: Array<{ type: 'authentic' | 'fake' | string; description: string; weight: number }>;
    brandSpecificChecks?: Array<{ check: string; status: 'present' | 'missing' | string }>;
    verificationSteps?: Array<{ step: string; priority: string; howTo: string }>;
    onlineVerification?: { recommendedTools?: string[] };
  };
}

interface ReverseSearchResult {
  search: {
    isStockPhoto: boolean;
    stockPhotoProbabilityPct: number;
    imageFindings?: string;
    recommendation: 'avoid' | 'report' | 'verify_first' | 'proceed' | string;
    reasoning?: string;
    urlAnalysis?: {
      matchedStockDomains?: string[];
      matchedPatterns?: string[];
      matchedWatermarks?: string[];
      totalRedFlags: number;
    };
    visualIndicators?: Array<{ type: 'authentic' | 'stock' | string; indicator: string; weight: number }>;
    searchStrategy?: {
      googleLensUrl?: string;
      tineyeUrl?: string;
      bingVisualUrl?: string;
      yandexUrl?: string;
    };
  };
}

// ===== Glavna komponenta =====
export function FraudDetectionPanel({ listingId, imageUrl }: { listingId: string; imageUrl?: string | null }) {
  const [fraud, setFraud] = useState<FraudResult | null>(null);
  const [fraudLoading, setFraudLoading] = useState(false);
  const [fakeDetect, setFakeDetect] = useState<FakeDetectResult | null>(null);
  const [fakeDetectLoading, setFakeDetectLoading] = useState(false);
  const [reverseSearch, setReverseSearch] = useState<ReverseSearchResult | null>(null);
  const [reverseSearchLoading, setReverseSearchLoading] = useState(false);

  // ===== 1. Fraud Detection =====
  const runFraud = async () => {
    setFraudLoading(true);
    setFraud(null);
    try {
      const res = await fetch('/api/ai/fraud-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) { setFraud(data); toast.success('✓ Fraud analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setFraudLoading(false); }
  };

  // ===== 2. Fake Detection =====
  const runFakeDetect = async () => {
    setFakeDetectLoading(true);
    setFakeDetect(null);
    try {
      const res = await fetch('/api/ai/fake-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) { setFakeDetect(data); toast.success('✓ Fake detection analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setFakeDetectLoading(false); }
  };

  // ===== 3. Reverse Image Search =====
  const runReverseSearch = async () => {
    setReverseSearchLoading(true);
    setReverseSearch(null);
    try {
      const res = await fetch('/api/ai/reverse-image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) { setReverseSearch(data); toast.success('✓ Reverse image search generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setReverseSearchLoading(false); }
  };

  return (
    <>
      {/* 1. AI Fraud Detection (v6.13) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
            AI Fraud Detection
            <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.13</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-red-500/40 text-red-500 hover:bg-red-500/10"
            disabled={fraudLoading}
            onClick={runFraud}
          >
            {fraudLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
            Skeniraj oglas
          </Button>
        </div>

        {fraudLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira 30+ vzorcev prevare + ML signale...
          </div>
        ) : fraud?.analysis ? (
          <div className="space-y-2 text-[11px]">
            {/* Fraud score */}
            <div className={cn('border rounded p-2',
              fraud.analysis.riskLevel === 'critical' ? 'bg-red-500/10 border-red-500/40' :
              fraud.analysis.riskLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
              fraud.analysis.riskLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/5 border-primary/20')}>
              <div className="flex items-center justify-between mb-1">
                <span className={cn('font-bold uppercase text-[10px]',
                  fraud.analysis.riskLevel === 'critical' || fraud.analysis.riskLevel === 'high' ? 'text-red-500' :
                  fraud.analysis.riskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                  🛡️ {fraud.analysis.riskLevel} risk · {fraud.analysis.scamType.replace('_', ' ')}
                </span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  fraud.analysis.fraudScore >= 70 ? 'text-red-500 border-red-500/40' :
                  fraud.analysis.fraudScore >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                  Score: {fraud.analysis.fraudScore}/100
                </Badge>
              </div>
              <p className="text-[10px] font-medium">{fraud.analysis.aiAssessment}</p>
              {fraud.analysis.reasoning && <p className="text-[9px] text-muted-foreground italic mt-1">{fraud.analysis.reasoning}</p>}
            </div>

            {/* Recommendation */}
            <div className={cn('rounded p-1.5 border text-[10px] font-bold uppercase text-center',
              fraud.analysis.recommendation === 'avoid' || fraud.analysis.recommendation === 'report'
                ? 'bg-red-500/10 border-red-500/30 text-red-500'
                : fraud.analysis.recommendation === 'verify_first'
                ? 'bg-amber-400/10 border-amber-400/30 text-amber-400'
                : 'bg-primary/10 border-primary/30 text-primary')}>
              {fraud.analysis.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
               fraud.analysis.recommendation === 'report' ? '🚨 PRIJAVI' :
               fraud.analysis.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI S PREVIDNOSTJO'}
            </div>

            {/* Score breakdown */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-muted-foreground text-[9px]">Hevristika</div>
                <div className="font-mono font-bold">{fraud.analysis.hevristicScore}/100</div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-muted-foreground text-[9px]">AI ocena</div>
                <div className="font-mono font-bold">{fraud.analysis.aiScore}/100</div>
              </div>
            </div>

            {/* Red flags */}
            {(fraud.analysis.redFlags?.length ?? 0) > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-red-500 mb-1">🚩 Red flags ({fraud.analysis.redFlags?.length ?? 0}):</div>
                <ul className="space-y-0.5 ml-3">
                  {fraud.analysis.redFlags?.slice(0, 8).map((r: any, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">
                      <span className="font-medium">{r.pattern}</span>
                      <span className="text-muted-foreground"> (+{r.weight}pt)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ML signals */}
            {(fraud.analysis.mlSignals?.length ?? 0) > 0 && (
              <div className="bg-blue-400/5 border border-blue-400/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-blue-400 mb-1">🤖 ML signali:</div>
                <ul className="space-y-0.5 ml-3">
                  {fraud.analysis.mlSignals?.map((s: any, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">
                      {s.signal} <span className="text-muted-foreground">(+{s.riskContribution}pt)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Additional red flags */}
            {(fraud.analysis.additionalRedFlags?.length ?? 0) > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-amber-400 mb-1">🔍 Subtilni znaki:</div>
                <ul className="space-y-0.5 ml-3">
                  {fraud.analysis.additionalRedFlags?.map((r: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Verification steps */}
            {(fraud.analysis.verificationSteps?.length ?? 0) > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-primary mb-1">✓ Koraki za preverjanje:</div>
                <ol className="space-y-0.5 ml-3">
                  {fraud.analysis.verificationSteps?.map((s: string, i: number) => (
                    <li key={i} className="text-[10px] list-decimal list-outside">{s}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Similar fraud patterns */}
            {(fraud.analysis.similarFraudPatterns?.length ?? 0) > 0 && (
              <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                🔗 Podobni sumljivi oglasi: {fraud.analysis.similarFraudPatterns?.length ?? 0}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            AI kombinira hevristiko (30+ vzorcev prevare) z ML signali in kontekstno AI analizo.
          </p>
        )}
      </div>

      {/* 2. AI Fake Detection (v6.21) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ScanSearch className="w-3.5 h-3.5 text-red-500" />
            AI Fake Detection
            <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.21</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-red-500/40 text-red-500 hover:bg-red-500/10"
            disabled={fakeDetectLoading || !imageUrl}
            onClick={runFakeDetect}
          >
            {fakeDetectLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
            Preveri pristnost
          </Button>
        </div>
        {fakeDetectLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI preverja znake ponarejanja z vizualno analizo...
          </div>
        ) : fakeDetect?.detection ? (
          <div className="space-y-2 text-[11px]">
            <div className={cn('border rounded p-2',
              fakeDetect.detection.isLikelyFake ? 'bg-red-500/10 border-red-500/30' :
              fakeDetect.detection.authenticityScore >= 70 ? 'bg-primary/10 border-primary/30' :
              'bg-amber-400/5 border-amber-400/20')}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold uppercase text-[10px]">
                  {fakeDetect.detection.isLikelyFake ? '🚨 VERJETNO PONAREDEK' : '✓ Verjetno pristen'}
                </span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  fakeDetect.detection.fakeProbabilityPct >= 60 ? 'text-red-500 border-red-500/40' :
                  fakeDetect.detection.fakeProbabilityPct >= 30 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                  Pristnost: {fakeDetect.detection.authenticityScore}%
                </Badge>
              </div>
              {fakeDetect.detection.detectedBrand && (
                <div className="text-[9px] text-muted-foreground">Znamka: <b>{fakeDetect.detection.detectedBrand}</b></div>
              )}
              {fakeDetect.detection.imageFindings && (
                <p className="text-[10px] italic mt-1">{fakeDetect.detection.imageFindings}</p>
              )}
            </div>
            <div className={cn('rounded p-1.5 text-[10px] text-center font-bold uppercase',
              fakeDetect.detection.recommendation === 'avoid' || fakeDetect.detection.recommendation === 'report'
                ? 'bg-red-500/10 text-red-500'
                : fakeDetect.detection.recommendation === 'verify_first'
                ? 'bg-amber-400/10 text-amber-400'
                : 'bg-primary/10 text-primary')}>
              → {fakeDetect.detection.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
                 fakeDetect.detection.recommendation === 'report' ? '🚨 PRIJAVI' :
                 fakeDetect.detection.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI'}
            </div>
            {fakeDetect.detection.reasoning && (
              <div className="text-[10px] text-muted-foreground italic">{fakeDetect.detection.reasoning}</div>
            )}
            {/* Indicators */}
            {(fakeDetect.detection.indicators?.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Indikatorji:</div>
                <div className="space-y-0.5">
                  {fakeDetect.detection.indicators?.map((i: any, j: number) => (
                    <div key={j} className="text-[10px] flex items-center justify-between">
                      <span className={cn(i.type === 'authentic' ? 'text-primary' : i.type === 'fake' ? 'text-red-500' : 'text-amber-400')}>
                        {i.type === 'authentic' ? '✓' : i.type === 'fake' ? '🚨' : '⚠️'} {i.description}
                      </span>
                      <span className="text-[8px] text-muted-foreground">({i.weight}/10)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Brand-specific checks */}
            {(fakeDetect.detection.brandSpecificChecks?.length ?? 0) > 0 && (
              <div className="bg-background/40 border rounded p-1.5">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Specifično za znamko:</div>
                <div className="space-y-0.5">
                  {fakeDetect.detection.brandSpecificChecks?.map((c: any, j: number) => (
                    <div key={j} className="text-[10px] flex items-center justify-between">
                      <span>{c.check}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="outline" className={cn('text-[8px]',
                          c.status === 'present' ? 'text-primary border-primary/30' :
                          c.status === 'missing' ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                          {c.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Verification steps */}
            {(fakeDetect.detection.verificationSteps?.length ?? 0) > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-primary mb-1">✓ Koraki za preverjanje:</div>
                <ol className="space-y-0.5 ml-3">
                  {fakeDetect.detection.verificationSteps?.map((s: any, j: number) => (
                    <li key={j} className="text-[10px] list-decimal list-outside">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.step}</span>
                        <Badge variant="outline" className={cn('text-[8px]',
                          s.priority === 'high' ? 'text-red-500 border-red-500/30' : 'text-muted-foreground')}>{s.priority}</Badge>
                      </div>
                      <div className="text-[9px] text-muted-foreground">→ {s.howTo}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {/* Online tools */}
            {(fakeDetect.detection.onlineVerification?.recommendedTools?.length ?? 0) > 0 && (
              <div className="text-[10px] text-muted-foreground">
                🔍 Orodja: {fakeDetect.detection.onlineVerification?.recommendedTools?.join(' · ')}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            {imageUrl ? 'AI preveri znake ponarejanja (Gucci/LV/Rolex/iPhone/...).' : 'Ni slike za analizo.'}
          </p>
        )}
      </div>

      {/* 3. AI Reverse Image Search (v6.22) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            AI Reverse Image Search
            <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400/40">v6.22</Badge>
          </h4>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1.5 border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/10"
            disabled={reverseSearchLoading || !imageUrl}
            onClick={runReverseSearch}
          >
            {reverseSearchLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Preveri sliko
          </Button>
        </div>
        {reverseSearchLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI preverja ali je slika stock fotografija...
          </div>
        ) : reverseSearch?.search ? (
          <div className="space-y-2 text-[11px]">
            <div className={cn('border rounded p-2',
              reverseSearch.search.isStockPhoto ? 'bg-red-500/10 border-red-500/30' :
              reverseSearch.search.stockPhotoProbabilityPct >= 50 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/10 border-primary/30')}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold uppercase text-[10px]">
                  {reverseSearch.search.isStockPhoto ? '🚨 STOCK FOTOGRAFIJA' : '✓ Verjetno realna slika'}
                </span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  reverseSearch.search.stockPhotoProbabilityPct >= 70 ? 'text-red-500 border-red-500/40' :
                  reverseSearch.search.stockPhotoProbabilityPct >= 30 ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                  Stock verjetnost: {reverseSearch.search.stockPhotoProbabilityPct}%
                </Badge>
              </div>
              {reverseSearch.search.imageFindings && (
                <p className="text-[10px] italic">{reverseSearch.search.imageFindings}</p>
              )}
            </div>
            <div className={cn('rounded p-1.5 text-[10px] text-center font-bold uppercase',
              reverseSearch.search.recommendation === 'avoid' || reverseSearch.search.recommendation === 'report'
                ? 'bg-red-500/10 text-red-500'
                : reverseSearch.search.recommendation === 'verify_first'
                ? 'bg-amber-400/10 text-amber-400'
                : 'bg-primary/10 text-primary')}>
              → {reverseSearch.search.recommendation === 'avoid' ? '🚫 NE NAKUPUJ' :
                 reverseSearch.search.recommendation === 'report' ? '🚨 PRIJAVI' :
                 reverseSearch.search.recommendation === 'verify_first' ? '⚠️ PREVERI PREJ' : '✓ NAKUPI S PREVIDNOSTJO'}
            </div>
            {reverseSearch.search.reasoning && (
              <div className="text-[10px] text-muted-foreground italic">{reverseSearch.search.reasoning}</div>
            )}
            {/* URL analysis */}
            {reverseSearch.search.urlAnalysis && (
              <div className="bg-background/40 border rounded p-1.5">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🔗 URL analiza:</div>
                <div className="space-y-0.5 text-[10px]">
                  {(reverseSearch.search.urlAnalysis?.matchedStockDomains?.length ?? 0) > 0 && (
                    <div className="text-red-500">🚨 Stock domena: {reverseSearch.search.urlAnalysis?.matchedStockDomains?.join(', ')}</div>
                  )}
                  {(reverseSearch.search.urlAnalysis?.matchedPatterns?.length ?? 0) > 0 && (
                    <div className="text-amber-400">⚠️ Stock vzorci: {reverseSearch.search.urlAnalysis?.matchedPatterns?.join(', ')}</div>
                  )}
                  {(reverseSearch.search.urlAnalysis?.matchedWatermarks?.length ?? 0) > 0 && (
                    <div className="text-red-500">🚨 Watermark: {reverseSearch.search.urlAnalysis?.matchedWatermarks?.join(', ')}</div>
                  )}
                  {reverseSearch.search.urlAnalysis.totalRedFlags === 0 && (
                    <div className="text-primary">✓ URL brez sumljivih vzorcev</div>
                  )}
                </div>
              </div>
            )}
            {/* Visual indicators */}
            {(reverseSearch.search.visualIndicators?.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Vizualni indikatorji:</div>
                <div className="space-y-0.5">
                  {reverseSearch.search.visualIndicators?.map((v: any, j: number) => (
                    <div key={j} className="text-[10px] flex items-center justify-between">
                      <span className={cn(v.type === 'authentic' ? 'text-primary' : v.type === 'stock' ? 'text-red-500' : 'text-amber-400')}>
                        {v.type === 'authentic' ? '✓' : v.type === 'stock' ? '🚨' : '⚠️'} {v.indicator}
                      </span>
                      <span className="text-[8px] text-muted-foreground">({v.weight}/10)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Search URLs */}
            {reverseSearch.search.searchStrategy && (
              <div className="bg-cyan-400/5 border border-cyan-400/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-cyan-400 mb-1">🔍 Preveri na:</div>
                <div className="grid grid-cols-2 gap-1 text-[9px]">
                  {reverseSearch.search.searchStrategy.googleLensUrl && (
                    <a href={reverseSearch.search.searchStrategy.googleLensUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                      <ExternalLink className="w-3 h-3" /> Google Lens
                    </a>
                  )}
                  {reverseSearch.search.searchStrategy.tineyeUrl && (
                    <a href={reverseSearch.search.searchStrategy.tineyeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                      <ExternalLink className="w-3 h-3" /> TinEye
                    </a>
                  )}
                  {reverseSearch.search.searchStrategy.bingVisualUrl && (
                    <a href={reverseSearch.search.searchStrategy.bingVisualUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                      <ExternalLink className="w-3 h-3" /> Bing Visual
                    </a>
                  )}
                  {reverseSearch.search.searchStrategy.yandexUrl && (
                    <a href={reverseSearch.search.searchStrategy.yandexUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-cyan-400 hover:underline">
                      <ExternalLink className="w-3 h-3" /> Yandex
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            {imageUrl ? 'AI preveri ali je slika stock fotografija (URL + vizualna analiza).' : 'Ni slike za analizo.'}
          </p>
        )}
      </div>
    </>
  );
}
