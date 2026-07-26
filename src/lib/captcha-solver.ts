/**
 * v5.9: Multi-Provider CAPTCHA Solver
 *
 * Podpira 4 CAPTCHA providerje z fallback chain:
 * 1. 2captcha (2captcha.com)
 * 2. Anti-Captcha (anti-captcha.com)
 * 3. CapMonster Cloud (capmonster.cloud)
 * 4. Custom provider (configurable URL)
 *
 * Vsi providerji uporabljajo podoben API (submit task → poll result).
 * Če prvi provider ne uspe, avtomatsko preizkusi naslednjega.
 */

import { db } from './db';
import { getSettingsRow } from './pipeline';

export type CaptchaProvider = '2captcha' | 'anti-captcha' | 'capmonster' | 'custom';
export type CaptchaType = 'recaptcha' | 'hcaptcha' | 'cloudflare' | 'generic';

export interface CaptchaResult {
  solved: boolean;
  token?: string;
  provider?: CaptchaProvider;
  error?: string;
  durationMs?: number;
}

export interface CaptchaDetection {
  detected: boolean;
  type?: CaptchaType;
  siteKey?: string;
}

// ===== CAPTCHA DETECTION =====
export function detectCaptcha(html: string): CaptchaDetection {
  const lower = html.toLowerCase();

  // reCAPTCHA v2/v3
  const recaptchaMatch = html.match(/grecaptcha[^"']*data-sitekey=["']([^"']+)["']/i);
  if (recaptchaMatch) {
    return { detected: true, type: 'recaptcha', siteKey: recaptchaMatch[1] };
  }
  if (lower.includes('g-recaptcha') && lower.includes('data-sitekey')) {
    const match = html.match(/data-sitekey=["']([^"']+)["']/i);
    if (match) return { detected: true, type: 'recaptcha', siteKey: match[1] };
  }

  // hCaptcha
  if (lower.includes('h-captcha') || lower.includes('hcaptcha')) {
    const match = html.match(/data-sitekey=["']([^"']+)["']/i);
    if (match) return { detected: true, type: 'hcaptcha', siteKey: match[1] };
  }

  // Cloudflare challenge
  if (lower.includes('cf-challenge') || (lower.includes('cloudflare') && lower.includes('challenge'))) {
    return { detected: true, type: 'cloudflare' };
  }

  // Generic
  if (lower.includes('captcha') && (lower.includes('verify') || lower.includes('solve') || lower.includes('human'))) {
    return { detected: true, type: 'generic' };
  }

  return { detected: false };
}

// ===== PROVIDER INTERFACES =====

interface ProviderConfig {
  apiKey: string;
  apiUrl: string;
}

interface ProviderHandler {
  name: CaptchaProvider;
  submitTask: (apiKey: string, type: CaptchaType, siteKey: string | undefined, pageUrl: string) => Promise<{ taskId: string; error?: string }>;
  pollResult: (apiKey: string, taskId: string) => Promise<{ token?: string; status: 'ready' | 'processing' | 'error'; error?: string }>;
}

// ===== 1. 2CAPTCHA =====
const handler2Captcha: ProviderHandler = {
  name: '2captcha',
  submitTask: async (apiKey, type, siteKey, pageUrl) => {
    const res = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: apiKey,
        method: type === 'recaptcha' ? 'userrecaptcha' : type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha',
        googlekey: siteKey,
        pageurl: pageUrl,
        json: 1,
      }),
    });
    const data = await res.json();
    if (data.status !== 1) return { taskId: '', error: data.request || 'Napaka' };
    return { taskId: data.request };
  },
  pollResult: async (apiKey, taskId) => {
    const res = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
    const data = await res.json();
    if (data.status === 1) return { token: data.request, status: 'ready' };
    if (data.request === 'CAPCHA_NOT_READY') return { status: 'processing' };
    return { status: 'error', error: data.request };
  },
};

// ===== 2. ANTI-CAPTCHA (anti-captcha.com) =====
const handlerAntiCaptcha: ProviderHandler = {
  name: 'anti-captcha',
  submitTask: async (apiKey, type, siteKey, pageUrl) => {
    const taskType = type === 'recaptcha' ? 'NoCaptchaTaskProxyless' : type === 'hcaptcha' ? 'HCaptchaTaskProxyless' : 'NoCaptchaTaskProxyless';
    const res = await fetch('https://api.anti-captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: taskType,
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    });
    const data = await res.json();
    if (data.errorId) return { taskId: '', error: data.errorDescription || 'Napaka' };
    return { taskId: String(data.taskId) };
  },
  pollResult: async (apiKey, taskId) => {
    const res = await fetch('https://api.anti-captcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: parseInt(taskId, 10) }),
    });
    const data = await res.json();
    if (data.errorId) return { status: 'error', error: data.errorDescription };
    if (data.status === 'ready') return { token: data.solution?.gRecaptchaResponse || data.solution?.token, status: 'ready' };
    return { status: 'processing' };
  },
};

