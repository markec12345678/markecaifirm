'use client';

/**
 * v9.55: AI Assistant — chat interface za naravna vprašanja.
 *
 * Navdih: Tableau AI, Metabase AI, ChatGPT-style interface.
 *
 * Funkcije:
 * - Chat modal z zgodovino
 * - 8 suggestion chips za hitri start
 * - Markdown-style rendering odgovorov
 * - Predlagane akcije (clickable)
 * - Loading state z "..." indikatorjem
 * - Error handling z jasnim sporočilom
 * - Auto-scroll na najnovejši odgovor
 * - Cmd+J shortcut za odprtje
 * - Enter za pošiljanje, Shift+Enter za novo vrstico
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, Send, User, Bot, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestedActions?: string[];
  error?: boolean;
}

interface SuggestedQuery {
  icon: string;
  text: string;
}

interface AiAssistantProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiAssistant({ open, onOpenChange }: AiAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedQueries, setSuggestedQueries] = useState<SuggestedQuery[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const haptic = useHaptic();

  // Load suggested queries na mount
  useEffect(() => {
    if (suggestedQueries.length === 0) {
      fetch('/api/ai/assistant')
        .then((r) => r.json())
        .then((data) => {
          if (data.suggestedQueries) {
            setSuggestedQueries(data.suggestedQueries);
          }
        })
        .catch(() => {});
    }
  }, [suggestedQueries.length]);

  // Auto-scroll na dno ko pride nov odgovor
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Fokus na input ko se odpre
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Pošlji vprašanje
  const sendQuery = useCallback(async (query: string) => {
    if (!query.trim() || loading) return;

    haptic.light();
    const userMessage: Message = {
      role: 'user',
      content: query.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Zgodovina za kontekst (zadnjih 6 sporočil)
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), history }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        const errorMessage: Message = {
          role: 'assistant',
          content: data.error || 'Napaka pri obdelavi vprašanja. Poskusi znova.',
          timestamp: new Date().toISOString(),
          error: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } else {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.answer,
          timestamp: data.timestamp,
          suggestedActions: data.suggestedActions,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err) {
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Povezava z AI ni uspela. Preveri internet in AI provider nastavitve.',
        timestamp: new Date().toISOString(),
        error: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, haptic]);

  // Enter za pošiljanje, Shift+Enter za novo vrstico
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery(input);
    }
    // Escape zapre modal
    if (e.key === 'Escape') {
      onOpenChange(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-2xl h-[80vh] max-h-[700px] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary terminal-glow uppercase tracking-wider">
                AI Asistent
              </h2>
              <p className="text-[10px] text-muted-foreground">
                Vprašaj o svojih trgovinah, dobičku, priložnostih
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-card/50"
            aria-label="Zapri AI asistent"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-base font-bold mb-2">Pozdravljen v AI Asistentu 👋</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Postavi mi poljubno vprašanje o tvojem poslovanju.
                Na voljo imam vse podatke o tvojih trgovinah, dobičku, kategorijah in priložnostih.
              </p>

              {/* Suggestion chips */}
              {suggestedQueries.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {suggestedQueries.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendQuery(q.text)}
                      className="flex items-center gap-2 p-3 rounded-md border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-colors text-left text-sm"
                    >
                      <span className="text-lg">{q.icon}</span>
                      <span className="text-xs">{q.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                      msg.role === 'user'
                        ? 'bg-muted'
                        : msg.error
                          ? 'bg-destructive/10'
                          : 'bg-primary/10'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <User className="w-4 h-4 text-muted-foreground" />
                    ) : msg.error ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <Bot className="w-4 h-4 text-primary" />
                    )}
                  </div>

                  {/* Message bubble */}
                  <div
                    className={cn(
                      'flex-1 min-w-0 max-w-[85%] rounded-lg p-3',
                      msg.role === 'user'
                        ? 'bg-primary/10 border border-primary/20'
                        : msg.error
                          ? 'bg-destructive/5 border border-destructive/20'
                          : 'bg-card/50 border border-border'
                    )}
                  >
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                    {/* Suggested actions */}
                    {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                        <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1.5">
                          🎯 Predlagane akcije
                        </div>
                        {msg.suggestedActions.map((action, j) => (
                          <button
                            key={j}
                            onClick={() => sendQuery(action)}
                            className="block w-full text-left text-xs p-2 rounded bg-background/50 hover:bg-card border border-border/50 hover:border-primary/30 transition-colors"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-card/50 border border-border rounded-lg p-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">AI razmišlja...</span>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Vprašaj AI... (npr. 'Kaj naj kupim naslednje?')"
              rows={1}
              maxLength={500}
              disabled={loading}
              className="flex-1 resize-none bg-background border border-border rounded-md p-2.5 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-50 max-h-24"
              style={{ minHeight: '42px' }}
            />
            <button
              onClick={() => sendQuery(input)}
              disabled={!input.trim() || loading}
              aria-label="Pošlji vprašanje"
              className="p-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[42px] min-w-[42px] flex items-center justify-center"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
            <span>
              <kbd className="px-1 py-0.5 bg-background border border-border rounded">Enter</kbd> pošlji ·{' '}
              <kbd className="px-1 py-0.5 bg-background border border-border rounded">Shift+Enter</kbd> nova vrstica ·{' '}
              <kbd className="px-1 py-0.5 bg-background border border-border rounded">Esc</kbd> zapri
            </span>
            <span>{input.length}/500</span>
          </div>
        </div>
      </div>
    </div>
  );
}
