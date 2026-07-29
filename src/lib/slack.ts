/**
 * Slack webhook notifier — sends rich formatted messages via Slack incoming webhooks.
 * v2.1 addition.
 * v6.92 FIX: Popravljen `mrkdwn_section` (neveljaven Slack Block Kit tip) → `mrkdwn`.
 *           Slack je prej tiho zavrnil celoten blocks payload.
 *           Dodan tudi 429 rate-limit handling z `Retry-After`.
 *           Popravljen tudi `testSlack` da pošlje Block Kit (ne le navadno besedilo),
 *           tako da test dejansko validira formatiranje.
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
      // Slack rate limit: HTTP 429 z Retry-After headerjem (v sekundah)
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
        return { ok: false, error: `Slack rate limit (429). Počakaj ${retryAfter}s.` };
      }
      return { ok: false, error: `Slack HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error' };
  }
}

export async function testSlack(cfg: SlackConfig): Promise<{ ok: boolean; message: string }> {
  // Popravek: testSlack zdaj pošlje tudi Block Kit, da prihaja do enake validacije kot pravi alert.
  // Prej je test vedno uspel (navadno besedilo), pravi alerti pa tiho odpovedali zaradi mrkdwn_section.
  const testBlocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ Markec AI Firm — test' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Testno sporočilo*\nSlack webhook je konfiguriran.' },
        { type: 'mrkdwn', text: '*Block Kit*\nFormatiranje deluje pravilno.' },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Markec AI Firm v6.92 • Slack Block Kit test' }],
    },
  ];
  const result = await sendSlackMessage(cfg, '✅ Markec AI Firm — test. Slack webhook je uspešno konfiguriran.', testBlocks);
  return result.ok
    ? { ok: true, message: 'Testno sporočilo (z Block Kit) poslano. Preverite Slack.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

/**
 * Build alert blocks — POPRAVLJENO v6.92:
 * - `type: 'mrkdwn_section'` (neveljaven) → `type: 'mrkdwn'` znotraj field objekta
 * - Slack `fields` array zahteva `{ type: 'mrkdwn', text: '...' }` (ali `plain_text`)
 * - Dodan escape Slack Markdown znakov v vseh uporabniških besedilih
 * - Odstranjen hardcoded `http://localhost:3000/alerts` gumb (bil broken v produkciji)
 * @see https://api.slack.com/reference/block-kit/blocks
 */
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
  const verdictText = opts.aiVerdict === 'PRILIKA' ? '🎯 PRILIKA'
    : opts.aiVerdict === 'SUMNJIVO' ? '⚠️ SUMNJIVO'
    : opts.aiVerdict === 'NEZANIMIVO' ? '⚪ NEZANIMIVO'
    : 'N/A';

  // Fields v section block-u: Slack zahteva `{ type: 'mrkdwn', text: '...' }`
  const fields: any[] = [
    { type: 'mrkdwn', text: `*💰 Cena:*\n${escapeSlackMd(opts.priceText)}` },
    { type: 'mrkdwn', text: `*📦 Monitor:*\n${escapeSlackMd(opts.monitorName)}` },
  ];
  if (opts.aiScore != null) {
    fields.push({ type: 'mrkdwn', text: `*⭐ Prilika:*\n${opts.aiScore}/10` });
  }
  if (opts.aiRisk != null) {
    fields.push({ type: 'mrkdwn', text: `*🛡 Tveganje:*\n${opts.aiRisk}/10` });
  }
  if (opts.estimatedValue) {
    fields.push({ type: 'mrkdwn', text: `*📈 Tržna vrednost:*\n~${opts.estimatedValue}€` });
  }

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: opts.title.slice(0, 150) },
    },
    {
      type: 'section',
      fields,
    },
    ...(opts.aiReason ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `_${escapeSlackMd(opts.aiReason.slice(0, 500))}_` },
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
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Verdikt: *${verdictText}* • Markec AI Firm` }],
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
        { type: 'mrkdwn', text: `*📊 Aktivni monitorji:*\n${opts.activeMonitors}` },
        { type: 'mrkdwn', text: `*🔄 Izvedbe:*\n${opts.successfulRuns}/${opts.totalRuns} uspešnih` },
        { type: 'mrkdwn', text: `*📦 Novi oglasi:*\n${opts.newListings}` },
        { type: 'mrkdwn', text: `*🔔 Alerti:*\n${opts.totalAlerts} (${opts.prilikaAlerts} 🎯, ${opts.sumnjivoAlerts} ⚠️)` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${ok ? 'Sistem deluje normalno' : 'Imaš napake — preveri dashboard'}` }],
    },
  ];
}

/**
 * Escape Slack mrkdwn special characters.
 * Slack mrkdwn podpira le *, _, ~, ` in ne HTML-ja, ampak <, >, & morajo biti HTML-escape-ani
 * ker Slack interpretira <...> kot link/mention syntax.
 * @see https://api.slack.com/reference/surfaces/formatting#escaping
 */
function escapeSlackMd(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