// ===== 3. CAPMONSTER CLOUD (capmonster.cloud) =====
const handlerCapMonster: ProviderHandler = {
  name: 'capmonster',
  submitTask: async (apiKey, type, siteKey, pageUrl) => {
    const taskType = type === 'recaptcha' ? 'NoCaptchaTaskProxyless' : type === 'hcaptcha' ? 'HCaptchaTaskProxyless' : 'NoCaptchaTaskProxyless';
    const res = await fetch('https://api.capmonster.cloud/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: taskType,
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    });
    const data = await res.json();
    if (data.errorId) return { taskId: '', error: data.errorDescription || 'Napaka' };
    return { taskId: String(data.taskId) };
  },
  pollResult: async (apiKey, taskId) => {
    const res = await fetch('https://api.capmonster.cloud/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: parseInt(taskId, 10) }),
    });
    const data = await res.json();
    if (data.errorId) return { status: 'error', error: data.errorDescription };
    if (data.status === 'ready') return { token: data.solution?.gRecaptchaResponse || data.solution?.token, status: 'ready' };
    return { status: 'processing' };
  },
};

// ===== 4. CUSTOM PROVIDER =====
const handlerCustom: ProviderHandler = {
  name: 'custom',
  submitTask: async (apiKey, type, siteKey, pageUrl) => {
    // Custom provider URL stored in settings.captchaCustomApiUrl
    const settings = await getSettingsRow();
    const apiUrl = (settings as any)?.captchaCustomApiUrl || '';
    if (!apiUrl) return { taskId: '', error: 'Custom API URL ni nastavljen' };
    const res = await fetch(`${apiUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'NoCaptchaTaskProxyless',
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    });
    const data = await res.json();
    if (data.errorId) return { taskId: '', error: data.errorDescription || 'Napaka' };
    return { taskId: String(data.taskId) };
  },
  pollResult: async (apiKey, taskId) => {
    const settings = await getSettingsRow();
    const apiUrl = (settings as any)?.captchaCustomApiUrl || '';
    const res = await fetch(`${apiUrl}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: parseInt(taskId, 10) }),
    });
    const data = await res.json();
    if (data.errorId) return { status: 'error', error: data.errorDescription };
    if (data.status === 'ready') return { token: data.solution?.gRecaptchaResponse || data.solution?.token, status: 'ready' };
    return { status: 'processing' };
  },
};

// ===== PROVIDER REGISTRY =====
const PROVIDERS: Record<CaptchaProvider, ProviderHandler> = {
  '2captcha': handler2Captcha,
  'anti-captcha': handlerAntiCaptcha,
  'capmonster': handlerCapMonster,
  'custom': handlerCustom,
};

// ===== MAIN SOLVE FUNCTION (z fallback chain) =====
export async function solveCaptcha(
  type: CaptchaType,
  siteKey: string | undefined,
  pageUrl: string
): Promise<CaptchaResult> {
  const startTime = Date.now();
  const settings = await getSettingsRow();
  if (!settings.captchaSolverEnabled) {
    return { solved: false, error: 'CAPTCHA solver ni omogočen' };
  }

  // Get configured providers and API keys
  // Provider chain: try primary, then fallback to others with API keys
  const providerChain: { provider: CaptchaProvider; apiKey: string }[] = [];

  // Primary provider (from settings)
  const primaryProvider = (settings as any)?.captchaProvider || '2captcha';
  const primaryKey = settings.captchaApiKey;
  if (primaryKey) {
    providerChain.push({ provider: primaryProvider, apiKey: primaryKey });
  }

  // Fallback providers (if they have API keys configured)
  const allProviders: CaptchaProvider[] = ['2captcha', 'anti-captcha', 'capmonster', 'custom'];
  for (const p of allProviders) {
    if (p === primaryProvider) continue;
    const keyField = `captchaApiKey${p.charAt(0).toUpperCase() + p.slice(1).replace('-', '')}`;
    const key = (settings as any)?.[keyField];
    if (key && p !== 'custom') {
      providerChain.push({ provider: p, apiKey: key });
    }
  }

  if (providerChain.length === 0) {
    return { solved: false, error: 'Noben CAPTCHA provider ni konfiguriran' };
  }

  // Try each provider in the chain
  const errors: string[] = [];
  for (const { provider, apiKey } of providerChain) {
    const handler = PROVIDERS[provider];
    if (!handler) continue;

    try {
      // Submit task
      const submitResult = await handler.submitTask(apiKey, type, siteKey, pageUrl);
      if (submitResult.error || !submitResult.taskId) {
        errors.push(`${provider}: ${submitResult.error}`);
        continue;
      }

      // Poll for result (max 60 seconds, 3s interval)
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const result = await handler.pollResult(apiKey, submitResult.taskId);
        if (result.status === 'ready' && result.token) {
          return {
            solved: true,
            token: result.token,
            provider,
            durationMs: Date.now() - startTime,
          };
        }
        if (result.status === 'error') {
          errors.push(`${provider}: ${result.error}`);
          break;
        }
      }
    } catch (e: any) {
      errors.push(`${provider}: ${e?.message ?? 'napaka'}`);
    }
  }

  return {
    solved: false,
    error: `Vsi providerji odpovedali: ${errors.join('; ')}`,
    durationMs: Date.now() - startTime,
  };
}
