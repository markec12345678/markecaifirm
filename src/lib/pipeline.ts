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
import { scrape, scrapeMulti, type SourceType, type ScraperFilters } from './scraper';
import { evaluateListing, downloadImageAsBase64, type AiSettings, type AiProviderType, type ListingEvaluation } from './ai';
import { formatAlertMessage, buildAlertInlineButtons, sendTelegramMessage } from './telegram';
import { sendDiscordMessage } from './discord';
import { calculatePriority } from './smart-push';
import { decryptSettingsFromStorage } from './secrets';
import { getAppUrl } from './app-url';
// v9.83: Unified notification dispatch — replaces 3× duplicated notification blocks
import { dispatchAlert, triggerAlertWebhooks, type NotificationSettings, type AlertDispatchData, type DeliveryResult } from './dispatch-alerts';
import { progressStart, progressUpdate, progressDone, progressError, progressAddListing, progressUpdateListing } from './scraper-progress';

/** v3.2: Increment AI call counter, reset if date changed. */
async function trackAiCall() {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await db.settings.findUnique({ where: { id: 'singleton' }, select: { aiCallsToday: true, aiCallsDate: true } });
  if (!settings) return;
  if (settings.aiCallsDate !== today) {
    // New day — reset counter
    await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: 1, aiCallsDate: today } });
  } else {
    await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
  }
}

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
  // v7.32: Decrypt sensitive fields on read (no-op if APP_API_KEY unset)
  return decryptSettingsFromStorage(s);
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

  progressStart(monitor.id, monitor.name);

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
    progressUpdate(monitor.id, { status: 'scraping', step: 'Pridobivam oglase...', progress: 5 });
    await new Promise(r => setTimeout(r, 300)); // 0.3s delay for UI to pick up
    const preSettings = await getSettingsRow();

    // Emit progress every 3s while scraping
    let scrapeSeconds = 0;
    const scrapeTimer = setInterval(() => {
      scrapeSeconds += 3;
      // Scraping is ~20-30s, cap at 30%
      const pct = Math.min(5 + Math.round((scrapeSeconds / 30) * 25), 30);
      progressUpdate(monitor.id, { step: `Pridobivam oglase... (${scrapeSeconds}s)`, progress: pct });
    }, 3000);

    let listings;
    try {
      // Check if monitor has multiple source URLs
      let sourceUrls: string[] = [];
      try { sourceUrls = JSON.parse(monitor.sourceUrls || '[]'); } catch {}
      
      if (sourceUrls.length > 1) {
        listings = await scrapeMulti(
          monitor.source as SourceType,
          sourceUrls,
          filters,
          {
            playwrightEnabled: preSettings.playwrightEnabled,
            onProgress: (msg) => progressUpdate(monitor.id, { step: msg }),
          }
        );
      } else {
        listings = await scrape(
          monitor.source as SourceType,
          monitor.sourceUrl,
          filters,
          {
            playwrightEnabled: preSettings.playwrightEnabled,
            onProgress: (msg) => progressUpdate(monitor.id, { step: msg }),
          }
        );
      }
    } finally {
      clearInterval(scrapeTimer);
    }

    // Add all found listings to progress
    for (const l of listings) {
      progressAddListing(monitor.id, {
        id: l.externalId,
        title: l.title,
        price: l.priceText || (l.price != null ? `${l.price}€` : '?'),
        url: l.url,
        location: l.location || undefined,
        isNew: false,
      });
    }

    if (listings.length === 0) {
      progressDone(monitor.id);
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
    progressUpdate(monitor.id, { status: 'dedup', step: `Primerjam ${listings.length} oglasov z znanimi...`, listingsFound: listings.length, progress: 35 });
    await new Promise(r => setTimeout(r, 800)); // 0.8s for UI to see dedup step
    const externalIds = listings.map(l => l.externalId);
    const existing = await db.listing.findMany({
      where: { monitorId: monitor.id, externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map(e => e.externalId));
    const fresh = listings.filter(l => !existingIds.has(l.externalId));

    // Mark new listings in progress
    for (const l of fresh) {
      progressUpdateListing(monitor.id, l.externalId, { isNew: true });
    }
    progressUpdate(monitor.id, { step: `Najdenih ${fresh.length} novih oglasov od ${listings.length}`, newListings: fresh.length, progress: 40 });
    await new Promise(r => setTimeout(r, 800)); // 0.8s for UI to see dedup result

    if (fresh.length === 0) {
      progressDone(monitor.id);
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
    progressUpdate(monitor.id, { status: 'ai-evaluating', step: `AI ocenjuje ${fresh.length} novih oglasov...`, newListings: fresh.length, aiTotal: fresh.length, aiEvaluated: 0, progress: 45 });
    await new Promise(r => setTimeout(r, 800)); // 0.8s for UI to see AI step start
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

          // v9.83: Unified notification dispatch
          await triggerAlertWebhooks('price.drop', {
            alertId: alert.id,
            monitorId: monitor.id,
            listingId: existing.id,
            title: existing.title,
            oldPrice: existing.price,
            newPrice: newListings.price,
            dropAmount,
            dropPct,
            url: existing.url,
          });

          const delivery = await dispatchAlert(
            settings as NotificationSettings,
            monitor.notificationChannels,
            {
              alertId: alert.id,
              monitorId: monitor.id,
              monitorName: monitor.name,
              listingId: existing.id,
              title: `📉 CENA PADLA: ${existing.title}`,
              priceText: `${newListings.priceText} (prej ${existing.priceText})`,
              url: existing.url,
              aiScore: null,
              aiRisk: null,
              aiVerdict: 'PRILIKA',
              aiReason: `Cena padla za ${dropAmount}€ (${dropPct}%).`,
              alertBody,
            },
            'high',
          );

          if (delivery.alertsSentCount > 0) alertsSent++;
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

    // v4.5: Target price alerts — check ALL listings (existing + freshly updated) against their targetPrice
    // Query current state from DB to get targetPrice fields
    const listingsWithTargets = await db.listing.findMany({
      where: {
        monitorId: monitor.id,
        targetPrice: { not: null },
        targetPriceAlertSent: false,
        price: { not: null },
      },
      select: {
        id: true, title: true, url: true, price: true, priceText: true,
        targetPrice: true, aiVerdict: true, monitor: { select: { name: true } },
      },
    });
    let targetPriceAlerts = 0;
    for (const l of listingsWithTargets) {
      if (l.price == null || l.targetPrice == null) continue;
      if (l.price <= l.targetPrice) {
        const savings = l.targetPrice - l.price;
        const alertBody = formatAlertMessage({
          monitorName: l.monitor.name,
          title: `🎯 CILJNA CENA DOSEŽENA: ${l.title}`,
          priceText: `${l.priceText} (cilj ${l.targetPrice}€ — ${savings}€ pod ciljem)`,
          url: l.url,
          aiScore: null,
          aiRisk: null,
          aiVerdict: l.aiVerdict,
          aiReason: `Cena je dosegla tvojo ciljno mejo ${l.targetPrice}€. Trenutna cena ${l.price}€ je za ${savings}€ pod ciljem — morda je pravi čas za nakup.`,
          estimatedValue: null,
        });

        const alert = await db.alert.create({
          data: {
            monitorId: monitor.id,
            listingId: l.id,
            title: `🎯 ${l.title}`,
            body: alertBody,
            url: l.url,
            aiVerdict: 'PRILIKA',
          },
        });

        // v9.83: Unified notification dispatch
        await triggerAlertWebhooks('target.hit', {
          alertId: alert.id,
          monitorId: monitor.id,
          listingId: l.id,
          title: l.title,
          currentPrice: l.price,
          targetPrice: l.targetPrice,
          savings,
          url: l.url,
        });

        const delivery = await dispatchAlert(
          settings as NotificationSettings,
          monitor.notificationChannels,
          {
            alertId: alert.id,
            monitorId: monitor.id,
            monitorName: l.monitor.name,
            listingId: l.id,
            title: `🎯 CILJNA CENA DOSEŽENA: ${l.title}`,
            priceText: `${l.priceText} (cilj ${l.targetPrice}€)`,
            url: l.url,
            aiScore: null,
            aiRisk: null,
            aiVerdict: 'PRILIKA',
            aiReason: `Tvoja ciljna cena dosežena — ${savings}€ pod ciljem.`,
            alertBody,
          },
          'critical',
        );

        if (delivery.alertsSentCount > 0) alertsSent++;
        targetPriceAlerts++;

        // Mark alert as sent to prevent spam
        await db.listing.update({
          where: { id: l.id },
          data: { targetPriceAlertSent: true },
        });
      }
    }

    // Evaluate each fresh listing with AI
    for (let i = 0; i < createdListings.length; i++) {
      const aiPct = Math.round(45 + ((i + 1) / createdListings.length) * 50);
      progressUpdate(monitor.id, { step: `AI ocenjuje oglas ${i + 1}/${createdListings.length}: ${fresh[i].title.slice(0, 40)}...`, aiEvaluated: i, progress: aiPct });
      await new Promise(r => setTimeout(r, 200)); // 0.2s delay for UI to see each step
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

        // v3.2: Track AI call
        await trackAiCall();

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
            dealScore: evaluation.deal_score ?? null,
            dealScoreReason: evaluation.razlog,
            dealScoreComputedAt: new Date(),
            aiEvaluatedAt: new Date(),
            aiImageAnalysis: evaluation.image_analysis ?? null,
            aiImageVerdict: evaluation.image_verdict ?? null,
          },
        });

        // Update listing in progress with AI scores
        progressUpdateListing(monitor.id, scraped.externalId, {
          aiScore: evaluation.ocena_prilike,
          aiRisk: evaluation.ocena_tveganja,
          aiVerdict: evaluation.verdict,
          aiReason: evaluation.razlog,
          dealScore: evaluation.deal_score ?? undefined,
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

          // v9.83: Unified notification dispatch
          await triggerAlertWebhooks('alert.created', {
            alertId: alert.id,
            monitorId: monitor.id,
            listingId: listing.id,
            title: listing.title,
            url: listing.url,
            priceText: listing.priceText,
            price: listing.price,
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            aiVerdict: evaluation.verdict,
            aiReason: evaluation.razlog,
            estimatedValue: evaluation.predvidena_trzna_vrednost,
          });

          // Calculate priority for push notifications
          const pushPriority = calculatePriority({
            aiVerdict: evaluation.verdict,
            aiScore: evaluation.ocena_prilike,
            aiRisk: evaluation.ocena_tveganja,
            dealScore: listing.dealScore ?? null,
          });

          const delivery = await dispatchAlert(
            settings as NotificationSettings,
            monitor.notificationChannels,
            {
              alertId: alert.id,
              monitorId: monitor.id,
              monitorName: monitor.name,
              listingId: listing.id,
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
              alertBody,
            },
            pushPriority,
          );

          // Update alert with delivery status
          if (delivery.alertsSentCount > 0) {
            await db.alert.update({
              where: { id: alert.id },
              data: {
                sentTelegram: delivery.sentTelegram,
                telegramSentAt: delivery.telegramSentAt,
                telegramError: delivery.telegramError,
                sentDiscord: delivery.sentDiscord,
                discordError: delivery.discordError,
                sentSlack: delivery.sentSlack,
                slackError: delivery.slackError,
                sentPush: delivery.sentPush,
                pushError: delivery.pushError,
                sentEmail: delivery.sentEmail,
                emailError: delivery.emailError,
              },
            });
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
    // v4.5: Add target price alerts to total
    alertsSent += targetPriceAlerts;

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

    progressUpdate(monitor.id, { status: 'done', step: `Končano — ${fresh.length} novih, ${alertsSent} alertov`, progress: 100 });
    await new Promise(r => setTimeout(r, 500)); // 0.5s delay so UI shows final state
    progressDone(monitor.id);
    return {
      status: 'ok',
      listingsFound: listings.length,
      newListings: fresh.length,
      alertsSent,
      durationMs: Date.now() - startedAt,
    };
  } catch (e: any) {
    const error = e?.message ?? 'Neznana napaka';
    progressError(monitor.id, error);
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

/** Force-run ALL active monitors immediately, ignoring intervals. Used by "Poženi vse" button. */
export async function forceRunAll(): Promise<{ ran: number; results: RunResult[] }> {
  const monitors = await db.monitor.findMany({ where: { isActive: true } });
  const results: RunResult[] = [];
  for (const m of monitors) {
    const r = await runMonitor(m.id);
    results.push(r);
  }
  return { ran: monitors.length, results };
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
    const inlineButtons = buildHeartbeatInlineButtons(getAppUrl());
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
