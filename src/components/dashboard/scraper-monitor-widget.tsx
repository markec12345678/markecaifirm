'use client';

/**
 * v9.57: Scraper Monitor Widget — real-time tracking scraping aktivnosti.
 *
 * Prikaže:
 * - Live: katero stran se trenutno scrapa (z URL + source)
 * - Status: running / blocked / bypassed / error / success
 * - Block type: captcha / cloudflare / 403 / 429 / timeout
 * - Bypass gumb za posamezen blokirani scraper
 * - Auto-bypass toggle (samodejni obhod blokad)
 * - Statistike 24h (success rate, bypass rate)
 * - Zgodovina zadnjih 10 scrapanj
 *
 * Navdih: Vercel deployment logs + Linear activity feed.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, Zap, AlertTriangle, CheckCircle, XCircle,
  Shield, Clock, ExternalLink, Activity, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHaptic } from '@/hooks/use-haptic';

interface ScraperStatusRow {
  id: string;
  monitorId: string | null;
  source: string;
  targetUrl: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  blockType: string | null;
  blockDetails: string | null;
  bypassAttempts: number;
  bypassMethod: string | null;
  bypassSuccess: boolean;
  listingsFound: number;
  newListings: number;
  error: string | null;
  // v9.69: AI ocene
  avgDealScore: number | null;
  avgAiScore: number | null;
  bestDealScore: number | null;
  bestListingTitle: string | null;
  bestListingUrl: string | null;
  bestAiVerdict: string | null;
  prilikaCount: number;
  sumnjivoCount: number;
  nezanimivoCount: number;
  monitor?: { name: string; source: string } | null;
}

interface Stats {
  total24h: number;
  blocked24h: number;
  bypassed24h: number;
  success24h: number;
  successRate: number;
  bypassRate: number;
}

interface StatusLabel {
  label: string;
  icon: string;
  color: string;
}

interface ApiResponse {
  ok: true;
  recent: ScraperStatusRow[];
  live: ScraperStatusRow[];
  stats: Stats;
  statusLabels: Record<string, StatusLabel>;
  blockLabels: Record<string, string>;
}

const SOURCE_ICONS: Record<string, string> = {
  bolha: '🛒',
  vinted: '👕',
  avtonet: '🚗',
  'mobile-de': '🇩🇪',
  nepremicnine: '🏠',
  'avto.net': '🚙',
  willhaben: '🇦🇹',
  subito: '🇮🇹',
  leboncoin: '🇫🇷',
  ebay: '🌐',
  kleinanzeigen: '🇩🇪',
};

const SOURCE_COLORS: Record<string, string> = {
  bolha: 'text-emerald-500',
  vinted: 'text-sky-500',
  avtonet: 'text-amber-500',
  'mobile-de': 'text-purple-500',
  nepremicnine: 'text-red-500',
};

const BYPASS_METHODS = [
  { id: 'proxy-rotation', name: 'Proxy rotacija', icon: '🔄', desc: 'Zamenjaj IP naslov' },
  { id: 'stealth-mode', name: 'Stealth mode', icon: '🥷', desc: 'Playwright z masking' },
  { id: 'captcha-solve', name: 'CAPTCHA reševalec', icon: '🤖', desc: '2captcha/anti-captcha' },
  { id: 'retry-backoff', name: 'Retry z backoff', icon: '⏱️', desc: 'Počakaj in poskusi znova' },
  { id: 'playwright', name: 'Playwright', icon: '🎭', desc: 'Full browser fetch' },
];

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'zdaj';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min nazaj`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h nazaj`;
  return `${Math.floor(diff / 86400000)}d nazaj`;
}

export function ScraperMonitorWidget() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoBypass, setAutoBypass] = useState(false);
  const [bypassing, setBypassing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/scraper-status');
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) {
        setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // refresh vsakih 5s (live feel)
    return () => clearInterval(interval);
  }, [load]);

  const handleAutoBypass = async () => {
    haptic.medium();
    setBypassing('auto');
    try {
      const res = await fetch('/api/scraper-status?autoBypass=true', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || `Bypass: ${json.bypassed}/${json.total} uspešnih`);
        haptic.success();
      } else {
        toast.error(json.error || 'Bypass ni uspel');
        haptic.error();
      }
      await load();
    } catch (e) {
      toast.error('Povezava ni uspela');
    } finally {
      setBypassing(null);
    }
  };

  const handleManualBypass = async (id: string, method: string) => {
    haptic.light();
    setBypassing(id);
    try {
      const res = await fetch(`/api/scraper-status/${id}/bypass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      const json = await res.json();
      if (json.ok && json.success) {
        toast.success(`Bypass uspel z "${method}"`);
        haptic.success();
      } else if (json.ok) {
        toast.error(`Bypass z "${method}" ni uspel. Poskusi drugo metodo.`);
      } else {
        toast.error(json.error || 'Napaka');
      }
      await load();
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setBypassing(null);
    }
  };

  if (loading || !data) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const { live, recent, stats } = data;

  return (
    <Card className="bg-card/50 border-sky-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-500" />
          Scraper Monitor
          {live.length > 0 && (
            <Badge className="ml-auto bg-sky-500/10 text-sky-500 border-sky-500/30 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse mr-1" />
              {live.length} aktivnih
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-2 rounded bg-background/50 border border-border">
            <div className="text-lg font-bold text-foreground">{stats.total24h}</div>
            <div className="text-[9px] uppercase text-muted-foreground">24h skupaj</div>
          </div>
          <div className="p-2 rounded bg-background/50 border border-border">
            <div className="text-lg font-bold text-emerald-500">{stats.success24h}</div>
            <div className="text-[9px] uppercase text-muted-foreground">Uspeh</div>
          </div>
          <div className="p-2 rounded bg-background/50 border border-border">
            <div className="text-lg font-bold text-red-500">{stats.blocked24h}</div>
            <div className="text-[9px] uppercase text-muted-foreground">Blokirani</div>
          </div>
          <div className="p-2 rounded bg-background/50 border border-border">
            <div className="text-lg font-bold text-amber-500">{stats.bypassed24h}</div>
            <div className="text-[9px] uppercase text-muted-foreground">Bypassed</div>
          </div>
        </div>

        {/* Success rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Success rate 24h</span>
            <span className="font-bold">{stats.successRate}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
        </div>

        {/* Auto-bypass toggle */}
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-background/30">
          <Shield className={cn('w-4 h-4', autoBypass ? 'text-amber-500' : 'text-muted-foreground')} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">Auto-bypass blokiranih</div>
            <div className="text-[10px] text-muted-foreground">
              Samodejno poskusi proxy/stealth/captcha ko je blokiran
            </div>
          </div>
          <Button
            onClick={() => {
              haptic.light();
              setAutoBypass(!autoBypass);
              toast.info(autoBypass ? 'Auto-bypass izklopljen' : 'Auto-bypass vklopljen');
            }}
            variant={autoBypass ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            aria-label={autoBypass ? 'Izklopi auto-bypass' : 'Vklopi auto-bypass'}
          >
            {autoBypass ? 'ON' : 'OFF'}
          </Button>
          {autoBypass && stats.blocked24h > 0 && (
            <Button
              onClick={handleAutoBypass}
              disabled={bypassing === 'auto'}
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-amber-500/40 text-amber-500"
            >
              {bypassing === 'auto' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              Bypass vse
            </Button>
          )}
        </div>

        {/* Live scraping */}
        {live.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase text-sky-500 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
              Trenutno scrapa
            </div>
            {live.map((row) => {
              // v9.69: Live duration calculator — koliko časa že scrapa
              const liveDuration = row.status === 'running' && row.startedAt
                ? Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 1000)
                : null;

              return (
              <div
                key={row.id}
                className={cn(
                  'p-2 rounded border bg-card/50',
                  row.status === 'blocked' ? 'border-red-500/40 bg-red-500/5' : 'border-sky-500/30'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{SOURCE_ICONS[row.source] ?? '🌐'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate flex items-center gap-1.5">
                      {row.monitor?.name ?? row.source}
                      {/* v9.69: Live duration indikator */}
                      {row.status === 'running' && liveDuration !== null && (
                        <span className="text-[9px] text-sky-500 font-mono flex items-center gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-sky-500 animate-pulse" />
                          {liveDuration < 60 ? `${liveDuration}s` : `${Math.floor(liveDuration / 60)}min ${liveDuration % 60}s`}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                      {row.targetUrl.length > 60 ? row.targetUrl.slice(0, 60) + '...' : row.targetUrl}
                    </div>
                  </div>
                  <Badge
                    className={cn(
                      'text-[9px] px-1.5 py-0',
                      row.status === 'running' && 'bg-sky-500/10 text-sky-500 border-sky-500/30',
                      row.status === 'blocked' && 'bg-red-500/10 text-red-500 border-red-500/30'
                    )}
                  >
                    {data.statusLabels[row.status]?.icon} {data.statusLabels[row.status]?.label}
                  </Badge>
                </div>

                {/* v9.69: Live progress bar — animirana ko scraper dela */}
                {row.status === 'running' && (
                  <div className="h-0.5 bg-muted rounded-full overflow-hidden mb-1.5">
                    <div className="h-full bg-gradient-to-r from-sky-500 to-sky-300 animate-pulse" style={{ width: '60%' }} />
                  </div>
                )}

                {/* v9.69: AI ocene za končane scrape (success/bypassed) */}
                {(row.status === 'success' || row.status === 'bypassed') && row.listingsFound > 0 && (
                  <div className="mt-1.5 p-1.5 rounded bg-background/30 border border-border/50 space-y-1">
                    {/* Stats row */}
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-emerald-500 font-bold">{row.newListings}</span>
                      <span className="text-muted-foreground">novih</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-foreground font-bold">{row.listingsFound}</span>
                      <span className="text-muted-foreground">skupaj</span>
                      {row.durationMs && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatDuration(row.durationMs)}</span>
                        </>
                      )}
                    </div>

                    {/* Verdikt counts */}
                    {(row.prilikaCount > 0 || row.sumnjivoCount > 0) && (
                      <div className="flex items-center gap-2 text-[9px]">
                        {row.prilikaCount > 0 && (
                          <span className="text-emerald-500 flex items-center gap-0.5">
                            🎯 {row.prilikaCount} priložnosti
                          </span>
                        )}
                        {row.sumnjivoCount > 0 && (
                          <span className="text-amber-500 flex items-center gap-0.5">
                            ⚠️ {row.sumnjivoCount} sumljivih
                          </span>
                        )}
                      </div>
                    )}

                    {/* Best listing */}
                    {row.bestDealScore !== null && row.bestListingTitle && (
                      <div className="pt-1 border-t border-border/30">
                        <div className="text-[9px] uppercase text-muted-foreground font-bold mb-0.5">
                          🏆 Najboljši oglas
                        </div>
                        <div className="flex items-center gap-1.5">
                          {row.bestListingUrl ? (
                            <a
                              href={row.bestListingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary hover:underline truncate flex-1"
                            >
                              {row.bestListingTitle.slice(0, 40)}{row.bestListingTitle.length > 40 ? '...' : ''}
                            </a>
                          ) : (
                            <span className="text-[10px] truncate flex-1">
                              {row.bestListingTitle.slice(0, 40)}{row.bestListingTitle.length > 40 ? '...' : ''}
                            </span>
                          )}
                          <Badge className={cn(
                            'text-[9px] px-1 py-0 shrink-0',
                            row.bestDealScore >= 80 ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                              : row.bestDealScore >= 50 ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                : 'bg-muted text-muted-foreground border-border'
                          )}>
                            {row.bestDealScore}/100
                          </Badge>
                        </div>
                        {row.bestAiVerdict && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">
                            AI verdikt: <span className={cn(
                              'font-bold',
                              row.bestAiVerdict === 'PRILIKA' ? 'text-emerald-500'
                                : row.bestAiVerdict === 'SUMNJIVO' ? 'text-amber-500'
                                  : 'text-muted-foreground'
                            )}>{row.bestAiVerdict}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Average scores */}
                    {row.avgDealScore !== null && (
                      <div className="flex items-center gap-2 text-[9px] text-muted-foreground pt-1 border-t border-border/30">
                        <span>Povprečje:</span>
                        <span>Deal {row.avgDealScore}/100</span>
                        {row.avgAiScore !== null && <span>· AI {row.avgAiScore}/10</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* Block info */}
                {row.status === 'blocked' && row.blockType && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-500 mb-1.5">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{data.blockLabels[row.blockType] ?? row.blockType}</span>
                  </div>
                )}

                {/* Bypass buttons for blocked */}
                {row.status === 'blocked' && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {BYPASS_METHODS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleManualBypass(row.id, m.id)}
                        disabled={bypassing === row.id}
                        title={m.desc}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-card hover:border-amber-500/40 hover:bg-amber-500/5 text-[9px] disabled:opacity-50 transition-colors"
                      >
                        <span>{m.icon}</span>
                        <span>{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Bypass result */}
                {row.bypassAttempts > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Bypass poskusi: {row.bypassAttempts}
                    {row.bypassMethod && ` · ${row.bypassMethod}`}
                    {row.bypassSuccess ? (
                      <CheckCircle className="w-3 h-3 inline ml-1 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3 h-3 inline ml-1 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground">
            <Activity className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Trenutno ni aktivnega scrapanja.
            <br />
            <span className="text-[10px]">Pojdi v Monitorji → Poženi za začetek</span>
          </div>
        )}

        {/* History toggle */}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full text-[10px] text-muted-foreground hover:text-foreground flex items-center justify-between pt-1 border-t border-border"
        >
          <span>Zgodovina (zadnjih 10)</span>
          <span>{showHistory ? '▲ Skrij' : '▼ Pokaži'}</span>
        </button>

        {showHistory && (
          <div className="space-y-1 max-h-48 overflow-y-auto touch-scroll">
            {recent.slice(0, 10).map((row) => {
              const statusLabel = data.statusLabels[row.status];
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 p-1.5 rounded bg-background/30 border border-border text-[10px]"
                >
                  <span>{SOURCE_ICONS[row.source] ?? '🌐'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      {row.monitor?.name ?? row.source}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2">
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeAgo(row.startedAt)}
                      </span>
                      <span>·</span>
                      <span>{formatDuration(row.durationMs)}</span>
                      {row.newListings > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-500">+{row.newListings} novih</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={cn('text-xs', statusLabel?.color)}>
                    {statusLabel?.icon}
                  </span>
                </div>
              );
            })}
            {recent.length === 0 && (
              <div className="text-center py-4 text-[10px] text-muted-foreground">
                Še ni zgodovine scrapov.
              </div>
            )}
          </div>
        )}

        {/* Settings hint */}
        <div className="text-[9px] text-muted-foreground/70 text-center pt-1 border-t border-border/50 flex items-center justify-center gap-1">
          <Settings className="w-2.5 h-2.5" />
          Konfiguriraj proxy/stealth/captcha v Nastavitve → Anti-detekcija
        </div>
      </CardContent>
    </Card>
  );
}
