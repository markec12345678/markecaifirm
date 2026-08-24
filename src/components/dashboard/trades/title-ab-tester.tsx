'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Type } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';

interface TitleABTesterProps {
  trades: Trade[];
}

export function TitleABTester({ trades }: TitleABTesterProps) {
  // v6.22: Title A/B Test
  const [titleAbTestData, setTitleAbTestData] = useState<Record<string, any> | null>(null);
  const [titleAbTestLoading, setTitleAbTestLoading] = useState(false);
  const [titleAbTestCopied, setTitleAbTestCopied] = useState<string | null>(null);

  return (
    <>
      {/* v6.22: Title A/B Tester */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-purple-400/40 text-purple-400 hover:bg-purple-400/10"
        disabled={titleAbTestLoading}
        onClick={async () => {
          if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
          const firstHeld = trades.find((t: Record<string, any>) => t.status === 'held');
          if (!firstHeld) { toast.error('Ni held tradeov'); return; }
          setTitleAbTestLoading(true); setTitleAbTestData(null);
          try {
            const res = await fetch('/api/ai/title-abtest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tradeId: firstHeld.id }),
            });
            const data = await res.json();
            if (data.ok) { setTitleAbTestData(data); toast.success('✓ A/B test naslovov generiran'); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setTitleAbTestLoading(false); }
        }}
        title="AI generira in testira naslove oglasov za maksimalen CTR"
      >
        {titleAbTestLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Type className="w-3.5 h-3.5" />}
        Title A/B test
      </Button>

      {/* v6.22: AI Title A/B Tester results */}
      {titleAbTestData?.test && (
        <Card className="bg-card/50 border-purple-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-bold">AI Title A/B Tester</span>
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/40">v6.22</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTitleAbTestData(null)} className="h-6 text-xs">×</Button>
            </div>

            {/* Current title analysis */}
            <div className="bg-background/40 border rounded p-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">Trenutni naslov:</div>
              <div className="font-bold text-[12px]">{titleAbTestData.test.currentTitle}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  titleAbTestData.test.currentTitleAnalysis.score >= 70 ? 'text-primary border-primary/40' :
                  titleAbTestData.test.currentTitleAnalysis.score >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  Score: {titleAbTestData.test.currentTitleAnalysis.score}/100
                </Badge>
              </div>
            </div>

            {/* Winner */}
            {titleAbTestData.test.winner?.title && (
              <div className="bg-primary/10 border border-primary/30 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🏆 Zmagovalni naslov:</div>
                <div className="font-bold text-[12px] text-primary">{titleAbTestData.test.winner.title}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{titleAbTestData.test.winner.why}</div>
                {titleAbTestData.test.winner.expectedImprovementPct > 0 && (
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/40 mt-1">
                    +{titleAbTestData.test.winner.expectedImprovementPct}% izboljšava
                  </Badge>
                )}
              </div>
            )}

            {/* Variants */}
            {titleAbTestData.test.variants?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Variante naslovov:</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {titleAbTestData.test.variants.map((v: Record<string, any>, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-[11px] flex-1">{v.title}</div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px] text-purple-400 border-purple-400/30">{v.strategy.replace('_', ' ')}</Badge>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(v.title);
                              setTitleAbTestCopied(`v${i}`);
                              setTimeout(() => setTitleAbTestCopied(null), 1500);
                              toast.success('Naslov kopiran');
                            }}
                            className="text-[9px] text-purple-400 hover:underline"
                          >
                            {titleAbTestCopied === `v${i}` ? '✓' : '📋'}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">CTR</div>
                          <div className={cn('font-mono font-bold', v.ctrScore >= 70 ? 'text-primary' : v.ctrScore >= 40 ? 'text-amber-400' : 'text-red-500')}>{v.ctrScore}</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">Search</div>
                          <div className={cn('font-mono font-bold', v.searchVisibility >= 70 ? 'text-primary' : 'text-amber-400')}>{v.searchVisibility}</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border text-center">
                          <div className="text-[8px] uppercase text-muted-foreground">Convert</div>
                          <div className={cn('font-mono font-bold', v.conversionScore >= 70 ? 'text-primary' : 'text-amber-400')}>{v.conversionScore}</div>
                        </div>
                        <div className={cn('rounded p-1 border text-center',
                          v.overallScore >= 70 ? 'bg-primary/5 border-primary/20' : 'bg-background/40 border')}>
                          <div className="text-[8px] uppercase text-muted-foreground">Skupno</div>
                          <div className={cn('font-mono font-bold', v.overallScore >= 70 ? 'text-primary' : 'text-amber-400')}>{v.overallScore}</div>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        📝 {v.characterCount} znakov · 📍 {v.bestForPlatform}
                      </div>
                      {v.strengths?.length > 0 && (
                        <div className="text-[9px] text-primary">✓ {v.strengths.join(' · ')}</div>
                      )}
                      {v.weaknesses?.length > 0 && (
                        <div className="text-[9px] text-red-500">⚠️ {v.weaknesses.join(' · ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Platform-specific titles */}
            {titleAbTestData.test.platformSpecificTitles && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📱 Platform-specific naslovi:</div>
                <div className="space-y-1">
                  {Object.entries(titleAbTestData.test.platformSpecificTitles).map(([platform, title]: [string, any]) => (
                    title ? (
                      <div key={platform} className="text-[10px] flex items-center justify-between gap-2">
                        <span><Badge variant="outline" className="text-[8px] mr-1 capitalize">{platform}</Badge> {String(title)}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(String(title));
                            setTitleAbTestCopied(`p${platform}`);
                            setTimeout(() => setTitleAbTestCopied(null), 1500);
                            toast.success(`${platform} naslov kopiran`);
                          }}
                          className="text-[9px] text-purple-400 hover:underline shrink-0"
                        >
                          {titleAbTestCopied === `p${platform}` ? '✓' : '📋'}
                        </button>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            {titleAbTestData.test.tips?.length > 0 && (
              <div className="bg-purple-400/5 border border-purple-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-purple-400 mb-1">💡 Nasveti:</div>
                <ul className="space-y-0.5 ml-3">
                  {titleAbTestData.test.tips.map((t: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
