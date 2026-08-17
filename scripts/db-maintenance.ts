// v8.86: DB Maintenance script — cleanup old data for better performance.
// Run manually: bun run scripts/db-maintenance.ts
// Or via cron: /api/cron/db-maintenance (future)

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  let totalDeleted = 0;

  console.log('🔧 DB Maintenance starting...\n');

  // 1. Delete old RunLogs (>90 days)
  const runLogsCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oldRunLogs = await prisma.runLog.deleteMany({
    where: { startedAt: { lt: runLogsCutoff } },
  });
  console.log(`✓ Deleted ${oldRunLogs.count} old RunLogs (>90 days)`);
  totalDeleted += oldRunLogs.count;

  // 2. Delete old PriceHistory for hidden/deleted listings (>180 days)
  const priceHistCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const oldPriceHist = await prisma.priceHistory.deleteMany({
    where: { seenAt: { lt: priceHistCutoff } },
  });
  console.log(`✓ Deleted ${oldPriceHist.count} old PriceHistory entries (>180 days)`);
  totalDeleted += oldPriceHist.count;

  // 3. Delete old Notifications (>90 days) — v8.38 cleanup
  const notifCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oldNotifs = await prisma.notification.deleteMany({
    where: { createdAt: { lt: notifCutoff } },
  });
  console.log(`✓ Deleted ${oldNotifs.count} old Notifications (>90 days)`);
  totalDeleted += oldNotifs.count;

  // 4. Delete old BuyRequestMatches that are read (>60 days)
  const matchCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const oldMatches = await prisma.buyRequestMatch.deleteMany({
    where: { matchedAt: { lt: matchCutoff }, isRead: true },
  });
  console.log(`✓ Deleted ${oldMatches.count} old BuyRequestMatches (read, >60 days)`);
  totalDeleted += oldMatches.count;

  // 5. Delete hidden listings older than 30 days
  const hiddenCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const hiddenListings = await prisma.listing.findMany({
    where: { isHidden: true, hiddenAt: { lt: hiddenCutoff } },
    select: { id: true },
  });
  if (hiddenListings.length > 0) {
    const hiddenIds = hiddenListings.map(l => l.id);
    await prisma.priceHistory.deleteMany({ where: { listingId: { in: hiddenIds } } });
    await prisma.alert.deleteMany({ where: { listingId: { in: hiddenIds } } });
    await prisma.buyRequestMatch.deleteMany({ where: { listingId: { in: hiddenIds } } });
    const deleted = await prisma.listing.deleteMany({ where: { id: { in: hiddenIds } } });
    console.log(`✓ Deleted ${deleted.count} hidden listings (>30 days hidden)`);
    totalDeleted += deleted.count;
  }

  // 6. Optimize SQLite (VACUUM)
  await prisma.$executeRaw`VACUUM`;
  console.log(`✓ SQLite VACUUM completed`);

  // 7. Print DB stats
  const stats = {
    listings: await prisma.listing.count(),
    alerts: await prisma.alert.count(),
    trades: await prisma.trade.count(),
    monitors: await prisma.monitor.count(),
    notifications: await prisma.notification.count(),
    runLogs: await prisma.runLog.count(),
    buyRequests: await prisma.buyRequest.count(),
    buyRequestMatches: await prisma.buyRequestMatch.count(),
    priceHistory: await prisma.priceHistory.count(),
  };

  console.log('\n📊 DB Stats after cleanup:');
  Object.entries(stats).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });
  console.log(`\n✅ Total deleted: ${totalDeleted} records`);

  await prisma.$disconnect();
}

main().catch(console.error).finally(() => process.exit(0));
