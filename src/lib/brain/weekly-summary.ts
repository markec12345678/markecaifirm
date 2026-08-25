// v8.41: Weekly Summary Report — comprehensive weekly digest sent to Telegram + Email.
//
// Aggregates: this week's profit, MoM change, goal progress, top 3 trades,
// worst trade, Brain health, top actionable insights (from v8.40 Trade Insights),
// and recommendations for next week.
//
// Pure compute module pattern (consistent with v8.23 actual.ts + v8.37
// profit-timeline + v8.40 trade-insights): reads from `db` (Trade + Settings),
// calls masterBrain() (v8.22), getTradeInsights() (v8.40), calculateActualProfit()
// (v8.23). No AI/LLM SDK calls — all aggregations are deterministic.
//
// Three formatters:
//   1. `telegramMessage` — plain text (parseMode: null, no MarkdownV2 escaping
//      needed) — same pattern as v8.35 sendBrainDigest.
//   2. `emailSubject` + `emailHtml` — styled HTML for SMTP (uses v6.92 escapeHtml
//      pattern via inline escapeHtml helper).
//   3. Notification record body — uses `telegramMessage` (plain text fits both
//      Notification Center + Telegram).
//
// Used by:
//   - GET /api/ai/brain/weekly-summary → returns summary without sending.
//   - POST /api/ai/brain/weekly-summary { action: 'send' } → sends to all channels.
//   - GET /api/cron/weekly-report?key=... → sends weekly (cron schedule).

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { calculateActualProfit } from '@/lib/profit/actual';
import { getTradeInsights } from '@/lib/trades/trade-insights';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendEmail } from '@/lib/email';
import { createNotification } from '@/lib/notifications';

// --- Types -----------------------------------------------------------------

export interface WeeklySummary {
  ok: true;
  period: { start: string; end: string }; // ISO dates (Mon-Sun, last week)
  // Profit metrics
  profit: {
    thisWeek: number;
    lastWeek: number;
    momChange: number; // % change vs last week (0 if lastWeek = 0)
    total30d: number;
    goalProgress: number; // % of monthly goal
    goalMonthly: number;
    goalRealized: number;
  };
  // Trade metrics
  trades: {
    soldThisWeek: number;
    soldValue: number; // sum of sellPrice this week
    heldCount: number;
    avgHoldDays: number;
    winRate: number;
  };
  // Top trades (by profit this week)
  topTrades: Array<{ title: string; profit: number; category: string; source: string }>;
  worstTrade: { title: string; profit: number; category: string } | null;
  // Brain health
  brainHealth: {
    score: number;
    grade: string;
    riskLevel: string;
    topAction: string;
    conflictsCount: number;
  };
  // Insights highlights (from v8.40) — top 3 actionable insights
  insightsHighlights: string[];
  // Recommendations for next week
  recommendations: string[];
  // Formatted messages
  telegramMessage: string; // plain text for Telegram
  emailSubject: string;
  emailHtml: string; // HTML for email
  source: 'v8.41-weekly-summary';
}

export interface WeeklySummarySendResult {
  ok: boolean;
  sentTelegram: boolean;
  sentEmail: boolean;
  error?: string;
}

// --- Helpers ---------------------------------------------------------------

/** Round to 2 decimal places (EUR precision). */
function r2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Format EUR with sign. */
function fmtEUR(n: number, sign = false): string {
  const v = Math.round(n);
  if (sign && v > 0) return `+${v}€`;
  return `${v}€`;
}

/**
 * Get Monday-start of the week containing `date`.
 * Sunday (day=0) is shifted back 6 days to the previous Monday.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sunday, 1=Monday, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Format a date as ISO yyyy-mm-dd. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a date in Slovenian locale for display (e.g. "15. avg 2026"). */
function fmtSlDate(d: Date): string {
  return d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Slovenian weekday short labels. */
const WEEKDAY_SHORT = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];

/**
 * HTML-escape a string for safe inclusion in email HTML body.
 * Same pattern as v6.92 formatAlertEmail escapeHtml.
 */
function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Per-trade profit formula consistent with v8.23 actual.ts + v8.37 profit-timeline
 * + v8.40 trade-insights: profit = sellPrice - sellFees - buyPrice - buyFees.
 */
function profitOf(t: {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
}): number {
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  const buyFees = t.buyFees ?? 0;
  return sellPrice - sellFees - t.buyPrice - buyFees;
}

