// v4.7: Full JSON backup/export — human-readable, portable
// GET /api/backup/json — download JSON of all data
// POST /api/backup/json — restore from JSON

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ===== GET: Export all data as JSON =====
export async function GET() {
  try {
    const [settings, monitors, listings, alerts, trades, runLogs, heartbeats, priceHistory, digestLogs, pushSubs] = await Promise.all([
      db.settings.findFirst({ where: { id: 'singleton' } }),
      db.monitor.findMany(),
      db.listing.findMany(),
      db.alert.findMany(),
      db.trade.findMany(),
      db.runLog.findMany(),
      db.heartbeatLog.findMany(),
      db.priceHistory.findMany(),
      db.digestLog.findMany(),
      db.pushSubscription.findMany(),
    ]);

    // Sanitize settings — mask sensitive fields (don't export raw API keys)
    const sanitizedSettings = settings ? {
      ...settings,
      aiApiKey: settings.aiApiKey ? '***REDACTED***' : '',
      fallbackApiKey: settings.fallbackApiKey ? '***REDACTED***' : '',
      telegramBotToken: settings.telegramBotToken ? '***REDACTED***' : '',
      telegramWebhookSecret: settings.telegramWebhookSecret ? '***REDACTED***' : '',
      discordWebhookUrl: settings.discordWebhookUrl ? '***REDACTED***' : '',
      slackWebhookUrl: settings.slackWebhookUrl ? '***REDACTED***' : '',
      emailSmtpPassword: settings.emailSmtpPassword ? '***REDACTED***' : '',
      vapidPrivateKey: settings.vapidPrivateKey ? '***REDACTED***' : '',
    } : null;

    const backup = {
      _meta: {
        app: 'markec-ai-firm',
        version: 'v4.7',
        exportedAt: new Date().toISOString(),
        counts: {
          monitors: monitors.length,
          listings: listings.length,
          alerts: alerts.length,
          trades: trades.length,
          runLogs: runLogs.length,
          heartbeats: heartbeats.length,
          priceHistory: priceHistory.length,
          digestLogs: digestLogs.length,
          pushSubs: pushSubs.length,
        },
      },
      settings: sanitizedSettings,
      monitors,
      listings,
      alerts,
      trades,
      runLogs,
      heartbeats,
      priceHistory,
      digestLogs,
      pushSubs,
    };

    const json = JSON.stringify(backup, null, 2);
    const filename = `markec-ai-firm-backup-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Backup failed' }, { status: 500 });
  }
}

// ===== POST: Restore from JSON =====
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const backup = body?.backup ?? body; // accept either { backup: {...} } or {...}

    if (!backup || !backup._meta || backup._meta.app !== 'markec-ai-firm') {
      return NextResponse.json({ error: 'Neveljaven backup format (manjka _meta.app)' }, { status: 400 });
    }

    const result = {
      monitors: 0,
      listings: 0,
      alerts: 0,
      trades: 0,
      runLogs: 0,
      heartbeats: 0,
      priceHistory: 0,
      digestLogs: 0,
      pushSubs: 0,
      settings: false,
    };

    // Settings — upsert (but don't overwrite sensitive fields with redacted values)
    if (backup.settings && Array.isArray(backup.settings) ? false : backup.settings) {
      const s = backup.settings;
      // Only update non-sensitive fields
      const safeData: any = {};
      const safeFields = [
        'aiProvider', 'aiBaseUrl', 'aiModel',
        'fallbackProvider', 'fallbackBaseUrl', 'fallbackModel',
        'telegramChatId', 'telegramEnabled', 'discordEnabled', 'slackEnabled',
        'emailEnabled', 'emailSmtpHost', 'emailSmtpPort', 'emailSmtpUser',
        'emailFrom', 'emailTo',
        'heartbeatEnabled', 'heartbeatHour',
        'minOpportunityScore', 'maxRiskScore',
        'imageAnalysisEnabled', 'playwrightEnabled', 'telegramInlineButtons',
        'pushEnabled', 'vapidPublicKey',
        'digestMode', 'digestHour', 'quickResponseTemplates',
        'quietHoursEnabled', 'quietStartHour', 'quietEndHour',
        'autoCleanupEnabled', 'autoCleanupAlertsDays', 'autoCleanupListingsDays',
        'monthlyProfitGoal',
      ];
      for (const f of safeFields) {
        if (s[f] !== undefined) safeData[f] = s[f];
      }
      if (Object.keys(safeData).length > 0) {
        await db.settings.upsert({
          where: { id: 'singleton' },
          update: safeData,
          create: { id: 'singleton', ...safeData },
        });
        result.settings = true;
      }
    }

    // Monitors — upsert by id
    if (Array.isArray(backup.monitors)) {
      for (const m of backup.monitors) {
        try {
          await db.monitor.upsert({
            where: { id: m.id },
            update: {
              name: m.name,
              source: m.source,
              sourceUrl: m.sourceUrl,
              keywords: m.keywords ?? '',
              excludeKeywords: m.excludeKeywords ?? '',
              minPrice: m.minPrice ?? null,
              maxPrice: m.maxPrice ?? null,
              intervalMinutes: m.intervalMinutes ?? 30,
              isActive: m.isActive ?? true,
              runStartHour: m.runStartHour ?? null,
              runEndHour: m.runEndHour ?? null,
              lastRunAt: m.lastRunAt ? new Date(m.lastRunAt) : null,
              lastStatus: m.lastStatus ?? null,
              lastError: m.lastError ?? null,
              consecutiveErrors: m.consecutiveErrors ?? 0,
              autoPauseThreshold: m.autoPauseThreshold ?? 5,
              autoPausedAt: m.autoPausedAt ? new Date(m.autoPausedAt) : null,
              notificationChannels: m.notificationChannels ?? '{}',
              customPrompt: m.customPrompt ?? '',
              tags: m.tags ?? '',
            },
            create: {
              id: m.id,
              name: m.name,
              source: m.source,
              sourceUrl: m.sourceUrl,
              keywords: m.keywords ?? '',
              excludeKeywords: m.excludeKeywords ?? '',
              minPrice: m.minPrice ?? null,
              maxPrice: m.maxPrice ?? null,
              intervalMinutes: m.intervalMinutes ?? 30,
              isActive: m.isActive ?? true,
              runStartHour: m.runStartHour ?? null,
              runEndHour: m.runEndHour ?? null,
              notificationChannels: m.notificationChannels ?? '{}',
              customPrompt: m.customPrompt ?? '',
              tags: m.tags ?? '',
            },
          });
          result.monitors++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // Listings — upsert by id (and monitorId must exist)
    if (Array.isArray(backup.listings)) {
      const monitorIds = new Set((backup.monitors || []).map((m: any) => m.id));
      for (const l of backup.listings) {
        if (!monitorIds.has(l.monitorId)) continue; // skip orphans
        try {
          await db.listing.upsert({
            where: { id: l.id },
            update: {
              monitorId: l.monitorId,
              externalId: l.externalId,
              title: l.title,
              price: l.price,
              priceText: l.priceText,
              url: l.url,
              location: l.location ?? '',
              description: l.description ?? '',
              imageUrl: l.imageUrl,
              postedAt: l.postedAt ? new Date(l.postedAt) : null,
              firstSeenAt: l.firstSeenAt ? new Date(l.firstSeenAt) : new Date(),
              aiScore: l.aiScore,
              aiRisk: l.aiRisk,
              aiVerdict: l.aiVerdict,
              aiReason: l.aiReason,
              aiEstimatedValue: l.aiEstimatedValue,
              aiEvaluatedAt: l.aiEvaluatedAt ? new Date(l.aiEvaluatedAt) : null,
              aiImageAnalysis: l.aiImageAnalysis,
              aiImageVerdict: l.aiImageVerdict,
              isBookmarked: l.isBookmarked ?? false,
              bookmarkedAt: l.bookmarkedAt ? new Date(l.bookmarkedAt) : null,
              isHidden: l.isHidden ?? false,
              hiddenAt: l.hiddenAt ? new Date(l.hiddenAt) : null,
              detailDescription: l.detailDescription,
              detailImages: l.detailImages,
              detailFetchedAt: l.detailFetchedAt ? new Date(l.detailFetchedAt) : null,
              sellerName: l.sellerName,
              sellerListingCount: l.sellerListingCount ?? 0,
              previousPrice: l.previousPrice,
              priceDroppedAt: l.priceDroppedAt ? new Date(l.priceDroppedAt) : null,
              userNotes: l.userNotes,
              userNotesUpdatedAt: l.userNotesUpdatedAt ? new Date(l.userNotesUpdatedAt) : null,
              contactStatus: l.contactStatus ?? 'none',
              contactedAt: l.contactedAt ? new Date(l.contactedAt) : null,
              sellerResponse: l.sellerResponse,
              dealScore: l.dealScore,
              dealScoreReason: l.dealScoreReason,
              dealScoreComputedAt: l.dealScoreComputedAt ? new Date(l.dealScoreComputedAt) : null,
              targetPrice: l.targetPrice,
              targetPriceSetAt: l.targetPriceSetAt ? new Date(l.targetPriceSetAt) : null,
              targetPriceAlertSent: l.targetPriceAlertSent ?? false,
            },
            create: {
              id: l.id,
              monitorId: l.monitorId,
              externalId: l.externalId,
              title: l.title,
              price: l.price,
              priceText: l.priceText,
              url: l.url,
              location: l.location ?? '',
              description: l.description ?? '',
              imageUrl: l.imageUrl,
              firstSeenAt: l.firstSeenAt ? new Date(l.firstSeenAt) : new Date(),
            },
          });
          result.listings++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // Trades — upsert by id
    if (Array.isArray(backup.trades)) {
      for (const t of backup.trades) {
        try {
          await db.trade.upsert({
            where: { id: t.id },
            update: {
              listingId: t.listingId,
              title: t.title,
              category: t.category ?? '',
              imageUrl: t.imageUrl,
              url: t.url,
              buyPrice: t.buyPrice,
              buyDate: t.buyDate ? new Date(t.buyDate) : new Date(),
              buyLocation: t.buyLocation ?? '',
              buyFees: t.buyFees ?? 0,
              sellPrice: t.sellPrice,
              sellDate: t.sellDate ? new Date(t.sellDate) : null,
              sellLocation: t.sellLocation ?? '',
              sellFees: t.sellFees ?? 0,
              status: t.status ?? 'held',
              notes: t.notes ?? '',
            },
            create: {
              id: t.id,
              listingId: t.listingId,
              title: t.title,
              category: t.category ?? '',
              buyPrice: t.buyPrice,
              buyDate: t.buyDate ? new Date(t.buyDate) : new Date(),
              status: t.status ?? 'held',
            },
          });
          result.trades++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // Alerts — upsert by id (only if listing/monitor exists)
    if (Array.isArray(backup.alerts)) {
      const monitorIds = new Set((backup.monitors || []).map((m: any) => m.id));
      for (const a of backup.alerts) {
        if (!monitorIds.has(a.monitorId)) continue;
        try {
          await db.alert.upsert({
            where: { id: a.id },
            update: {
              monitorId: a.monitorId,
              listingId: a.listingId,
              title: a.title,
              body: a.body,
              url: a.url,
              aiScore: a.aiScore,
              aiRisk: a.aiRisk,
              aiVerdict: a.aiVerdict,
              isRead: a.isRead ?? false,
              isArchived: a.isArchived ?? false,
              sentTelegram: a.sentTelegram ?? false,
              sentDiscord: a.sentDiscord ?? false,
              sentSlack: a.sentSlack ?? false,
              sentPush: a.sentPush ?? false,
              sentEmail: a.sentEmail ?? false,
              createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
            },
            create: {
              id: a.id,
              monitorId: a.monitorId,
              listingId: a.listingId,
              title: a.title,
              body: a.body,
              url: a.url,
              createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
            },
          });
          result.alerts++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // RunLogs — upsert by id
    if (Array.isArray(backup.runLogs)) {
      for (const r of backup.runLogs) {
        try {
          await db.runLog.upsert({
            where: { id: r.id },
            update: {
              monitorId: r.monitorId,
              startedAt: r.startedAt ? new Date(r.startedAt) : new Date(),
              finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
              status: r.status,
              listingsFound: r.listingsFound ?? 0,
              newListings: r.newListings ?? 0,
              alertsSent: r.alertsSent ?? 0,
              error: r.error,
              durationMs: r.durationMs ?? 0,
            },
            create: {
              id: r.id,
              monitorId: r.monitorId,
              startedAt: r.startedAt ? new Date(r.startedAt) : new Date(),
              status: r.status ?? 'ok',
            },
          });
          result.runLogs++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // Heartbeats — upsert by id
    if (Array.isArray(backup.heartbeats)) {
      for (const h of backup.heartbeats) {
        try {
          await db.heartbeatLog.upsert({
            where: { id: h.id },
            update: {
              sentAt: h.sentAt ? new Date(h.sentAt) : new Date(),
              periodStart: h.periodStart ? new Date(h.periodStart) : new Date(),
              periodEnd: h.periodEnd ? new Date(h.periodEnd) : new Date(),
              totalRuns: h.totalRuns ?? 0,
              successfulRuns: h.successfulRuns ?? 0,
              failedRuns: h.failedRuns ?? 0,
              totalListings: h.totalListings ?? 0,
              newListings: h.newListings ?? 0,
              totalAlerts: h.totalAlerts ?? 0,
            },
            create: {
              id: h.id,
              sentAt: h.sentAt ? new Date(h.sentAt) : new Date(),
              periodStart: h.periodStart ? new Date(h.periodStart) : new Date(),
              periodEnd: h.periodEnd ? new Date(h.periodEnd) : new Date(),
              message: h.message ?? '',
            },
          });
          result.heartbeats++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    // PriceHistory — upsert by id
    if (Array.isArray(backup.priceHistory)) {
      for (const p of backup.priceHistory) {
        try {
          await db.priceHistory.upsert({
            where: { id: p.id },
            update: {
              listingId: p.listingId,
              price: p.price,
              priceText: p.priceText ?? '',
              seenAt: p.seenAt ? new Date(p.seenAt) : new Date(),
            },
            create: {
              id: p.id,
              listingId: p.listingId,
              price: p.price,
              priceText: p.priceText ?? '',
              seenAt: p.seenAt ? new Date(p.seenAt) : new Date(),
            },
          });
          result.priceHistory++;
        } catch (e) { /* skip on conflict */ }
      }
    }

    return NextResponse.json({
      ok: true,
      restored: result,
      meta: backup._meta,
      restoredAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Restore failed' }, { status: 500 });
  }
}
