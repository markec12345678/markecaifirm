/**
 * Slack webhook notifier — sends rich formatted messages via Slack incoming webhooks.
 * v2.1 addition.
 */

export interface SlackConfig {
  webhookUrl: string;
}

export async function sendSlackMessage(
  cfg: SlackConfig,
  text: string,
  blocks?: any[]
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.webhookUrl) {
    return { ok: false, error: 'Manjka Slack webhook URL' };
  }
  try {
    const body: any = { text };
    if (blocks) body.blocks = blocks;
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Slack HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error' };
  }
}

export async function testSlack(cfg: SlackConfig): Promise<{ ok: boolean; message: string }> {
  const result = await sendSlackMessage(cfg, '✅ Markec AI Firm — test. Slack webhook je uspešno konfiguriran.');
  return result.ok
    ? { ok: true, message: 'Testno sporočilo poslano. Preverite Slack.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

export function buildAlertSlackBlocks(opts: {
  title: string;
  priceText: string;
  url: string;
  monitorName: string;
  aiScore?: number | null;
  aiRisk?: number | null;
  aiVerdict?: string | null;
  aiReason?: string | null;
  estimatedValue?: number | null;
}): any[] {
  const color = opts.aiVerdict === 'PRILIKA' ? '#4ade80'
    : opts.aiVerdict === 'SUMNJIVO' ? '#fbbf24'
    : '#6b7280';

  const fields: any[] = [];
  if (opts.aiScore != null) {
    fields.push({ type: 'mrkdwn_section', text: `*⭐ Prilika:* ${opts.aiScore}/10` });
  }
  if (opts.aiRisk != null) {
    fields.push({ type: 'mrkdwn_section', text: `*🛡 Tveganje:* ${opts.aiRisk}/10` });
  }
  if (opts.estimatedValue) {
    fields.push({ type: 'mrkdwn_section', text: `*📈 Tržna vrednost:* ~${opts.estimatedValue}€` });
  }

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: opts.title.slice(0, 150) },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn_section', text: `*💰 Cena:* ${opts.priceText}` },
        { type: 'mrkdwn_section', text: `*📦 Monitor:* ${opts.monitorName}` },
        ...fields,
      ],
    },
    ...(opts.aiReason ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `_${opts.aiReason.slice(0, 500)}_` },
    }] : []),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 Odpri oglas' },
          url: opts.url,
          action_id: 'open_listing',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 Dashboard' },
          url: 'http://localhost:3000/alerts',
          action_id: 'open_dashboard',
        },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Verdikt: *${opts.aiVerdict ?? 'N/A'}* • Markec AI Firm` }],
    },
  ];
}

export function buildHeartbeatSlackBlocks(opts: {
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
}): any[] {
  const ok = opts.failedRuns === 0;
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${ok ? '✅' : '⚠️'} Heartbeat — Markec AI Firm` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn_section', text: `*📊 Aktivni monitorji:* ${opts.activeMonitors}` },
        { type: 'mrkdwn_section', text: `*🔄 Izvedbe:* ${opts.successfulRuns}/${opts.totalRuns} uspešnih` },
        { type: 'mrkdwn_section', text: `*📦 Novi oglasi:* ${opts.newListings}` },
        { type: 'mrkdwn_section', text: `*🔔 Alerti:* ${opts.totalAlerts} (${opts.prilikaAlerts} 🎯, ${opts.sumnjivoAlerts} ⚠️)` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${ok ? 'Sistem deluje normalno' : 'Imaš napake — preveri dashboard'}` }],
    },
  ];
}
