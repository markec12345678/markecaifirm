// v9.46: Link existing trades to listings by title matching
// Then backfill buyScore on linked trades

import { db } from '../src/lib/db';
import { getBuyOpportunityForListing } from '../src/lib/trades/buy-opportunity';

async function main() {
  console.log('\n🔗 Link trades to listings by title matching\n');
  
  const trades = await db.trade.findMany({ 
    where: { listingId: null },
    select: { id: true, title: true, category: true }
  });
  
  const listings = await db.listing.findMany({
    select: { id: true, title: true }
  });
  
  console.log(`Trades without listingId: ${trades.length}`);
  console.log(`Available listings: ${listings.length}\n`);
  
  let linked = 0;
  
  for (const trade of trades) {
    // Simple title matching — find listing with similar title
    const tradeTitleLower = trade.title.toLowerCase();
    let bestMatch: { id: string; title: string; score: number } | null = null;
    
    for (const listing of listings) {
      const listingTitleLower = listing.title.toLowerCase();
      // Check if trade title contains key words from listing or vice versa
      const tradeWords = tradeTitleLower.split(/\s+/).filter(w => w.length > 3);
      const listingWords = listingTitleLower.split(/\s+/).filter(w => w.length > 3);
      
      let matchCount = 0;
      for (const tw of tradeWords) {
        if (listingTitleLower.includes(tw)) matchCount++;
      }
      for (const lw of listingWords) {
        if (tradeTitleLower.includes(lw)) matchCount++;
      }
      
      const score = matchCount / Math.max(tradeWords.length + listingWords.length, 1);
      if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: listing.id, title: listing.title, score };
      }
    }
    
    if (bestMatch) {
      await db.trade.update({
        where: { id: trade.id },
        data: { listingId: bestMatch.id }
      });
      console.log(`  ✓ "${trade.title}" → "${bestMatch.title}" (score: ${(bestMatch.score * 100).toFixed(0)}%)`);
      linked++;
    } else {
      console.log(`  ✗ "${trade.title}" — no match`);
    }
  }
  
  console.log(`\n📊 Link Summary: ${linked}/${trades.length} trades linked to listings`);
  
  // Now backfill buyScore
  console.log('\n🎯 Backfill buyScore on linked trades\n');
  
  const linkedTrades = await db.trade.findMany({
    where: { listingId: { not: null }, buyScore: null },
    select: { id: true, title: true, listingId: true }
  });
  
  console.log(`Found ${linkedTrades.length} linked trades without buyScore\n`);
  
  let scored = 0;
  for (const trade of linkedTrades) {
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
        scored++;
      }
    } catch (e) {
      console.log(`  ✗ "${trade.title}": ${(e as Error).message}`);
    }
  }
  
  console.log(`\n📊 Backfill Summary: ${scored}/${linkedTrades.length} trades scored`);
  
  // Final check
  const withScore = await db.trade.count({ where: { buyScore: { not: null } } });
  const soldWithScore = await db.trade.count({ where: { buyScore: { not: null }, status: 'sold' } });
  console.log(`\n  Trades with buyScore: ${withScore}`);
  console.log(`  Sold trades with buyScore: ${soldWithScore} (needed for Decision Accuracy)`);
  
  // Test decision accuracy API
  console.log('\n🧠 Testing Decision Accuracy API...\n');
  try {
    const res = await fetch('http://localhost:3000/api/analytics/decision-accuracy');
    if (res.ok) {
      const data = await res.json();
      console.log('Decision Accuracy Result:');
      console.log(`  Buy Score Accuracy: correlation=${data.buyScoreAccuracy?.correlation} accuracy=${data.buyScoreAccuracy?.accuracyPercent}%`);
      console.log(`  Smart Price Accuracy: withinRange=${data.smartPriceAccuracy?.withinRange}% avgDeviation=${data.smartPriceAccuracy?.avgDeviationPercent}%`);
      console.log(`  Overall Health: score=${data.overallHealth?.score}/100 grade=${data.overallHealth?.grade}`);
      console.log(`  Insights: ${data.overallHealth?.insights?.length || 0}`);
    } else {
      console.log(`  API returned ${res.status}`);
    }
  } catch (e) {
    console.log(`  API not available: ${(e as Error).message}`);
  }
  
  await db.$disconnect();
}

main().catch(console.error);
