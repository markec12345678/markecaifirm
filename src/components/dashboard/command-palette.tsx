'use client';

// v8.46: Command Palette (Cmd+K) — Raycast/Spotlight-style search across
// all views, AI endpoints, quick actions, and Brain functions.
// Uses existing cmdk + shadcn Command component.

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import {
  LayoutDashboard, Sparkles, TrendingUp, Bell, Settings, Package,
  Plus, RefreshCw, Camera, Rocket, Shield, Target, Download, Upload,
  Brain, DollarSign, BarChart3, FileText, Zap, Activity,
} from 'lucide-react';
import { toast } from 'sonner';

export type ViewName = string;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: ViewName) => void;
}

export function CommandPalette({ open, onOpenChange, onNavigate }: CommandPaletteProps) {
  const [aiEndpoints, setAiEndpoints] = useState<Array<{ name: string; description: string; category: string }>>([]);
  const [loading, setLoading] = useState(false);

  // Fetch AI endpoints for search (only when palette opens)
  useEffect(() => {
    if (!open || aiEndpoints.length > 0) return;
    setLoading(true);
    fetch('/api/ai-list')
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.endpoints) {
          setAiEndpoints(data.endpoints.slice(0, 100)); // top 100 for performance
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, aiEndpoints.length]);

  const navigateTo = useCallback((view: ViewName) => {
    onNavigate(view);
    onOpenChange(false);
  }, [onNavigate, onOpenChange]);

  const runAction = useCallback(async (action: string, label: string) => {
    onOpenChange(false);
    toast.info(`⏳ ${label}...`);
    try {
      const res = await fetch(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ ${label} uspešno`);
      } else {
        toast.error(`✗ ${label}: ${data.error || 'Napaka'}`);
      }
    } catch (err: unknown) {
      toast.error(`✗ ${label}: ${(err as Error)?.message || 'Napaka'}`);
    }
  }, [onOpenChange]);

  const runAIEndpoint = useCallback((endpointName: string) => {
    onNavigate('ai-hub');
    onOpenChange(false);
    // Store the endpoint name in sessionStorage so AI Hub can pick it up
    sessionStorage.setItem('cmdk-endpoint', endpointName);
    setTimeout(() => sessionStorage.removeItem('cmdk-endpoint'), 5000);
    toast.info(`🧠 Odpiram: ${endpointName}`);
  }, [onNavigate, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Išči akcije, poglede, AI funkcije... (npr. 'trade', 'profit', 'brain')" />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>Ni najdenih rezultatov.</CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading="Navigacija">
          <CommandItem onSelect={() => navigateTo('dashboard')} value="dashboard pregled home">
            <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
            <span className="ml-auto text-xs text-muted-foreground">D</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('ai-hub')} value="ai hub brain funkcije">
            <Sparkles className="mr-2 h-4 w-4" /> AI Hub
            <span className="ml-auto text-xs text-muted-foreground">A</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('trades')} value="trades trgovine prodaja">
            <TrendingUp className="mr-2 h-4 w-4" /> Trgovine
            <span className="ml-auto text-xs text-muted-foreground">T</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('alerts')} value="alerts alerti obvestila">
            <Bell className="mr-2 h-4 w-4" /> Alerti
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('skladisce')} value="skladisce inventory zaloga">
            <Package className="mr-2 h-4 w-4" /> Skladišče
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('settings')} value="settings nastavitve konfiguracija">
            <Settings className="mr-2 h-4 w-4" /> Nastavitve
            <span className="ml-auto text-xs text-muted-foreground">S</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Quick Actions */}
        <CommandGroup heading="Hitre akcije">
          <CommandItem onSelect={() => runAction('/api/trades', 'Dodaj trade')} value="dodaj trade nov">
            <Plus className="mr-2 h-4 w-4" /> Dodaj trade
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/cron/run-all', 'Poženi vse monitorje')} value="pozeni monitorji run scrapers">
            <RefreshCw className="mr-2 h-4 w-4" /> Poženi vse monitorje
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/ai/brain/snapshots', 'Shrani snapshot')} value="snapshot brain shrani">
            <Camera className="mr-2 h-4 w-4" /> Shrani Brain Snapshot
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/ai/brain/auto-pilot', 'Auto-pilot run')} value="auto-pilot avtopilot run">
            <Rocket className="mr-2 h-4 w-4" /> Poženi Auto-pilot
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/cron/auto-backup', 'Backup')} value="backup varnostna kopija">
            <Shield className="mr-2 h-4 w-4" /> Ustvari Backup
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/ai/brain/weekly-summary', 'Tedenski povzetek')} value="weekly summary tedenski povzetek email">
            <FileText className="mr-2 h-4 w-4" /> Pošlji Tedenski Povzetek
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Brain Actions */}
        <CommandGroup heading="🧠 Brain Sistem">
          <CommandItem onSelect={() => navigateTo('ai-hub')} value="master brain odločitev top 5">
            <Brain className="mr-2 h-4 w-4" /> Master Brain — TOP 5 akcij
          </CommandItem>
          <CommandItem onSelect={() => runAction('/api/ai/brain/weekly-summary', 'Brain digest')} value="brain digest telegram email">
            <Zap className="mr-2 h-4 w-4" /> Brain Digest (Telegram/Email)
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('ai-hub')} value="scenario what if kaj ce">
            <Target className="mr-2 h-4 w-4" /> Scenario Brain — What If?
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('ai-hub')} value="explainability zakaj reasoning">
            <Activity className="mr-2 h-4 w-4" /> Explainability — Zakaj?
          </CommandItem>
          <CommandItem onSelect={() => navigateTo('ai-hub')} value="adaptive weights utezi feedback">
            <BarChart3 className="mr-2 h-4 w-4" /> Adaptive Weights
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* AI Endpoints Search (top 100) */}
        {aiEndpoints.length > 0 && (
          <CommandGroup heading={`AI Funkcije (${aiEndpoints.length}+ od 431)`}>
            {aiEndpoints.slice(0, 30).map((ep) => (
              <CommandItem
                key={ep.name}
                onSelect={() => runAIEndpoint(ep.name)}
                value={`${ep.name} ${ep.description || ''}`}
              >
                <DollarSign className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="truncate">{ep.name}</span>
                {ep.description && (
                  <span className="ml-2 text-xs text-muted-foreground truncate">
                    {ep.description.substring(0, 50)}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {loading && (
          <CommandGroup heading="Nalagam...">
            <CommandItem disabled>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Nalagam AI funkcije...
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
