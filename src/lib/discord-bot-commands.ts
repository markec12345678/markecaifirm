// v8.97: Discord Bot Helper — interaktivne komande za Discord.
//
// Razširi obstoječi Discord webhook z interaktivnimi slash commands.
//
// Komande:
//   /opportunities — prikaži zadnje AI priložnosti
//   /inventory — prikaži held inventory
//   /profit — prikaži dnevni/mesečni dobiček
//   /alerts — prikaži neprebrane alerte
//   /price <item> — AI cenovna napoved
//   /status — sistemski status (AI, Brain, scraper)
//
// Uporaba:
//   import { handleDiscordCommand } from '@/lib/discord-bot-commands';
//   const result = await handleDiscordCommand(db, interaction);

import type { PrismaClient } from '@prisma/client';

export interface DiscordCommand {
  name: string;
  description: string;
  options?: Array<{
    name: string;
    description: string;
    type: number;
    required?: boolean;
  }>;
}

export const DISCORD_COMMANDS: DiscordCommand[] = [
  {
    name: 'opportunities',
    description: 'Prikaži zadnje AI priložnosti',
  },
  {
    name: 'inventory',
    description: 'Prikaži held inventory',
    options: [{
      name: 'limit',
      description: 'Število prikazanih (default 5)',
      type: 4,
      required: false,
    }],
  },
  {
    name: 'profit',
    description: 'Prikaži dnevni/mesečni dobiček',
  },
  {
    name: 'alerts',
    description: 'Prikaži neprebrane alerte',
    options: [{
      name: 'limit',
      description: 'Število prikazanih (default 5)',
      type: 4,
      required: false,
    }],
  },
  {
    name: 'price',
    description: 'AI cenovna napoved za artikel',
    options: [{
      name: 'item',
      description: 'Naslov artikla',
      type: 3,
      required: true,
    }],
  },
  {
    name: 'status',
    description: 'Sistemski status',
  },
];

export async function handleDiscordCommand(
  db: PrismaClient,
  commandName: string,
  options: Record<string, string | number>
): Promise<{ content: string; embeds?: any[] }> {
  switch (commandName) {
    case 'opportunities':
      return handleOpportunities(db);
    case 'inventory':
      return handleInventory(db, Number(options.limit ?? 5));
    case 'profit':
      return handleProfit(db);
    case 'alerts':
      return handleAlerts(db, Number(options.limit ?? 5));
    case 'price':
      return handlePrice(db, String(options.item ?? ''));
    case 'status':
      return handleStatus(db);
    default:
      return { content: `Neznana komanda: ${commandName}` };
  }
}

async function handleOpportunities(db: PrismaClient): Promise<{ content: string; embeds?: any[] }> {
  const listings = await db.listing.findMany({
    where: { aiVerdict: 'PRILIKA', isHidden: false },
    select: { title: true, price: true, aiScore: true, dealScore: true, url: true, monitor: { select: { source: true } } },
    orderBy: { aiScore: 'desc' },
    take: 5,
  });

  if (listings.length === 0) {
    return { content: '📊 Trenutno ni novih AI priložnosti.' };
  }

  const fields = listings.map((l, i) => ({
    name: `${i + 1}. ${l.title.slice(0, 80)}`,
    value: `💰 ${l.price ?? '?'}€ | AI: ${l.aiScore ?? '?'}/10 | Deal: ${l.dealScore ?? '?'}/100 | ${l.monitor?.source ?? '?'}`,
  }));

  return {
    content: `🎯 **Zadnje ${listings.length} AI priložnosti:**`,
    embeds: [{ title: 'AI Priložnosti', color: 0x00ff00, fields }],
  };
}

async function handleInventory(db: PrismaClient, limit: number): Promise<{ content: string; embeds?: any[] }> {
  const trades = await db.trade.findMany({
    where: { status: 'held' },
    select: { title: true, buyPrice: true, buyDate: true, category: true },
    orderBy: { buyDate: 'desc' },
    take: Math.min(10, Math.max(1, limit)),
  });

  if (trades.length === 0) {
    return { content: '📦 Ni held inventory.' };
  }

  const totalValue = trades.reduce((s, t) => s + t.buyPrice, 0);
  const fields = trades.map((t, i) => ({
    name: `${i + 1}. ${t.title.slice(0, 60)}`,
    value: `💰 ${t.buyPrice}€ | ${t.category ?? 'neznan'} | ${new Date(t.buyDate).toLocaleDateString('sl-SI')}`,
  }));

  return {
    content: `📦 **Held Inventory (${trades.length} itemov, ${totalValue}€ skupno):**`,
    embeds: [{ title: 'Inventory', color: 0x0099ff, fields }],
  };
}

