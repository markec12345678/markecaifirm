'use client';

/**
 * v6.98: NegotiationPanel — izvlečen iz ListingDetailModal.
 *
 * Združuje 4 AI panel-e povezane s pogajanjem:
 * 1. AI Negotiator (generator sporočil, 5 jezikov, 3 tipi) — /api/listings/:id/negotiate (v1.8/v4.6)
 * 2. AI Negotiation Playbook (celovit scenarij) — /api/ai/negotiation-playbook (v6.11)
 * 3. AI Negotiation Outcome Predictor — /api/ai/negotiation-outcome (v6.14)
 * 4. AI Smart Negotiation Chatbot (multi-turn) — /api/ai/negotiation-chatbot (v6.20)
 *
 * Prej: ~580 vrstic inline JSX + 20 useState znotraj ListingDetailModal.
 * Sedaj: samostojna komponenta z lastnim state.
 *
 * API:
 * <NegotiationPanel listingId={listing.id} price={listing.price} />
 */

import { useState } from 'react';
import { MessageSquare, BookOpen, Dice5, RefreshCw, Send, Copy, Check, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface NegotiationPanelProps {
  listingId: string;
  price?: number | null;
}

export function NegotiationPanel({ listingId, price }: NegotiationPanelProps) {
  // ===== Negotiator state (v1.8/v4.6) =====
  const [negotiating, setNegotiating] = useState(false);
  const [negotiateMessage, setNegotiateMessage] = useState<string | null>(null);
  const [negotiateType, setNegotiateType] = useState<string>('initial');
  const [negotiateLang, setNegotiateLang] = useState<string>('sl');
  const [negotiateLangLabel, setNegotiateLangLabel] = useState<string>('SLO');
  const [copied, setCopied] = useState(false);

  // ===== Playbook state (v6.11) =====
  const [playbook, setPlaybook] = useState<any>(null);
  const [playbookLoading, setPlaybookLoading] = useState(false);
  const [playbookMaxBudget, setPlaybookMaxBudget] = useState('');
  const [playbookCopied, setPlaybookCopied] = useState<string | null>(null);

  // ===== Outcome state (v6.14) =====
  const [outcome, setOutcome] = useState<any>(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [outcomeOffer, setOutcomeOffer] = useState('');
  const [outcomeMessage, setOutcomeMessage] = useState('');

  // ===== Chatbot state (v6.20) =====
  const [chatbotMessages, setChatbotMessages] = useState<Array<{ role: 'user' | 'seller'; text: string }>>([]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [chatbotLoading, setChatbotLoading] = useState(false);
  const [chatbotStrategy, setChatbotStrategy] = useState<'aggressive' | 'firm' | 'patient'>('firm');
  const [chatbotMaxPrice, setChatbotMaxPrice] = useState('');
  const [chatbotLastReply, setChatbotLastReply] = useState<any>(null);

  // ===== Negotiator functions =====
  const generateMessage = async (type: string, lang?: string) => {
    setNegotiating(true);
    setNegotiateType(type);
    setNegotiateMessage(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, lang: lang ?? negotiateLang }),
      });
      const data = await res.json();
      if (data.ok) {
        setNegotiateMessage(data.message);
        toast.success(`Sporočilo generirano (${data.lang?.toUpperCase()})`);
      } else {
        toast.error(data.error ?? 'Napaka pri generiranju');
      }
    } catch {
      toast.error('Napaka');
    } finally {
      setNegotiating(false);
    }
  };

  const copyMessage = () => {
    if (!negotiateMessage) return;
    navigator.clipboard.writeText(negotiateMessage);
    setCopied(true);
    toast.success('Sporočilo kopirano');
    setTimeout(() => setCopied(false), 2000);
  };

  // ===== Playbook function =====
  const runPlaybook = async () => {
    setPlaybookLoading(true);
    setPlaybook(null);
    setPlaybookCopied(null);
    try {
      const budgetNum = playbookMaxBudget ? Number(playbookMaxBudget) : 0;
      const res = await fetch('/api/ai/negotiation-playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, maxBudget: budgetNum || undefined }),
      });
      const data = await res.json();
      if (data.ok) { setPlaybook(data); toast.success('✓ Pogajalski playbook generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setPlaybookLoading(false); }
  };

  // ===== Outcome function =====
  const runOutcome = async () => {
    setOutcomeLoading(true);
    setOutcome(null);
    try {
      const res = await fetch('/api/ai/negotiation-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          offerPrice: outcomeOffer ? Number(outcomeOffer) : undefined,
          message: outcomeMessage || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) { setOutcome(data); toast.success('✓ Napoved izida generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setOutcomeLoading(false); }
  };

  // ===== Chatbot function =====
  const sendChatbot = (inputText: string) => {
    const newMessages = inputText
      ? [...chatbotMessages, { role: 'seller' as const, text: inputText }]
      : chatbotMessages.length > 0
        ? chatbotMessages
        : [{ role: 'seller' as const, text: 'Pozdravljen, vaš oglas me zanima. Kakšna je najboljša cena?' }];
    setChatbotMessages(newMessages);
    setChatbotInput('');
    setChatbotLoading(true);
    fetch('/api/ai/negotiation-chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId,
        messages: newMessages,
        strategy: chatbotStrategy,
        myGoal: { maxPrice: chatbotMaxPrice ? Number(chatbotMaxPrice) : undefined },
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setChatbotMessages([...newMessages, { role: 'user' as const, text: data.reply.text }]);
          setChatbotLastReply(data.reply);
          toast.success(`✓ AI odgovor (${data.reply.confidencePct}% confidence)`);
        } else toast.error(data.error ?? 'Napaka');
      })
      .catch(err => toast.error(err?.message ?? 'Napaka'))
      .finally(() => setChatbotLoading(false));
  };

  return (
    <>
      {/* 1. AI Negotiator (v1.8/v4.6) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            AI pogajalec
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.6</Badge>
          </h4>
          {/* v4.6: Language switcher */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-muted-foreground">Jezik:</span>
            {[
              { code: 'sl', label: '🇸🇮 SLO' },
              { code: 'en', label: '🇬🇧 EN' },
              { code: 'de', label: '🇩🇪 DE' },
              { code: 'it', label: '🇮🇹 IT' },
              { code: 'hr', label: '🇭🇷 HR' },
            ].map(l => (
              <button
                key={l.code}
                onClick={() => {
                  setNegotiateLang(l.code);
                  setNegotiateLangLabel(l.label);
                  if (negotiateMessage) {
                    generateMessage(negotiateType, l.code);
                  }
                }}
                className={cn(
                  'px-1.5 py-0.5 rounded border text-[10px] transition-colors',
                  negotiateLang === l.code
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={() => generateMessage('initial')} disabled={negotiating} className="gap-1.5 text-xs h-7">
            {negotiating && negotiateType === 'initial' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
            Začetno sporočilo
          </Button>
          <Button size="sm" variant="outline" onClick={() => generateMessage('low_offer')} disabled={negotiating} className="gap-1.5 text-xs h-7">
            {negotiating && negotiateType === 'low_offer' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
            Nizka ponudba
          </Button>
          <Button size="sm" variant="outline" onClick={() => generateMessage('polite_decline')} disabled={negotiating} className="gap-1.5 text-xs h-7">
            {negotiating && negotiateType === 'polite_decline' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
            Vljudna zavrnitev
          </Button>
        </div>
        {negotiateMessage && (
          <div className="bg-background/50 border border-border rounded p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Generirano sporočilo ({negotiateLangLabel}):
              </span>
              <Button size="sm" variant="ghost" onClick={copyMessage} className="h-6 px-2 text-xs gap-1">
                {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Kopirano' : 'Kopiraj'}
              </Button>
            </div>
            <p className="text-sm whitespace-pre-wrap">{negotiateMessage}</p>
            <p className="text-[10px] text-muted-foreground mt-2">
              ⚠️ Preglej in prilagodi pred pošiljanjem. AI ne pozna specifičnih detailov ki jih vidiš ti.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              💡 Preklopi jezik zgoraj — AI bo regeneriral v izbranem jeziku.
            </p>
          </div>
        )}
      </div>

      {/* 2. AI Negotiation Playbook (v6.11) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-primary" />
            AI Negotiation Playbook
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
          </h4>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              placeholder="Max budget (€)"
              value={playbookMaxBudget}
              onChange={(e) => setPlaybookMaxBudget(e.target.value)}
              className="h-6 w-24 text-[10px]"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
              disabled={playbookLoading}
              onClick={runPlaybook}
            >
              {playbookLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
              Generiraj
            </Button>
          </div>
        </div>

        {playbookLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI pripravlja celovit pogajalski scenarij...
          </div>
        ) : playbook?.playbook ? (
          <div className="space-y-2 text-[11px]">
            {/* Strategy */}
            <div className="bg-primary/5 border border-primary/20 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-primary uppercase text-[10px]">📋 Strategija: {playbook.playbook.strategy}</span>
                <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                  {playbook.playbook.openingOffer}€ → {playbook.playbook.targetPrice}€ → {playbook.playbook.walkAwayPrice}€
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground italic">{playbook.playbook.strategyReasoning}</p>
            </div>

            {/* Price targets */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-background/40 rounded p-1.5 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">🎨 Opening</div>
                <div className="font-mono font-bold text-primary">{playbook.playbook.openingOffer}€</div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">🎯 Target</div>
                <div className="font-mono font-bold">{playbook.playbook.targetPrice}€</div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">🚫 Walk-away</div>
                <div className="font-mono font-bold text-destructive">{playbook.playbook.walkAwayPrice}€</div>
              </div>
            </div>

            {playbook.marketContext && (
              <div className="text-[10px] text-muted-foreground">📊 {playbook.marketContext}</div>
            )}

            {/* Arguments */}
            {playbook.playbook.arguments?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Argumenti za pogajanje:</div>
                <ul className="space-y-0.5 ml-3">
                  {playbook.playbook.arguments.map((arg: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{arg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Counter offers */}
            {playbook.playbook.counterOffers?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">Counter-offers:</div>
                <div className="space-y-1">
                  {playbook.playbook.counterOffers.map((c: any, i: number) => (
                    <div key={i} className="bg-background/40 rounded p-1.5 border">
                      <div className="text-[10px] text-muted-foreground">Če: "{c.trigger}"</div>
                      <div className="text-[10px] font-medium">{c.response} <Badge variant="outline" className="text-[9px] ml-1">{c.price}€</Badge></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Psychology tactics */}
            {playbook.playbook.psychologyTactics?.length > 0 && (
              <div className="bg-purple-500/5 border border-purple-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-purple-400 mb-1">🧠 Psihološke taktike:</div>
                <ul className="space-y-0.5 ml-3">
                  {playbook.playbook.psychologyTactics.map((t: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Red flags */}
            {playbook.playbook.redFlags?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-red-500 mb-1">🚩 Red flags:</div>
                <ul className="space-y-0.5 ml-3">
                  {playbook.playbook.redFlags.map((r: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Best timing */}
            {playbook.playbook.bestTiming && (
              <div className="text-[10px] text-muted-foreground">
                ⏰ <span className="font-semibold">Najboljši čas za kontakt:</span> {playbook.playbook.bestTiming}
              </div>
            )}

            {/* Message templates */}
            {playbook.playbook.messageTemplates?.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase text-muted-foreground">Predloge sporočil:</div>
                {playbook.playbook.messageTemplates.map((m: any, i: number) => (
                  <div key={i} className="bg-background/40 rounded p-1.5 border">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[9px]">{m.type}</Badge>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(m.text);
                          setPlaybookCopied(m.type);
                          setTimeout(() => setPlaybookCopied(null), 1500);
                          toast.success('Sporočilo kopirano');
                        }}
                        className="text-[9px] text-primary hover:underline"
                      >
                        {playbookCopied === m.type ? <Check className="w-3 h-3 inline" /> : <Copy className="w-3 h-3 inline" />} Kopiraj
                      </button>
                    </div>
                    <p className="text-[10px] whitespace-pre-wrap">{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            AI pripravi strategijo, argumente, counter-offers, psihološke taktike in predloge sporočil.
          </p>
        )}
      </div>

      {/* 3. AI Negotiation Outcome Predictor (v6.14) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Dice5 className="w-3.5 h-3.5 text-primary" />
            AI Negotiation Outcome
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
          </h4>
        </div>

        <div className="space-y-2 mb-2">
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder={`Moja ponudba (€) — npr. ${Math.round((price ?? 100) * 0.85)}`}
              value={outcomeOffer}
              onChange={(e) => setOutcomeOffer(e.target.value)}
              className="h-7 text-[11px] flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
              disabled={outcomeLoading}
              onClick={runOutcome}
            >
              {outcomeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Dice5 className="w-3 h-3" />}
              Napovej izid
            </Button>
          </div>
          <Input
            type="text"
            placeholder="Sporočilo prodajalcu (opcijsko)"
            value={outcomeMessage}
            onChange={(e) => setOutcomeMessage(e.target.value)}
            className="h-7 text-[11px]"
          />
        </div>

        {outcomeLoading ? (
          <div className="py-3 text-center text-[11px] text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira prodajalca, tržne pogoje in verjetnost uspeha...
          </div>
        ) : outcome?.prediction ? (
          <div className="space-y-2 text-[11px]">
            {/* Success probability */}
            <div className={cn('border rounded p-2',
              outcome.prediction.successProbabilityPct >= 70 ? 'bg-primary/10 border-primary/30' :
              outcome.prediction.successProbabilityPct >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold uppercase text-[10px]">
                  🎯 Verjetnost uspeha
                </span>
                <Badge variant="outline" className={cn('text-[9px] font-mono font-bold',
                  outcome.prediction.successProbabilityPct >= 70 ? 'text-primary border-primary/40' :
                  outcome.prediction.successProbabilityPct >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  {outcome.prediction.successProbabilityPct}% (confidence {outcome.prediction.confidence}%)
                </Badge>
              </div>
              {/* Probability bar */}
              <div className="w-full h-2 bg-background rounded overflow-hidden mt-1">
                <div className={cn('h-full rounded',
                  outcome.prediction.successProbabilityPct >= 70 ? 'bg-primary' :
                  outcome.prediction.successProbabilityPct >= 40 ? 'bg-amber-400' : 'bg-red-500')}
                  style={{ width: `${outcome.prediction.successProbabilityPct}%` }} />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">{outcome.prediction.reasoning}</p>
            </div>

            {/* Counter-offer and optimal offer */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-background/40 rounded p-1.5 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Tvoja ponudba</div>
                <div className="font-mono font-bold">{outcome.userOffer}€</div>
                <div className="text-[9px] text-amber-400">−{outcome.discountRequested}%</div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Counter-offer</div>
                <div className="font-mono font-bold text-amber-400">{outcome.prediction.expectedCounterOfferEur}€</div>
                <div className="text-[9px] text-muted-foreground">predvideno</div>
              </div>
              <div className="bg-primary/5 rounded p-1.5 border border-primary/20 text-center">
                <div className="text-[9px] uppercase text-primary">Optimalna</div>
                <div className="font-mono font-bold text-primary">{outcome.prediction.suggestedOptimalOfferEur}€</div>
                <div className="text-[9px] text-primary">→ ponudi to</div>
              </div>
            </div>

            {/* Strategy */}
            {outcome.prediction.optimalStrategy?.approach && (
              <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-primary mb-1">
                  🎯 Strategija: <b>{outcome.prediction.optimalStrategy.approach.replace('_', ' ')}</b>
                </div>
                <div className="text-[10px]">{outcome.prediction.optimalStrategy.timing}</div>
                {outcome.prediction.optimalStrategy.messageTips?.length > 0 && (
                  <ul className="space-y-0.5 ml-3 mt-1">
                    {outcome.prediction.optimalStrategy.messageTips.map((t: string, i: number) => (
                      <li key={i} className="text-[9px] list-disc list-outside">{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Factors */}
            {outcome.prediction.factors?.length > 0 && (
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Faktorji:</div>
                <div className="space-y-0.5">
                  {outcome.prediction.factors.map((f: any, i: number) => {
                    const impactColor = f.impact === 'positive' ? 'text-primary' :
                                        f.impact === 'negative' ? 'text-red-500' : 'text-muted-foreground';
                    return (
                      <div key={i} className="text-[10px] flex items-center gap-1">
                        <span className={cn('font-bold w-3', impactColor)}>
                          {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '○'}
                        </span>
                        <span className="font-medium">{f.factor}</span>
                        <span className="text-muted-foreground text-[9px]">({f.weight}/10)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scenarios */}
            {outcome.prediction.scenarios?.length > 0 && (
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🔮 Scenariji:</div>
                <div className="space-y-1">
                  {outcome.prediction.scenarios.map((s: any, i: number) => (
                    <div key={i} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{s.name}</span>
                        <span className="font-mono text-primary">{s.probabilityPct}% · {s.finalPriceEur}€</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground">{s.outcome}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {outcome.prediction.warnings?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Opozorila:</div>
                <ul className="space-y-0.5 ml-3">
                  {outcome.prediction.warnings.map((w: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Context */}
            {(outcome.marketContext || outcome.sellerHistory) && (
              <div className="text-[9px] text-muted-foreground border-t border-border pt-1 space-y-0.5">
                {outcome.marketContext && <div>📊 {outcome.marketContext}</div>}
                {outcome.sellerHistory && <div>👤 {outcome.sellerHistory}</div>}
                <div>📅 Oglas star {outcome.daysSincePosted} dni</div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            Vnesi ponudbo — AI bo napovedal verjetnost uspeha, counter-offer in optimalno strategijo.
          </p>
        )}
      </div>

      {/* 4. AI Smart Negotiation Chatbot (v6.20) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
            AI Negotiation Chatbot
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.20</Badge>
          </h4>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select
            value={chatbotStrategy}
            onChange={(e) => setChatbotStrategy(e.target.value as any)}
            className="h-7 text-[11px] bg-background border rounded px-2"
          >
            <option value="aggressive">🔥 Agresivna (15-25% pod)</option>
            <option value="firm">⚖️ Zmerna (10-15% pod)</option>
            <option value="patient">🛡️ Strpna (sprašuj)</option>
          </select>
          <Input
            type="number"
            placeholder="Max budget (€)"
            value={chatbotMaxPrice}
            onChange={(e) => setChatbotMaxPrice(e.target.value)}
            className="h-7 text-[11px]"
          />
        </div>
        {chatbotMessages.length > 0 && (
          <div className="space-y-1 mb-2 max-h-40 overflow-y-auto bg-background/40 rounded p-2 border">
            {chatbotMessages.map((m, i) => (
              <div key={i} className={cn('text-[10px] rounded p-1.5',
                m.role === 'user' ? 'bg-primary/10 text-primary ml-4' : 'bg-muted/30 mr-4')}>
                <div className="text-[8px] uppercase font-bold opacity-70">
                  {m.role === 'user' ? 'JAZ' : 'PRODAJALEC'}
                </div>
                <div>{m.text}</div>
              </div>
            ))}
            {chatbotLastReply && (
              <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                <div className="text-[8px] uppercase font-bold text-primary">AI PREDLOG ↓</div>
                <div className="text-[10px] font-medium">{chatbotLastReply.text}</div>
                {chatbotLastReply.suggestedPriceEur != null && (
                  <div className="text-[9px] text-primary mt-0.5">💰 Predlagana cena: {chatbotLastReply.suggestedPriceEur}€</div>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(chatbotLastReply.text);
                    toast.success('Predlagani odgovor kopiran');
                  }}
                  className="text-[9px] text-primary hover:underline mt-1"
                >
                  📋 Kopiraj
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            type="text"
            placeholder="Sporočilo prodajalca (ali prazno za začetek)"
            value={chatbotInput}
            onChange={(e) => setChatbotInput(e.target.value)}
            className="h-7 text-[11px] flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !chatbotLoading) {
                sendChatbot(chatbotInput);
              }
            }}
          />
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            disabled={chatbotLoading}
            onClick={() => sendChatbot(chatbotInput)}
          >
            {chatbotLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {chatbotMessages.length === 0 ? 'Začni' : 'Odgovori'}
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1">
          💡 Prilepi prodajalčevo sporočilo in AI bo generiral tvoj naslednji odgovor. Strategija: {chatbotStrategy}.
        </p>
      </div>
    </>
  );
}
