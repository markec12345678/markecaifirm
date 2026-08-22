/**
 * AIHubView — central hub for browsing and running all AI endpoints.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. This is the only module that exports the public
 * `AIHubView` component (used by /src/app/page.tsx).
 *
 * Responsibilities:
 *   - Fetch /api/ai-list to get all 254 AI endpoints
 *   - Mirror server-side categorize() to guarantee consistent category labels
 *   - Render the BrainSynthesisCard (the brain-system dashboard) at the top
 *   - Render the category stat grid (10 categories)
 *   - Render the search input + deprecated-filter toggle
 *   - Render the endpoint card grid (max 60 visible, brain endpoints get
 *     version badges, deprecated endpoints get a DEPRECATED pill)
 *   - Open AIRunnerModal on endpoint click
 *
 * Lazy-loaded via next/dynamic (ssr: false) by the parent page.
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronRight, RefreshCw, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AIEndpoint } from './types';
import { CATEGORIES, categorize } from './utils';
import { BrainSynthesisCard } from './system';
import { AIRunnerModal } from './runner-modal';

export function AIHubView() {
  const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedEndpoint, setSelectedEndpoint] = useState<AIEndpoint | null>(null);
  // v8.94: filter toggle za deprecated endpoint-e (default: prikaži)
  const [hideDeprecated, setHideDeprecated] = useState(false);

  // Generiraj seznam iz AI_ENDPOINTS.md ali direktno iz route.ts datotek
  useEffect(() => {
    // Statičen seznam generiran iz backend-a (254 endpointov)
    // V produkciji bi to lahko bil API klic na /api/ai/list, a za enostavnost
    // uporabljamo statičen seznam (generiran ob build-izgradnji)
    fetch('/api/ai-list')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.endpoints) {
          // Mirror server-side categorize — guarantees consistency even if
          // /api/ai-list returns a stale category field.
          const normalized: AIEndpoint[] = data.endpoints.map((e: AIEndpoint) => ({
            ...e,
            category: categorize(e.name),
          }));
          setEndpoints(normalized);
        } else {
          // Fallback: prazen seznam (API ne obstaja — uporabnik lahko še vedno išče)
          setEndpoints([]);
        }
      })
      .catch(() => setEndpoints([]))
      .finally(() => setLoading(false));
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let result = endpoints;
    if (activeCategory !== 'all') {
      result = result.filter(e => e.category === activeCategory);
    }
    if (hideDeprecated) {
      result = result.filter(e => !e.deprecated);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        // v8.94: išči tudi po replacement endpoint-u (da uporabnik najde replacement)
        (e.deprecatedReplacement ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [endpoints, activeCategory, search, hideDeprecated]);

  // Statistike po kategorijah
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    endpoints.forEach(e => { stats[e.category] = (stats[e.category] ?? 0) + 1; });
    return stats;
  }, [endpoints]);

  // v8.94: Count deprecated za prikaz v UI
  const deprecatedCount = useMemo(() => endpoints.filter(e => e.deprecated).length, [endpoints]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam AI endpointe...</span>
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
            AI Hub
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {endpoints.length} AI funkcij · {filtered.length} prikazanih
          </p>
        </div>
      </div>

      {/* v8.15: Brain Synthesis Card — top of AI Hub, above stats */}
      <BrainSynthesisCard onBrainCategoryClick={() => setActiveCategory('brain')} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {CATEGORIES.map(cat => (
          <Card key={cat.id} className={cn('cursor-pointer transition-all hover:border-primary/40',
            activeCategory === cat.id && 'border-primary bg-primary/5')}
            onClick={() => setActiveCategory(cat.id)}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                <span>{cat.icon}</span>
                {cat.label}
              </div>
              <div className={cn('text-xl font-bold font-mono', cat.color)}>
                {cat.id === 'all' ? endpoints.length : (categoryStats[cat.id] ?? 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + deprecated filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Išči AI funkcijo (npr. 'fraud', 'buyer', 'profit', 'brain'...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Išči AI endpointe"
          />
        </div>
        {deprecatedCount > 0 && (
          <button
            type="button"
            onClick={() => setHideDeprecated(!hideDeprecated)}
            aria-pressed={hideDeprecated}
            aria-label={hideDeprecated ? 'Prikaži zastarele endpointe' : 'Skrij zastarele endpointe'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs transition-colors min-h-[44px] sm:min-h-0 whitespace-nowrap',
              hideDeprecated
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card/50 text-muted-foreground hover:border-primary/30 hover:text-primary'
            )}
          >
            <span>{hideDeprecated ? '👁️' : '🚫'}</span>
            <span>{hideDeprecated ? 'Prikaži' : 'Skrij'}</span>
            <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive shrink-0">
              {deprecatedCount}
            </Badge>
          </button>
        )}
      </div>

      {/* Endpoints grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {endpoints.length === 0
                ? 'AI endpointi še niso naloženi. Za generiranje poženi: bun run dev in obišči /api/ai-list'
                : 'Ni rezultatov za ta iskalni niz.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.slice(0, 60).map(ep => {
            const cat = CATEGORIES.find(c => c.id === ep.category) ?? CATEGORIES[CATEGORIES.length - 1];
            return (
              <Card
                key={ep.name}
                className={cn(
                  'cursor-pointer hover:border-primary/40 hover:bg-card/50 transition-all group',
                  ep.category === 'brain' && 'border-emerald-500/30 hover:border-emerald-500/50',
                )}
                onClick={() => setSelectedEndpoint(ep)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs">{cat.icon}</span>
                        <span className="font-mono text-xs font-bold text-foreground truncate group-hover:text-primary">
                          {ep.name}
                        </span>
                        {ep.category === 'brain' && ep.name === 'brain/profit' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                            v8.15
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/inventory' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
                            v8.16
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/market' && (
                          <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-600 dark:text-sky-400 shrink-0">
                            v8.17
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/sourcing' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
                            v8.18
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/risk' && (
                          <Badge variant="outline" className="text-[9px] border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
                            v8.19
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/buyer' && (
                          <Badge variant="outline" className="text-[9px] border-cyan-500/40 text-cyan-600 dark:text-cyan-400 shrink-0">
                            v8.20
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/pricing' && (
                          <Badge variant="outline" className="text-[9px] border-lime-500/40 text-lime-700 dark:text-lime-400 shrink-0">
                            v8.21
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/master' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
                            v8.22 · FINAL
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/actual-profit' && (
                          <Badge variant="outline" className="text-[9px] border-indigo-500/50 text-indigo-700 dark:text-indigo-400 shrink-0 font-bold">
                            v8.23 · GROUND TRUTH
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/snapshots' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-700 dark:text-emerald-400 shrink-0 font-bold">
                            v8.23 · VALIDATION
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/risk-profile' && (
                          <Badge variant="outline" className="text-[9px] border-violet-500/50 text-violet-700 dark:text-violet-400 shrink-0 font-bold">
                            v8.24 · PERSONAL
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/accuracy' && (
                          <Badge variant="outline" className="text-[9px] border-teal-500/50 text-teal-700 dark:text-teal-400 shrink-0 font-bold">
                            v8.25 · ACCURACY
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/explain' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
                            v8.26 · WHY
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/scenario' && (
                          <Badge variant="outline" className="text-[9px] border-rose-500/50 text-rose-700 dark:text-rose-400 shrink-0 font-bold">
                            v8.27 · WHAT IF?
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/weights' && (
                          <Badge variant="outline" className="text-[9px] border-orange-500/50 text-orange-700 dark:text-orange-400 shrink-0 font-bold">
                            v8.28 · LEARNING
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/drafts' && (
                          <Badge variant="outline" className="text-[9px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
                            v8.29 · ACTION
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/drafts/[id]' && (
                          <Badge variant="outline" className="text-[9px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
                            v8.29 · PATCH
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/auto-pilot' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
                            v8.31 · AUTO+
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/auto-pilot/rollback' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
                            v8.30 · UNDO
                          </Badge>
                        )}
                        {ep.deprecated && (
                          <Badge
                            variant="destructive"
                            className="text-[9px] shrink-0 font-bold"
                            title={ep.deprecatedReplacement ? `Uporabi /api/ai/${ep.deprecatedReplacement} namesto tega` : 'Zastareli — bo odstranjen v v9.0'}
                          >
                            DEPRECATED
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">
                        {ep.description || 'Brez opisa'}
                      </p>
                      {ep.deprecated && ep.deprecatedReplacement && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                          → Uporabi <code className="font-mono">/api/ai/{ep.deprecatedReplacement}</code>
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Show more / count */}
      {filtered.length > 60 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Prikažujem prvih 60 od {filtered.length} rezultatov. Zaostriti iskanje za manj rezultatov.
        </div>
      )}

      {/* AI Runner Modal */}
      <AIRunnerModal endpoint={selectedEndpoint} onClose={() => setSelectedEndpoint(null)} />

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            🤖 <b>AI Hub</b> omogoča brskanje in poganjanje vseh {endpoints.length} AI funkcij.
            Klikni na endpoint za podrobnosti in pošiljanje zahteve.
            Body je JSON (privzeto <code className="px-1 bg-card rounded">{`{}`}</code> — prazno).
            Rezultat je prikazan v pretty-print JSON formatu.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