/** Compute hold days = floor((sellDate - buyDate) / 86_400_000). 0 if invalid. */
function holdDaysOf(t: { buyDate: Date | string; sellDate: Date | string | null }): number {
  if (!t.sellDate) return 0;
  const buy = new Date(t.buyDate).getTime();
  const sell = new Date(t.sellDate).getTime();
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || sell < buy) return 0;
  return Math.floor((sell - buy) / 86_400_000);
}

// --- Main compute ----------------------------------------------------------

/**
 * Generate comprehensive weekly summary.
 *
 * Period: last completed week (Mon-Sun). If today is Wednesday, the report
 * covers the week that ended on the previous Sunday (7-13 days ago).
 * Edge case: if today is Monday, the report covers the week that just ended
 * yesterday (1-7 days ago).
 */
export async function generateWeeklySummary(): Promise<WeeklySummary> {
  const now = new Date();

  // 1. Compute date range — last completed week (Mon → Sun)
  const thisWeekStart = getWeekStart(now); // Monday of current week
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1); // Sunday 23:59:59
  const lastWeekStart = getWeekStart(lastWeekEnd); // Monday of last week
  // Previous week (for MoM comparison)
  const prevWeekEnd = new Date(lastWeekStart.getTime() - 1);
  const prevWeekStart = getWeekStart(prevWeekEnd);

  const periodStart = lastWeekStart;
  const periodEnd = lastWeekEnd;

  // 2. Fetch sold trades in this week (last completed week)
  const soldThisWeekRaw = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: periodStart, lte: periodEnd, not: null },
    },
    select: {
      id: true,
      title: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
      buyLocation: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
    },
    orderBy: { sellDate: 'desc' },
  });

  type SoldTrade = (typeof soldThisWeekRaw)[number] & { profit: number; holdDays: number };
  const soldThisWeek: SoldTrade[] = soldThisWeekRaw.map((t) => ({
    ...t,
    profit: profitOf(t),
    holdDays: holdDaysOf(t),
  }));

  const soldCount = soldThisWeek.length;
  const thisWeekProfit = soldThisWeek.reduce((s, t) => s + t.profit, 0);
  const thisWeekRevenue = soldThisWeek.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
  const profitableCount = soldThisWeek.filter((t) => t.profit > 0).length;
  const winRate = soldCount > 0 ? r2((profitableCount / soldCount) * 100) : 0;
  const avgHoldDays =
    soldCount > 0 ? r2(soldThisWeek.reduce((s, t) => s + t.holdDays, 0) / soldCount) : 0;

  // 3. Last week's sold trades (for MoM comparison vs previous week)
  //    Note: "lastWeek" here = previous week relative to the report week.
  //    So we compare soldThisWeek (last completed week) vs soldPrevWeek (the week before that).
  const soldPrevWeekRaw = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: prevWeekStart, lte: prevWeekEnd, not: null },
    },
    select: {
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
    },
  });
  const prevWeekProfit = soldPrevWeekRaw.reduce((s, t) => s + profitOf(t), 0);

  // MoM change (%): if prevWeekProfit = 0, use 0 (can't compute % of 0)
  let momChange = 0;
  if (prevWeekProfit !== 0) {
    momChange = Math.round(((thisWeekProfit - prevWeekProfit) / Math.abs(prevWeekProfit)) * 100);
  } else if (thisWeekProfit > 0) {
    momChange = 100; // grew from 0 to positive
  } else if (thisWeekProfit < 0) {
    momChange = -100;
  }

  // 4. 30d actual profit (ground truth)
  const actual30d = await calculateActualProfit(30);

  // 5. Goal progress — fetch from goal-tracker logic (inline replication to
  //    avoid circular import with goal-tracker route). Simple: compute realized
  //    profit this month + read monthlyGoal from Settings.
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      monthlyProfitGoal: true,
      telegramEnabled: true,
      telegramBotToken: true,
      telegramChatId: true,
      emailEnabled: true,
      emailSmtpHost: true,
      emailSmtpPort: true,
      emailSmtpUser: true,
      emailSmtpPassword: true,
      emailFrom: true,
      emailTo: true,
    },
  });

  const goalMonthly = settings?.monthlyProfitGoal ?? 0;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const soldThisMonthRaw = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: monthStart, not: null },
    },
    select: {
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
    },
  });
  const goalRealized = Math.round(
    soldThisMonthRaw.reduce((s, t) => s + profitOf(t), 0),
  );
  const goalProgress = goalMonthly > 0 ? Math.round((goalRealized / goalMonthly) * 100) : 0;

  // 6. Top 3 trades by profit this week
  const topTrades = [...soldThisWeek]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 3)
    .map((t) => ({
      title: t.title,
      profit: r2(t.profit),
      category: t.category?.trim() || 'brez kategorije',
      source: t.buyLocation?.trim() || 'Neznano',
    }));

  // 7. Worst trade this week (only if there's at least one sold trade)
  const worstTradeRaw = soldThisWeek.length > 0
    ? soldThisWeek.reduce((worst, t) => (t.profit < worst.profit ? t : worst), soldThisWeek[0])
    : null;
  const worstTrade = worstTradeRaw
    ? {
        title: worstTradeRaw.title,
        profit: r2(worstTradeRaw.profit),
        category: worstTradeRaw.category?.trim() || 'brez kategorije',
      }
    : null;

  // 8. Held count
  const heldCount = await db.trade.count({ where: { status: 'held' } });

  // 9. Brain health — call masterBrain() (v8.22). Wrap in try/catch — Brain is
  //    a complex dependency that may fail; the weekly summary should still
  //    be generated with a degraded brainHealth object.
  let brainHealth: WeeklySummary['brainHealth'];
  let topActionText = '';
  try {
    const { masterBrain } = await import('./master');
    const master = await masterBrain();
    brainHealth = {
      score: Math.round(master.overallHealth.score),
      grade: master.overallHealth.grade,
      riskLevel: master.overallHealth.riskLevel,
      topAction: master.topActions[0]?.action ?? '—',
      conflictsCount: master.conflicts.length,
    };
    topActionText = master.topActions[0]?.action ?? '';
  } catch (err: any) {
    logger.warn('generateWeeklySummary', 'masterBrain failed (non-critical)', err);
    brainHealth = {
      score: 0,
      grade: 'F',
      riskLevel: 'HIGH',
      topAction: '—',
      conflictsCount: 0,
    };
  }

  // 10. Trade Insights (v8.40) — top 3 actionable insights
  let insightsHighlights: string[] = [];
  try {
    const insights = await getTradeInsights(365);
    insightsHighlights = insights.actionableInsights.slice(0, 3);
  } catch (err: any) {
    logger.warn('generateWeeklySummary', 'getTradeInsights failed (non-critical)', err);
    insightsHighlights = [];
  }

  // 11. Recommendations for next week (Slovenian). Generated from this week's
  //     metrics + insights + Brain health. Always 2-4 items.
  const recommendations: string[] = [];

  if (soldCount === 0) {
    recommendations.push('💤 Ni prodaj ta teden — pospeši objavo oglasov in pregledaj Flip Status za zastarele item-e.');
  } else if (thisWeekProfit > 0 && winRate >= 80) {
    recommendations.push(`🚀 Odličen teden! ${soldCount} prodaj z ${winRate}% win rate. Povečaj volume v kategorijah z najvišjim ROI.`);
  } else if (thisWeekProfit > 0) {
    recommendations.push(`✅ Pozitiven teden (+${Math.round(thisWeekProfit)}€). Fokusiraj se na kategorije z višjim ROI za večji dobiček.`);
  } else {
    recommendations.push(`❌ Negativen teden (${Math.round(thisWeekProfit)}€). Preverjaj Sold Comps pred nakupom — mogoče previč plačuješ.`);
  }

  if (momChange > 20) {
    recommendations.push(`📈 MoM rast ${momChange}% — trend je pozitiven, ohrani trenutno strategijo.`);
  } else if (momChange < -20) {
    recommendations.push(`📉 MoM padec ${Math.abs(momChange)}% — preglej pricing in buy pristop.`);
  }

  if (goalMonthly > 0 && goalProgress < 75) {
    const remaining = Math.max(0, goalMonthly - goalRealized);
    recommendations.push(`🎯 Mesečni cilj: ${goalRealized}€/${goalMonthly}€ (${goalProgress}%). Še ${remaining}€ do cilja.`);
  } else if (goalMonthly > 0 && goalProgress >= 100) {
    recommendations.push(`🎉 Mesečni cilj dosežen! (${goalRealized}€/${goalMonthly}€, ${goalProgress}%). Premagaj cilj za dodatni dobiček.`);
  }

  if (heldCount > 3) {
    recommendations.push(`📦 ${heldCount} item-ov v inventarju — preveri Flip Status za zastarele in znižaj cene če potreben.`);
  }

  if (topActionText) {
    recommendations.push(`🧠 Brain akcija: ${topActionText.slice(0, 80)}${topActionText.length > 80 ? '...' : ''}`);
  }

  // Cap at 5 recommendations
  const finalRecommendations = recommendations.slice(0, 5);

  // 12. Format Telegram message (plain text — no Markdown)
  const periodLabel = `${fmtSlDate(periodStart)} – ${fmtSlDate(periodEnd)}`;
  const telegramMessage = formatTelegramMessage({
    periodLabel,
    thisWeekProfit,
    lastWeekProfit: prevWeekProfit,
    momChange,
    total30d: actual30d.totalProfitEUR,
    goalMonthly,
    goalRealized,
    goalProgress,
    soldCount,
    soldValue: thisWeekRevenue,
    heldCount,
    avgHoldDays,
    winRate,
    topTrades,
    worstTrade,
    brainHealth,
    insightsHighlights,
    finalRecommendations,
  });

  // 13. Format email HTML + subject
  const emailSubject = `📋 Tedenski povzetek — ${periodLabel} (${fmtEUR(thisWeekProfit, true)})`;
  const emailHtml = formatEmailHtml({
    periodLabel,
    thisWeekProfit,
    lastWeekProfit: prevWeekProfit,
    momChange,
    total30d: actual30d.totalProfitEUR,
    goalMonthly,
    goalRealized,
    goalProgress,
    soldCount,
    soldValue: thisWeekRevenue,
    heldCount,
    avgHoldDays,
    winRate,
    topTrades,
    worstTrade,
    brainHealth,
    insightsHighlights,
    finalRecommendations,
  });

  return {
    ok: true,
    period: { start: isoDate(periodStart), end: isoDate(periodEnd) },
    profit: {
      thisWeek: r2(thisWeekProfit),
      lastWeek: r2(prevWeekProfit),
      momChange,
      total30d: actual30d.totalProfitEUR,
      goalProgress,
      goalMonthly,
      goalRealized,
    },
    trades: {
      soldThisWeek: soldCount,
      soldValue: r2(thisWeekRevenue),
      heldCount,
      avgHoldDays,
      winRate,
    },
    topTrades,
    worstTrade,
    brainHealth,
    insightsHighlights,
    recommendations: finalRecommendations,
    telegramMessage,
    emailSubject,
    emailHtml,
    source: 'v8.41-weekly-summary',
  };
}

