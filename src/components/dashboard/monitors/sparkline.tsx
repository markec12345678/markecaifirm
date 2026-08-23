'use client';

// v9.03: Sparkline — extracted from monitors-view.tsx.

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Zap, AlertCircle, PauseCircle, Bell, Copy, Square, Tag, Sparkles, Check, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PROMPT_CATEGORIES, getPromptsByCategory } from '@/lib/ai-prompts';

// v3.4: Mini SVG sparkline component
export function Sparkline({ data, width = 60, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length === 0 || data.every(d => d === 0)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const points = data.map((d, i) => `${i * step},${height - (d / max) * height}`).join(' ');
  const lastIdx = data.length - 1;
  const lastVal = data[lastIdx];
  const lastX = lastIdx * step;
  const lastY = height - (lastVal / max) * height;
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke="#4ade80" strokeWidth="1.5" />
      <circle cx={lastX} cy={lastY} r="1.5" fill="#4ade80" />
    </svg>
  );
}

type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss' | 'vinted' | 'mobile-de' | 'kleinanzeigen' | 'subito' | 'willhaben' | 'quoka';

interface Monitor {
  id: string;
  name: string;
  source: Source;
  sourceUrl: string;
  keywords: string;
  excludeKeywords: string;
  minPrice: number | null;
  maxPrice: number | null;
  intervalMinutes: number;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  customPrompt: string;
  runStartHour: number | null;
  runEndHour: number | null;
  // v1.3: auto-pause
  consecutiveErrors: number;
  autoPauseThreshold: number;
  autoPausedAt: string | null;
  // v2.2: notification channels
  notificationChannels: string;
  // v4.4: tags
  tags: string;
  createdAt: string;
  _count?: { listings: number; alerts: number };
}

const SOURCE_LABELS: Record<Source, string> = {
  bolha: 'Bolha.com',
  nepremicnine: 'Nepremičnine.net (RSS)',
  avtonet: 'Avtonet.si',
  salomon: 'Salomon.si',
  'custom-rss': 'Custom RSS',
  vinted: 'Vinted.si (API)',
  'mobile-de': 'Mobile.de (DE→SI arbitraža)',
  kleinanzeigen: 'Kleinanzeigen.de (Nemčija)',
  subito: 'Subito.it (Italija)',
  willhaben: 'Willhaben.at (Avstrija)',
  quoka: 'Quoka.de (Nemčija)',
};

const SOURCE_PRESETS: Array<{ source: Source; label: string; url: string; hint: string }> = [
  {
    source: 'nepremicnine',
    label: 'Nepremičnine — 2-sobna LJ do 200k',
    url: 'https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/stanovanje/2-sobno/cena-od-1-do-200-tisoč-evrov/?output=rss',
    hint: 'Po pripravi RSS URL-ja na spletni strani dodaj ?output=rss',
  },
  {
    source: 'bolha',
    label: 'Bolha — iPhone 13 Pro',
    url: 'https://www.bolha.com/index.php?ctl=search&A_3_1=iphone+13+pro&A_12_1=1&A_0_1=0&sort=new',
    hint: 'Iskanje po ključnih besedah na Bolhi',
  },
  {
    source: 'bolha',
    label: 'Bolha — orodje Bosch',
    url: 'https://www.bolha.com/orodja?query=bosch',
    hint: 'Kategorija + iskalni niz',
  },
  {
    source: 'vinted',
    label: 'Vinted — Nike Air Max',
    url: 'https://www.vinted.si/api/v2/catalog/items?search_text=nike%20air%20max&order_by=newest_first',
    hint: 'Vinted API — zamenjaj search_text param',
  },
  // v2.9: Additional templates
  {
    source: 'avtonet',
    label: 'Avtonet — VW Golf do 8000€',
    url: 'https://www.avto.net/adresults.asp?znamka=VOLKSWAGEN&model=GOLF&cenaMIN=0&cenaMAX=8000',
    hint: 'Avtonet iskanje — zamenjaj znamko/model/ceno',
  },
  {
    source: 'nepremicnine',
    label: 'Nepremičnine — hiša Bela krajina',
    url: 'https://www.nepremicnine.net/oglasi-prodaja/bela-krajina/hisa/?output=rss',
    hint: 'Hiše v Beli krajini',
  },
  {
    source: 'vinted',
    label: 'Vinted — Levi\'s jeans',
    url: 'https://www.vinted.si/api/v2/catalog/items?search_text=levis%20jeans&order_by=newest_first',
    hint: 'Vinted — iskanje oblačil',
  },
  {
    source: 'bolha',
    label: 'Bolha — PlayStation 5',
    url: 'https://www.bolha.com/index.php?ctl=search&A_3_1=playstation+5&sort=new',
    hint: 'Igranje konzol na Bolhi',
  },
  // v6.17: mobile.de presets (DE→SI cross-border arbitraža)
  {
    source: 'mobile-de',
    label: 'Mobile.de — BMW Series 3 do 10.000€ (DE→SI)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&make=BMW&model=SERIES_3&priceTo=10000&sortOption=price.asc',
    hint: 'Cross-border: kupi v DE (~15% cenejše), prodaj v SI. Shipping ~400€. Vklopi Playwright v nastavitvah za Cloudflare blokade.',
  },
  {
    source: 'mobile-de',
    label: 'Mobile.de — VW Golf 7 do 10.000€ (DE→SI)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&make=VOLKSWAGEN&model=GOLF&priceTo=10000&yearFrom=2012&sortOption=price.asc',
    hint: 'Najbolj prodajan avto v SI. V DE ~15% cenejši.',
  },
  {
    source: 'mobile-de',
    label: 'Mobile.de — EV avtomobili do 20.000€ (SI subvencija 4500€)',
    url: 'https://suchen.mobile.de/fahrzeuge/search.html?dam=false&isSearchRequest=true&fuel=ELECTRIC&priceTo=20000&sortOption=price.asc',
    hint: 'Slovenska subvencija 4500€ za EV! 18000€ v DE - 4500€ subvencija = 13900€ efektivno.',
  },
  // v6.18: Tujih trgov presets
  {
    source: 'kleinanzeigen',
    label: 'Kleinanzeigen.de — iPhone 13/14 Pro do 600€ (DE→SI)',
    url: 'https://www.kleinanzeigen.de/s-suchanfrage.html?keywords=iphone+13+pro&priceType:from=300&priceType:to=600',
    hint: 'iPhone v DE ~15% cenejši. Shipping DHL ~12€. Pazi "Ohne iCloud Sperre".',
  },
  {
    source: 'subito',
    label: 'Subito.it — Luxury torbe (Gucci/Prada) do 500€ (IT→SI)',
    url: 'https://www.subito.it/annunci-italia/vendita?q=gucci+borsa&prezzo=200-500',
    hint: 'Italija = domovina Gucci/Prada. Prihranek 30-50% za preprodajo.',
  },
  {
    source: 'willhaben',
    label: 'Willhaben.at — Smuči (Atomic/Head) do 400€ (AT→SI)',
    url: 'https://www.willhaben.at/iad/kaufen-und-verkaufen?keyword=atomic+head+ski&priceFrom=150&priceTo=400',
    hint: 'Avstrija = smučarska država. Atomic in Head sta avstrijski znamki (boljše cene).',
  },
];

