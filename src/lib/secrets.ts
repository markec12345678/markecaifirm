/** v7.32: AES-256-GCM encryption for sensitive Settings fields. */
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'markec-ai-firm-v7.32-salt';
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const PREFIX = 'enc:';
let cachedKey: Buffer | undefined;

function getKey(): Buffer | undefined {
  const appKey = process.env.APP_API_KEY;
  if (!appKey) return undefined;
  if (!cachedKey) cachedKey = crypto.pbkdf2Sync(appKey, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  if (!key || plaintext.startsWith(PREFIX)) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return '';
  const key = getKey();
  if (!key || !value.startsWith(PREFIX)) return value;
  try {
    const payload = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(IV_LENGTH, payload.length - 16);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

export const SENSITIVE_FIELDS = ['aiApiKey', 'fallbackApiKey', 'telegramBotToken', 'discordWebhookUrl', 'slackWebhookUrl', 'emailSmtpPassword', 'vapidPrivateKey', 'vapidPublicKey', 'captchaApiKey', 'captchaApiKeyAnticaptcha', 'captchaApiKeyCapmonster', 'telegramWebhookSecret'] as const;

export function encryptSettingsForStorage<T extends Record<string, unknown>>(s: T): T {
  const r: Record<string, unknown> = { ...s };
  for (const f of SENSITIVE_FIELDS) if (f in r && typeof r[f] === 'string') r[f] = encryptSecret(r[f] as string);
  return r as T;
}

export function decryptSettingsFromStorage<T extends Record<string, unknown>>(s: T): T {
  const r: Record<string, unknown> = { ...s };
  for (const f of SENSITIVE_FIELDS) if (f in r && typeof r[f] === 'string') r[f] = decryptSecret(r[f] as string);
  return r as T;
}
