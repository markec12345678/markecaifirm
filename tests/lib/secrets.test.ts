import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, encryptSettingsForStorage, decryptSettingsFromStorage, resetEncryptionCache, SENSITIVE_FIELDS } from '../../src/lib/secrets';

describe('secrets', () => {
  const origKey = process.env.APP_API_KEY;

  beforeEach(() => resetEncryptionCache());
  afterEach(() => {
    if (origKey) (process.env as any).APP_API_KEY = origKey;
    else delete (process.env as any).APP_API_KEY;
    resetEncryptionCache();
  });

  describe('with APP_API_KEY set', () => {
    beforeEach(() => {
      (process.env as any).APP_API_KEY = 'test-secret-key-vitest-1234567890';
      resetEncryptionCache();
    });

    it('encrypts and decrypts round-trip', () => {
      const plaintext = 'sk-abc123secret-api-key-456';
      const encrypted = encryptSecret(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.startsWith('enc:')).toBe(true);
      expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const e1 = encryptSecret('same-secret');
      const e2 = encryptSecret('same-secret');
      expect(e1).not.toBe(e2);
    });

    it('is idempotent — no double-encryption', () => {
      const encrypted = encryptSecret('secret');
      expect(encryptSecret(encrypted)).toBe(encrypted);
    });

    it('decrypts plain-text (pre-v7.32) values unchanged', () => {
      expect(decryptSecret('plain-api-key')).toBe('plain-api-key');
    });

    it('returns empty for tampered ciphertext', () => {
      const encrypted = encryptSecret('real-secret');
      const tampered = encrypted.slice(0, -2) + 'XX';
      expect(decryptSecret(tampered)).toBe('');
    });
  });

  describe('without APP_API_KEY (disabled)', () => {
    beforeEach(() => {
      delete (process.env as any).APP_API_KEY;
      resetEncryptionCache();
    });

    it('encryptSecret returns plaintext unchanged', () => {
      expect(encryptSecret('my-api-key')).toBe('my-api-key');
    });

    it('decryptSecret returns value unchanged', () => {
      expect(decryptSecret('some-value')).toBe('some-value');
    });
  });

  describe('row-level encryption', () => {
    beforeEach(() => {
      (process.env as any).APP_API_KEY = 'test-key-row-level';
      resetEncryptionCache();
    });

    it('round-trips a full Settings row', () => {
      const row = { aiApiKey: 'sk-roundtrip', telegramBotToken: 'token', aiProvider: 'openai' };
      const encrypted = encryptSettingsForStorage(row);
      expect((encrypted as any).aiApiKey).not.toBe('sk-roundtrip');
      expect((encrypted as any).aiProvider).toBe('openai');
      const decrypted = decryptSettingsFromStorage(encrypted);
      expect(decrypted.aiApiKey).toBe('sk-roundtrip');
      expect(decrypted.telegramBotToken).toBe('token');
    });

    it('SENSITIVE_FIELDS includes all critical fields', () => {
      expect(SENSITIVE_FIELDS).toContain('aiApiKey');
      expect(SENSITIVE_FIELDS).toContain('telegramBotToken');
      expect(SENSITIVE_FIELDS).toContain('discordWebhookUrl');
      expect(SENSITIVE_FIELDS).toContain('emailSmtpPassword');
      expect(SENSITIVE_FIELDS).toContain('vapidPrivateKey');
      expect(SENSITIVE_FIELDS).toContain('captchaApiKey');
    });
  });
});
