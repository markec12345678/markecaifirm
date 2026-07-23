/**
 * Telegram Bot API notifier — sends Markdown-formatted alerts with inline buttons.
 *
 * v1.1 additions:
 * - Inline URL buttons (Odpri oglas, Odpri dashboard)
 * - Inline callback buttons (Arhiviraj, Označi kot prevaro) — requires webhook setup
 * - answerCallbackQuery for webhook callbacks
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface InlineButton {
  text: string;
  url?: string;       // URL button — opens a link
  callbackData?: string; // Callback button — sends callback to webhook
}

export interface SendMessageOptions {
  inlineButtons?: InlineButton[][]; // rows of buttons
  disablePreview?: boolean;
}

export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string,
  options?: SendMessageOptions
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!cfg.botToken || !cfg.chatId) {
    return { ok: false, error: 'Manjka bot token ali chat ID' };
  }
  try {
    const body: any = {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: options?.disablePreview ?? false,
    };
    if (options?.inlineButtons && options.inlineButtons.length > 0) {
      body.reply_markup = {
        inline_keyboard: options.inlineButtons.map(row =>
          row.map(b => {
            const btn: any = { text: b.text };
            if (b.url) btn.url = b.url;
            if (b.callbackData) btn.callback_data = b.callbackData;
            return btn;
          })
        ),
      };
    }
    const res = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    if (!data.ok) {
      return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error' };
  }
}

export async function testTelegram(cfg: TelegramConfig): Promise<{ ok: boolean; message: string }> {
  const result = await sendTelegramMessage(
    cfg,
    `✅ *Test* — Markec AI Firm monitor je uspešno povezan s Telegramom.\n\nv1.1: inline tipke, analiza slik, heartbeat.`,
    {
      inlineButtons: [[
        { text: '📊 Odpri dashboard', url: 'http://localhost:3000' },
      ]],
    }
  );
  return result.ok
    ? { ok: true, message: 'Testno sporočilo poslano. Preverite Telegram.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

/** Answer a callback query (acknowledge button press). Used by webhook. */
export async function answerCallbackQuery(
  cfg: TelegramConfig,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  if (!cfg.botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? 'OK',
        show_alert: false,
      }),
    });
  } catch {
    /* ignore */
  }
}

