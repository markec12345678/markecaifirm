// v5.0: Telegram bot commands — interactive bot with /commands
// Handles /help, /status, /run, /alerts, /listings, /monitors, /trades, /stats

import { db } from '@/lib/db';
import { getSettingsRow, runMonitor } from '@/lib/pipeline';
import { sendTelegramMessage, formatAlertMessage } from '@/lib/telegram';
import type { TelegramConfig } from '@/lib/telegram';

export interface BotCommand {
  command: string;
  description: string;
  handler: (args: string[], cfg: TelegramConfig, chatId: string) => Promise<string>;
}

export const BOT_COMMANDS: BotCommand[] = [
  {
    command: 'help',
    description: 'Prikaži seznam ukazov',
    handler: async () => {
      return `🤖 *Markec AI Firm — Bot ukazi*

*/help* — ta pomoč
*/deals* — 🎯 TOP 5 priložnosti (deal 70+)
*/profit* — 💰 dobiček ta mesec + ROI
*/inventory* — 📦 skladišče z aging statusom
*/status* — stanje sistema (monitorji, alerti, oglasi)
*/run* — poženi vse monitorje
*/run <id>* — poženi specifičen monitor
*/alerts* — zadnjih 5 alertov
*/alerts <n>* — zadnjih N alertov (max 20)
*/listings* — zadnjih 5 oglasov
*/listings <n>* — zadnjih N oglasov (max 20)
*/monitors* — seznam vseh monitorjev
*/trades* — pregled skladišča (held + sold)
*/stats* — ključne statistike
*/ping* — preveri ali bot deluje

💡 Ukazi so na voljo samo admin uporabnikom (tvoj chat ID).`;
    },
  },
  {
    command: 'ping',
    description: 'Preveri ali bot deluje',
    handler: async () => '🏓 Pong! Bot deluje. Uporabi /help za seznam ukazov.',
  },
  {
    command: 'status',
    description: 'Stanje sistema',
    handler: async () => {
      const [monitors, activeMonitors, listings, alerts, unreadAlerts, trades, heldTrades] = await Promise.all([
        db.monitor.count(),
        db.monitor.count({ where: { isActive: true } }),
        db.listing.count(),
        db.alert.count(),
        db.alert.count({ where: { isRead: false, isArchived: false } }),
        db.trade.count(),
        db.trade.count({ where: { status: 'held' } }),
      ]);
      const lastRun = await db.runLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true, durationMs: true, newListings: true, alertsSent: true },
      });

      let lastRunText = '—';
      if (lastRun) {
        const ago = Math.round((Date.now() - lastRun.startedAt.getTime()) / 60_000);
        const dur = lastRun.durationMs != null ? `${(lastRun.durationMs / 1000).toFixed(1)}s` : '?';
        lastRunText = `${lastRun.status} ${ago}min nazaj (${dur}, ${lastRun.newListings} novih, ${lastRun.alertsSent} alertov)`;
      }

      return `📊 *Stanje sistema*

Monitorji: ${activeMonitors}/${monitors} aktivnih
Oglasi: ${listings}
Alerti: ${alerts} (${unreadAlerts} neprebranih)
Tradei: ${trades} (${heldTrades} v skladišču)

Zadnji run: ${lastRunText}`;
    },
  },
  {
    command: 'run',
    description: 'Poženi monitor(je)',
    handler: async (args, cfg, chatId) => {
      if (args.length === 0) {
        // Run all
        const monitors = await db.monitor.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        });
        if (monitors.length === 0) {
          return 'ℹ️ Ni aktivnih monitorjev.';
        }
        await sendTelegramMessage(cfg, `🚀 *Poganjam ${monitors.length} monitorjev...*`);
        let totalNew = 0;
        let totalAlerts = 0;
        let errors = 0;
        for (const m of monitors) {
          try {
            const result = await runMonitor(m.id);
            totalNew += result.newListings ?? 0;
            totalAlerts += result.alertsSent ?? 0;
            if (result.status === 'error') errors++;
          } catch {
            errors++;
          }
        }
        return `✅ *Končano*

Poganjano: ${monitors.length}
Novi oglasi: ${totalNew}
Alerti poslani: ${totalAlerts}
Napake: ${errors}`;
      } else {
        // Run specific by ID or name
        const target = args[0];
        const monitor = await db.monitor.findFirst({
          where: {
            OR: [
              { id: target },
              { name: { contains: target } },
            ],
          },
        });
        if (!monitor) {
          return `❌ Monitor "${target}" ne obstaja. Uporabi /monitors za seznam.`;
        }
        await sendTelegramMessage(cfg, `🚀 *Poganjam: ${monitor.name}*`);
        const result = await runMonitor(monitor.id);
        return `✅ *${monitor.name}*

Status: ${result.status}
Novi oglasi: ${result.newListings ?? 0}
Alerti: ${result.alertsSent ?? 0}
Čas: ${(result.durationMs / 1000).toFixed(1)}s${result.error ? `\nNapaka: ${result.error}` : ''}`;
      }
    },
  },
  {
    command: 'alerts',
    description: 'Zadnji alerti',
    handler: async (args) => {
      const n = Math.min(20, Math.max(1, parseInt(args[0] ?? '5', 10) || 5));
      const alerts = await db.alert.findMany({
        orderBy: { createdAt: 'desc' },
        take: n,
        include: { monitor: { select: { name: true } } },
      });
      if (alerts.length === 0) {
        return 'ℹ️ Ni alertov.';
      }
      const lines = [`📋 *Zadnjih ${alerts.length} alertov:`, ''];
      for (const a of alerts) {
        const emoji = a.aiVerdict === 'PRILIKA' ? '🎯' : a.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';
        const time = a.createdAt.toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        lines.push(`${emoji} *${a.title?.slice(0, 60)}*`);
        lines.push(`   ${a.monitor?.name ?? '?'} • ${time}`);
        if (a.aiScore) lines.push(`   ⭐ ${a.aiScore}/10 ${a.aiRisk ? `🛡 ${a.aiRisk}/10` : ''}`);
        lines.push('');
      }
      return lines.join('\n');
    },
  },
  {
    command: 'listings',
    description: 'Zadnji oglasi',
    handler: async (args) => {
      const n = Math.min(20, Math.max(1, parseInt(args[0] ?? '5', 10) || 5));
      const listings = await db.listing.findMany({
        orderBy: { firstSeenAt: 'desc' },
        take: n,
        include: { monitor: { select: { name: true, source: true } } },
      });
      if (listings.length === 0) {
        return 'ℹ️ Ni oglasov.';
      }
      const lines = [`📋 *Zadnjih ${listings.length} oglasov:`, ''];
      for (const l of listings) {
        const emoji = l.aiVerdict === 'PRILIKA' ? '🎯' : l.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';
        const time = l.firstSeenAt.toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        lines.push(`${emoji} *${l.title?.slice(0, 60)}*`);
        lines.push(`   ${l.priceText} • ${l.monitor?.name ?? '?'}`);
        if (l.aiScore) lines.push(`   ⭐ ${l.aiScore}/10 ${l.dealScore ? `🎯 ${l.dealScore}/100` : ''}`);
        lines.push(`   ${time}`);
        lines.push('');
      }
      return lines.join('\n');
    },
  },
  {
    command: 'monitors',
    description: 'Seznam monitorjev',
    handler: async () => {
      const monitors = await db.monitor.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, source: true, isActive: true, lastRunAt: true, lastStatus: true, _count: { select: { listings: true, alerts: true } } },
      });
      if (monitors.length === 0) {
        return 'ℹ️ Ni monitorjev. Dodaj jih v web vmesniku.';
      }
      const lines = [`📋 *Monitorji (${monitors.length}):*`, ''];
      for (const m of monitors) {
        const status = m.isActive ? '✅' : '⏸';
        const lastStatus = m.lastStatus ? ` (${m.lastStatus})` : '';
        const ago = m.lastRunAt ? ` • ${Math.round((Date.now() - m.lastRunAt.getTime()) / 60_000)}min` : '';
        lines.push(`${status} *${m.name}*`);
        lines.push(`   ${m.source} • ${m._count.listings} oglasov • ${m._count.alerts} alertov${lastStatus}${ago}`);
        lines.push(`   ID: \`${m.id}\``);
        lines.push('');
      }
      return lines.join('\n');
    },
  },
  {
    command: 'trades',
    description: 'Pregled skladišča',
    handler: async () => {
      const trades = await db.trade.findMany({
        where: { status: { in: ['held', 'sold'] } },
        select: { id: true, title: true, status: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, category: true },
        orderBy: { buyDate: 'desc' },
      });
      if (trades.length === 0) {
        return 'ℹ️ Ni tradeov v skladišču.';
      }
      const held = trades.filter(t => t.status === 'held');
      const sold = trades.filter(t => t.status === 'sold');
      const realizedProfit = sold.reduce((s, t) => s + ((t.sellPrice ?? 0) - t.buyPrice), 0);
      const invested = held.reduce((s, t) => s + t.buyPrice, 0);

      const lines = [
        `📊 *Skladišče:*`,
        '',
        `💼 V skladišču: ${held.length} (${invested.toFixed(0)}€)`,
        `💰 Prodano: ${sold.length} (${realizedProfit >= 0 ? '+' : ''}${realizedProfit.toFixed(0)}€ dobička)`,
        '',
        '*Zadnjih 5:*',
        '',
      ];
      for (const t of trades.slice(0, 5)) {
        const emoji = t.status === 'sold' ? '✅' : '💼';
        const profit = t.status === 'sold' && t.sellPrice ? ` (+${(t.sellPrice - t.buyPrice).toFixed(0)}€)` : '';
        lines.push(`${emoji} *${t.title?.slice(0, 50)}* ${t.buyPrice}€${profit}`);
      }
      return lines.join('\n');
    },
  },
  {
    command: 'deals',
    description: 'TOP 5 priložnosti (deal score 70+)',
    handler: async () => {
      const deals = await db.listing.findMany({
        where: {
          aiVerdict: 'PRILIKA',
          isHidden: false,
          contactStatus: 'none',
          dealScore: { gte: 70 },
        },
        select: {
          id: true, title: true, price: true, priceText: true, url: true,
          dealScore: true, aiScore: true, aiRisk: true, aiEstimatedValue: true,
          location: true, monitor: { select: { name: true, source: true } },
        },
        orderBy: { dealScore: 'desc' },
        take: 5,
      });
      if (deals.length === 0) {
        return 'ℹ️ Trenutno ni TOP deal-ov (score 70+). Počakaj na naslednji scan.';
      }
      const lines = [`🎯 *TOP ${deals.length} PRILIKNOSTI:`, ''];
      for (const d of deals) {
        const savings = d.aiEstimatedValue && d.price ? ` (est. ${d.aiEstimatedValue}€ — prihranek ${d.aiEstimatedValue - d.price}€)` : '';
        const risk = (d.aiRisk ?? 0) <= 2 ? '✅' : (d.aiRisk ?? 0) <= 5 ? '⚠️' : '🔴';
        lines.push(`*${d.dealScore}/100* ${risk} ${d.title?.slice(0, 50)}`);
        lines.push(`   💰 ${d.priceText}${savings}`);
        if (d.location) lines.push(`   📍 ${d.location}`);
        lines.push(`   🔗 ${d.url}`);
        lines.push('');
      }
      return lines.join('\n');
    },
  },
  {
    command: 'profit',
    description: 'Dobiček ta mesec + ROI',
    handler: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const soldThisMonth = await db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: monthStart, not: null } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      });
      const profit = soldThisMonth.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      const invested = soldThisMonth.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
      const roi = invested > 0 ? Math.round((profit / invested) * 100) : 0;

      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { buyPrice: true, buyDate: true },
      });
      const heldValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
      const agingItems = heldTrades.filter(t => Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / 86400000) > 30);

      const monthName = now.toLocaleDateString('sl-SI', { month: 'long' });
      return `💰 *DOBIČEK — ${monthName}*

Prodano: ${soldThisMonth.length} item-ov
Dobiček: ${profit >= 0 ? '+' : ''}${profit}€
ROI: ${roi}%
Investirano: ${invested}€

📦 Inventar: ${heldTrades.length} held (${heldValue}€)
${agingItems.length > 0 ? `⚠️ ${agingItems.length} item-ov 30+ dni — zastara!` : '✅ Brez zastarelih item-ov'}`;
    },
  },
  {
    command: 'inventory',
    description: 'Skladišče z aging statusom',
    handler: async () => {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, buyPrice: true, buyDate: true, category: true, flipChecklist: true },
        orderBy: { buyDate: 'asc' },
      });
      if (heldTrades.length === 0) {
        return 'ℹ️ Skladišče je prazno.';
      }
      const now = Date.now();
      const lines = [`📦 *SKLADIŠČE (${heldTrades.length})*`, ''];
      for (const t of heldTrades) {
        const days = Math.floor((now - new Date(t.buyDate).getTime()) / 86400000);
        const emoji = days > 90 ? '🔴' : days > 60 ? '🔴' : days > 30 ? '🟡' : '🟢';
        // Parse flip checklist
        let steps = 0;
        try { steps = JSON.parse(t.flipChecklist || '[]').length; } catch { /* */ }
        lines.push(`${emoji} *${t.title?.slice(0, 40)}* — ${t.buyPrice}€`);
        lines.push(`   ${days}d • ${steps}/9 flip korakov • ${t.category || '?'}`);
      }
      const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
      lines.push('', `💼 Skupaj: ${totalValue}€ vezano`);
      return lines.join('\n');
    },
  },
  {
    command: 'stats',
    description: 'Ključne statistike',
    handler: async () => {
      const [monitors, listings, alerts, trades, runLogs] = await Promise.all([
        db.monitor.count(),
        db.listing.count(),
        db.alert.count(),
        db.trade.count(),
        db.runLog.count(),
      ]);

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [newListings24h, alerts24h, runs24h] = await Promise.all([
        db.listing.count({ where: { firstSeenAt: { gte: last24h } } }),
        db.alert.count({ where: { createdAt: { gte: last24h } } }),
        db.runLog.count({ where: { startedAt: { gte: last24h } } }),
      ]);

      const settings = await getSettingsRow();
      const aiCalls = settings.aiCallsToday;

      return `📈 *Statistike*

Skupaj:
• Monitorji: ${monitors}
• Oglasi: ${listings}
• Alerti: ${alerts}
• Tradei: ${trades}
• Run logi: ${runLogs}

Zadnje 24h:
• Novi oglasi: ${newListings24h}
• Alerti: ${alerts24h}
• Poganjanja: ${runs24h}

AI klici danes: ${aiCalls}`;
    },
  },
];

// Get bot commands for setMyCommands (Telegram API)
export function getBotCommandsList() {
  return BOT_COMMANDS.map(c => ({
    command: c.command,
    description: c.description,
  }));
}

// Find and execute a command
export async function handleCommand(
  text: string,
  cfg: TelegramConfig,
  chatId: string
): Promise<{ ok: boolean; response?: string; error?: string }> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return { ok: false, error: 'Ni ukaz (začni z /)' };
  }
  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase().split('@')[0]; // strip @botname suffix
  const args = parts.slice(1);

  const command = BOT_COMMANDS.find(c => c.command === cmd);
  if (!command) {
    return { ok: false, error: `Neznan ukaz: /${cmd}. Pošlji /help za seznam.` };
  }

  try {
    const response = await command.handler(args, cfg, chatId);
    return { ok: true, response };
  } catch (e: any) {
    return { ok: false, error: `Napaka: ${e?.message ?? 'neznan'}` };
  }
}

// Setup bot commands (call on app startup or manually)
export async function setupBotCommands(botToken: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: getBotCommandsList(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return { ok: true, message: `Registriranih ${getBotCommandsList().length} ukazov` };
    }
    return { ok: false, message: data.description ?? 'Napaka Telegram API' };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'Napaka' };
  }
}
