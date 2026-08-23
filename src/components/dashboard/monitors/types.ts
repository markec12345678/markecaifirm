// v9.03: Shared types for monitors modules.
// Extracted from monitors-view.tsx to enable modular monitors components.

export type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'custom-rss' | 'vinted' | 'mobile-de' | 'kleinanzeigen' | 'subito' | 'willhaben' | 'quoka';

export interface Monitor {
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
