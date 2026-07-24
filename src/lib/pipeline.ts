/**
 * Pipeline runner — orchestrates a single monitor execution:
 * 1. Scrape source
 * 2. Deduplicate against DB
 * 3. AI evaluation for new listings
 * 4. Generate alert if thresholds met
 * 5. Send Telegram (if enabled)
 * 6. Write run log
 */

import { db } from './db';
import { scrape, type SourceType, type ScraperFilters } from './scraper';
import { evaluateListing, downloadImageAsBase64, type AiSettings, type ListingEvaluation } from './ai';
import { sendTelegramMessage, formatAlertMessage, buildAlertInlineButtons } from './telegram';
import { sendDiscordMessage, buildAlertEmbed } from './discord';
import { sendSlackMessage, buildAlertSlackBlocks } from './slack';
import { sendPushNotification } from './push';

/** v2.2: Check if current time is within quiet hours. */
function isInQuietHours(quietStart: number, quietEnd: number): boolean {
  const hour = new Date().getHours();
  // Handle wrap-around (e.g., 22-7)
  if (quietStart <= quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }
  return hour >= quietStart || hour < quietEnd;
}

/** v2.2: Parse monitor-specific notification channels. */
function getMonitorChannels(channelsJson: string): { telegram: boolean; discord: boolean; slack: boolean; push: boolean } | null {
  try {
    const parsed = JSON.parse(channelsJson || '{}');
    if (Object.keys(parsed).length === 0) return null; // empty = use global
    return {
      telegram: parsed.telegram ?? true,
      discord: parsed.discord ?? true,
      slack: parsed.slack ?? true,
      push: parsed.push ?? true,
    };
  } catch {
    return null;
  }
}

export interface RunResult {
  status: 'ok' | 'error' | 'empty';
  listingsFound: number;
  newListings: number;
  alertsSent: number;
  error?: string;
  durationMs: number;
}

export async function getSettingsRow() {
  const s = await db.settings.findUnique({ where: { id: 'singleton' } });
  if (!s) {
    return db.settings.create({ data: { id: 'singleton' } });
  }
  return s;
}

function toAiSettings(s: {
  aiProvider: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  fallbackProvider?: string;
  fallbackBaseUrl?: string;
  fallbackApiKey?: string;
  fallbackModel?: string;
}): AiSettings {
  return {
    provider: s.aiProvider as AiSettings['provider'],
    baseUrl: s.aiBaseUrl,
    apiKey: s.aiApiKey,
    model: s.aiModel,
    // v2.6: fallback
    fallbackProvider: (s.fallbackProvider || '') as AiProviderType | '',
    fallbackBaseUrl: s.fallbackBaseUrl || '',
    fallbackApiKey: s.fallbackApiKey || '',
    fallbackModel: s.fallbackModel || '',
  };
}