/** Edit message text (used after callback button press to update the message). */
export async function editMessageText(
  cfg: TelegramConfig,
  messageId: number,
  text: string,
  inlineButtons?: InlineButton[][]
): Promise<void> {
  if (!cfg.botToken) return;
  try {
    const body: any = {
      chat_id: cfg.chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    };
    if (inlineButtons) {
      body.reply_markup = {
        inline_keyboard: inlineButtons.map(row =>
          row.map(b => {
            const btn: any = { text: b.text };
            if (b.url) btn.url = b.url;
            if (b.callbackData) btn.callback_data = b.callbackData;
            return btn;
          })
        ),
      };
    }
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

export interface AlertMessageOptions {
  monitorName: string;
  title: string;
  priceText: string;
  url: string;
  location?: string;
  aiScore?: number | null;
  aiRisk?: number | null;
  aiVerdict?: string | null;
  aiReason?: string | null;
  estimatedValue?: number | null;
  imageAnalysis?: string | null;
  alertId?: string;
  dashboardUrl?: string;
}

export function formatAlertMessage(opts: AlertMessageOptions): string {
  const verdictEmoji =
    opts.aiVerdict === 'PRILIKA' ? '🎯' :
    opts.aiVerdict === 'SUMNJIVO' ? '⚠️' :
    opts.aiVerdict === 'NEZANIMIVO' ? '⚪' : '•';
  const lines: string[] = [];
  lines.push(`${verdictEmoji} *${escapeMd(opts.title)}*`);
  lines.push(`💰 *Cena:* ${escapeMd(opts.priceText)}`);
  if (opts.location) lines.push(`📍 ${escapeMd(opts.location)}`);
  if (opts.estimatedValue) {
    const diff = opts.estimatedValue - (parsePrice(opts.priceText) ?? 0);
    if (diff > 0) {
      lines.push(`📈 *Tržna vrednost:* ~${opts.estimatedValue} EUR _(podcenjeno za ~${diff} EUR)_`);
    } else {
      lines.push(`📈 *Tržna vrednost:* ~${opts.estimatedValue} EUR`);
    }
  }
  if (opts.aiScore != null) lines.push(`⭐ *Prilika:* ${opts.aiScore}/10`);
  if (opts.aiRisk != null) lines.push(`🛡 *Tveganje:* ${opts.aiRisk}/10`);
  if (opts.aiReason) lines.push(`\n_${escapeMd(opts.aiReason)}_`);
  if (opts.imageAnalysis) {
    lines.push(`\n📸 *Analiza slike:* ${escapeMd(opts.imageAnalysis.slice(0, 200))}`);
  }
  lines.push(`\n[Odpri oglas](${opts.url})`);
  lines.push(`\n📦 Monitor: ${escapeMd(opts.monitorName)}`);
  return lines.join('\n');
}

/** Build inline button rows for an alert message. */
export function buildAlertInlineButtons(opts: {
  alertId?: string;
  listingUrl: string;
  dashboardUrl?: string;
}): InlineButton[][] {
  const rows: InlineButton[][] = [];
  // Row 1: open listing + open dashboard
  const row1: InlineButton[] = [
    { text: '🔗 Odpri oglas', url: opts.listingUrl },
  ];
  if (opts.dashboardUrl) {
    row1.push({ text: '📊 Dashboard', url: opts.dashboardUrl });
  }
  rows.push(row1);
  // Row 2: action callbacks (require webhook)
  if (opts.alertId) {
    rows.push([
      { text: '✅ Arhiviraj', callbackData: `archive:${opts.alertId}` },
      { text: '🚫 Označi prevaro', callbackData: `scam:${opts.alertId}` },
    ]);
  }
  return rows;
}

/** Build heartbeat inline buttons. */
export function buildHeartbeatInlineButtons(dashboardUrl: string): InlineButton[][] {
  return [[
    { text: '📊 Odpri dashboard', url: dashboardUrl },
  ]];
}

export function formatHeartbeatMessage(opts: {
  periodStart: Date;
  periodEnd: Date;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  newListings: number;
  totalAlerts: number;
  prilikaAlerts: number;
  sumnjivoAlerts: number;
  activeMonitors: number;
}): string {
  const ok = opts.failedRuns === 0;
  const emoji = ok ? '✅' : '⚠️';
  const lines: string[] = [];
  lines.push(`${emoji} *Heartbeat — Markec AI Firm*`);
  lines.push(`_Obdobje: ${opts.periodStart.toLocaleString('sl-SI')} → ${opts.periodEnd.toLocaleString('sl-SI')}_`);
  lines.push('');
  lines.push(`📊 *Aktivni monitorji:* ${opts.activeMonitors}`);
  lines.push(`🔄 *Izvedbe:* ${opts.successfulRuns}/${opts.totalRuns} uspešnih${opts.failedRuns > 0 ? ` (${opts.failedRuns} napak)` : ''}`);
  lines.push(`📦 *Novi oglasi:* ${opts.newListings}`);
  lines.push(`🔔 *Alerti:* ${opts.totalAlerts} (${opts.prilikaAlerts} 🎯 prilik, ${opts.sumnjivoAlerts} ⚠️ sumljivih)`);
  if (opts.failedRuns > 0) {
    lines.push(`\n⚠️ _Imaš napake — preveri dashboard za podrobnosti._`);
  } else if (opts.newListings === 0) {
    lines.push(`\n💤 _Brez novih oglasov v tem obdobju. Morda preveri, ali so monitorji aktivni._`);
  } else {
    lines.push(`\n✅ _Sistem deluje normalno._`);
  }
  return lines.join('\n');
}

function escapeMd(s: string): string {
  // Escape Markdown special chars in Markdown mode
  return (s ?? '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function parsePrice(s: string): number | null {
  const m = (s ?? '').match(/(\d[\d.\s]*)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[\s.]/g, ''), 10);
  return isNaN(n) ? null : n;
}
