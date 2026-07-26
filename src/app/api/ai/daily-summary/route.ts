// v5.2: AI Deal Summary — dnevni AI povzetek najboljših priložnosti
// Pošlje se na Email in/ali Telegram ob dogovorjenem času
// POST /api/ai/daily-summary
// Body: { sendEmail?: boolean, sendTelegram?: boolean, hours?: number }
// Returns: { ok, summary, stats, sentTo: { email, telegram } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sendEmail = body?.sendEmail === true;
    const sendTelegram = body?.sendTelegram === true;
    const hoursRaw = typeof body?.hours === 'number' ? body.hours : Number(body?.hours);
    const hours = Number.isFinite(hoursRaw) ? Math.min(168, Math.max(1, hoursRaw)) : 24;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Gather top opportunities from last N hours
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: since },
        isHidden: false,
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 60 } },
        ],
      },
      orderBy: [
        { aiScore: 'desc' },
        { dealScore: 'desc' },
      ],
      take: 30,
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        location: true,
        url: true,
        aiVerdict: true,
        aiScore: true,
        aiRisk: true,
        aiReason: true,
        aiEstimatedValue: true,
        dealScore: true,
        dealScoreReason: true,
        targetPrice: true,
        firstSeenAt: true,
        monitor: { select: { name: true, source: true } },
      },
    });

    // Stats
    const [totalNewListings, totalAlerts, totalBookmarked, monitorsActive] = await Promise.all([
      db.listing.count({ where: { firstSeenAt: { gte: since } } }),
      db.alert.count({ where: { createdAt: { gte: since } } }),
      db.listing.count({ where: { isBookmarked: true, firstSeenAt: { gte: since } } }),
      db.monitor.count({ where: { isActive: true } }),
    ]);

    // Build summary
    let summary = '';
    let topPick: string | null = null;
    let recommendation: string | null = null;

    if (listings.length === 0) {
      summary = `📊 *DNEVNI POVZETEK (${hours}h)*\n\nV zadnjih ${hours} urah ni bilo novih priložnosti, ki bi zadoščale kriterijem (PRILIKA ali dealScore ≥ 60).\n\n*Statistika:*\n• Novih oglasov: ${totalNewListings}\n• Alertov: ${totalAlerts}\n• Shranjenih: ${totalBookmarked}\n• Aktivnih monitorjev: ${monitorsActive}`;
    } else {
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

      const prompt = buildSummaryPrompt(listings, { hours, totalNewListings, totalAlerts, totalBookmarked });

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
      summary = String(parsed?.summary ?? parsed?.povzetek ?? raw).slice(0, 4000);
      topPick = parsed?.top_pick ?? parsed?.topPick ?? null;
      recommendation = parsed?.recommendation ?? parsed?.priporocilo ?? null;

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
    }

    // Send to Telegram
    let telegramSent = false;
    if (sendTelegram) {
      const settings = await getSettingsRow();
      if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
        try {
          const { sendTelegramMessage } = await import('@/lib/telegram');
          await sendTelegramMessage(
            { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
            summary
          );
          telegramSent = true;
        } catch (e: any) {
          console.error('Telegram send failed:', e?.message);
        }
      }
    }

    // Send to Email
    let emailSent = false;
    if (sendEmail) {
      const settings = await getSettingsRow();
      if (settings.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
        try {
          const { sendEmail } = await import('@/lib/email');
          // Convert markdown to simple HTML
          const html = summary
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.+?)\*/g, '<i>$1</i>')
            .replace(/\n/g, '<br>');
          await sendEmail({
            smtpHost: settings.emailSmtpHost,
            smtpPort: settings.emailSmtpPort,
            smtpUser: settings.emailSmtpUser,
            smtpPassword: settings.emailSmtpPassword,
            from: settings.emailFrom,
            to: settings.emailTo,
          }, `📊 Markec AI — Povzetek (${hours}h)`, `<div style="font-family: monospace; padding: 16px;">${html}</div>`);
          emailSent = true;
        } catch (e: any) {
          console.error('Email send failed:', e?.message);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      summary,
      topPick,
      recommendation,
      sentTo: {
        telegram: telegramSent,
        email: emailSent,
      },
      stats: {
        hours,
        totalNewListings,
        totalAlerts,
        totalBookmarked,
        opportunitiesFound: listings.length,
        monitorsActive,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka pri AI povzetku' }, { status: 500 });
  }
}

function buildSummaryPrompt(listings: any[], stats: any): string {
  const lines: string[] = [
    'Si pomočnik za analizo priložnosti na slovenskih spletnih oglasih.',
    `Na podlagi spodnjih ${listings.length} oglasov iz zadnjih ${stats.hours} ur napiši jedrnat POVZETEK v slovenščini, primeren za Telegram sporočilo (Markdown).`,
    '',
    `Statistika: novih oglasov ${stats.totalNewListings}, alertov ${stats.totalAlerts}, shranjenih ${stats.totalBookmarked}, priložnosti v povzetku ${listings.length}.`,
    '',
    'Oglasi (urejeni po AI oceni prilike):',
    '',
  ];

  listings.slice(0, 15).forEach((l, i) => {
    lines.push(`--- Oglas #${i + 1} ---`);
    lines.push(`Naslov: ${l.title}`);
    lines.push(`Cena: ${l.priceText}${l.price ? ` (${l.price}€)` : ''}`);
    if (l.location) lines.push(`Lokacija: ${l.location}`);
    if (l.aiVerdict) lines.push(`AI verdikt: ${l.aiVerdict}`);
    if (l.aiScore != null) lines.push(`AI ocena prilike: ${l.aiScore}/10`);
    if (l.aiRisk != null) lines.push(`AI tveganje: ${l.aiRisk}/10`);
    if (l.dealScore != null) lines.push(`Deal Score: ${l.dealScore}/100`);
    if (l.dealScoreReason) lines.push(`Razlog: ${l.dealScoreReason}`);
    if (l.aiReason) lines.push(`AI razlog: ${l.aiReason}`);
    if (l.aiEstimatedValue != null) lines.push(`AI tržna vrednost: ${l.aiEstimatedValue}€`);
    if (l.targetPrice != null) lines.push(`Uporabnikova ciljna cena: ${l.targetPrice}€`);
    if (l.monitor?.name) lines.push(`Monitor: ${l.monitor.name} (${l.monitor.source})`);
    lines.push('');
  });

  lines.push('Navodila za povzetek:');
  lines.push('1. Začenji z naslovom "📊 DNEVNI POVZETEK (Xh)" kjer je X število ur.');
  lines.push('2. Kratek pregled (1-2 stavka) o tem, kaj se je zgodilo.');
  lines.push('3. Izpostavi TOP 3 najbolj zanimive oglase (poimenuj "TOP #1", "TOP #2", "TOP #3") s kratkim razlogom.');
  lines.push('4. Omeni morebitne trende (npr. "več telefonov kot običajno", "cene padajo").');
  lines.push('5. Na koncu dodaj praktično priporočilo za uporabnika (kaj naj stori).');
  lines.push('6. Skupna dolžina: 200-500 besed. Slovenščina, neposredno in jedrnato. Markdown format.');
  lines.push('7. Uporabi *bold* za naslove in cene, _italic_ za razloge.');
  lines.push('', 'Odgovori LE z JSON v tej obliki:');
  lines.push('{"summary": "<celoten povzetek v markdown formatu>", "top_pick": "<naslov najboljšega oglasa ali null>", "recommendation": "<kratko priporočilo>"}');
  return lines.join('\n');
}