// --- Message formatters -----------------------------------------------------

interface FormatInput {
  periodLabel: string;
  thisWeekProfit: number;
  lastWeekProfit: number;
  momChange: number;
  total30d: number;
  goalMonthly: number;
  goalRealized: number;
  goalProgress: number;
  soldCount: number;
  soldValue: number;
  heldCount: number;
  avgHoldDays: number;
  winRate: number;
  topTrades: Array<{ title: string; profit: number; category: string; source: string }>;
  worstTrade: { title: string; profit: number; category: string } | null;
  brainHealth: WeeklySummary['brainHealth'];
  insightsHighlights: string[];
  finalRecommendations: string[];
}

/**
 * Format weekly summary as PLAIN TEXT for Telegram (parseMode: null).
 * Same pattern as v8.35 formatBrainDigest — no Markdown escaping needed.
 */
function formatTelegramMessage(input: FormatInput): string {
  const lines: string[] = [];
  lines.push('📋 TEDENSKI POVZETEK');
  lines.push(`Datum: ${input.periodLabel}`);
  lines.push('');

  // Profit
  const profitSign = input.thisWeekProfit >= 0 ? '+' : '';
  lines.push(`💰 DOBIČEK: ${profitSign}${Math.round(input.thisWeekProfit)}€`);
  if (input.momChange !== 0) {
    const arrow = input.momChange > 0 ? '↑' : '↓';
    lines.push(`   ${arrow} ${Math.abs(input.momChange)}% vs prejšnji teden (${profitSign}${Math.round(input.thisWeekProfit)}€ vs ${Math.round(input.lastWeekProfit)}€)`);
  }
  lines.push(`   30d profit: ${Math.round(input.total30d)}€`);
  lines.push('');

  // Goal
  if (input.goalMonthly > 0) {
    lines.push(`🎯 CILJ: ${input.goalRealized}€ / ${input.goalMonthly}€ (${input.goalProgress}%)`);
    lines.push('');
  }

  // Trades
  lines.push(`📦 TRADES: ${input.soldCount} prodanih · ${Math.round(input.soldValue)}€ promet · ${input.heldCount} v inventarju`);
  lines.push(`   Avg hold: ${input.avgHoldDays} dni · Win rate: ${input.winRate}%`);
  lines.push('');

  // Top trades
  if (input.topTrades.length > 0) {
    lines.push('🏆 TOP 3 TRADES:');
    input.topTrades.forEach((t, i) => {
      const sign = t.profit >= 0 ? '+' : '';
      lines.push(`${i + 1}. ${t.title.slice(0, 50)} — ${sign}${t.profit}€ [${t.category} · ${t.source}]`);
    });
    lines.push('');
  }

  // Worst trade
  if (input.worstTrade && input.worstTrade.profit < 0) {
    lines.push(`❌ NAJSLABŠI: ${input.worstTrade.title.slice(0, 50)} — ${input.worstTrade.profit}€ [${input.worstTrade.category}]`);
    lines.push('');
  }

  // Brain health
  lines.push(`🧠 BRAIN: ${input.brainHealth.score}/100 (${input.brainHealth.grade}) — ${input.brainHealth.riskLevel}`);
  if (input.brainHealth.conflictsCount > 0) {
    lines.push(`   ⚠️ ${input.brainHealth.conflictsCount} konfliktov zaznanih`);
  }
  lines.push('');

  // Insights highlights
  if (input.insightsHighlights.length > 0) {
    lines.push('💡 TOP 3 INSIGHTS (v8.40):');
    input.insightsHighlights.forEach((insight, i) => {
      // Truncate to ~80 chars for Telegram readability
      const truncated = insight.length > 80 ? insight.slice(0, 80) + '...' : insight;
      lines.push(`${i + 1}. ${truncated}`);
    });
    lines.push('');
  }

  // Recommendations
  if (input.finalRecommendations.length > 0) {
    lines.push('🚀 PRIPOROČILA ZA NASLEDNJI TEDEN:');
    input.finalRecommendations.forEach((rec, i) => {
      const truncated = rec.length > 100 ? rec.slice(0, 100) + '...' : rec;
      lines.push(`${i + 1}. ${truncated}`);
    });
  }

  return lines.join('\n');
}

