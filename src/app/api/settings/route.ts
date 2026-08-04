import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { testConnection, type AiProviderType } from '@/lib/ai';
import { testTelegram } from '@/lib/telegram';
import { getSettingsRow } from '@/lib/pipeline';
import { encryptSettingsForStorage } from '@/lib/secrets';

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
    // v2.6: AI fallback
    fallbackProvider: s.fallbackProvider || '',
    fallbackBaseUrl: s.fallbackBaseUrl || '',
    fallbackApiKeySet: !!s.fallbackApiKey,
    fallbackModel: s.fallbackModel || '',
    telegramBotTokenSet: !!s.telegramBotToken,
    telegramChatId: s.telegramChatId,
    telegramEnabled: s.telegramEnabled,
    // v1.4
    discordWebhookUrlSet: !!s.discordWebhookUrl,
    discordWebhookUrlMasked: s.discordWebhookUrl ? maskWebhook(s.discordWebhookUrl) : '',
    discordEnabled: s.discordEnabled,
    // v2.1
    slackWebhookUrlSet: !!s.slackWebhookUrl,
    slackWebhookUrlMasked: s.slackWebhookUrl ? maskWebhook(s.slackWebhookUrl) : '',
    slackEnabled: s.slackEnabled,
    // v2.7: Email
    emailEnabled: s.emailEnabled,
    emailSmtpHost: s.emailSmtpHost,
    emailSmtpPort: s.emailSmtpPort,
    emailSmtpUser: s.emailSmtpUser,
    emailSmtpPasswordSet: !!s.emailSmtpPassword,
    emailFrom: s.emailFrom,
    emailTo: s.emailTo,
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
    // v2.2: Quiet hours
    quietHoursEnabled: s.quietHoursEnabled,
    quietStartHour: s.quietStartHour,
    quietEndHour: s.quietEndHour,
    // v2.2: Auto-cleanup
    autoCleanupEnabled: s.autoCleanupEnabled,
    autoCleanupAlertsDays: s.autoCleanupAlertsDays,
    autoCleanupListingsDays: s.autoCleanupListingsDays,
    // v4.2: Profit goal
    monthlyProfitGoal: s.monthlyProfitGoal,
    // v5.5: Category notifications
    categoryNotifications: s.categoryNotifications || '{}',
    // v5.6: Dashboard layout
    dashboardLayout: s.dashboardLayout || '[]',
    // v5.8: Advanced scraping
    proxyList: s.proxyList || '[]',
    proxyEnabled: s.proxyEnabled,
    realisticHeaders: s.realisticHeaders,
    requestMinDelay: s.requestMinDelay,
    requestMaxDelay: s.requestMaxDelay,
    stealthMode: s.stealthMode,
    captchaSolverEnabled: s.captchaSolverEnabled,
    captchaApiKeySet: !!s.captchaApiKey,
    captchaProvider: s.captchaProvider || '2captcha',
    captchaApiKeyAnticaptchaSet: !!s.captchaApiKeyAnticaptcha,
    captchaApiKeyCapmonsterSet: !!s.captchaApiKeyCapmonster,
    captchaCustomApiUrl: s.captchaCustomApiUrl || '',
    tlsFingerprinting: s.tlsFingerprinting,
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

  // v4.4: Test fallback AI provider
  if (action === 'test-fallback-ai') {
    const s = await getSettingsRow();
    const fallbackProvider = (body.fallbackProvider ?? s.fallbackProvider) as AiProviderType | '';
    if (!fallbackProvider) {
      return NextResponse.json({ ok: false, message: 'Fallback provider ni nastavljen.' });
    }
    const testSettings = {
      provider: fallbackProvider,
      baseUrl: body.fallbackBaseUrl ?? s.fallbackBaseUrl,
      apiKey: body.fallbackApiKey ?? s.fallbackApiKey,
      model: body.fallbackModel ?? s.fallbackModel,
    };
    if (!testSettings.model) {
      return NextResponse.json({ ok: false, message: 'Fallback model ni nastavljen.' });
    }
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

  // v2.7: Test Email
  if (action === 'test-email') {
    const s = await getSettingsRow();
    const { testEmail } = await import('@/lib/email');
    const result = await testEmail({
      smtpHost: body.emailSmtpHost ?? s.emailSmtpHost,
      smtpPort: body.emailSmtpPort ?? s.emailSmtpPort,
      smtpUser: body.emailSmtpUser ?? s.emailSmtpUser,
      smtpPassword: body.emailSmtpPassword ?? s.emailSmtpPassword,
      from: body.emailFrom ?? s.emailFrom,
      to: body.emailTo ?? s.emailTo,
    });
    return NextResponse.json(result);
  }

  const data: any = {};
  if (typeof body.aiProvider === 'string') data.aiProvider = body.aiProvider;
  if (typeof body.aiBaseUrl === 'string') data.aiBaseUrl = body.aiBaseUrl;
  if (typeof body.aiModel === 'string') data.aiModel = body.aiModel;
  // v2.6: AI fallback
  if (typeof body.fallbackProvider === 'string') data.fallbackProvider = body.fallbackProvider;
  if (typeof body.fallbackBaseUrl === 'string') data.fallbackBaseUrl = body.fallbackBaseUrl;
  if (typeof body.fallbackModel === 'string') data.fallbackModel = body.fallbackModel;
  if (typeof body.fallbackApiKey === 'string' && body.fallbackApiKey.trim() !== '') {
    data.fallbackApiKey = body.fallbackApiKey.trim();
  }
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
  // v2.1: Slack
  if (typeof body.slackEnabled === 'boolean') data.slackEnabled = body.slackEnabled;
  if (typeof body.slackWebhookUrl === 'string' && body.slackWebhookUrl.trim() !== '') {
    data.slackWebhookUrl = body.slackWebhookUrl.trim();
  }
  // v2.7: Email
  if (typeof body.emailEnabled === 'boolean') data.emailEnabled = body.emailEnabled;
  if (typeof body.emailSmtpHost === 'string') data.emailSmtpHost = body.emailSmtpHost;
  if (typeof body.emailSmtpPort === 'number') data.emailSmtpPort = body.emailSmtpPort;
  if (typeof body.emailSmtpUser === 'string') data.emailSmtpUser = body.emailSmtpUser;
  if (typeof body.emailSmtpPassword === 'string' && body.emailSmtpPassword.trim() !== '') {
    data.emailSmtpPassword = body.emailSmtpPassword.trim();
  }
  if (typeof body.emailFrom === 'string') data.emailFrom = body.emailFrom;
  if (typeof body.emailTo === 'string') data.emailTo = body.emailTo;
  // v1.5: Push
  if (typeof body.pushEnabled === 'boolean') data.pushEnabled = body.pushEnabled;
  // v1.6: Digest
  if (typeof body.digestMode === 'string' && ['instant', 'daily', 'weekly'].includes(body.digestMode)) {
    data.digestMode = body.digestMode;
  }
  if (typeof body.digestHour === 'number') data.digestHour = body.digestHour;
  // v2.2: Quiet hours
  if (typeof body.quietHoursEnabled === 'boolean') data.quietHoursEnabled = body.quietHoursEnabled;
  if (typeof body.quietStartHour === 'number') data.quietStartHour = body.quietStartHour;
  if (typeof body.quietEndHour === 'number') data.quietEndHour = body.quietEndHour;
  // v2.2: Auto-cleanup
  if (typeof body.autoCleanupEnabled === 'boolean') data.autoCleanupEnabled = body.autoCleanupEnabled;
  if (typeof body.autoCleanupAlertsDays === 'number') data.autoCleanupAlertsDays = body.autoCleanupAlertsDays;
  if (typeof body.autoCleanupListingsDays === 'number') data.autoCleanupListingsDays = body.autoCleanupListingsDays;
  // v4.2: Profit goal
  if (typeof body.monthlyProfitGoal === 'number') data.monthlyProfitGoal = body.monthlyProfitGoal;
  // v5.5: Category notifications
  if (typeof body.categoryNotifications === 'string') data.categoryNotifications = body.categoryNotifications;
  // v5.6: Dashboard layout
  if (typeof body.dashboardLayout === 'string') data.dashboardLayout = body.dashboardLayout;
  // v5.8: Advanced scraping
  if (typeof body.proxyList === 'string') data.proxyList = body.proxyList;
  if (typeof body.proxyEnabled === 'boolean') data.proxyEnabled = body.proxyEnabled;
  if (typeof body.realisticHeaders === 'boolean') data.realisticHeaders = body.realisticHeaders;
  if (typeof body.requestMinDelay === 'number') data.requestMinDelay = body.requestMinDelay;
  if (typeof body.requestMaxDelay === 'number') data.requestMaxDelay = body.requestMaxDelay;
  if (typeof body.stealthMode === 'boolean') data.stealthMode = body.stealthMode;
  if (typeof body.captchaSolverEnabled === 'boolean') data.captchaSolverEnabled = body.captchaSolverEnabled;
  if (typeof body.tlsFingerprinting === 'boolean') data.tlsFingerprinting = body.tlsFingerprinting;
  if (typeof body.captchaProvider === 'string') data.captchaProvider = body.captchaProvider;
  if (typeof body.captchaApiKey === 'string' && body.captchaApiKey.trim() !== '') {
    data.captchaApiKey = body.captchaApiKey.trim();
  }
  // v5.9: Multi-provider CAPTCHA keys
  if (typeof body.captchaApiKeyAnticaptcha === 'string' && body.captchaApiKeyAnticaptcha.trim() !== '') {
    data.captchaApiKeyAnticaptcha = body.captchaApiKeyAnticaptcha.trim();
  }
  if (typeof body.captchaApiKeyCapmonster === 'string' && body.captchaApiKeyCapmonster.trim() !== '') {
    data.captchaApiKeyCapmonster = body.captchaApiKeyCapmonster.trim();
  }
  if (typeof body.captchaCustomApiUrl === 'string') data.captchaCustomApiUrl = body.captchaCustomApiUrl.trim();
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

  // v7.32: Encrypt sensitive fields before writing
  const encryptedData = encryptSettingsForStorage(data);
  const updated = await db.settings.upsert({
    where: { id: 'singleton' },
    update: encryptedData,
    create: { id: 'singleton', ...encryptedData },
  });

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt });
}
