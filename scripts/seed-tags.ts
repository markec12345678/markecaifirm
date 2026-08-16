// v8.63: One-off seed script — assign sensible tags to existing demo trades.
// Run once: bun run scripts/seed-tags.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

async function main() {
  const trades = await prisma.trade.findMany({
    select: { id: true, title: true, category: true, status: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyLocation: true, sellLocation: true, tags: true },
  });

  let updated = 0;
  for (const t of trades) {
    const existing = parseTags(t.tags);
    const tags = new Set(existing);

    // Rule 1: category-based tags
    if (t.category === 'elektronika') tags.add('elektronika');
    if (t.category === 'obutev') { tags.add('sneakers'); tags.add('moda'); }
    if (t.category === 'oblačila') tags.add('moda');
    if (t.category === 'orodje') tags.add('orodje');
    if (t.category === 'avto') tags.add('avto-deli');

    // Rule 2: title-based tags
    const title = (t.title || '').toLowerCase();
    if (title.includes('iphone') || title.includes('samsung') || title.includes('macbook') || title.includes('ipad')) {
      tags.add('premium');
    }
    if (title.includes('nike') || title.includes('jordan') || title.includes('adidas') || title.includes('new balance')) {
      tags.add('sneakers');
      tags.add('brand');
    }
    if (title.includes('zara') || title.includes('pulover') || title.includes('jakna')) {
      tags.add('moda');
    }
    if (title.includes('radio') || title.includes('avto')) {
      tags.add('avto-deli');
    }

    // Rule 3: price-based — high value trades are "premium"
    if (t.buyPrice >= 200) tags.add('premium');
    if (t.buyPrice < 30) tags.add('mali-budget');

    // Rule 4: status-based
    if (t.status === 'cancelled') tags.add('izguba');
    if (t.status === 'held') tags.add('v-skladiscu');

    // Rule 5: profit-based verdict for sold trades
    if (t.status === 'sold' && t.sellPrice != null) {
      const profit = t.sellPrice - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      const roi = t.buyPrice > 0 ? (profit / (t.buyPrice + (t.buyFees ?? 0))) * 100 : 0;
      if (roi >= 50) tags.add('hitri-flip');
      else if (roi >= 20) tags.add('flip');
      else if (profit < 0) tags.add('izguba');
      else tags.add('majhen-profit');
    }

    // Rule 6: source-based
    if (t.buyLocation === 'Vinted') tags.add('vinted');
    if (t.buyLocation === 'Bolha') tags.add('bolha');
    if (t.buyLocation === 'Avtonet') tags.add('avtonet');

    const newTags = Array.from(tags).sort().join(',');
    if (newTags !== t.tags) {
      await prisma.trade.update({ where: { id: t.id }, data: { tags: newTags } });
      updated++;
    }
  }

  console.log(`✓ Seeded tags on ${updated}/${trades.length} trades`);

  // Print tag summary
  const tagCount: Record<string, number> = {};
  for (const t of trades) {
    for (const tag of parseTags(t.tags)) tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
  console.log('\nTag distribution:');
  Object.entries(tagCount).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
    console.log(`  #${tag}: ${count}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
