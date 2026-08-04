import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/export
 * Exports all settings + monitors as JSON (WITHOUT API keys/passwords).
 * For backup/restore of configuration.
 */
export async function GET() {
  try {
    const settings = await db.settings.findUnique({ where: { id: 'singleton' } });
    const monitors = await db.monitor.findMany({
      select: {
        name: true, source: true, sourceUrl: true, keywords: true,
        excludeKeywords: true, minPrice: true, maxPrice: true,
        intervalMinutes: true, isActive: true, runStartHour: true, runEndHour: true,
        autoPauseThreshold: true, notificationChannels: true, customPrompt: true,
      },
    });

    const exportData = {
      version: '2.7',
      exportedAt: new Date().toISOString(),
      settings: {
        aiProvider: settings?.aiProvider,
        aiBaseUrl: settings?.aiBaseUrl,
        aiModel: settings?.aiModel,
        fallbackProvider: settings?.fallbackProvider,
        fallbackBaseUrl: settings?.fallbackBaseUrl,
        fallbackModel: settings?.fallbackModel,
        // NOT exporting: aiApiKey, fallbackApiKey, telegramBotToken, emailSmtpPassword, etc.
        telegramEnabled: settings?.telegramEnabled,
        telegramChatId: settings?.telegramChatId,
        discordEnabled: settings?.discordEnabled,
        slackEnabled: settings?.slackEnabled,
        emailEnabled: settings?.emailEnabled,
        emailSmtpHost: settings?.emailSmtpHost,
        emailSmtpPort: settings?.emailSmtpPort,
        emailSmtpUser: settings?.emailSmtpUser,
        emailFrom: settings?.emailFrom,
        emailTo: settings?.emailTo,
        heartbeatEnabled: settings?.heartbeatEnabled,
        heartbeatHour: settings?.heartbeatHour,
        minOpportunityScore: settings?.minOpportunityScore,
        maxRiskScore: settings?.maxRiskScore,
        imageAnalysisEnabled: settings?.imageAnalysisEnabled,
        playwrightEnabled: settings?.playwrightEnabled,
        telegramInlineButtons: settings?.telegramInlineButtons,
        pushEnabled: settings?.pushEnabled,
        digestMode: settings?.digestMode,
        digestHour: settings?.digestHour,
        quietHoursEnabled: settings?.quietHoursEnabled,
        quietStartHour: settings?.quietStartHour,
        quietEndHour: settings?.quietEndHour,
        autoCleanupEnabled: settings?.autoCleanupEnabled,
        autoCleanupAlertsDays: settings?.autoCleanupAlertsDays,
        autoCleanupListingsDays: settings?.autoCleanupListingsDays,
      },
      monitors,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="markec-settings-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });

  } catch (err) {
    logger.error("/api/settings/export", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

/**
 * POST /api/settings/export
 * Import settings + monitors from JSON.
 * Body: the exported JSON object.
 * Does NOT overwrite API keys/passwords — those must be entered manually.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.version || !body?.settings) {
      return NextResponse.json({ error: 'Neveljaven format' }, { status: 400 });
    }

    // Update settings (excluding secrets)
    const s = body.settings;
    const settingsData: any = {};
    const safeFields = [
      'aiProvider', 'aiBaseUrl', 'aiModel', 'fallbackProvider', 'fallbackBaseUrl', 'fallbackModel',
      'telegramEnabled', 'telegramChatId', 'discordEnabled', 'slackEnabled',
      'emailEnabled', 'emailSmtpHost', 'emailSmtpPort', 'emailSmtpUser', 'emailFrom', 'emailTo',
      'heartbeatEnabled', 'heartbeatHour', 'minOpportunityScore', 'maxRiskScore',
      'imageAnalysisEnabled', 'playwrightEnabled', 'telegramInlineButtons',
      'pushEnabled', 'digestMode', 'digestHour',
      'quietHoursEnabled', 'quietStartHour', 'quietEndHour',
      'autoCleanupEnabled', 'autoCleanupAlertsDays', 'autoCleanupListingsDays',
    ];
    for (const field of safeFields) {
      if (s[field] !== undefined) settingsData[field] = s[field];
    }

    await db.settings.upsert({
      where: { id: 'singleton' },
      update: settingsData,
      create: { id: 'singleton', ...settingsData },
    });

    // Import monitors (add new ones, don't overwrite existing by name)
    if (Array.isArray(body.monitors)) {
      for (const m of body.monitors) {
        const existing = await db.monitor.findFirst({ where: { name: m.name, source: m.source } });
        if (!existing) {
          await db.monitor.create({ data: m });
        }
      }
    }

    return NextResponse.json({ ok: true, imported: { settings: Object.keys(settingsData).length, monitors: body.monitors?.length ?? 0 } });

  } catch (err) {
    logger.error("/api/settings/export", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
