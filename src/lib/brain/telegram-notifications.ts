// v8.35: Telegram Brain Notifications — sends Master Brain digests + auto-pilot
// alerts to Telegram. Connects the Brain system (v8.22+) to the existing
// Telegram bot (src/lib/telegram.ts).
//
// 3 notification types:
//   1. DAILY DIGEST — TOP 5 actions + overallHealth + oneLineSummary (sent by
//      cron job /api/cron/brain-digest, scheduled daily @ 08:00).
//   2. AUTO-PILOT ALERT — when an action is auto-executed by runSafeAutoPilot().
//      Includes action text, domain, signal, expected uplift, confidence, reason.
//   3. ANOMALY ALERT — when auto-pilot is suspended due to anomaly detection
//      (>8 auto-executions in 1 hour — possible loop).
//
// All 3 are NON-CRITICAL: if Telegram is not configured or send fails, the
// underlying Brain system continues working. The auto-pilot.ts caller wraps
// every sendXxx() call in try/catch so a Telegram failure never affects the
// auto-pilot logic.
//
// Messages are sent as PLAIN TEXT (parseMode: null) — no Markdown escaping
// needed. Asterisks and special characters in the message body are displayed
// literally, not parsed as formatting. This is intentional: Telegram MarkdownV2
// requires escaping `. - ( ) !` etc, and our messages contain many of those
// (especially EUR amounts like "30d: 1234€" and dates like "2026-08-28 08:00").
// Plain text avoids 100% of those edge cases.

import { sendTelegramMessage } from '@/lib/telegram';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { MasterBrainResult } from './master';
import type { ActionDraft } from './draft-queue';

// --- Types -----------------------------------------------------------------

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface NotificationResult {
  ok: boolean;
  sent: boolean;
  reason?: string;
}

// --- Config loader ---------------------------------------------------------

/**
 * Load Telegram config from Settings (singleton row).
 * Returns null if Telegram is not configured or disabled — caller should
 * silently skip the notification in that case.
 *
 * Uses the standard `db` (cached PrismaClient) — the Settings model + Telegram
 * fields have been stable since v1.0, so no Turbopack stale-client issue.
 */
export async function loadTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const settings = await db.settings.findUnique({ where: { id: 'singleton' } });
    if (!settings) return null;
    if (!settings.telegramEnabled) return null;
    if (!settings.telegramBotToken || !settings.telegramChatId) return null;
    return {
      enabled: settings.telegramEnabled,
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
    };
  } catch (err: any) {
    logger.error('loadTelegramConfig', 'failed to load Telegram config', err);
    return null;
  }
}

// --- Message formatters ----------------------------------------------------

/**
 * Format Master Brain daily digest as PLAIN TEXT (no Markdown).
 *
 * Returns a multi-line message with:
 *   - Header: 🧠 MASTER BRAIN — DNEVNI PREGLED
 *   - Health score + grade + risk level
 *   - Strategy projections: 30d / 90d / 12m profit EUR
 *   - TOP 5 actions (rank, domain, action truncated, uplift, confidence)
 *   - One-line summary
 *   - Conflicts count (if any)
 *
 * Sent as plain text (parseMode: null) to avoid MarkdownV2 escaping issues
 * with EUR amounts (1234€), dates (2026-08-28), and parentheses.
 */
export function formatBrainDigest(masterResult: MasterBrainResult): string {
  const lines: string[] = [];
  lines.push('🧠 MASTER BRAIN — DNEVNI PREGLED');
  lines.push('');
  lines.push(
    `📊 Health: ${masterResult.overallHealth.score.toFixed(0)}/100 (${masterResult.overallHealth.grade}) — ${masterResult.overallHealth.riskLevel}`,
  );
  lines.push(
    `💰 Strategija: 30d: ${masterResult.strategy.projection30d.profitEUR.toFixed(0)}€ · 90d: ${masterResult.strategy.projection90d.profitEUR.toFixed(0)}€ · 12m: ${masterResult.strategy.projection12m.profitEUR.toFixed(0)}€`,
  );
  lines.push('');
  lines.push('🎯 TOP 5 AKCIJ:');
  masterResult.topActions.forEach((action, i) => {
    const truncatedAction =
      action.action.length > 60 ? action.action.slice(0, 60) + '...' : action.action;
    lines.push(`${i + 1}. [${action.domain}] ${truncatedAction}`);
    lines.push(`   +${action.expectedUpliftEUR}€/mo (${action.confidence})`);
  });
  lines.push('');
  lines.push(`📝 Povzetek: ${masterResult.oneLineSummary}`);
  if (masterResult.conflicts.length > 0) {
    lines.push('');
    lines.push(`⚠️ Konflikti: ${masterResult.conflicts.length} zaznanih`);
  }
  return lines.join('\n');
}

/**
 * Format auto-pilot execution alert as PLAIN TEXT.
 */
