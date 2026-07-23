/**
 * Discord webhook notifier — sends rich embed messages.
 * v1.4 addition.
 */

export interface DiscordConfig {
  webhookUrl: string;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string };
}

export async function sendDiscordMessage(
  cfg: DiscordConfig,
  embed: DiscordEmbed
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.webhookUrl) {
    return { ok: false, error: 'Manjka Discord webhook URL' };
  }
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });
    if (!res.ok) {
      // Discord returns 204 on success, 4xx on error
      const txt = await res.text();
      return { ok: false, error: `Discord HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error' };
  }
}

export async function testDiscord(cfg: DiscordConfig): Promise<{ ok: boolean; message: string }> {
  const result = await sendDiscordMessage(cfg, {
    title: '✅ Markec AI Firm — test',
    description: 'Discord webhook je uspešno konfiguriran. Alerti o priložnostih bodo prihajali sem.',
    color: 0x4ade80, // green
    timestamp: new Date().toISOString(),
    footer: { text: 'Markec AI Firm v1.4' },
  });
  return result.ok
    ? { ok: true, message: 'Testno sporočilo poslano. Preverite Discord.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

export interface AlertEmbedOptions {
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
  imageUrl?: string | null;
}

export function buildAlertEmbed(opts: AlertEmbedOptions): DiscordEmbed {
  // Color based on verdict
  const color =
    opts.aiVerdict === 'PRILIKA' ? 0x4ade80 :  // green
    opts.aiVerdict === 'SUMNJIVO' ? 0xfbbf24 : // amber
    0x6b7280;                                    // gray

  const emoji =
    opts.aiVerdict === 'PRILIKA' ? '🎯' :
    opts.aiVerdict === 'SUMNJIVO' ? '⚠️' :
    '•';

  const fields: DiscordEmbed['fields'] = [];

  if (opts.aiScore != null) {
    fields.push({ name: '⭐ Prilika', value: `${opts.aiScore}/10`, inline: true });
  }
  if (opts.aiRisk != null) {
    fields.push({ name: '🛡 Tveganje', value: `${opts.aiRisk}/10`, inline: true });
  }
  if (opts.estimatedValue) {
    const current = parsePrice(opts.priceText) ?? 0;
    const diff = opts.estimatedValue - current;
    const sign = diff > 0 ? '+' : '';
    fields.push({
      name: '📈 Tržna vrednost',
      value: `~${opts.estimatedValue}€ (${sign}${diff}€)`,
      inline: true,
    });
  }
  if (opts.location) {
    fields.push({ name: '📍 Lokacija', value: opts.location, inline: true });
  }
  fields.push({ name: '📦 Monitor', value: opts.monitorName, inline: true });

  return {
    title: `${emoji} ${opts.title}`,
    description: opts.aiReason ? `*${opts.aiReason}*` : undefined,
    url: opts.url,
    color,
    timestamp: new Date().toISOString(),
    fields,
    ...(opts.imageUrl ? { thumbnail: { url: opts.imageUrl } } : {}),
    footer: { text: 'Markec AI Firm' },
  };
}

export function buildHeartbeatEmbed(opts: {
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
}): DiscordEmbed {
  const ok = opts.failedRuns === 0;
  const color = ok ? 0x4ade80 : 0xfbbf24;
  const emoji = ok ? '✅' : '⚠️';

  return {
    title: `${emoji} Heartbeat — Markec AI Firm`,
    description: `Obdobje: ${opts.periodStart.toLocaleString('sl-SI')} → ${opts.periodEnd.toLocaleString('sl-SI')}`,
    color,
    timestamp: new Date().toISOString(),
    fields: [
      { name: '📊 Aktivni monitorji', value: String(opts.activeMonitors), inline: true },
      { name: '🔄 Izvedbe', value: `${opts.successfulRuns}/${opts.totalRuns} uspešnih`, inline: true },
      { name: '📦 Novi oglasi', value: String(opts.newListings), inline: true },
      { name: '🔔 Alerti', value: String(opts.totalAlerts), inline: true },
      { name: '🎯 Prilike', value: String(opts.prilikaAlerts), inline: true },
      { name: '⚠️ Sumljivi', value: String(opts.sumnjivoAlerts), inline: true },
    ],
    footer: { text: ok ? 'Sistem deluje normalno' : 'Imaš napake — preveri dashboard' },
  };
}

function parsePrice(s: string): number | null {
  const m = (s ?? '').match(/(\d[\d.\s]*)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[\s.]/g, ''), 10);
  return isNaN(n) ? null : n;
}
