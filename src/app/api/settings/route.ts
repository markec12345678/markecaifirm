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
    updatedAt: s.updatedAt,
  });
}

function maskKey(k: string): string {
  if (k.length <= 8) return '••••';
  return k.slice(0, 4) + '••••' + k.slice(-4);
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
  if (typeof body.aiApiKey === 'string' && body.aiApiKey.trim() !== '') {
    data.aiApiKey = body.aiApiKey.trim();
  }
  if (typeof body.telegramBotToken === 'string' && body.telegramBotToken.trim() !== '') {
    data.telegramBotToken = body.telegramBotToken.trim();
  }
  if (typeof body.telegramWebhookSecret === 'string' && body.telegramWebhookSecret.trim() !== '') {
    data.telegramWebhookSecret = body.telegramWebhookSecret.trim();
  }

  const updated = await db.settings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt });
}
