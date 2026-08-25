// v9.00: Shared helpers for listings modules.
// Extracted from listings-view.tsx.

export function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `pred ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `pred ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `pred ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `pred ${days}d`;
  return d.toLocaleDateString('sl-SI');
}
