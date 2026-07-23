'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, LayoutGrid, Bell, ExternalLink, Target, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'analytics' | 'settings';

interface SearchModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (v: View) => void;
}

interface SearchResult {
  listings: Array<{
    id: string;
    title: string;
    price: number | null;
    priceText: string;
    url: string;
    location: string;
    imageUrl: string | null;
    firstSeenAt: string;
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    monitor: { name: string };
  }>;
  alerts: Array<{
    id: string;
    title: string;
    url: string;
    createdAt: string;
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    isArchived: boolean;
    userAction: string | null;
    monitor: { name: string };
  }>;
  q: string;
  total: number;
}

export function SearchModal({ open, onOpenChange, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&limit=15`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Globalno iskanje
          </DialogTitle>
          <DialogDescription className="text-xs">
            Išči po naslovih, opisih, URL-jih oglasov in alertov.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="npr. iPhone, Ljubljana, nepremicnine.net/..."
            className="pl-9 font-mono text-sm"
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              iščem...
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 pb-4">
          {query.trim().length < 2 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              Vnesi vsaj 2 znaka za iskanje.
            </div>
          ) : !results || results.total === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              {loading ? 'Iščem...' : 'Ni rezultatov.'}
            </div>
          ) : (
            <div className="space-y-4">
              {results.listings.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <LayoutGrid className="w-3 h-3" />
                    Oglasi ({results.listings.length})
                  </div>
                  <div className="space-y-1">
                    {results.listings.map(l => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-2 rounded hover:bg-card/70 transition-colors text-xs"
                      >
                        {l.aiVerdict === 'PRILIKA' && <Target className="w-3 h-3 text-primary shrink-0" />}
                        {l.aiVerdict === 'SUMNJIVO' && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                        {!l.aiVerdict && <div className="w-3 h-3 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{l.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {l.priceText} • {l.monitor.name} • {new Date(l.firstSeenAt).toLocaleDateString('sl-SI')}
                          </div>
                        </div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {results.alerts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Bell className="w-3 h-3" />
                    Alerti ({results.alerts.length})
                  </div>
                  <div className="space-y-1">
                    {results.alerts.map(a => (
                      <button
                        key={a.id}
                        onClick={() => {
                          onNavigate('alerts');
                          onOpenChange(false);
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded hover:bg-card/70 transition-colors text-xs text-left"
                      >
                        {a.aiVerdict === 'PRILIKA' && <Target className="w-3 h-3 text-primary shrink-0" />}
                        {a.aiVerdict === 'SUMNJIVO' && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                        {!a.aiVerdict && <div className="w-3 h-3 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{a.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {a.monitor.name} • {new Date(a.createdAt).toLocaleDateString('sl-SI')}
                            {a.userAction && ` • ${a.userAction}`}
                          </div>
                        </div>
                        {a.isArchived && <Badge variant="outline" className="text-[9px] shrink-0">arhivirano</Badge>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border">
          Skupno {results?.total ?? 0} rezultatov • Pritisni Esc za zaprtje
        </div>
      </DialogContent>
    </Dialog>
  );
}
