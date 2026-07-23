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
import { evaluateListing, type AiSettings, type ListingEvaluation } from './ai';
import { sendTelegramMessage, formatAlertMessage } from './telegram';

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
}): AiSettings {
  return {
    provider: s.aiProvider as AiSettings['provider'],
    baseUrl: s.aiBaseUrl,
    apiKey: s.aiApiKey,
    model: s.aiModel,
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
    const listings = await scrape(monitor.source as SourceType, monitor.sourceUrl, filters);

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

    // Evaluate each fresh listing with AI
    for (let i = 0; i < createdListings.length; i++) {
      const listing = createdListings[i];
      const scraped = fresh[i];
      let evaluation: ListingEvaluation | null = null;
      let evalError: string | null = null;

      try {
        evaluation = await evaluateListing(aiSettings, {
          title: listing.title,
          priceText: listing.priceText,
          price: listing.price,
          location: listing.location,
          description: listing.description,
          source: monitor.source,
          monitorName: monitor.name,
          customPrompt: monitor.customPrompt,
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

          // Send Telegram if enabled
          if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
            const tg = await sendTelegramMessage(
              { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
              alertBody
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
          } else {
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
      data: { lastRunAt: new Date(), lastStatus: 'ok', lastError: null },
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
    await db.monitor.update({
      where: { id: monitor.id },
      data: { lastRunAt: new Date(), lastStatus: 'error', lastError: error },
    });
    return { status: 'error', listingsFound: 0, newListings: 0, alertsSent: 0, error, durationMs: Date.now() - startedAt };
  }
}

/** Run all active monitors whose interval has elapsed. Used by the cron endpoint. */
export async function runDueMonitors(): Promise<{ ran: number; results: RunResult[] }> {
  const now = new Date();
  const monitors = await db.monitor.findMany({ where: { isActive: true } });
  const due = monitors.filter(m => {
    if (!m.lastRunAt) return true;
    const elapsed = now.getTime() - m.lastRunAt.getTime();
    return elapsed >= m.intervalMinutes * 60 * 1000;
  });
  const results: RunResult[] = [];
  for (const m of due) {
    const r = await runMonitor(m.id);
    results.push(r);
  }
  return { ran: due.length, results };
}
