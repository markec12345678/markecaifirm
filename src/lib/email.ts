/**
 * v2.7: Email notifications via SMTP using Nodemailer.
 * Uses nodemailer for SMTP support (Gmail, Outlook, custom SMTP).
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
    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort || 587,
      secure: (cfg.smtpPort || 587) === 465,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPassword,
      },
    });

    await transporter.sendMail({
      from: cfg.from || cfg.smtpUser,
      to: cfg.to,
      subject,
      html,
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
     <p><small>Markec AI Firm v2.7</small></p>`
  );
  return result.ok
    ? { ok: true, message: 'Testni email poslan. Preverite pošto.' }
    : { ok: false, message: result.error ?? 'Napaka pri pošiljanju' };
}

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
  const verdictColor =
    opts.aiVerdict === 'PRILIKA' ? '#4ade80' :
    opts.aiVerdict === 'SUMNJIVO' ? '#fbbf24' : '#6b7280';
  const verdictEmoji =
    opts.aiVerdict === 'PRILIKA' ? '🎯' :
    opts.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';

  return `
    <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #0a0e0a; color: #d4d4d4; padding: 20px; border-radius: 8px;">
      <div style="color: ${verdictColor}; font-size: 18px; font-weight: bold; margin-bottom: 16px;">
        ${verdictEmoji} ${opts.title}
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 4px 0; color: #6b7280;">💰 Cena:</td><td style="color: #fbbf24; font-weight: bold;">${opts.priceText}</td></tr>
        ${opts.estimatedValue ? `<tr><td style="padding: 4px 0; color: #6b7280;">📈 Tržna vrednost:</td><td style="color: #4ade80;">~${opts.estimatedValue}€</td></tr>` : ''}
        ${opts.aiScore != null ? `<tr><td style="padding: 4px 0; color: #6b7280;">⭐ Prilika:</td><td style="color: #4ade80;">${opts.aiScore}/10</td></tr>` : ''}
        ${opts.aiRisk != null ? `<tr><td style="padding: 4px 0; color: #6b7280;">🛡 Tveganje:</td><td style="color: #fbbf24;">${opts.aiRisk}/10</td></tr>` : ''}
        <tr><td style="padding: 4px 0; color: #6b7280;">📦 Monitor:</td><td>${opts.monitorName}</td></tr>
      </table>
      ${opts.aiReason ? `<p style="margin-top: 16px; padding: 12px; background: #11140f; border-left: 3px solid ${verdictColor}; border-radius: 4px; font-style: italic;">${opts.aiReason}</p>` : ''}
      <a href="${opts.url}" style="display: inline-block; margin-top: 16px; padding: 8px 16px; background: #4ade80; color: #0a0e0a; text-decoration: none; border-radius: 4px; font-weight: bold;">🔗 Odpri oglas</a>
      <p style="margin-top: 20px; font-size: 11px; color: #6b7280;">Markec AI Firm</p>
    </div>
  `;
}
