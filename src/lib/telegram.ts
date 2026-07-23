/**
 * Telegram Bot API notifier — sends Markdown-formatted alerts.
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export async function sendTelegramMessage(
  cfg: TelegramConfig,
  text: string
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!cfg.botToken || !cfg.chatId) {
    return { ok: false, error: 'Manjka bot token ali chat ID' };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        }),
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
    `✅ *Test* — Markec AI Firm monitor je uspešno povezan s Telegramom.`
  );
  return result.ok
    ? { ok: true, message: 'Testno sporočilo poslano. Preverite Telegram.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

export function formatAlertMessage(opts: {
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
}): string {
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
  lines.push(`\n[Odpri oglas](${opts.url})`);
  lines.push(`\n📦 Monitor: ${escapeMd(opts.monitorName)}`);
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