function parseFilterList(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

export async function runMonitor(monitorId: string): Promise<RunResult> {
  const startedAt = Date.now();
  const monitor = await db.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor) {
    return { status: 'error', listingsFound: 0, newListings: 0, alertsSent: 0, error: 'Monitor ne obstaja', durationMs: 0 };
  }

  const filters: ScraperFilters = {
    keywords: parseFilterList(monitor.keywords),
    excludeKeywords: parseFilterList(monitor.excludeKeywords),
    minPrice: monitor.minPrice,
    maxPrice: monitor.maxPrice,
  };

  let runLogId: string | null = null;
  try {
    // Create run log entry
    const runLog = await db.runLog.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(),
        status: 'ok',
      },
    });
    runLogId = runLog.id;

    // 1. Scrape
    const listings = await scrape(
      monitor.source as SourceType,
      monitor.sourceUrl,
      filters,
      { playwrightEnabled: settings.playwrightEnabled }
    );

    if (listings.length === 0) {
      await db.runLog.update({
        where: { id: runLog.id },
        data: {
          status: 'empty',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          listingsFound: 0,
          newListings: 0,
          alertsSent: 0,
        },
      });
      await db.monitor.update({
        where: { id: monitor.id },
        data: { lastRunAt: new Date(), lastStatus: 'empty', lastError: null },
      });
      return { status: 'empty', listingsFound: 0, newListings: 0, alertsSent: 0, durationMs: Date.now() - startedAt };
    }

    // 2. Dedup — find which externalIds already exist
    const externalIds = listings.map(l => l.externalId);
    const existing = await db.listing.findMany({
      where: { monitorId: monitor.id, externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map(e => e.externalId));
    const fresh = listings.filter(l => !existingIds.has(l.externalId));

    if (fresh.length === 0) {
      await db.runLog.update({
        where: { id: runLog.id },
        data: {
          status: 'ok',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          listingsFound: listings.length,
          newListings: 0,
          alertsSent: 0,
        },
      });
      await db.monitor.update({
        where: { id: monitor.id },
        data: { lastRunAt: new Date(), lastStatus: 'ok', lastError: null },
      });
      return { status: 'ok', listingsFound: listings.length, newListings: 0, alertsSent: 0, durationMs: Date.now() - startedAt };
    }

    // 3. AI evaluation + persist + alert
    const settings = await getSettingsRow();
    const aiSettings = toAiSettings(settings);
    let alertsSent = 0;

    // Persist all fresh listings first (without AI evaluation)
    const createdListings = await Promise.all(
      fresh.map(l => db.listing.create({
        data: {
          monitorId: monitor.id,
          externalId: l.externalId,
          title: l.title,
          price: l.price ?? null,
          priceText: l.priceText,
          url: l.url,
          location: l.location ?? '',
          description: l.description ?? '',
          imageUrl: l.imageUrl ?? null,
          postedAt: l.postedAt ?? null,
        },
      }))
    );

    // v1.4: Record initial price history for each new listing
    await Promise.all(
      createdListings.map(l => db.priceHistory.create({
        data: {
          listingId: l.id,
          price: l.price,
          priceText: l.priceText,
        },
      }))
    );

    // v1.4: For existing listings, check if price changed and record history
    // (we already filtered to fresh only, so this is for the next run)
    // This logic is in runMonitor - check existing listings seen again with new price
    const existingListingsWithSameExternalId = await db.listing.findMany({
      where: {
        monitorId: monitor.id,
        externalId: { in: listings.filter(l => existingIds.has(l.externalId)).map(l => l.externalId) },
      },
      select: { id: true, externalId: true, price: true, priceText: true, title: true, url: true, aiVerdict: true },
    });
    let priceDropAlerts = 0;
    for (const existing of existingListingsWithSameExternalId) {
      const newListings = listings.find(l => l.externalId === existing.externalId);
      if (!newListings) continue;
      // If price changed, record new entry
      if (newListings.price !== existing.price || newListings.priceText !== existing.priceText) {
        await db.priceHistory.create({
          data: {
            listingId: existing.id,
            price: newListings.price ?? null,
            priceText: newListings.priceText,
          },
        });
        // v2.0: Price drop alert — if price DECREASED, send alert
        if (newListings.price != null && existing.price != null && newListings.price < existing.price) {
          const dropAmount = existing.price - newListings.price;
          const dropPct = Math.round((dropAmount / existing.price) * 100);

          const alertBody = formatAlertMessage({
            monitorName: monitor.name,
            title: `📉 CENA PADLA: ${existing.title}`,
            priceText: `${newListings.priceText} (prej ${existing.priceText})`,
            url: existing.url,
            aiScore: null,
            aiRisk: null,
            aiVerdict: existing.aiVerdict,
            aiReason: `Cena padla za ${dropAmount}€ (${dropPct}%). Morda je zdaj pravi čas za nakup.`,
            estimatedValue: null,
          });

          const alert = await db.alert.create({
            data: {
              monitorId: monitor.id,
              listingId: existing.id,
              title: `📉 ${existing.title}`,
              body: alertBody,
              url: existing.url,
              aiVerdict: 'PRILIKA',
            },
          });

          // Send notifications
          if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
            const inlineButtons = settings.telegramInlineButtons
              ? buildAlertInlineButtons({ alertId: alert.id, listingUrl: existing.url, dashboardUrl: 'http://localhost:3000/alerts' })
              : undefined;
            await sendTelegramMessage(
              { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
              alertBody,
              { inlineButtons }
            );
          }
          if (settings.discordEnabled && settings.discordWebhookUrl) {
            const embed = buildAlertEmbed({
              monitorName: monitor.name,
              title: `📉 CENA PADLA: ${existing.title}`,
              priceText: `${newListings.priceText} (prej ${existing.priceText})`,
              url: existing.url,
              aiVerdict: 'PRILIKA',
              aiReason: `Cena padla za ${dropAmount}€ (${dropPct}%).`,
              aiScore: null,
              aiRisk: null,
            });
            await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
          }
          if (settings.pushEnabled) {
            await sendPushNotification({
              title: `📉 Cena padla: ${existing.title.slice(0, 50)}`,
              body: `${newListings.priceText} (prej ${existing.priceText}) — ${dropPct}% nižje!`,
              url: '/alerts',
            });
          }
          priceDropAlerts++;
        }

        // v2.0: Update listing with previous price for tracking
        await db.listing.update({
          where: { id: existing.id },
          data: {
            price: newListings.price ?? null,
            priceText: newListings.priceText,
            previousPrice: existing.price,
            priceDroppedAt: newListings.price != null && existing.price != null && newListings.price < existing.price ? new Date() : null,
          },
        });
      }
    }

    // Evaluate each fresh listing with AI
    for (let i = 0; i < createdListings.length; i++) {
      const listing = createdListings[i];
      const scraped = fresh[i];
      let evaluation: ListingEvaluation | null = null;
      let evalError: string | null = null;

      try {
        // v1.1: download image if enabled and listing has imageUrl
        let imageBase64: string | null = null;
        if (settings.imageAnalysisEnabled && listing.imageUrl) {
          imageBase64 = await downloadImageAsBase64(listing.imageUrl, { timeoutMs: 8000 });
        }

        evaluation = await evaluateListing(aiSettings, {
          title: listing.title,
          priceText: listing.priceText,
          price: listing.price,
          location: listing.location,
          description: listing.description,
          source: monitor.source,
          monitorName: monitor.name,
          customPrompt: monitor.customPrompt,
          imageBase64,
          imageUrl: listing.imageUrl ?? null,
        });
      } catch (e: any) {
        evalError = e?.message ?? 'AI eval error';
      }

      if (evaluation) {
        await db.listing.update({
          where: { id: listing.id },
          data: {
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            aiVerdict: evaluation.verdict,
            aiReason: evaluation.razlog,
            aiEstimatedValue: evaluation.predvidena_trzna_vrednost ?? null,
            aiEvaluatedAt: new Date(),
            aiImageAnalysis: evaluation.image_analysis ?? null,
            aiImageVerdict: evaluation.image_verdict ?? null,
          },
        });

        // Check thresholds for alert
        const meetsOpp = evaluation.ocena_prilike >= settings.minOpportunityScore;
        const meetsRisk = evaluation.ocena_tveganja <= settings.maxRiskScore;
        const isPrilika = evaluation.prilika || evaluation.verdict === 'PRILIKA';

        if ((isPrilika && meetsRisk) || (meetsOpp && meetsRisk)) {
          const alertBody = formatAlertMessage({
            monitorName: monitor.name,
            title: listing.title,
            priceText: listing.priceText,
            url: listing.url,
            location: listing.location || undefined,
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            aiVerdict: evaluation.verdict,
            aiReason: evaluation.razlog,
            estimatedValue: evaluation.predvidena_trzna_vrednost ?? null,
            imageAnalysis: evaluation.image_analysis ?? null,
          });

          const alert = await db.alert.create({
            data: {
              monitorId: monitor.id,
              listingId: listing.id,
              title: listing.title,
              body: alertBody,
              url: listing.url,
              aiScore: evaluation.ocena_prilike,
              aiRisk: evaluation.ocena_tveganja,
              aiVerdict: evaluation.verdict,
            },
          });

          // v2.2: Check quiet hours and monitor-specific channels
          const inQuietHours = settings.quietHoursEnabled &&
            isInQuietHours(settings.quietStartHour, settings.quietEndHour);
          const monitorChannels = getMonitorChannels(monitor.notificationChannels);
          // Use monitor-specific channels if set, otherwise fall back to global
          const useTelegram = monitorChannels ? monitorChannels.telegram : settings.telegramEnabled;
          const useDiscord = monitorChannels ? monitorChannels.discord : settings.discordEnabled;
          const useSlack = monitorChannels ? monitorChannels.slack : settings.slackEnabled;
          const usePush = monitorChannels ? monitorChannels.push : settings.pushEnabled;

          // Skip notifications during quiet hours (but still create alert in DB)
          if (!inQuietHours) {
            // Send Telegram if enabled
            if (useTelegram && settings.telegramBotToken && settings.telegramChatId) {
              const inlineButtons = settings.telegramInlineButtons
                ? buildAlertInlineButtons({
                    alertId: alert.id,
                    listingUrl: listing.url,
                    dashboardUrl: 'http://localhost:3000/alerts',
                  })
                : undefined;
              const tg = await sendTelegramMessage(
                { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
                alertBody,
                { inlineButtons }
              );
              await db.alert.update({
                where: { id: alert.id },
                data: {
                  sentTelegram: tg.ok,
                  telegramSentAt: tg.ok ? new Date() : null,
                  telegramError: tg.ok ? null : tg.error,
                },
              });
              if (tg.ok) alertsSent++;
            }

            // v1.4: Send Discord if enabled
            if (useDiscord && settings.discordWebhookUrl) {
              const embed = buildAlertEmbed({
                monitorName: monitor.name,
                title: listing.title,
                priceText: listing.priceText,
                url: listing.url,
                location: listing.location || undefined,
                aiScore: evaluation.ocena_prilike,
                aiRisk: evaluation.ocena_tveganja,
                aiVerdict: evaluation.verdict,
                aiReason: evaluation.razlog,
                estimatedValue: evaluation.predvidena_trzna_vrednost ?? null,
                imageAnalysis: evaluation.image_analysis ?? null,
                imageUrl: listing.imageUrl ?? null,
              });
              const dc = await sendDiscordMessage(
                { webhookUrl: settings.discordWebhookUrl },
                embed
              );
              if (dc.ok && alertsSent === 0) alertsSent++;
            }

            // v2.1: Send Slack if enabled
            if (useSlack && settings.slackWebhookUrl) {
              const blocks = buildAlertSlackBlocks({
                title: listing.title,
                priceText: listing.priceText,
                url: listing.url,
                monitorName: monitor.name,
                aiScore: evaluation.ocena_prilike,
                aiRisk: evaluation.ocena_tveganja,
                aiVerdict: evaluation.verdict,
                aiReason: evaluation.razlog,
                estimatedValue: evaluation.predvidena_trzna_vrednost ?? null,
              });
              const sl = await sendSlackMessage(
                { webhookUrl: settings.slackWebhookUrl },
                `🎯 ${listing.title}`,
                blocks
              );
              if (sl.ok && alertsSent === 0) alertsSent++;
            }

            // v1.5: Send browser push notification if enabled
            if (usePush) {
              await sendPushNotification({
                title: `${evaluation.verdict === 'PRILIKA' ? '🎯' : evaluation.verdict === 'SUMNJIVO' ? '⚠️' : '•'} ${listing.title.slice(0, 60)}`,
                body: `${listing.priceText} • ${monitor.name} (prilika ${evaluation.ocena_prilike}/10, tveganje ${evaluation.ocena_tveganja}/10)`,
                url: '/alerts',
              });
            }
          }

          // If neither enabled or in quiet hours, still count as alert for stats
          if (!useTelegram && !useDiscord && !useSlack && !usePush) {
            alertsSent++;
          }
        }
      } else if (evalError) {
        // Save evaluation error on listing
        await db.listing.update({
          where: { id: listing.id },
          data: { aiReason: `Napaka pri oceni: ${evalError}` },
        });
      }
    }

    // v2.0: Add price drop alerts to total
    alertsSent += priceDropAlerts;

    await db.runLog.update({
      where: { id: runLog.id },
      data: {
        status: 'ok',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        listingsFound: listings.length,
        newListings: fresh.length,
        alertsSent,
      },
    });
    await db.monitor.update({
      where: { id: monitor.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'ok',
        lastError: null,
        // v1.3: reset consecutive error counter on success
        consecutiveErrors: 0,
      },
    });

    return {
      status: 'ok',
      listingsFound: listings.length,
      newListings: fresh.length,
      alertsSent,
      durationMs: Date.now() - startedAt,
    };
  } catch (e: any) {
    const error = e?.message ?? 'Neznana napaka';
    if (runLogId) {
      await db.runLog.update({
        where: { id: runLogId },
        data: {
          status: 'error',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          error,
        },
      });
    }
    // v1.3: increment consecutive errors and auto-pause if threshold reached
    const newErrorCount = monitor.consecutiveErrors + 1;
    const shouldAutoPause =
      monitor.autoPauseThreshold > 0 &&
      newErrorCount >= monitor.autoPauseThreshold;

    await db.monitor.update({
      where: { id: monitor.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'error',
        lastError: error,
        consecutiveErrors: newErrorCount,
        ...(shouldAutoPause
          ? { isActive: false, autoPausedAt: new Date() }
          : {}),
      },
    });

    return {
      status: 'error',
      listingsFound: 0,
      newListings: 0,
      alertsSent: 0,
      error: shouldAutoPause
        ? `${error} (AUTO-PAUSED po ${newErrorCount} zaporednih napakah)`
        : error,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Run all active monitors whose interval has elapsed. Used by the cron endpoint. */
export async function runDueMonitors(): Promise<{ ran: number; results: RunResult[]; skipped: number; autoPaused: number }> {
  const now = new Date();
  const monitors = await db.monitor.findMany({ where: { isActive: true } });
  const currentHour = now.getHours();

  const due: typeof monitors = [];
  let skipped = 0;
  let autoPaused = 0;
  for (const m of monitors) {
    // Interval check
    if (m.lastRunAt) {
      const elapsed = now.getTime() - m.lastRunAt.getTime();
      if (elapsed < m.intervalMinutes * 60 * 1000) continue;
    }
    // v1.2: schedule window check
    if (m.runStartHour != null && m.runEndHour != null) {
      const start = m.runStartHour;
      const end = m.runEndHour;
      // Handle wrap-around (e.g. 22-6 = night)
      const inWindow = start <= end
        ? (currentHour >= start && currentHour < end)
        : (currentHour >= start || currentHour < end);
      if (!inWindow) {
        skipped++;
        continue;
      }
    }
    due.push(m);
  }
  const results: RunResult[] = [];
  for (const m of due) {
    const r = await runMonitor(m.id);
    // v1.3: check if monitor was auto-paused by this run
    if (r.status === 'error') {
      const updated = await db.monitor.findUnique({
        where: { id: m.id },
        select: { isActive: true, autoPausedAt: true },
      });
      if (updated && !updated.isActive && updated.autoPausedAt) {
        autoPaused++;
      }
    }
    results.push(r);
  }
  return { ran: due.length, results, skipped, autoPaused };
}

/**
 * v1.1: Heartbeat — sends daily summary to Telegram if it's the right hour
 * and we haven't sent one in the last 23 hours.
 *
 * Designed to be called by the same cron as runDueMonitors (every 5-10 min).
 * It will only actually send a message at the configured hour.
 */
export async function maybeSendHeartbeat(): Promise<{ sent: boolean; reason: string; logId?: string }> {
  const settings = await getSettingsRow();
  if (!settings.heartbeatEnabled) {
    return { sent: false, reason: 'heartbeat onemogočen' };
  }
  if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
    return { sent: false, reason: 'telegram ni konfiguriran' };
  }

  const now = new Date();
  // Check if we're in the right hour
  if (now.getHours() !== settings.heartbeatHour) {
    return { sent: false, reason: `ni ura (${now.getHours()} != ${settings.heartbeatHour})` };
  }
  // Check if we already sent in the last 23 hours
  if (settings.lastHeartbeatAt) {
    const elapsedH = (now.getTime() - settings.lastHeartbeatAt.getTime()) / (60 * 60 * 1000);
    if (elapsedH < 23) {
      return { sent: false, reason: `že poslano pred ${elapsedH.toFixed(1)}h` };
    }
  }

  // Compute stats for last 24h
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const periodEnd = now;

  const [runs, activeMonitors, newListings, alerts] = await Promise.all([
    db.runLog.findMany({
      where: { startedAt: { gte: periodStart, lte: periodEnd } },
      select: { status: true, listingsFound: true, newListings: true, alertsSent: true },
    }),
    db.monitor.count({ where: { isActive: true } }),
    db.listing.count({ where: { firstSeenAt: { gte: periodStart, lte: periodEnd } } }),
    db.alert.findMany({
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
      select: { aiVerdict: true },
    }),
  ]);

  const totalRuns = runs.length;
  const successfulRuns = runs.filter(r => r.status === 'ok').length;
  const failedRuns = runs.filter(r => r.status === 'error').length;
  const totalAlerts = alerts.length;
  const prilikaAlerts = alerts.filter(a => a.aiVerdict === 'PRILIKA').length;
  const sumnjivoAlerts = alerts.filter(a => a.aiVerdict === 'SUMNJIVO').length;

  // Build and send message
  const { formatHeartbeatMessage, buildHeartbeatInlineButtons } = await import('./telegram');
  const { buildHeartbeatEmbed } = await import('./discord');
  const message = formatHeartbeatMessage({
    periodStart,
    periodEnd,
    totalRuns,
    successfulRuns,
    failedRuns,
    newListings,
    totalAlerts,
    prilikaAlerts,
    sumnjivoAlerts,
    activeMonitors,
  });

  let telegramOk = false;
  let telegramError: string | null = null;
  let discordOk = false;
  let discordError: string | null = null;

  // Send to Telegram
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    const inlineButtons = buildHeartbeatInlineButtons('http://localhost:3000');
    const tg = await sendTelegramMessage(
      { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
      message,
      { inlineButtons }
    );
    telegramOk = tg.ok;
    telegramError = tg.ok ? null : tg.error ?? null;
  }

  // v1.4: Send to Discord
  if (settings.discordEnabled && settings.discordWebhookUrl) {
    const embed = buildHeartbeatEmbed({
      periodStart, periodEnd,
      totalRuns, successfulRuns, failedRuns,
      newListings, totalAlerts, prilikaAlerts, sumnjivoAlerts,
      activeMonitors,
    });
    const dc = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
    discordOk = dc.ok;
    discordError = dc.ok ? null : dc.error ?? null;
  }

  const sentOk = telegramOk || discordOk;
  const combinedError = [telegramError, discordError].filter(Boolean).join('; ') || null;

  // Log to DB
  const log = await db.heartbeatLog.create({
    data: {
      sentAt: now,
      periodStart,
      periodEnd,
      totalRuns,
      successfulRuns,
      failedRuns,
      totalListings: runs.reduce((s, r) => s + r.listingsFound, 0),
      newListings,
      totalAlerts,
      prilikaAlerts,
      sumnjivoAlerts,
      activeMonitors,
      sentTelegram: telegramOk || discordOk,
      telegramError: combinedError,
      message,
    },
  });

  // Update last heartbeat time
  await db.settings.update({
    where: { id: 'singleton' },
    data: { lastHeartbeatAt: now },
  });

  return {
    sent: sentOk,
    reason: sentOk ? 'poslano' : `napaka: ${combinedError}`,
    logId: log.id,
  };
}