/**
 * Format weekly summary as styled HTML for email.
 * Same dark-theme style as v6.92 formatAlertEmail.
 */
function formatEmailHtml(input: FormatInput): string {
  const profitColor = input.thisWeekProfit >= 0 ? '#4ade80' : '#ef4444';
  const profitSign = input.thisWeekProfit >= 0 ? '+' : '';
  const momColor = input.momChange > 0 ? '#4ade80' : input.momChange < 0 ? '#ef4444' : '#6b7280';
  const momArrow = input.momChange > 0 ? '↑' : input.momChange < 0 ? '↓' : '→';

  const topTradesRows = input.topTrades
    .map((t, i) => {
      const sign = t.profit >= 0 ? '+' : '';
      const color = t.profit >= 0 ? '#4ade80' : '#ef4444';
      return `<tr>
        <td style="padding: 6px 8px; color: #6b7280;">${i + 1}.</td>
        <td style="padding: 6px 8px; color: #d4d4d4;">${escapeHtml(t.title.slice(0, 60))}</td>
        <td style="padding: 6px 8px; color: #6b7280; font-size: 11px;">${escapeHtml(t.category)} · ${escapeHtml(t.source)}</td>
        <td style="padding: 6px 8px; color: ${color}; font-weight: bold; text-align: right;">${sign}${t.profit}€</td>
      </tr>`;
    })
    .join('');

  const worstTradeRow = input.worstTrade && input.worstTrade.profit < 0
    ? `<tr>
        <td style="padding: 6px 8px; color: #ef4444;">❌</td>
        <td style="padding: 6px 8px; color: #d4d4d4;">${escapeHtml(input.worstTrade.title.slice(0, 60))}</td>
        <td style="padding: 6px 8px; color: #6b7280; font-size: 11px;">${escapeHtml(input.worstTrade.category)}</td>
        <td style="padding: 6px 8px; color: #ef4444; font-weight: bold; text-align: right;">${input.worstTrade.profit}€</td>
      </tr>`
    : '';

  const insightsItems = input.insightsHighlights
    .map((insight) => `<li style="margin-bottom: 6px; color: #d4d4d4;">${escapeHtml(insight)}</li>`)
    .join('');

  const recItems = input.finalRecommendations
    .map((rec) => `<li style="margin-bottom: 6px; color: #d4d4d4;">${escapeHtml(rec)}</li>`)
    .join('');

  const goalSection = input.goalMonthly > 0
    ? `<tr>
        <td style="padding: 4px 0; color: #6b7280;">🎯 Mesečni cilj:</td>
        <td style="color: #4ade80; font-weight: bold;">${input.goalRealized}€ / ${input.goalMonthly}€ (${input.goalProgress}%)</td>
      </tr>`
    : '';

  return `
    <div style="font-family: monospace; max-width: 640px; margin: 0 auto; background: #0a0e0a; color: #d4d4d4; padding: 20px; border-radius: 8px;">
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 8px; color: #fbbf24;">
        📋 TEDENSKI POVZETEK
      </div>
      <div style="color: #6b7280; margin-bottom: 16px;">${escapeHtml(input.periodLabel)}</div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">💰 Dobiček ta teden:</td>
          <td style="color: ${profitColor}; font-weight: bold; font-size: 16px;">${profitSign}${Math.round(input.thisWeekProfit)}€</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">${momArrow} MoM sprememba:</td>
          <td style="color: ${momColor}; font-weight: bold;">${input.momChange > 0 ? '+' : ''}${input.momChange}%</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">📅 Profit 30 dni:</td>
          <td style="color: #4ade80;">${Math.round(input.total30d)}€</td>
        </tr>
        ${goalSection}
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">📦 Prodano ta teden:</td>
          <td style="color: #d4d4d4;">${input.soldCount} · ${Math.round(input.soldValue)}€ promet · ${input.heldCount} v inventarju</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">⏱️ Avg hold · Win rate:</td>
          <td style="color: #d4d4d4;">${input.avgHoldDays} dni · ${input.winRate}%</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">🧠 Brain health:</td>
          <td style="color: #4ade80; font-weight: bold;">${input.brainHealth.score}/100 (${input.brainHealth.grade}) — ${escapeHtml(input.brainHealth.riskLevel)}</td>
        </tr>
      </table>

      ${topTradesRows || worstTradeRow ? `
      <div style="margin-bottom: 16px;">
        <div style="color: #fbbf24; font-weight: bold; margin-bottom: 8px;">🏆 TOP TRADES</div>
        <table style="width: 100%; border-collapse: collapse; background: #11140f; border-radius: 4px;">
          ${topTradesRows}
          ${worstTradeRow}
        </table>
      </div>
      ` : ''}

      ${insightsItems ? `
      <div style="margin-bottom: 16px;">
        <div style="color: #fbbf24; font-weight: bold; margin-bottom: 8px;">💡 TOP 3 INSIGHTS (v8.40)</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px;">
          ${insightsItems}
        </ul>
      </div>
      ` : ''}

      ${recItems ? `
      <div style="margin-bottom: 16px;">
        <div style="color: #fbbf24; font-weight: bold; margin-bottom: 8px;">🚀 PRIPOROČILA ZA NASLEDNJI TEDEN</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px;">
          ${recItems}
        </ul>
      </div>
      ` : ''}

      <p style="margin-top: 20px; font-size: 11px; color: #6b7280;">Markec AI Firm v8.41 — Weekly Summary Report</p>
    </div>
  `;
}

