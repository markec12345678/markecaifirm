// v9.46: Backfill buyScore on existing trades
// Computes buy opportunity score for all trades with listingId and persists to DB
// This enables Decision Accuracy analysis (buy score vs outcome correlation)

import { db } from '../src/lib/db';
import { getBuyOpportunityForListing } from '../src/lib/trades/buy-opportunity';

async function main() {
  console.log('\n🎯 Backfill buyScore on existing trades\n');
  
  const trades = await db.trade.findMany({
    where: { 
      listingId: { not: null },
      buyScore: null,
    },
    include: { listing: true },
  });
  
  console.log(`Found ${trades.length} trades without buyScore (have listingId)\n`);
  
  let updated = 0;
  let failed = 0;
  
  for (const trade of trades) {
    if (!trade.listing) {
      console.log(`  SKIP: "${trade.title}" — no listing`);
      continue;
    }
    
    try {
      const result = await getBuyOpportunityForListing(trade.listingId!);
      if (result) {
        await db.trade.update({
          where: { id: trade.id },
          data: {
            buyScore: result.score,
            buyVerdict: result.verdict,
            buyScoreAt: new Date(),
          },
        });
        console.log(`  ✓ "${trade.title}": score=${result.score} verdict=${result.verdict}`);
        updated++;
      } else {
        console.log(`  SKIP: "${trade.title}" — buy score computation returned null`);
      }
    } catch (e) {
      console.log(`  ✗ "${trade.title}": ${(e as Error).message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Backfill Summary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${trades.length - updated - failed}`);
  
  const withScore = await db.trade.count({ where: { buyScore: { not: null } } });
  const soldWithScore = await db.trade.count({ where: { buyScore: { not: null }, status: 'sold' } });
  console.log(`\n  Trades with buyScore: ${withScore}`);
  console.log(`  Sold trades with buyScore: ${soldWithScore} (needed for Decision Accuracy)`);
  
  await db.$disconnect();
}

main().catch(console.error);
