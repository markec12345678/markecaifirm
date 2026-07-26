'use client';

// v5.4: NegotiationHistory — zgodovina pogajanj z AI naslednjim korakom
// Vstavljeno v listing detail modal

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, ArrowRight, ArrowLeft, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface NegotiationMessage {
  id: string;
  direction: 'sent' | 'received';
  text: string;
  isAiGenerated: boolean;
  aiNextStep: string | null;
  status: string;
  suggestedPrice: number | null;
  createdAt: string;
}

export function NegotiationHistory({ listingId, aiMessage }: { listingId: string; aiMessage: string | null }) {
  const [messages, setMessages] = useState<NegotiationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [direction, setDirection] = useState<'sent' | 'received'>('sent');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/negotiations`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  // Auto-fill from AI negotiator message
  useEffect(() => {
    if (aiMessage && messages.length === 0) {
      setNewMessage(aiMessage);
      setDirection('sent');
    }
  }, [aiMessage, messages.length]);

  const sendMessage = async () => {
    if (!newMessage.trim()) {
      toast.error('Vnesi sporočilo');
      return;
    }
    setSending(true);
    try {
      const body: any = {
        direction,
        text: newMessage.trim(),
        isAiGenerated: false,
      };
      if (newPrice.trim()) {
        body.suggestedPrice = parseInt(newPrice, 10);
      }
      const res = await fetch(`/api/listings/${listingId}/negotiations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setNewMessage('');
        setNewPrice('');
        await load();
        toast.success('Sporočilo dodano' + (data.message?.aiNextStep ? ' — AI predlog generiran' : ''));
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setSending(false);
    }
  };

  const statusConfig: Record<string, { label: string; color: string }> = {
    initial: { label: 'Začetno', color: 'text-muted-foreground' },
    offer_sent: { label: 'Ponudba poslana', color: 'text-amber-400' },
    counter_received: { label: 'Counter prejet', color: 'text-blue-400' },
    accepted: { label: 'Sprejeto', color: 'text-primary' },
    declined: { label: 'Zavrnjeno', color: 'text-red-500' },
    no_response: { label: 'Brez odgovora', color: 'text-muted-foreground' },
  };

  const currentStatus = messages.length > 0 ? messages[messages.length - 1].status : 'initial';
  const latestAiStep = messages.length > 0 ? messages[messages.length - 1].aiNextStep : null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          Zgodovina pogajanj
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.4</Badge>
          {messages.length > 0 && (
            <Badge variant="outline" className={cn('text-[10px]', statusConfig[currentStatus]?.color)}>
              {statusConfig[currentStatus]?.label || currentStatus}
            </Badge>
          )}
        </h4>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-6 text-[10px] gap-1">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </div>

      {/* Messages timeline */}
      {messages.length > 0 && (
        <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={m.id}
              className={cn(
                'flex flex-col gap-1',
                m.direction === 'sent' ? 'items-end' : 'items-start'
              )}
            >
              <div className={cn(
                'max-w-[85%] rounded p-2 text-xs',
                m.direction === 'sent'
                  ? 'bg-primary/10 border border-primary/20'
                  : 'bg-card/50 border border-border'
              )}>
                <div className="flex items-center gap-1 mb-0.5">
                  {m.direction === 'sent' ? (
                    <ArrowRight className="w-3 h-3 text-primary" />
                  ) : (
                    <ArrowLeft className="w-3 h-3 text-muted-foreground" />
                  )}
                  <span className="text-[9px] text-muted-foreground">
                    {m.direction === 'sent' ? 'Jaz' : 'Prodajalec'}
                  </span>
                  {m.suggestedPrice != null && (
                    <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/40 ml-1">
                      💰 {m.suggestedPrice}€
                    </Badge>
                  )}
                  {m.isAiGenerated && (
                    <Badge variant="outline" className="text-[9px] text-primary border-primary/40 ml-1">
                      <Sparkles className="w-2 h-2" /> AI
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{m.text}</p>
                <div className="text-[9px] text-muted-foreground mt-1">
                  {new Date(m.createdAt).toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              {m.aiNextStep && (
                <div className="max-w-[85%] bg-amber-400/5 border border-amber-400/20 rounded p-1.5 text-[10px] text-amber-400">
                  <span className="font-bold">💡 AI naslednji korak:</span> {m.aiNextStep}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Latest AI next step highlight */}
      {latestAiStep && (
        <div className="bg-primary/5 border border-primary/20 rounded p-2 mb-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-primary mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            AI naslednji korak
          </div>
          <p className="text-primary">{latestAiStep}</p>
        </div>
      )}

      {/* Add message form */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDirection('sent')}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] border transition-colors',
              direction === 'sent'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground'
            )}
          >
            <ArrowRight className="w-2.5 h-2.5 inline" /> Poslano
          </button>
          <button
            onClick={() => setDirection('received')}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] border transition-colors',
              direction === 'received'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground'
            )}
          >
            <ArrowLeft className="w-2.5 h-2.5 inline" /> Prejeto
          </button>
          {direction === 'sent' && (
            <Input
              type="number"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Ponudba (€)"
              className="h-6 text-[10px] font-mono w-24 ml-auto"
            />
          )}
        </div>
        <Textarea
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Vnesi sporočilo..."
          className="text-xs min-h-[60px]"
        />
        <Button
          size="sm"
          className="w-full h-7 text-xs gap-1"
          onClick={sendMessage}
          disabled={sending || !newMessage.trim()}
        >
          {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Dodaj sporočilo
        </Button>
      </div>

      {messages.length === 0 && !loading && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          💡 Zgodovina pogajanj je prazna. Dodaj prvo sporočilo (ali uporabi AI pogajalca zgoraj).
        </p>
      )}
    </div>
  );
}
