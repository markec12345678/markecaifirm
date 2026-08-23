'use client';

/**
 * v8.97: Shared helper functions + CATEGORIES for ai-hub modules.
 * Extracted from ai-hub-view.tsx to enable modular AI Hub components.
 */

import type { AccuracyTrendSummary, DraftStatus, DomainName } from './types';
import { cn } from '@/lib/utils';

// v7.01: Categories for AI endpoint grid
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

export function hitRateColor(rate: number): string {
  if (rate >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function responseTimeColor(ms: number): string {
  if (ms < 50) return 'text-emerald-600 dark:text-emerald-400';
  if (ms <= 200) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function hitRateBarColor(rate: number): string {
  if (rate >= 70) return 'bg-emerald-500';
  if (rate >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

export function namespaceLabel(ns: string): string {
  return ns.replace(/-brain$/, '').replace(/^./, (c) => c.toUpperCase());
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

export function trustScoreColor(score: number): string {
  if (score >= 70) {
    return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
  if (score >= 50) {
    return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
  }
  return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
}

export function signalGradeColor(grade: string): string {
  return gradeColor(grade);
}

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


export const NOTIFICATION_SEVERITY_STYLES: Record<string, string> = {
  info: 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
};

export function severityBadgeClass(severity: string): string {
  return NOTIFICATION_SEVERITY_STYLES[severity] ?? NOTIFICATION_SEVERITY_STYLES.info;
}


export const DOMAIN_LABELS: Record<DomainName, { icon: string; label: string; color: string }> = {
  profit: { icon: '🧠', label: 'Profit', color: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: '📦', label: 'Inventar', color: 'text-amber-600 dark:text-amber-400' },
  market: { icon: '📈', label: 'Trg', color: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: '🎯', label: 'Sourcing', color: 'text-purple-600 dark:text-purple-400' },
  risk: { icon: '🛡️', label: 'Tveganje', color: 'text-rose-600 dark:text-rose-400' },
  buyer: { icon: '👥', label: 'Kupci', color: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: '💶', label: 'Cene', color: 'text-lime-700 dark:text-lime-400' },
};

export const DOMAIN_DISPLAY: Array<{
  key: DomainName;
  label: string;
  icon: string;
}> = [
  { key: 'profit', label: 'Profit', icon: '💰' },
  { key: 'inventory', label: 'Inventar', icon: '📦' },
  { key: 'market', label: 'Trg', icon: '📈' },
  { key: 'sourcing', label: 'Sourcing', icon: '🎯' },
  { key: 'risk', label: 'Tveganje', icon: '🛡️' },
  { key: 'buyer', label: 'Kupci', icon: '👥' },
  { key: 'pricing', label: 'Cene', icon: '💶' },
];
