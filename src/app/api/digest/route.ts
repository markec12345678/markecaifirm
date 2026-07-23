import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendDiscordMessage, buildHeartbeatEmbed } from '@/lib/discord';
import { sendPushNotification } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/digest
 * Returns digest info (when last sent, mode, hour).
 *
 * POST /api/digest
 * Force-send a digest now (test button).
 *
 * Designed to be called by cron — checks if digest should fire based on settings.digestMode.
 */

interface DigestData {
  periodStart: Date;
  periodEnd: Date;
  newListingsCount: number;
  newAlertsCount: number;
  topOpportunities: Array<{
    title: string;
    priceText: string;
    url: string;
    aiScore: number | null;
    aiRisk: number | null;
    aiReason: string | null;
    monitorName: string;
  }>;
}

async function gatherDigestData(periodHours: number): Promise<DigestData> {
  const periodStart = new Date(Date.now() - periodHours * 60 * 60 * 1000);
  const periodEnd = new Date();

  const [newListingsCount, newAlertsCount, topAlerts] = await Promise.all([
    db.listing.count({ where: { firstSeenAt: { gte: periodStart, lte: periodEnd } } }),
    db.alert.count({ where: { createdAt: { gte: periodStart, lte: periodEnd } } }),
    db.alert.findMany({
      where: {
        createdAt: { gte: periodStart, lte: periodEnd },
        aiVerdict: 'PRILIKA',
      },
      orderBy: { aiScore: 'desc' },
      take: 5,
      include: { monitor: { select: { name: true } } },
    }),
  ]);

  return {
    periodStart,
    periodEnd,
    newListingsCount,
    newAlertsCount,
    topOpportunities: topAlerts.map(a => ({
      title: a.title,
      priceText: a.body.split('\n').find((l: string) => l.includes('Cena')) ?? '',
      url: a.url,
      aiScore: a.aiScore,
      aiRisk: a.aiRisk,
      aiReason: a.aiReason,
      monitorName: a.monitor.name,
    })),
  };
}

function formatDigestMessage(data: DigestData, mode: string): string {
  const lines: string[] = [];
  const emoji = mode === 'weekly' ? '📅' : '📊';
  lines.push(`${emoji} *Digest — Markec AI Firm*`);
  lines.push(`_Obdobje: ${data.periodStart.toLocaleString('sl-SI')} → ${data.periodEnd.toLocaleString('sl-SI')}_`);
  lines.push('');
  lines.push(`📦 Novi oglasi: *${data.newListingsCount}*`);
  lines.push(`🔔 Novi alerti: *${data.newAlertsCount}*`);

  if (data.topOpportunities.length > 0) {
    lines.push('');
    lines.push(`🎯 *Top ${data.topOpportunities.length} priložnosti:*`);
    data.topOpportunities.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.title.slice(0, 60)}`);
      if (o.priceText) lines.push(`   ${o.priceText}`);
      if (o.aiScore != null) lines.push(`   ⭐ Prilika: ${o.aiScore}/10`);
      if (o.aiReason) lines.push(`   _${o.aiReason.slice(0, 100)}_`);
    });
  } else {
    lines.push('');
    lines.push('_Ni novih priložnosti v tem obdobju._');
  }

  return lines.join('\n');
}

async function sendDigest(data: DigestData, mode: string) {
  const settings = await getSettingsRow();
  const message = formatDigestMessage(data, mode);

  let telegramOk = false;
  let discordOk = false;
  let pushOk = false;

  // Telegram
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    const tg = await sendTelegramMessage(
      { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
      message
    );
    telegramOk = tg.ok;
  }

  // Discord
  if (settings.discordEnabled && settings.discordWebhookUrl) {
    const embed = buildHeartbeatEmbed({
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      newListings: data.newListingsCount,
      totalAlerts: data.newAlertsCount,
      prilikaAlerts: data.topOpportunities.length,
      sumnjivoAlerts: 0,
      activeMonitors: 0,
    });
    // Add top opportunities as description
    embed.description = (embed.description ?? '') + '\n\n**Top priložnosti:**\n' +
      (data.topOpportunities.length > 0
        ? data.topOpportunities.map((o, i) => `${i + 1}. ${o.title.slice(0, 60)} — ${o.priceText}`).join('\n')
        : 'Ni novih priložnosti.');
    const dc = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
    discordOk = dc.ok;
  }

  // Push
  if (settings.pushEnabled) {
    const push = await sendPushNotification({
      title: `${mode === 'weekly' ? '📅 Tedenski' : '📊 Dnevni'} digest`,
      body: `${data.newListingsCount} novih oglasov, ${data.newAlertsCount} alertov, ${data.topOpportunities.length} top priložnosti`,
      url: '/',
    });
    pushOk = push.sent > 0;
  }

  // Log to DB
  await db.digestLog.create({
    data: {
      sentAt: new Date(),
      type: mode,
      listingsCount: data.newListingsCount,
      alertsCount: data.newAlertsCount,
      topOpportunities: data.topOpportunities.length,
      sentTelegram: telegramOk,
      sentDiscord: discordOk,
      sentPush: pushOk,
      message,
    },
  });

  return { telegramOk, discordOk, pushOk };
}

export async function GET() {
  const settings = await getSettingsRow();
  const lastDigest = await db.digestLog.findFirst({
    orderBy: { sentAt: 'desc' },
  });
  return NextResponse.json({
    mode: settings.digestMode,
    hour: settings.digestHour,
    lastDigestAt: lastDigest?.sentAt ?? null,
    lastDigestType: lastDigest?.type ?? null,
  });
}

/** Should digest fire now? Returns mode if yes, null if no. */
async function shouldDigestFire(): Promise<'daily' | 'weekly' | null> {
  const settings = await getSettingsRow();
  if (settings.digestMode === 'instant') return null; // instant mode, no digest

  const now = new Date();
  const lastDigest = await db.digestLog.findFirst({
    where: { type: settings.digestMode },
    orderBy: { sentAt: 'desc' },
  });

  const minIntervalHours = settings.digestMode === 'weekly' ? 168 - 6 : 24 - 1;
  if (lastDigest) {
    const elapsedHours = (now.getTime() - lastDigest.sentAt.getTime()) / (60 * 60 * 1000);
    if (elapsedHours < minIntervalHours) return null;
  }

  // Check if we're at/after the configured hour
  if (now.getHours() < settings.digestHour) return null;

  return settings.digestMode as 'daily' | 'weekly';
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  if (force) {
    const settings = await getSettingsRow();
    const data = await gatherDigestData(settings.digestMode === 'weekly' ? 168 : 24);
    const result = await sendDigest(data, settings.digestMode === 'weekly' ? 'weekly' : 'daily');
    return NextResponse.json({ ok: true, sent: true, ...result, data });
  }

  const mode = await shouldDigestFire();
  if (!mode) {
    return NextResponse.json({ ok: true, sent: false, reason: 'Ni čas ali instant mode' });
  }

  const data = await gatherDigestData(mode === 'weekly' ? 168 : 24);
  const result = await sendDigest(data, mode);
  return NextResponse.json({ ok: true, sent: true, mode, ...result });
}
