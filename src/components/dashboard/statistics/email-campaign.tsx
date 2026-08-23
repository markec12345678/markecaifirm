'use client';

// v9.02: Extracted from statistics-view.tsx — AI Email Campaign Generator (v6.16)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export function EmailCampaign() {
  const [campaignData, setCampaignData] = useState<any>(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignType, setCampaignType] = useState<'win_back' | 'new_buyers' | 'bundle_offer' | 'clearance' | 'seasonal' | 'newsletter'>('newsletter');
  const [campaignCopied, setCampaignCopied] = useState<string | null>(null);

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Email Campaign Generator
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI generira celovito email kampanjo za outreach kupcem (subject, body, CTA, segmenti).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-muted-foreground shrink-0">Tip:</span>
          <select
            value={campaignType}
            onChange={(e) => setCampaignType(e.target.value as any)}
            className="h-7 text-xs bg-background border rounded px-2"
          >
            <option value="newsletter">📬 Newsletter</option>
            <option value="win_back">🔄 Win-back</option>
            <option value="new_buyers">🆕 Novi kupci</option>
            <option value="bundle_offer">📦 Bundle ponudba</option>
            <option value="clearance">🔥 Clearance</option>
            <option value="seasonal">🎄 Sezonska</option>
          </select>
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={campaignLoading}
            onClick={async () => {
              setCampaignLoading(true); setCampaignData(null);
              try {
                const res = await fetch('/api/ai/email-campaign', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ campaignType }),
                });
                const data = await res.json();
                if (data.ok) { setCampaignData(data); toast.success('✓ Email kampanja generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setCampaignLoading(false); }
            }}>
            {campaignLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj
          </Button>
        </div>
        {campaignLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI generira celovito kampanjo v slovenščini...</div>
        ) : campaignData?.campaign ? (
          <div className="space-y-2 text-xs">
            {campaignData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{campaignData.insights}</div>
            )}

            {/* Subject + preview */}
            <div className="bg-primary/5 border border-primary/20 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] uppercase text-muted-foreground">Subject:</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(campaignData.campaign.subject);
                    setCampaignCopied('subject');
                    setTimeout(() => setCampaignCopied(null), 1500);
                    toast.success('Subject kopiran');
                  }}
                  className="text-[9px] text-primary hover:underline"
                >
                  {campaignCopied === 'subject' ? '✓' : '📋'} Kopiraj
                </button>
              </div>
              <div className="font-bold text-[12px]">{campaignData.campaign.subject}</div>
              {campaignData.campaign.previewText && (
                <div className="text-[10px] text-muted-foreground mt-1 italic">{campaignData.campaign.previewText}</div>
              )}
            </div>

            {/* Subject variants */}
            {campaignData.campaign.subjectVariants?.length > 0 && (
              <div>
                <div className="text-[9px] uppercase text-muted-foreground mb-1">A/B subject varianti:</div>
                <div className="space-y-0.5">
                  {campaignData.campaign.subjectVariants.map((s: string, i: number) => (
                    <div key={i} className="text-[10px] bg-background/40 rounded p-1 border">
                      <span className="text-muted-foreground">Var {String.fromCharCode(65 + i)}:</span> {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Body */}
            {campaignData.campaign.body && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] uppercase text-muted-foreground">Body:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(campaignData.campaign.body);
                      setCampaignCopied('body');
                      setTimeout(() => setCampaignCopied(null), 1500);
                      toast.success('Body kopiran');
                    }}
                    className="text-[9px] text-primary hover:underline"
                  >
                    {campaignCopied === 'body' ? '✓' : '📋'} Kopiraj
                  </button>
                </div>
                <div className="bg-background/40 border rounded p-2 text-[11px] whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {campaignData.campaign.body}
                </div>
              </div>
            )}

            {/* CTA */}
            {campaignData.campaign.cta && (
              <div className="bg-primary/10 border border-primary/30 rounded p-1.5 text-center">
                <span className="text-[9px] uppercase text-primary font-bold">CTA: </span>
                <span className="text-[11px] font-bold">{campaignData.campaign.cta}</span>
              </div>
            )}

            {/* Send strategy */}
            {campaignData.campaign.sendStrategy && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📅 Strategija pošiljanja:</div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Dan:</span> <b>{campaignData.campaign.sendStrategy.bestDay}</b></div>
                  <div><span className="text-muted-foreground">Ura:</span> <b>{campaignData.campaign.sendStrategy.bestTime}</b></div>
                  <div><span className="text-muted-foreground">Frekvenca:</span> <b>{campaignData.campaign.sendStrategy.frequency}</b></div>
                </div>
                {campaignData.campaign.sendStrategy.reasoning && (
                  <div className="text-[9px] text-muted-foreground italic mt-1">{campaignData.campaign.sendStrategy.reasoning}</div>
                )}
              </div>
            )}

            {/* Segments */}
            {campaignData.campaign.segments?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">👥 Segmenti:</div>
                <div className="space-y-1">
                  {campaignData.campaign.segments.map((s: any, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{s.name}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[9px]">{s.estimatedReach} ljudi</Badge>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{s.criteria}</div>
                      <div className="text-[9px] mt-0.5">
                        📧 Open: <b>{s.expectedOpenRate}%</b> · 🖱 Click: <b>{s.expectedClickRate}%</b>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up */}
            {campaignData.campaign.followUp?.subject && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">
                  🔄 Follow-up (po {campaignData.campaign.followUp.waitDays}d):
                </div>
                <div className="font-bold text-[11px]">{campaignData.campaign.followUp.subject}</div>
                <div className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap">{campaignData.campaign.followUp.body}</div>
              </div>
            )}

            {/* Featured items */}
            {campaignData.campaign.featuredItems?.length > 0 && (
              <div className="bg-background/40 border rounded p-1.5">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📦 Featured itemi:</div>
                <div className="flex flex-wrap gap-1">
                  {campaignData.campaign.featuredItems.map((f: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px]">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Generiraj" za AI email kampanjo v slovenščini.</p>
        )}
      </CardContent>
    </Card>
  );
}
