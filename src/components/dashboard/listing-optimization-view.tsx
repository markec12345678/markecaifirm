'use client';

/**
 * v7.05: ListingOptimizationView — nov pogled za AI optimizacijo oglasov.
 *
 * Backend ima 40+ listing optimization AI endpointov, a frontend jih ni imel
 * v dedicated UI (samo description-optimizer in image-quality v ListingDetailModal).
 *
 * Integrira 5 najboljših:
 * 1. Listing Image Generator — /api/ai/listing-image-generator (VLM prompti za Midjourney/DALL-E)
 * 2. Description Generator v3 — /api/ai/listing-description-generator-v3 (10 stilov, A/B test)
 * 3. SEO Optimizer v2 — /api/ai/listing-seo-optimizer-v2 (keyword research, competitor analysis)
 * 4. Virality Predictor — /api/ai/listing-virality-predictor (8 heuristik v TS, viral potential)
 * 5. CTR Optimizer — /api/ai/listing-ctr-optimizer (optimizacija click-through rate)
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Camera, FileText, Search, Flame, MousePointerClick, Sparkles, Image as ImageIcon, Type, Tag, ImagePlus, Users, RefreshCw as RefreshIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  status: string;
}

export function ListingOptimizationView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTradeId, setSelectedTradeId] = useState('');

  const [imageGen, setImageGen] = useState<any>(null);
  const [imageGenLoading, setImageGenLoading] = useState(false);
  const [descGen, setDescGen] = useState<any>(null);
  const [descGenLoading, setDescGenLoading] = useState(false);
  const [seoOpt, setSeoOpt] = useState<any>(null);
  const [seoOptLoading, setSeoOptLoading] = useState(false);
  const [virality, setVirality] = useState<any>(null);
  const [viralityLoading, setViralityLoading] = useState(false);
  const [ctrOpt, setCtrOpt] = useState<any>(null);
  const [ctrOptLoading, setCtrOptLoading] = useState(false);
  // v7.15: 5 novih listing AI funkcij
  const [titleGen, setTitleGen] = useState<any>(null);
  const [titleGenLoading, setTitleGenLoading] = useState(false);
  const [tagOpt, setTagOpt] = useState<any>(null);
  const [tagOptLoading, setTagOptLoading] = useState(false);
  const [thumbnailOpt, setThumbnailOpt] = useState<any>(null);
  const [thumbnailOptLoading, setThumbnailOptLoading] = useState(false);
  const [socialProof, setSocialProof] = useState<any>(null);
  const [socialProofLoading, setSocialProofLoading] = useState(false);
  const [refresh, setRefresh] = useState<any>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades?status=held');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti tradeov');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTrade = trades.find(t => t.id === selectedTradeId);

  // ===== AI runners =====
  const runImageGen = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setImageGenLoading(true); setImageGen(null);
    try {
      const res = await fetch('/api/ai/listing-image-generator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setImageGen(data); toast.success('✓ Image prompti generirani'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setImageGenLoading(false); }
  };

  const runDescGen = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setDescGenLoading(true); setDescGen(null);
    try {
      const res = await fetch('/api/ai/listing-description-generator-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setDescGen(data); toast.success('✓ Opisi generirani'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setDescGenLoading(false); }
  };

  const runSeoOpt = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setSeoOptLoading(true); setSeoOpt(null);
    try {
      const res = await fetch('/api/ai/listing-seo-optimizer-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setSeoOpt(data); toast.success('✓ SEO optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setSeoOptLoading(false); }
  };

  const runVirality = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setViralityLoading(true); setVirality(null);
    try {
      const res = await fetch('/api/ai/listing-virality-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setVirality(data); toast.success('✓ Viralnost napovedana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setViralityLoading(false); }
  };

  const runCtrOpt = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setCtrOptLoading(true); setCtrOpt(null);
    try {
      const res = await fetch('/api/ai/listing-ctr-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setCtrOpt(data); toast.success('✓ CTR optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setCtrOptLoading(false); }
  };

  // v7.15: 6-10. Pet novih listing AI funkcij
  const runTitleGen = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setTitleGenLoading(true); setTitleGen(null); try { const r = await fetch('/api/ai/listing-title-generator-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setTitleGen(d); toast.success('✓ Naslovi generirani'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setTitleGenLoading(false); } };
  const runTagOpt = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setTagOptLoading(true); setTagOpt(null); try { const r = await fetch('/api/ai/listing-tag-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setTagOpt(d); toast.success('✓ Tag optimizacija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setTagOptLoading(false); } };
  const runThumbnailOpt = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setThumbnailOptLoading(true); setThumbnailOpt(null); try { const r = await fetch('/api/ai/listing-thumbnail-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setThumbnailOpt(d); toast.success('✓ Thumbnail optimizacija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setThumbnailOptLoading(false); } };
  const runSocialProof = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setSocialProofLoading(true); setSocialProof(null); try { const r = await fetch('/api/ai/listing-social-proof-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setSocialProof(d); toast.success('✓ Social proof generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setSocialProofLoading(false); } };
  const runRefresh = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setRefreshLoading(true); setRefresh(null); try { const r = await fetch('/api/ai/listing-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setRefresh(d); toast.success('✓ Refresh strategija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setRefreshLoading(false); } };

  const runAll = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    await Promise.all([runImageGen(), runDescGen(), runSeoOpt(), runVirality(), runCtrOpt(), runTitleGen(), runTagOpt(), runThumbnailOpt(), runSocialProof(), runRefresh()]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Optimizacija oglasov AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI generira slike, opise, SEO, viralnost in CTR za tvoje oglase.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Osveži
          </Button>
          <Button onClick={runAll} disabled={!selectedTradeId} size="sm" className="gap-2">
            <Sparkles className="w-4 h-4" /> Generiraj vse
          </Button>
        </div>
      </div>

      {/* Trade selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Izberi item za optimizacijo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Item v skladišču</Label>
              <Select value={selectedTradeId} onValueChange={setSelectedTradeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="— izberi item —" />
                </SelectTrigger>
                <SelectContent>
                  {trades.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title.slice(0, 50)} ({t.buyPrice}€)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedTrade && (
            <div className="text-xs text-muted-foreground bg-card/30 border border-border rounded p-2 mt-2">
              <b>{selectedTrade.title}</b> — {selectedTrade.category || 'brez kategorije'} · {selectedTrade.buyPrice}€
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Panels */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Image Generator */}
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
                {imageGen.generator.imagePrompts?.slice(0, 3).map((p: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <Badge variant="outline" className="text-[9px] mb-1">{p.shotType || p.type}</Badge>
                    <div className="text-[10px] font-mono text-primary">{p.prompt?.slice(0, 120)}...</div>
                  </div>
                ))}
                {imageGen.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {imageGen.generator.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI generira VLM prompte za Midjourney/DALL-E (10 shot tipov, editing presets).</p>
            )}
          </CardContent>
        </Card>

        {/* 2. Description Generator v3 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-pink-400" /> AI Description Generator v3</span>
              <Button size="sm" variant="outline" onClick={runDescGen} disabled={descGenLoading} className="h-6 text-xs gap-1.5">
                {descGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {descGenLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI generira opise (10 stilov)...</div>
            ) : descGen?.generator ? (
              <div className="space-y-2 text-xs">
                {descGen.generator.descriptions?.slice(0, 3).map((d: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[9px] text-pink-400 border-pink-400/30">{d.style || d.strategy}</Badge>
                      <span className="text-[9px] font-mono text-primary">{d.overallScore ?? d.score}/100</span>
                    </div>
                    <div className="text-[10px] line-clamp-2">{d.description?.slice(0, 120)}...</div>
                  </div>
                ))}
                {descGen.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {descGen.generator.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI generira opise z 10 stilovi (BENEFIT/STORY/TECHNICAL/SCANNABLE) in A/B testi.</p>
            )}
          </CardContent>
        </Card>

        {/* 3. SEO Optimizer v2 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Search className="w-4 h-4 text-cyan-400" /> AI SEO Optimizer v2</span>
              <Button size="sm" variant="outline" onClick={runSeoOpt} disabled={seoOptLoading} className="h-6 text-xs gap-1.5">
                {seoOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {seoOptLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira SEO...</div>
            ) : seoOpt?.optimizer ? (
              <div className="space-y-2 text-xs">
                {seoOpt.optimizer.keywordResearch?.slice(0, 4).map((k: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px] font-medium">{k.keyword || k.term}</span>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[9px]">{k.searchVolume ?? k.volume}</Badge>
                      <span className="text-[9px] text-primary">{k.cpc ?? ''}€</span>
                    </div>
                  </div>
                ))}
                {seoOpt.optimizer.optimizationPlan?.slice(0, 2).map((o: any, i: number) => (
                  <div key={i} className="bg-cyan-400/5 border border-cyan-400/20 rounded p-2 text-[10px]">
                    <b className="text-cyan-400">{o.action || o.title}</b> — {o.description || o.impact}
                  </div>
                ))}
                {seoOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {seoOpt.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI keyword research (CPC, volume) + competitor analysis + optimization plan.</p>
            )}
          </CardContent>
        </Card>

        {/* 4. Virality Predictor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Flame className="w-4 h-4 text-orange-400" /> AI Virality Predictor</span>
              <Button size="sm" variant="outline" onClick={runVirality} disabled={viralityLoading} className="h-6 text-xs gap-1.5">
                {viralityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Flame className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {viralityLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje viralnost (8 heuristik)...</div>
            ) : virality?.predictor ? (
              <div className="space-y-2 text-xs">
                {virality.predictor.viralityFactors?.slice(0, 4).map((f: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px] font-medium">{f.factor || f.name}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-16 h-1.5 bg-background rounded overflow-hidden">
                        <div className={cn('h-full rounded', (f.score ?? f.value) >= 70 ? 'bg-primary' : (f.score ?? f.value) >= 40 ? 'bg-amber-400' : 'bg-red-500')} style={{ width: `${f.score ?? f.value ?? 0}%` }} />
                      </div>
                      <span className="text-[9px] font-mono">{f.score ?? f.value ?? 0}</span>
                    </div>
                  </div>
                ))}
                {virality.predictor.predictions?.slice(0, 2).map((p: any, i: number) => (
                  <div key={i} className="bg-orange-400/5 border border-orange-400/20 rounded p-2 text-[10px]">
                    <b className="text-orange-400">{p.platform || p.channel}</b>: {p.viralProbabilityPct ?? p.probability ?? 0}% viral
                  </div>
                ))}
                {virality.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {virality.predictor.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI napove viralnost (8 heuristik: scarcity, emotional, controversy, utility, social proof...).</p>
            )}
          </CardContent>
        </Card>

        {/* 5. CTR Optimizer */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><MousePointerClick className="w-4 h-4 text-primary" /> AI CTR Optimizer</span>
              <Button size="sm" variant="outline" onClick={runCtrOpt} disabled={ctrOptLoading} className="h-6 text-xs gap-1.5">
                {ctrOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MousePointerClick className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ctrOptLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira click-through rate...</div>
            ) : ctrOpt?.optimizer ? (
              <div className="space-y-2 text-xs">
                {ctrOpt.optimizer.items?.slice(0, 3).map((item: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium truncate flex-1">{item.title || item.name}</span>
                      <Badge variant="outline" className={cn('text-[9px] ml-1',
                        (item.currentCtr ?? item.ctr ?? 0) >= 5 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                        CTR: {item.currentCtr ?? item.ctr ?? 0}%
                      </Badge>
                    </div>
                    {item.suggestedTitle && <div className="text-[10px] text-primary">→ {item.suggestedTitle}</div>}
                    {item.recommendation && <div className="text-[9px] text-muted-foreground mt-0.5">{item.recommendation}</div>}
                  </div>
                ))}
                {ctrOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {ctrOpt.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI optimizira click-through rate (naslovi, thumbnaili, časi objave, A/B testi).</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* v7.15: 5 novih listing AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Title Generator v2 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Type className="w-4 h-4 text-primary" /> AI Title Generator v2</span>
              <Button size="sm" variant="outline" onClick={runTitleGen} disabled={titleGenLoading} className="h-6 text-xs gap-1.5">
                {titleGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Type className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {titleGenLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI generira naslove...</div>
            ) : titleGen?.generator ? (
              <div className="space-y-2 text-xs">
                {titleGen.generator.titles?.slice(0, 4).map((t: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium">{t.title || t.text}</span>
                      {t.score != null && <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{t.score}/100</Badge>}
                    </div>
                    {t.reason && <div className="text-[9px] text-muted-foreground">{t.reason}</div>}
                  </div>
                ))}
                {titleGen.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {titleGen.generator.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI generira optimizirane naslove z A/B test scoring.</p>
            )}
          </CardContent>
        </Card>

        {/* 7. Tag Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-blue-400" /> AI Tag Optimizer</span>
              <Button size="sm" variant="outline" onClick={runTagOpt} disabled={tagOptLoading} className="h-6 text-xs gap-1.5">
                {tagOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tagOptLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira oznake...</div>
            ) : tagOpt?.optimizer ? (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-1">
                  {tagOpt.optimizer.suggestedTags?.slice(0, 8).map((t: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">{t}</Badge>
                  ))}
                </div>
                {tagOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {tagOpt.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI optimizira oznake/Tag-e za boljšo vidljivost.</p>
            )}
          </CardContent>
        </Card>

        {/* 8. Thumbnail Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><ImagePlus className="w-4 h-4 text-purple-400" /> AI Thumbnail Optimizer</span>
              <Button size="sm" variant="outline" onClick={runThumbnailOpt} disabled={thumbnailOptLoading} className="h-6 text-xs gap-1.5">
                {thumbnailOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {thumbnailOptLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira thumbnail...</div>
            ) : thumbnailOpt?.optimizer ? (
              <div className="space-y-2 text-xs">
                {thumbnailOpt.optimizer.recommendations?.slice(0, 3).map((r: any, i: number) => (
                  <div key={i} className="bg-purple-500/5 border border-purple-500/20 rounded p-2">
                    <div className="text-[10px] font-medium text-purple-400">{r.action || r.type}</div>
                    <div className="text-[9px] text-muted-foreground">{r.description || r.detail}</div>
                  </div>
                ))}
                {thumbnailOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {thumbnailOpt.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI optimizira thumbnail sliko za večji CTR.</p>
            )}
          </CardContent>
        </Card>

        {/* 9. Social Proof Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> AI Social Proof Optimizer</span>
              <Button size="sm" variant="outline" onClick={runSocialProof} disabled={socialProofLoading} className="h-6 text-xs gap-1.5">
                {socialProofLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {socialProofLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI dodaja social proof...</div>
            ) : socialProof?.optimizer ? (
              <div className="space-y-2 text-xs">
                {socialProof.optimizer.elements?.slice(0, 3).map((e: any, i: number) => (
                  <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                    <div className="text-[10px] font-medium text-primary">{e.type || e.element}</div>
                    <div className="text-[9px] text-muted-foreground">{e.content || e.description}</div>
                  </div>
                ))}
                {socialProof.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {socialProof.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI doda social proof elemente (review-i, rating-i, trust badges).</p>
            )}
          </CardContent>
        </Card>

        {/* 10. Listing Refresh */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><RefreshIcon className="w-4 h-4 text-amber-400" /> AI Listing Refresh</span>
              <Button size="sm" variant="outline" onClick={runRefresh} disabled={refreshLoading} className="h-6 text-xs gap-1.5">
                {refreshLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshIcon className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {refreshLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja refresh strategijo...</div>
            ) : refresh ? (
              <div className="space-y-2 text-xs">
                {refresh.strategy && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                    <div className="text-[10px] font-medium text-amber-400">Strategija: {refresh.strategy}</div>
                  </div>
                )}
                {refresh.actions?.slice(0, 3).map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px]">{a.action || a.description}</span>
                    {a.impact && <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{a.impact}</Badge>}
                  </div>
                ))}
                {refresh.insights && <div className="text-[9px] text-muted-foreground">💡 {refresh.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI pripravi strategijo za osvežitev oglasa (nov naslov, slika, cena) za boljši ranking.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            📝 <b>Optimizacija oglasov AI</b> integrira 5 AI funkcij.
            Backend ima še 35+ listing AI endpointov (listing-title-generator, listing-tag-optimizer,
            listing-thumbnail-optimizer, listing-social-proof, listing-emotional-trigger...) — vse najdeš v AI Hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
