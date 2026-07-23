import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { testConnection, type AiProviderType } from '@/lib/ai';
import { testTelegram } from '@/lib/telegram';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await getSettingsRow();
  return NextResponse.json({
    aiProvider: s.aiProvider,
    aiBaseUrl: s.aiBaseUrl,
    aiApiKeySet: !!s.aiApiKey,
    aiApiKeyMasked: s.aiApiKey ? maskKey(s.aiApiKey) : '',
    aiModel: s.aiModel,
    telegramBotTokenSet: !!s.telegramBotToken,
    telegramChatId: s.telegramChatId,
    telegramEnabled: s.telegramEnabled,
    // v1.4
    discordWebhookUrlSet: !!s.discordWebhookUrl,
    discordWebhookUrlMasked: s.discordWebhookUrl ? maskWebhook(s.discordWebhookUrl) : '',
    discordEnabled: s.discordEnabled,
    heartbeatEnabled: s.heartbeatEnabled,
    heartbeatHour: s.heartbeatHour,
    lastHeartbeatAt: s.lastHeartbeatAt,
    minOpportunityScore: s.minOpportunityScore,
    maxRiskScore: s.maxRiskScore,
    // v1.1
    imageAnalysisEnabled: s.imageAnalysisEnabled,
    playwrightEnabled: s.playwrightEnabled,
    telegramInlineButtons: s.telegramInlineButtons,
    telegramWebhookSecretSet: !!s.telegramWebhookSecret,
    // v1.5
    pushEnabled: s.pushEnabled,
    vapidPublicKeySet: !!s.vapidPublicKey,
    // v1.6
    digestMode: s.digestMode,
    digestHour: s.digestHour,
    quickResponseTemplatesSet: !!s.quickResponseTemplates && s.quickResponseTemplates !== '[]',
    updatedAt: s.updatedAt,
  });
}

function maskKey(k: string): string {
  if (k.length <= 8) return '••••';
  return k.slice(0, 4) + '••••' + k.slice(-4);
}

function maskWebhook(u: string): string {
  // Discord webhook URLs contain a token at the end
  // https://discord.com/api/webhooks/<id>/<token>
  try {
    const parts = u.split('/');
    if (parts.length >= 2) {
      return parts.slice(0, -1).join('/') + '/' + '••••' + (parts[parts.length - 1]?.slice(-4) ?? '');
    }
  } catch { /* ignore */ }
  return '••••';
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body?.action as string | undefined;

  if (action === 'test-ai') {
    const s = await getSettingsRow();
    const testSettings = {
      provider: (body.aiProvider ?? s.aiProvider) as AiProviderType,
      baseUrl: body.aiBaseUrl ?? s.aiBaseUrl,
      apiKey: body.aiApiKey ?? s.aiApiKey,
      model: body.aiModel ?? s.aiModel,
    };
    const result = await testConnection(testSettings);
    return NextResponse.json(result);
  }

  if (action === 'test-telegram') {
    const s = await getSettingsRow();
    const result = await testTelegram({
      botToken: body.telegramBotToken ?? s.telegramBotToken,
      chatId: body.telegramChatId ?? s.telegramChatId,
    });
    return NextResponse.json(result);
  }

  // v1.4: Test Discord webhook
  if (action === 'test-discord') {
    const s = await getSettingsRow();
    const { testDiscord } = await import('@/lib/discord');
    const result = await testDiscord({
      webhookUrl: body.discordWebhookUrl ?? s.discordWebhookUrl,
    });
    return NextResponse.json(result);
  }

  const data: any = {};
  if (typeof body.aiProvider === 'string') data.aiProvider = body.aiProvider;
  if (typeof body.aiBaseUrl === 'string') data.aiBaseUrl = body.aiBaseUrl;
  if (typeof body.aiModel === 'string') data.aiModel = body.aiModel;
  if (typeof body.telegramChatId === 'string') data.telegramChatId = body.telegramChatId;
  if (typeof body.telegramEnabled === 'boolean') data.telegramEnabled = body.telegramEnabled;
  if (typeof body.heartbeatEnabled === 'boolean') data.heartbeatEnabled = body.heartbeatEnabled;
  if (typeof body.heartbeatHour === 'number') data.heartbeatHour = body.heartbeatHour;
  if (typeof body.minOpportunityScore === 'number') data.minOpportunityScore = body.minOpportunityScore;
  if (typeof body.maxRiskScore === 'number') data.maxRiskScore = body.maxRiskScore;
  // v1.1
  if (typeof body.imageAnalysisEnabled === 'boolean') data.imageAnalysisEnabled = body.imageAnalysisEnabled;
  if (typeof body.playwrightEnabled === 'boolean') data.playwrightEnabled = body.playwrightEnabled;
  if (typeof body.telegramInlineButtons === 'boolean') data.telegramInlineButtons = body.telegramInlineButtons;
  // v1.4: Discord
  if (typeof body.discordEnabled === 'boolean') data.discordEnabled = body.discordEnabled;
  // v1.5: Push
  if (typeof body.pushEnabled === 'boolean') data.pushEnabled = body.pushEnabled;
  // v1.6: Digest
  if (typeof body.digestMode === 'string' && ['instant', 'daily', 'weekly'].includes(body.digestMode)) {
    data.digestMode = body.digestMode;
  }
  if (typeof body.digestHour === 'number') data.digestHour = body.digestHour;
  if (typeof body.aiApiKey === 'string' && body.aiApiKey.trim() !== '') {
    data.aiApiKey = body.aiApiKey.trim();
  }
  if (typeof body.telegramBotToken === 'string' && body.telegramBotToken.trim() !== '') {
    data.telegramBotToken = body.telegramBotToken.trim();
  }
  if (typeof body.telegramWebhookSecret === 'string' && body.telegramWebhookSecret.trim() !== '') {
    data.telegramWebhookSecret = body.telegramWebhookSecret.trim();
  }
  // v1.4: Discord webhook URL (only overwrite if non-empty)
  if (typeof body.discordWebhookUrl === 'string' && body.discordWebhookUrl.trim() !== '') {
    data.discordWebhookUrl = body.discordWebhookUrl.trim();
  }

  const updated = await db.settings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt });
}
