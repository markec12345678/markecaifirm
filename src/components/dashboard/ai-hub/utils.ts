/**
 * Shared helpers and constants for AI Hub modules.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. Includes the endpoint category table, endpoint
 * name categorizer, and the family of color/label helpers used across the
 * brain + automation + system cards.
 */

import type { AccuracyTrendSummary, DraftStatus } from './types';
import { cn } from '@/lib/utils';

export const CATEGORIES = [
  { id: 'all', label: 'Vsi', icon: '📋', color: 'text-primary' },
  { id: 'brain', label: 'Možgani', icon: '🧠', color: 'text-emerald-500' },
  { id: 'buyer', label: 'Kupci', icon: '👥', color: 'text-blue-400' },
  { id: 'inventory', label: 'Skladišče', icon: '📦', color: 'text-amber-400' },
  { id: 'listing', label: 'Oglasi', icon: '📝', color: 'text-purple-400' },
  { id: 'pricing', label: 'Cene', icon: '💰', color: 'text-primary' },
  { id: 'risk', label: 'Tveganje', icon: '🛡️', color: 'text-red-500' },
  { id: 'negotiation', label: 'Pogajanje', icon: '🤝', color: 'text-cyan-400' },
  { id: 'reports', label: 'Poročila', icon: '📊', color: 'text-primary' },
  { id: 'misc', label: 'Ostalo', icon: '🔧', color: 'text-muted-foreground' },
] as const;

// ===== Kategorizacija endpointov (mirror of /api/ai-list categorize) =====
export function categorize(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith('brain/') || n.split('/')[0] === 'brain') return 'brain';
  if (n.startsWith('buyer') || n.includes('customer')) return 'buyer';
  if (n.startsWith('inventory') || n.includes('stockout') || n.includes('shrinkage') || n.includes('liquidation') || n.includes('rebalancer') || n.includes('turnover') || n.includes('aging')) return 'inventory';
  if (n.startsWith('listing') || n.includes('description') || n.includes('title') || n.includes('seo') || n.includes('thumbnail') || n.includes('image') || n.includes('tag') || n.includes('content') || n.includes('ctr') || n.includes('conversion') || n.includes('engagement') || n.includes('virality') || n.includes('performance')) return 'listing';
  if (n.includes('price') || n.includes('pricing') || n.includes('margin') || n.includes('profit') || n.includes('bundle') || n.includes('cash') || n.includes('budget') || n.includes('seasonal') || n.includes('demand') || n.includes('depreciation') || n.includes('roi') || n.includes('cost')) return 'pricing';
  if (n.includes('risk') || n.includes('fraud') || n.includes('fake') || n.includes('insurance') || n.includes('hedge') || n.includes('parity') || n.includes('saturation') || n.includes('anomal')) return 'risk';
  if (n.includes('negotiation') || n.includes('negotiate') || n.includes('auction') || n.includes('sniper') || n.includes('bid') || n.includes('seller')) return 'negotiation';
  if (n.includes('report') || n.includes('summary') || n.includes('dashboard') || n.includes('forecast') || n.includes('benchmark') || n.includes('insights') || n.includes('trend') || n.includes('monthly') || n.includes('daily') || n.includes('playbook') || n.includes('automation') || n.includes('autonomous')) return 'reports';
  return 'misc';
}
export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A+':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
    case 'A':
      return 'bg-green-500/15 text-green-600 border-green-500/30 dark:text-green-400';
    case 'B':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'C':
      return 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400';
    case 'D':
      return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
    default:
      return 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-400';
  }
}

export function confidenceColor(c: string): string {
  switch (c) {
    case 'HIGH':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-zinc-500 dark:text-zinc-400';
  }
}
export function riskLevelColor(level: string): string {
  switch (level) {
    case 'CRITICAL':
      return 'bg-rose-600/20 text-rose-700 border-rose-600/40 dark:text-rose-300';
    case 'HIGH':
      return 'bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400';
    case 'MEDIUM':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'LOW':
    default:
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
}

export function gradeTextColor(grade: string | null): string {
  if (!grade) return 'text-muted-foreground';
  if (grade === 'A+' || grade === 'A') return 'text-emerald-600 dark:text-emerald-400';
  if (grade === 'B') return 'text-sky-600 dark:text-sky-400';
  if (grade === 'C') return 'text-amber-600 dark:text-amber-400';
  if (grade === 'D') return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

export function gradeTrendPill(grade: string): string {
  return cn('text-[9px] font-bold px-1.5 py-0.5 rounded border', gradeColor(grade));
}

export function trendBadgeClass(trend: AccuracyTrendSummary['trend']): string {
  switch (trend) {
    case 'IMPROVING':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    case 'STABLE':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400';
    case 'DECLINING':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
  }
}

export function trendIcon(trend: AccuracyTrendSummary['trend']): string {
  switch (trend) {
    case 'IMPROVING':
      return '↗️';
    case 'STABLE':
      return '→';
    case 'DECLINING':
      return '↘️';
    default:
      return '—';
  }
}
export function conflictSeverityColor(severity: string): string {
  switch (severity) {
    case 'HIGH':
      return 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/5';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5';
    default:
      return 'text-zinc-600 dark:text-zinc-400 border-zinc-500/30 bg-zinc-500/5';
  }
}

/**
 * v8.26: Color a 0-100 trustScore value for a pill.
 * ≥70 = emerald (high trust), ≥50 = amber (medium), <50 = red (low trust).
 */
export function trustScoreColor(score: number): string {
  if (score >= 70) {
    return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
  if (score >= 50) {
    return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
  }
  return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
}

/**
 * v8.26: Color a signal grade pill (mirrors the master brain's gradeColor but
 * with slightly tighter styling for the reasoning grid).
 */
export function signalGradeColor(grade: string): string {
  return gradeColor(grade);
}
/**
 * Color the execution rate bar:
 *  - >80% (≥0.8): green — user executes most actions in this domain
 *  - 40-80%: amber — mixed signals
 *  - <40% (<0.4): red — user ignores this domain
 */
export function rateColor(rate: number): string {
  if (rate >= 0.8) return 'bg-emerald-500';
  if (rate >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

export function rateLabel(rate: number): string {
  if (rate >= 0.8) return 'VISOKA (boost ×1.1)';
  if (rate >= 0.4) return 'SREDNJA';
  return 'NIZKA (reduce ×0.9)';
}
export function draftStatusColor(status: DraftStatus): string {
  switch (status) {
    case 'pending':
      return 'text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/5';
    case 'approved':
      return 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5';
    case 'executed':
      return 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5';
    case 'rejected':
      return 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/5';
    case 'expired':
      return 'text-zinc-500 dark:text-zinc-500 border-zinc-500/30 bg-zinc-500/5';
    default:
      return 'text-muted-foreground border-border';
  }
}

export function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'pending': return '⏳ Čaka';
    case 'approved': return '👍 Odobreno';
    case 'executed': return '✅ Izvedeno';
    case 'rejected': return '❌ Zavrnjeno';
    case 'expired': return '⌛ Poteklo';
    default: return status;
  }
}
const NOTIFICATION_SEVERITY_STYLES: Record<string, string> = {
  info: 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
};
export function severityBadgeClass(severity: string): string {
  return NOTIFICATION_SEVERITY_STYLES[severity] ?? NOTIFICATION_SEVERITY_STYLES.info;
}

export function timeAgo(isoDate: string): string {
  const d = new Date(isoDate);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'zdaj';
  if (diffMin < 60) return `${diffMin} min nazaj`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h nazaj`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} d nazaj`;
  return d.toLocaleDateString('sl-SI');
}