async function handleProfit(db: PrismaClient): Promise<{ content: string }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todaySales, monthSales] = await Promise.all([
    db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: todayStart }, sellPrice: { not: null } },
      select: { buyPrice: true, sellPrice: true },
    }),
    db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: monthStart }, sellPrice: { not: null } },
      select: { buyPrice: true, sellPrice: true },
    }),
  ]);

  const todayProfit = todaySales.reduce((s, t) => s + ((t.sellPrice ?? 0) - t.buyPrice), 0);
  const monthProfit = monthSales.reduce((s, t) => s + ((t.sellPrice ?? 0) - t.buyPrice), 0);

  return {
    content: `💰 **Dobiček:**\n📅 Danes: ${todaySales.length} prodaj, +${todayProfit}€\n📅 Mesec: ${monthSales.length} prodaj, +${monthProfit}€`,
  };
}

async function handleAlerts(db: PrismaClient, limit: number): Promise<{ content: string; embeds?: any[] }> {
  const alerts = await db.alert.findMany({
    where: { isRead: false, isArchived: false },
    select: { title: true, aiVerdict: true, aiScore: true, createdAt: true, monitor: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(10, Math.max(1, limit)),
  });

  if (alerts.length === 0) {
    return { content: '🔔 Ni neprebranih alertov.' };
  }

  const fields = alerts.map((a, i) => ({
    name: `${i + 1}. ${a.title.slice(0, 60)}`,
    value: `${a.aiVerdict === 'PRILIKA' ? '🎯' : a.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•'} AI: ${a.aiScore ?? '?'}/10 | ${a.monitor?.name ?? '?'}`,
  }));

  return {
    content: `🔔 **${alerts.length} neprebranih alertov:**`,
    embeds: [{ title: 'Alerti', color: 0xff9900, fields }],
  };
}

async function handlePrice(db: PrismaClient, itemTitle: string): Promise<{ content: string }> {
  // Preprosta hevristika — išči podobne listinge
  const similar = await db.listing.findMany({
    where: {
      title: { contains: itemTitle },
      price: { not: null },
      isHidden: false,
    },
    select: { price: true, title: true },
    take: 5,
  });

  if (similar.length === 0) {
    return { content: `🔍 Ni podobnih oglasov za "${itemTitle}".` };
  }

  const avgPrice = Math.round(similar.reduce((s, l) => s + (l.price ?? 0), 0) / similar.length);
  const minPrice = Math.min(...similar.map(l => l.price ?? 0));
  const maxPrice = Math.max(...similar.map(l => l.price ?? 0));

  return {
    content: `🔍 **Cenovna analiza: "${itemTitle}"**\n📊 ${similar.length} podobnih oglasov\n💰 Min: ${minPrice}€ | Povp: ${avgPrice}€ | Max: ${maxPrice}€\n💡 Priporočena cena: ${Math.round(avgPrice * 0.9)}€ (hitra) - ${Math.round(avgPrice * 1.1)}€ (premium)`,
  };
}

async function handleStatus(db: PrismaClient): Promise<{ content: string }> {
  const [monitors, listings, alerts, trades] = await Promise.all([
    db.monitor.count(),
    db.listing.count(),
    db.alert.count({ where: { isRead: false } }),
    db.trade.count({ where: { status: 'held' } }),
  ]);

  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { aiProvider: true, aiCallsToday: true, aiMaxDailyCalls: true, telegramEnabled: true },
  });

  return {
    content: `📊 **Sistemski Status:**\n🔌 AI: ${settings?.aiProvider ?? 'N/A'} | ${settings?.aiCallsToday ?? 0}/${settings?.aiMaxDailyCalls ?? 500} klicev danes\n📡 Monitorji: ${monitors}\n📋 Oglasi: ${listings}\n🔔 Neprebrani alerti: ${alerts}\n📦 Held inventory: ${trades}\n📱 Telegram: ${settings?.telegramEnabled ? '✅' : '❌'}`,
  };
}
