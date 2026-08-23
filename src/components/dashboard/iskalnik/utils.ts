// v9.06: Shared helpers for iskalnik modules.
// Extracted from iskalnik-view.tsx.

export const CATEGORIES = ['elektronika', 'avto', 'oblačila', 'obutev', 'orodje', 'pohištvo', 'nepremičnina', 'kolektorstvo', 'drugo'];

// v8.74: Platform source badge helpers
export const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  bolha: { icon: '🇸🇮', label: 'Bolha', color: 'border-emerald-500/40 text-emerald-500' },
  nepremicnine: { icon: '🏠', label: 'Nepremičnine', color: 'border-blue-500/40 text-blue-500' },
  avtonet: { icon: '🚗', label: 'Avtonet', color: 'border-amber-500/40 text-amber-500' },
  salomon: { icon: '🛍️', label: 'Salomon', color: 'border-purple-500/40 text-purple-500' },
  vinted: { icon: '👕', label: 'Vinted', color: 'border-teal-500/40 text-teal-500' },
  'mobile-de': { icon: '🇩🇪', label: 'Mobile.de', color: 'border-yellow-500/40 text-yellow-500' },
  kleinanzeigen: { icon: '🇩🇪', label: 'Kleinanzeigen', color: 'border-yellow-500/40 text-yellow-500' },
  subito: { icon: '🇮🇹', label: 'Subito', color: 'border-green-500/40 text-green-500' },
  willhaben: { icon: '🇦🇹', label: 'Willhaben', color: 'border-red-500/40 text-red-500' },
  quoka: { icon: '🇩🇪', label: 'Quoka', color: 'border-yellow-500/40 text-yellow-500' },
  'custom-rss': { icon: '📡', label: 'RSS', color: 'border-muted text-muted-foreground' },
};

export function sourceIcon(source: string): string {
  return SOURCE_META[source]?.icon ?? '📋';
}

export function sourceColor(source: string): string {
  return SOURCE_META[source]?.color ?? 'border-muted text-muted-foreground';
}

// v8.75: Time ago helper
export function timeAgo(date: string | Date): string {
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
