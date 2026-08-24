'use client';

// v8.97: Seed & Telegram Card extracted from ai-hub-view.tsx (v8.35).
// Two action areas: (A) Seed demo data when Trade table empty (loads 25 demo trades),
// (B) Telegram brain notifications (3 test buttons: digest/autopilot/anomaly).

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sprout, RefreshCw, Send, Bot, AlertOctagon, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SeedInfo } from './types';

export function SeedAndTelegramCard() {
  const [seedInfo, setSeedInfo] = useState<SeedInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ type: string; sent: boolean; reason?: string | null } | null>(null);

  const fetchSeedInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch('/api/ai/brain/seed', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SeedInfo;
      if (!json?.ok) throw new Error('API ni vrnil rezultata');
      setSeedInfo(json);
    } catch {
      // Silent fail — the card just shows the seed button without count info
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    fetchSeedInfo();
    // Auto-refresh trade count every 60 seconds (matches SystemHealthCard cadence)
    const intervalId = setInterval(() => {
      fetchSeedInfo();
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchSeedInfo]);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/ai/brain/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (json.created > 0) {
        toast.success(`✓ Naloženih ${json.created} demo trade-ov. Osvežujem...`);
        // Refresh info to show new trade count
        await fetchSeedInfo();
        // Trigger a full page refresh after a short delay so all brain cards recompute
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.reload();
        }, 1500);
      } else {
        // Skipped because trades already exist
        toast.info(`ℹ️ Trade-i že obstajajo (${json.total}). Uporabi 'reseed' za reset.`);
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri nalaganju demo podatkov');
    } finally {
      setSeeding(false);
    }
  }, [fetchSeedInfo]);

  const handleTelegramTest = useCallback(async (type: 'digest' | 'autopilot' | 'anomaly') => {
    setSendingTest(type);
    setLastResult(null);
    try {
      const res = await fetch('/api/ai/brain/telegram-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (json.sent) {
        toast.success(`✓ ${type} test poslan na Telegram`);
        setLastResult({ type, sent: true });
      } else {
        const reason = json.reason ?? 'Telegram ni konfiguriran';
        toast.warning(`ℹ️ ${type}: ${reason}`);
        setLastResult({ type, sent: false, reason });
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri testiranju Telegram-a');
      setLastResult({ type, sent: false, reason: (e as Error)?.message ?? 'Napaka' });
    } finally {
      setSendingTest(null);
    }
  }, []);

  // Hide the seed section if trades already exist (user already has real data)
  const showSeedSection = seedInfo ? seedInfo.count === 0 : loadingInfo;

  return (
    <div className="rounded-xl border-2 bg-gradient-to-br from-lime-500/15 via-cyan-500/10 to-sky-500/5 border-lime-500/40 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sprout className="w-5 h-5 shrink-0 text-lime-600 dark:text-lime-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🌱 Seed Data & 📱 Telegram
          </span>
          <Badge variant="outline" className="text-[10px] border-lime-500/50 text-lime-700 dark:text-lime-300 shrink-0 font-bold">
            v8.35
          </Badge>
        </div>
        <button
          onClick={fetchSeedInfo}
          disabled={loadingInfo}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loadingInfo && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* SEED SECTION — only shown if Trade table is empty */}
      {showSeedSection ? (
        <div className="rounded-lg border border-lime-500/30 bg-lime-500/5 p-2.5 mb-2.5">
          <div className="flex items-start gap-2 mb-2">
            <Sprout className="w-4 h-4 shrink-0 text-lime-600 dark:text-lime-400 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-bold text-lime-700 dark:text-lime-300">Nisi še dodal nobene prodaje.</span>{' '}
              <span className="text-muted-foreground">
                Naloži demo podatke (25 trade-ov) za testiranje Brain sistema — Actual Profit, Accuracy in vsi Brain signali bodo dobili realne podatke.
              </span>
            </div>
          </div>
          <Button
            onClick={handleSeed}
            disabled={seeding}
            size="sm"
            className="w-full h-8 text-[11px] bg-lime-600 hover:bg-lime-700 text-white border-0"
          >
            {seeding ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin mr-1" /> Nalagam...
              </>
            ) : (
              <>
                <Sprout className="w-3 h-3 mr-1" /> Naloži demo podatke (25 trade-ov)
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 mb-2.5 text-[10px] text-emerald-700 dark:text-emerald-300">
          ✓ Trade-i obstajajo: <span className="font-mono font-bold">{seedInfo?.count ?? 0}</span>
          {' '}({seedInfo?.byStatus.sold ?? 0} sold · {seedInfo?.byStatus.held ?? 0} held · {seedInfo?.byStatus.cancelled ?? 0} cancelled)
        </div>
      )}

      {/* TELEGRAM SECTION — always visible */}
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <MessageCircle className="w-3.5 h-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
            📱 Telegram Brain Notifications
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
          3 tipi obvestil: (1) <span className="font-semibold">dnevni digest</span> — TOP 5 akcij + health + strategija; (2) <span className="font-semibold">auto-pilot alert</span> — ko auto-pilot izvede akcijo; (3) <span className="font-semibold">anomalija alert</span> — ko je auto-pilot suspendiran.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <Button
            onClick={() => handleTelegramTest('digest')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'digest' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
            Pošlji digest
          </Button>
          <Button
            onClick={() => handleTelegramTest('autopilot')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'autopilot' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Bot className="w-3 h-3 mr-1" />}
            Pošlji auto-pilot test
          </Button>
          <Button
            onClick={() => handleTelegramTest('anomaly')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'anomaly' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <AlertOctagon className="w-3 h-3 mr-1" />}
            Pošlji anomalija test
          </Button>
        </div>
        {lastResult && (
          <div className={cn(
            'mt-2 text-[10px] rounded border px-2 py-1',
            lastResult.sent
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>
            {lastResult.sent
              ? `✅ ${lastResult.type}: Poslano na Telegram`
              : `❌ ${lastResult.type}: ${lastResult.reason ?? 'Telegram ni konfiguriran'}`}
          </div>
        )}
        <div className="mt-2 text-[9px] text-muted-foreground/70 leading-relaxed">
          💡 Konfiguriraj Telegram bot token + chat ID v ⚙️ Settings → Telegram sekcija.
        </div>
      </div>
    </div>
  );
}
