/**
 * v2.7: Email notifications via SMTP using Nodemailer.
 * Uses nodemailer for SMTP support (Gmail, Outlook, custom SMTP).
 *
 * v6.92 FIX: HTML-escape vseh uporabniških vsebin v formatAlertEmail (XSS zaščita).
 *            Prej je naslov oglasa z `<script>` bi bil izveden v email odjemalcu.
 *            Dodan tudi `text` fallback (plain-text) za spam filterje.
 *            Dodana podpora za requireTLS na STARTTLS portih (587).
 *            Transporter caching (module-level) namesto novo-povezave-na-email.
 */

let nodemailer: any = null;
let nodemailerLoaded = false;
async function ensureNodemailer() {
  if (nodemailerLoaded) return nodemailer;
  nodemailerLoaded = true;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    nodemailer = null;
  }
  return nodemailer;
}

// v6.92: Cached transporter (ponovna uporaba SMTP povezave namesto novo-povezave-na-email)
let cachedTransporter: any = null;
let cachedTransporterKey: string = '';

function transporterKey(cfg: EmailConfig): string {
  return `${cfg.smtpHost}:${cfg.smtpPort}:${cfg.smtpUser}`;
}

function createTransporter(nodemailer: any, cfg: EmailConfig) {
  const port = cfg.smtpPort || 587;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    secure: port === 465,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPassword,
    },
    // v6.92: requireTLS za STARTTLS (port 587). Port 465 implicitni TLS (secure: true).
    requireTLS: port !== 465,
  });
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  from: string;
  to: string;
}

export async function sendEmail(
  cfg: EmailConfig,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const nodemailer = await ensureNodemailer();
  if (!nodemailer) {
    return { ok: false, error: 'Nodemailer ni nameščen. Poženi: bun add nodemailer' };
  }
  if (!cfg.smtpHost || !cfg.to) {
    return { ok: false, error: 'Manjka SMTP host ali to naslov' };
  }
  try {
    // v6.92: Reuse transporter if config je enak; drugače ga ponovno ustvari
    const key = transporterKey(cfg);
    if (!cachedTransporter || cachedTransporterKey !== key) {
      cachedTransporter = createTransporter(nodemailer, cfg);
      cachedTransporterKey = key;
    }

    // v6.92: Plain-text fallback (avtomatsko generirano iz HTML z brisanjem tag-ov)
    const plainText = htmlToPlainText(html);

    await cachedTransporter.sendMail({
      from: cfg.from || cfg.smtpUser,
      to: cfg.to,
      subject,
      html,
      text: plainText, // v6.92: dodano — spam filterji penalizirajo email-e brez plain-text
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'SMTP napaka' };
  }
}

export async function testEmail(cfg: EmailConfig): Promise<{ ok: boolean; message: string }> {
  const result = await sendEmail(
    cfg,
    '✅ Markec AI Firm — test',
    `<h2>✅ Email je uspešno konfiguriran</h2>
     <p>Prejemal boš alerte o novih priložnostih na ta email naslov.</p>
     <p><small>Markec AI Firm v6.92</small></p>`
  );
  return result.ok
    ? { ok: true, message: 'Testni email poslan. Preverite pošto.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

/**
 * v6.92 FIX: formatAlertEmail — HTML-escape vseh uporabniških vsebin.
 * Prej je bil XSS ranljivost: naslov oglasa z `<script>...</script>` bi bil izveden.
 *
 * Naslov oglasa pride iz scraper-ja (Bolha, mobile.de itd.) — ne zaupamo mu.
 * AI razlog pride od LLM-ja — tudi ne zaupamo mu.
 * Monitor ime je uporabniško definirano — zaupamo, a escape-a vseeno.
 */
export function formatAlertEmail(opts: {
  title: string;
  priceText: string;
  url: string;
  monitorName: string;
  aiScore?: number | null;
  aiRisk?: number | null;
  aiVerdict?: string | null;
  aiReason?: string | null;
  estimatedValue?: number | null;
}): string {
  // v6.92: HTML-escape vseh uporabniških/nezanesljivih vsebin
  const title = escapeHtml(opts.title);
  const priceText = escapeHtml(opts.priceText);
  const monitorName = escapeHtml(opts.monitorName);
  const aiReason = opts.aiReason ? escapeHtml(opts.aiReason) : null;
  const url = encodeURI(opts.url); // URL mora ostati veljaven za href

  const verdictColor =
    opts.aiVerdict === 'PRILIKA' ? '#4ade80' :
    opts.aiVerdict === 'SUMNJIVO' ? '#fbbf24' : '#6b7280';
  const verdictEmoji =
    opts.aiVerdict === 'PRILIKA' ? '🎯' :
    opts.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';

  return `
    <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #0a0e0a; color: #d4d4d4; padding: 20px; border-radius: 8px;">
      <div style="color: ${verdictColor}; font-size: 18px; font-weight: bold; margin-bottom: 16px;">
        ${verdictEmoji} ${title}
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 4px 0; color: #6b7280;">💰 Cena:</td><td style="color: #fbbf24; font-weight: bold;">${priceText}</td></tr>
        ${opts.estimatedValue ? `<tr><td style="padding: 4px 0; color: #6b7280;">📈 Tržna vrednost:</td><td style="color: #4ade80;">~${escapeHtml(String(opts.estimatedValue))}€</td></tr>` : ''}
        ${opts.aiScore != null ? `<tr><td style="padding: 4px 0; color: #6b7280;">⭐ Prilika:</td><td style="color: #4ade80;">${escapeHtml(String(opts.aiScore))}/10</td></tr>` : ''}
        ${opts.aiRisk != null ? `<tr><td style="padding: 4px 0; color: #6b7280;">🛡 Tveganje:</td><td style="color: #fbbf24;">${escapeHtml(String(opts.aiRisk))}/10</td></tr>` : ''}
        <tr><td style="padding: 4px 0; color: #6b7280;">📦 Monitor:</td><td>${monitorName}</td></tr>
      </table>
      ${aiReason ? `<p style="margin-top: 16px; padding: 12px; background: #11140f; border-left: 3px solid ${verdictColor}; border-radius: 4px; font-style: italic;">${aiReason}</p>` : ''}
      <a href="${url}" style="display: inline-block; margin-top: 16px; padding: 8px 16px; background: #4ade80; color: #0a0e0a; text-decoration: none; border-radius: 4px; font-weight: bold;">🔗 Odpri oglas</a>
      <p style="margin-top: 20px; font-size: 11px; color: #6b7280;">Markec AI Firm v6.92</p>
    </div>
  `;
}

/**
 * v6.92: HTML-escape — zaščita pred XSS v email odjemalcih.
 * Večina email odjemalcev (Gmail, Outlook, Apple Mail) sicer strippajo <script>,
 * a to ni standardizirano. Pravilna rešitev je HTML-escape na izvorni strani.
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
 * v6.92: Plain-text fallback za spam filterje.
 * Generira berljivo besedilo iz HTML-a z brisanjem tag-ov.
 */
function htmlToPlainText(html: string): string {
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
