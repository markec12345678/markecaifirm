'use client';

// v8.78: Saved Search Status Card — dashboard widget za BuyRequest monitoring.
// "3 aktivna iskanja · 5 novih ujemanj · zadnjič pred 5min · najnovejše: iPhone 13 Pro 450€"

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, RefreshCw, Bell, Clock, ExternalLink, MapPin, Star, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusData {
  ok: boolean;
  activeCount: number;
  totalNewMatches: number;
  totalMatchesAllTime: number;
  lastRunAt: string | null;
  topRequests: Array<{
    id: string;
    title: string;
    searchFor: string;
    newMatchesCount: number;
    lastRunAt: string | null;
    category: string;
    priceMax: number | null;
  }>;
  recentMatch: {
    matchedAt: string;
    matchPrice: number | null;
    listing: {
      id: string;
      title: string;
      price: number | null;
      url: string;
      location: string;
      imageUrl: string | null;
      aiScore: number | null;
      aiVerdict: string | null;
      monitor: { source: string } | null;
    };
    buyRequest: { id: string; title: string; searchFor: string };
  } | null;
}

function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'zdaj';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min nazaj`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h nazaj`;
  const days = Math.floor(hours / 24);
  return `${days}d nazaj`;
}

const SOURCE_ICONS: Record<string, string> = {
  bolha: '🇸🇮', nepremicnine: '🏠', avtonet: '🚗', vinted: '👕',
  'mobile-de': '🇩🇪', kleinanzeigen: '🇩🇪', subito: '🇮🇹', willhaben: '🇦🇹', quoka: '🇩🇪',
};

export function SavedSearchStatusCard() {
  const { data, loading, error, refetch } = useFetch<StatusData>('/api/buy-requests/status', { interval: 60000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> 🔍 Saved Searches</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> 🔍 Saved Searches</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  // Empty state
  if (data.activeCount === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> 🔍 Saved Searches</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Še nimaš shranjenih iskanj.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Odpri <a href="/?view=iskalnik" className="text-primary hover:underline">Iskalnik</a> in shrani iskanje za avtomatski monitoring.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-primary/20', data.totalNewMatches > 0 && 'border-primary/40')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" /> 🔍 Saved Searches
            {data.totalNewMatches > 0 && (
              <Badge className="bg-primary text-primary-foreground animate-pulse text-[9px]">
                {data.totalNewMatches} novo
              </Badge>
            )}
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Top stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Aktivna</div>
            <div className="text-lg font-bold text-primary">{data.activeCount}</div>
          </div>
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Novih ujemanj</div>
            <div className={cn('text-lg font-bold', data.totalNewMatches > 0 ? 'text-emerald-500' : 'text-muted-foreground')}>
              {data.totalNewMatches}
            </div>
          </div>
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Skupno ujemanj</div>
            <div className="text-lg font-bold text-foreground">{data.totalMatchesAllTime}</div>
          </div>
        </div>

        {/* Last run */}
        {data.lastRunAt && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Zadnji pregled: {timeAgo(data.lastRunAt)}
          </div>
        )}

        {/* Top requests z novimi ujemanji */}
        {data.topRequests.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
              <Bell className="w-2.5 h-2.5" /> Nova ujemanja
            </div>
            <div className="space-y-1">
              {data.topRequests.map(r => (
                <a
                  key={r.id}
                  href={`/?view=iskalnik&matchRequestId=${encodeURIComponent(r.id)}`}
                  className="flex items-center gap-2 p-1.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium truncate">{r.title}</span>
                      {r.searchFor && <span className="text-[9px] text-muted-foreground">({r.searchFor})</span>}
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {r.category}{r.priceMax && ` · ≤${r.priceMax}€`}
                      {r.lastRunAt && ` · ${timeAgo(r.lastRunAt)}`}
                    </div>
                  </div>
                  <Badge className="bg-primary text-primary-foreground text-[9px] shrink-0">
                    {r.newMatchesCount} novo
                  </Badge>
                  <Eye className="w-3 h-3 text-primary shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Recent match */}
        {data.recentMatch && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Zadnje ujemanje</div>
            <div className="bg-muted/20 rounded-md p-2 flex items-start gap-2">
              {data.recentMatch.listing.imageUrl && (
                <img src={data.recentMatch.listing.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{data.recentMatch.listing.title}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                  {data.recentMatch.listing.price != null && (
                    <span className="font-bold text-emerald-500 font-mono">{data.recentMatch.listing.price}€</span>
                  )}
                  {data.recentMatch.listing.location && (
                    <span className="flex items-center gap-0.5"><MapPin className="w-2 h-2" /> {data.recentMatch.listing.location}</span>
                  )}
                  {data.recentMatch.listing.aiScore != null && (
                    <span className="text-primary flex items-center gap-0.5"><Star className="w-2 h-2" /> {data.recentMatch.listing.aiScore}/10</span>
                  )}
                  {data.recentMatch.listing.monitor?.source && (
                    <span>{SOURCE_ICONS[data.recentMatch.listing.monitor.source] || '📋'} {data.recentMatch.listing.monitor.source}</span>
                  )}
                  <span>· {timeAgo(data.recentMatch.matchedAt)}</span>
                </div>
              </div>
              <a href={data.recentMatch.listing.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-primary hover:text-primary/80">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Footer link */}
        <div className="pt-1 border-t border-border/30">
          <a href="/?view=iskalnik" className="text-[10px] text-primary hover:underline flex items-center gap-1">
            <Search className="w-2.5 h-2.5" /> Odpri Iskalnik
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