export function formatAutoPilotAlert(draft: ActionDraft, reason: string): string {
  return [
    '🤖 AUTO-PILOT IZVEDEN',
    '',
    `Akcija: ${draft.action}`,
    `Domena: ${draft.domain}`,
    `Signal: ${draft.signal}`,
    `Pričakovan uplift: +${draft.expectedUpliftEUR}€/mo`,
    `Confidence: ${draft.confidence}`,
    `Razlog: ${reason}`,
    '',
    '↩️ Razveljavi v dashboardu če ni pravilno.',
  ].join('\n');
}

/**
 * Format anomaly alert as PLAIN TEXT.
 */
export function formatAnomalyAlert(reason: string): string {
  return [
    '⚠️ ANOMALIJA ZAZNANA',
    '',
    `Razlog: ${reason}`,
    '',
    '🤖 Auto-pilot je bil SUSPENDIRAN.',
    'Preglej zgodovino in razveljavi suspenzijo v dashboardu.',
  ].join('\n');
}

// --- Senders ---------------------------------------------------------------

/**
 * Send daily Master Brain digest to Telegram.
 * Called by cron job. If Telegram not configured or disabled, silently skips.
 */
export async function sendBrainDigest(): Promise<NotificationResult> {
  // 1. Load Telegram config
  const config = await loadTelegramConfig();
  if (!config) {
    return { ok: true, sent: false, reason: 'Telegram not configured or disabled' };
  }

  // 2. Generate Master Brain result (fresh — no cache for digest)
  let masterResult: MasterBrainResult;
  try {
    const { masterBrain } = await import('./master');
    masterResult = await masterBrain();
  } catch (err: any) {
    logger.error('sendBrainDigest', 'failed to compute Master Brain', err);
    return { ok: false, sent: false, reason: `Master Brain failed: ${err?.message ?? 'unknown'}` };
  }

  // 3. Format message (plain text)
  const message = formatBrainDigest(masterResult);

  // 4. Send — parseMode: null (plain text, no Markdown escaping needed)
  try {
    const result = await sendTelegramMessage(
      { botToken: config.botToken, chatId: config.chatId },
      message,
      { parseMode: null },
    );
    if (result.ok) {
      logger.info('sendBrainDigest', `digest sent to Telegram (messageId=${result.messageId ?? 'n/a'})`);
      return { ok: true, sent: true };
    }
    logger.error('sendBrainDigest', `Telegram send failed: ${result.error}`);
    return { ok: false, sent: false, reason: result.error ?? 'Send failed' };
  } catch (err: any) {
    logger.error('sendBrainDigest', 'failed to send Telegram digest', err);
    return { ok: false, sent: false, reason: err?.message ?? 'Send failed' };
  }
}

/**
 * Send auto-pilot execution alert to Telegram.
 * Called when auto-pilot executes a draft.
 *
 * NON-CRITICAL: if Telegram is not configured or send fails, returns silently.
 * The auto-pilot logic in runSafeAutoPilot() wraps every call in try/catch,
 * so a Telegram failure never affects the auto-pilot execution itself.
 */
export async function sendAutoPilotAlert(
  draft: ActionDraft,
  reason: string,
): Promise<NotificationResult> {
  const config = await loadTelegramConfig();
  if (!config) {
    return { ok: true, sent: false, reason: 'Telegram not configured or disabled' };
  }

  const message = formatAutoPilotAlert(draft, reason);

  try {
    const result = await sendTelegramMessage(
      { botToken: config.botToken, chatId: config.chatId },
      message,
      { parseMode: null },
    );
    if (result.ok) {
      logger.info('sendAutoPilotAlert', `auto-pilot alert sent for draft ${draft.id}`);
      return { ok: true, sent: true };
    }
    logger.warn('sendAutoPilotAlert', `Telegram send failed: ${result.error}`);
    return { ok: false, sent: false, reason: result.error ?? 'Send failed' };
  } catch (err: any) {
    logger.error('sendAutoPilotAlert', 'failed to send Telegram alert', err);
    return { ok: false, sent: false, reason: err?.message ?? 'Send failed' };
  }
}

/**
 * Send anomaly alert to Telegram.
 * Called when auto-pilot is suspended due to anomaly detection.
 *
 * NON-CRITICAL: same try/catch pattern as sendAutoPilotAlert.
 */
export async function sendAnomalyAlert(reason: string): Promise<NotificationResult> {
  const config = await loadTelegramConfig();
  if (!config) {
    return { ok: true, sent: false, reason: 'Telegram not configured or disabled' };
  }

  const message = formatAnomalyAlert(reason);

  try {
    const result = await sendTelegramMessage(
      { botToken: config.botToken, chatId: config.chatId },
      message,
      { parseMode: null },
    );
    if (result.ok) {
      logger.info('sendAnomalyAlert', 'anomaly alert sent to Telegram');
      return { ok: true, sent: true };
    }
    logger.warn('sendAnomalyAlert', `Telegram send failed: ${result.error}`);
    return { ok: false, sent: false, reason: result.error ?? 'Send failed' };
  } catch (err: any) {
    logger.error('sendAnomalyAlert', 'failed to send Telegram anomaly alert', err);
    return { ok: false, sent: false, reason: err?.message ?? 'Send failed' };
  }
}