// --- Sender ----------------------------------------------------------------

/**
 * Send weekly summary to Telegram + Email + Notification Center.
 *
 * Behavior:
 *   1. Generate summary (always — even if no channels configured).
 *   2. Create Notification record (always — central audit trail v8.38).
 *   3. Send to Telegram if configured (best-effort, non-blocking).
 *   4. Send to Email if configured (best-effort, non-blocking).
 *
 * Returns: { ok, sentTelegram, sentEmail, error? }.
 * `ok=true` even if no channel configured — summary was still generated +
 * Notification recorded.
 */
export async function sendWeeklySummary(): Promise<WeeklySummarySendResult> {
  let summary: WeeklySummary;
  try {
    summary = await generateWeeklySummary();
  } catch (err: any) {
    logger.error('sendWeeklySummary', 'generateWeeklySummary failed', err);
    // Record the failure as a Notification (severity=error)
    try {
      await createNotification({
        type: 'system',
        title: '📋 Tedenski povzetek — napaka',
        body: `Generiranje povzetka ni uspelo: ${err?.message ?? 'unknown'}`,
        severity: 'error',
        source: 'system',
        metadata: { error: err?.message ?? 'unknown' },
      });
    } catch (notifErr: any) {
      logger.warn('sendWeeklySummary', 'createNotification (error) failed (non-critical)', notifErr);
    }
    return {
      ok: false,
      sentTelegram: false,
      sentEmail: false,
      error: err?.message ?? 'Generiranje ni uspelo',
    };
  }

  // 1. Create Notification record (always — even if no channels configured)
  const severity = summary.profit.thisWeek >= 0 ? 'success' : 'warning';
  try {
    await createNotification({
      type: 'system',
      title: `📋 Tedenski povzetek — ${summary.profit.thisWeek >= 0 ? '+' : ''}${Math.round(summary.profit.thisWeek)}€`,
      body: summary.telegramMessage,
      severity,
      source: 'system',
      snapshotDate: new Date().toISOString().split('T')[0],
      metadata: {
        periodStart: summary.period.start,
        periodEnd: summary.period.end,
        thisWeekProfit: summary.profit.thisWeek,
        lastWeekProfit: summary.profit.lastWeek,
        momChange: summary.profit.momChange,
        goalProgress: summary.profit.goalProgress,
        soldCount: summary.trades.soldThisWeek,
        winRate: summary.trades.winRate,
        brainHealthScore: summary.brainHealth.score,
        brainHealthGrade: summary.brainHealth.grade,
        topTradesCount: summary.topTrades.length,
        insightsCount: summary.insightsHighlights.length,
        recommendationsCount: summary.recommendations.length,
      },
    });
  } catch (notifErr: any) {
    logger.warn('sendWeeklySummary', 'createNotification failed (non-critical)', notifErr);
  }

  // 2. Load channel configs from Settings
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      telegramEnabled: true,
      telegramBotToken: true,
      telegramChatId: true,
      emailEnabled: true,
      emailSmtpHost: true,
      emailSmtpPort: true,
      emailSmtpUser: true,
      emailSmtpPassword: true,
      emailFrom: true,
      emailTo: true,
    },
  });

  let sentTelegram = false;
  let sentEmail = false;

  // 3. Telegram send (best-effort)
  if (
    settings?.telegramEnabled &&
    settings.telegramBotToken &&
    settings.telegramChatId
  ) {
    try {
      const result = await sendTelegramMessage(
        { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
        summary.telegramMessage,
        { parseMode: null }, // plain text — no Markdown escaping
      );
      if (result.ok) {
        sentTelegram = true;
        logger.info('sendWeeklySummary', 'Telegram sent');
      } else {
        logger.warn('sendWeeklySummary', `Telegram send failed: ${result.error}`);
      }
    } catch (err: any) {
      logger.warn('sendWeeklySummary', `Telegram send failed (non-critical): ${err?.message}`);
    }
  }

  // 4. Email send (best-effort)
  if (
    settings?.emailEnabled &&
    settings.emailSmtpHost &&
    settings.emailTo
  ) {
    try {
      const result = await sendEmail(
        {
          smtpHost: settings.emailSmtpHost,
          smtpPort: settings.emailSmtpPort || 587,
          smtpUser: settings.emailSmtpUser,
          smtpPassword: settings.emailSmtpPassword,
          from: settings.emailFrom,
          to: settings.emailTo,
        },
        summary.emailSubject,
        summary.emailHtml,
      );
      if (result.ok) {
        sentEmail = true;
        logger.info('sendWeeklySummary', 'Email sent');
      } else {
        logger.warn('sendWeeklySummary', `Email send failed: ${result.error}`);
      }
    } catch (err: any) {
      logger.warn('sendWeeklySummary', `Email send failed (non-critical): ${err?.message}`);
    }
  }

  return { ok: true, sentTelegram, sentEmail };
}
