// v5.7: AI Monthly Report — comprehensive monthly analysis with AI
// POST /api/ai/monthly-report
// Body: { month?: string (YYYY-MM, default current), sendEmail?: boolean, sendTelegram?: boolean }
// Returns: { ok, report, stats, sentTo }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthStr = body?.month || new Date().toISOString().slice(0, 7);
    const sendEmail = body?.sendEmail === true;
    const sendTelegram = body?.sendTelegram === true;

    const monthStart = new Date(monthStr + '-01T00:00:00.000Z');
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

    // Gather all data for the month
    const [listings, alerts, trades, soldTrades, runLogs] = await Promise.all([
      db.listing.findMany({
        where: { firstSeenAt: { gte: monthStart, lt: monthEnd } },
        select: { id: true, title: true, price: true, aiVerdict: true, aiScore: true, dealScore: true, aiEstimatedValue: true, monitor: { select: { name: true, source: true } } },
        take: 500,
      }),
      db.alert.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
      db.trade.findMany({
        where: { buyDate: { gte: monthStart, lt: monthEnd } },
        select: { id: true, title: true, buyPrice: true, sellPrice: true, status: true, category: true, buyDate: true, sellDate: true },
        take: 100,
      }),
      db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: monthStart, lt: monthEnd } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, title: true, category: true },
        take: 100,
      }),
      db.runLog.findMany({
        where: { startedAt: { gte: monthStart, lt: monthEnd } },
        select: { status: true, newListings: true, alertsSent: true, durationMs: true },
        take: 500,
      }),
    ]);

    // Calculate metrics
    const realizedProfit = soldTrades.reduce((s, t) =>
      s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const totalInvested = trades.filter(t => t.status === 'held').reduce((s, t) => s + t.buyPrice, 0);
    const avgRoi = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
          const cost = t.buyPrice + (t.buyFees ?? 0);
          return s + (cost > 0 ? profit / cost : 0);
        }, 0) / soldTrades.length * 100)
      : 0;

    const prilikaCount = listings.filter(l => l.aiVerdict === 'PRILIKA').length;
    const sumnjivoCount = listings.filter(l => l.aiVerdict === 'SUMNJIVO').length;
    const successRate = runLogs.length > 0 ? Math.round(runLogs.filter(r => r.status === 'ok').length / runLogs.length * 100) : 0;

    // Category breakdown
    const byCategory: Record<string, { count: number; profit: number }> = {};
    for (const t of soldTrades) {
      const cat = t.category || 'brez';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0 };
      byCategory[cat].count++;
      byCategory[cat].profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    }

    // AI generates the report
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const monthLabel = monthStart.toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });

    // If no data, return early
    if (listings.length === 0 && trades.length === 0 && alerts === 0) {
      const emptyReport = `📊 *MESEČNO POROČILO — ${monthLabel}*\n\nV tem mesecu ni bilo aktivnosti.`;
      return NextResponse.json({
        ok: true,
        report: emptyReport,
        stats: { month: monthStr, listings: 0, alerts: 0, trades: 0, soldTrades: 0, realizedProfit: 0 },
        sentTo: { telegram: false, email: false },
      });
    }

    const prompt = `Si pomočnik za mesečna poročila o aktivnosti na slovenskih spletnih oglasih.
Napiši jedrnato mesečno poročilo za ${monthLabel} v slovenščini, primerno za Telegram/Email (Markdown format).

Statistika za ${monthLabel}:
- Novih oglasov: ${listings.length}
- Alertov: ${alerts}
- Novih tradeov: ${trades.length}
- Prodanih tradeov: ${soldTrades.length}
- Realizirani dobiček: ${realizedProfit}€
- Povprečni ROI: ${avgRoi}%
- V investiciji (held): ${totalInvested}€
- AI PRILIKA: ${prilikaCount}, SUMNJIVO: ${sumnjivoCount}
- Success rate monitorjev: ${successRate}%
- Skupaj poganjanj: ${runLogs.length}

Kategorije prodanih:
${Object.entries(byCategory).map(([cat, v]) => `- ${cat}: ${v.count} prodaj, ${v.profit.toFixed(0)}€ dobička`).join('\n')}

Top 5 oglasov z najvišjim deal score:
${listings.filter(l => l.dealScore != null).sort((a, b) => b.dealScore! - a.dealScore!).slice(0, 5).map((l, i) => `${i + 1}. ${l.title} (${l.price}€, 🎯${l.dealScore})`).join('\n') || 'Ni podatkov'}

Strukturaj poročilo:
1. Naslov z mesecem
2. Executive summary (1-2 stavka)
3. Ključne številke (bullet list)
4. TOP 3 najboljše priložnosti
5. Analiza dobička
6. Priporočila za naslednji mesec

Dolžina: 300-600 besed. Markdown format z *bold* in _italic_.

Odgovori LE z JSON: {"report": "<celotno poročilo v markdown>"}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fallbackSettings: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fallbackSettings, prompt);
      } else {
        throw primaryError;
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const report = String(parsed?.report ?? raw).slice(0, 5000);

    // Increment AI usage counter
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsDate: today, aiCallsToday: 1 },
      });
    } else {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { aiCallsToday: { increment: 1 } },
      });
    }

    // Send to Telegram
    let telegramSent = false;
    if (sendTelegram && settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      try {
        const { sendTelegramMessage } = await import('@/lib/telegram');
        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          report
        );
        telegramSent = true;
      } catch { /* ignore */ }
    }

    // Send to Email
    let emailSent = false;
    if (sendEmail && settings.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
      try {
        const { sendEmail } = await import('@/lib/email');
        const html = report.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');
        await sendEmail({
          smtpHost: settings.emailSmtpHost,
          smtpPort: settings.emailSmtpPort,
          smtpUser: settings.emailSmtpUser,
          smtpPassword: settings.emailSmtpPassword,
          from: settings.emailFrom,
          to: settings.emailTo,
        }, `📊 Markec AI — Mesečno poročilo (${monthLabel})`, `<div style="font-family: monospace; padding: 16px;">${html}</div>`);
        emailSent = true;
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      ok: true,
      report,
      stats: {
        month: monthStr,
        monthLabel,
        listings: listings.length,
        alerts,
        trades: trades.length,
        soldTrades: soldTrades.length,
        realizedProfit,
        avgRoi,
        totalInvested,
        prilikaCount,
        sumnjivoCount,
        successRate,
        runLogs: runLogs.length,
        byCategory,
      },
      sentTo: { telegram: telegramSent, email: emailSent },
    });
  } catch (e: any) {
    logger.error("/api/ai/monthly-report", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
