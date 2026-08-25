// v8.95: Shared types for settings modules.
// Single source of truth for Settings interface, Provider type, and PROVIDER_PRESETS.
// Extracted from settings-view.tsx to enable modular settings components.

export type Provider = 'ollama' | 'openai' | 'anthropic' | 'openai-compatible' | 'openrouter' | 'gemini';

export interface Settings {
  aiProvider: Provider;
  aiBaseUrl: string;
  aiApiKeySet: boolean;
  aiApiKeyMasked: string;
  aiModel: string;
  // v2.6: AI fallback
  fallbackProvider: string;
  fallbackBaseUrl: string;
  fallbackApiKeySet: boolean;
  fallbackModel: string;
  telegramBotTokenSet: boolean;
  telegramChatId: string;
  telegramEnabled: boolean;
  // v1.4
  discordWebhookUrlSet: boolean;
  discordWebhookUrlMasked: string;
  discordEnabled: boolean;
  // v2.7: Email
  emailEnabled: boolean;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpUser: string;
  emailSmtpPasswordSet: boolean;
  emailFrom: string;
  emailTo: string;
  heartbeatEnabled: boolean;
  heartbeatHour: number;
  lastHeartbeatAt: string | null;
  minOpportunityScore: number;
  maxRiskScore: number;
  // v1.1
  imageAnalysisEnabled: boolean;
  playwrightEnabled: boolean;
  telegramInlineButtons: boolean;
  telegramWebhookSecretSet: boolean;
  // v1.5
  pushEnabled: boolean;
  vapidPublicKeySet: boolean;
  // v1.6: Digest
  digestMode: string;
  digestHour: number;
  quickResponseTemplatesSet: boolean;
  // v2.2: Quiet hours
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  // v2.2: Auto-cleanup
  autoCleanupEnabled: boolean;
  autoCleanupAlertsDays: number;
  autoCleanupListingsDays: number;
  // v4.2: Profit goal
  monthlyProfitGoal: number;
  updatedAt: string;
}

export const PROVIDER_PRESETS: Record<Provider, { baseUrl: string; model: string; needsKey: boolean; label: string; help: string }> = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    needsKey: false,
    label: 'Ollama (lokalno)',
    help: 'Poženi Ollama CLI lokalno. Priporočam qwen2.5:7b ali 14b za slovenščino.',
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    needsKey: true,
    label: 'OpenAI',
    help: 'API key dobiš na platform.openai.com. Modeli: gpt-4o, gpt-4o-mini, o1-mini.',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-haiku-20241022',
    needsKey: true,
    label: 'Anthropic Claude',
    help: 'API key dobiš na console.anthropic.com. Modeli: claude-3-5-sonnet, claude-3-5-haiku.',
  },
  'openai-compatible': {
    baseUrl: 'https://api.groq.com/openai',
    model: 'llama-3.3-70b-versatile',
    needsKey: true,
    label: 'OpenAI-kompatibilni (Groq, Together, DeepSeek, ...)',
    help: 'Kateri koli endpoint, ki podpira OpenAI /v1/chat/completions format. Pusti baseUrl prazen za privzeto.',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api',
    model: 'anthropic/claude-3.5-sonnet',
    needsKey: true,
    label: 'OpenRouter (gateway do 100+ modelov)',
    help: 'En API key za vse modele (OpenAI, Anthropic, Meta, Mistral, Google, ...). Key dobiš na openrouter.ai/keys. Free modeli: "meta-llama/llama-3.2-3b-instruct:free". Model format: "provider/model".',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.0-flash-exp',
    needsKey: true,
    label: 'Google Gemini (brezplačni tier)',
    help: 'API key dobiš na aistudio.google.com/apikey (brezplačno). Brezplačni tier: 15 req/min, 1500/dan za gemini-1.5-flash. Modeli: gemini-2.0-flash-exp (najnovejši), gemini-1.5-flash (hitro), gemini-1.5-pro (najnatančneje).',
  },
};

// Helper: convert VAPID base64 key to Uint8Array (used by Push section)
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
