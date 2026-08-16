// v8.68: Seed demo listings with AI evaluation for Buy Opportunity testing.
// Run once: bun run scripts/seed-listings.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find or create a demo monitor
  let monitor = await prisma.monitor.findFirst({ where: { name: 'Demo iPhone Bolha' } });
  if (!monitor) {
    monitor = await prisma.monitor.create({
      data: {
        name: 'Demo iPhone Bolha',
        source: 'bolha',
        sourceUrl: 'https://www.bolha.com/iskanje?q=iphone',
        tags: 'elektronika',
        isActive: false,
      },
    });
  }

  const demoListings = [
    {
      title: 'iPhone 13 Pro 256GB - odlično stanje',
      price: 450,
      priceText: '450€',
      url: 'https://www.bolha.com/ad/1',
      location: 'Ljubljana',
      description: 'iPhone 13 Pro 256GB, midnight, 1 leto garancije, brez prask.',
      aiScore: 9,
      aiRisk: 2,
      aiVerdict: 'PRILIKA',
      aiReason: 'Odlična cena za ta model',
      aiEstimatedValue: 580,
    },
    {
      title: 'Samsung Galaxy S22 Ultra 256GB',
      price: 380,
      priceText: '380€',
      url: 'https://www.bolha.com/ad/2',
      location: 'Maribor',
      description: 'Samsung S22 Ultra, 8GB RAM, 256GB, S Pen vključen.',
      aiScore: 7,
      aiRisk: 3,
      aiVerdict: 'PRILIKA',
      aiReason: 'Dobra cena, S Pen dodana vrednost',
      aiEstimatedValue: 450,
    },
    {
      title: 'MacBook Air M1 2021',
      price: 720,
      priceText: '720€',
      url: 'https://www.bolha.com/ad/3',
      location: 'Ljubljana',
      description: 'MacBook Air M1, 8GB RAM, 256GB SSD, space gray.',
      aiScore: 8,
      aiRisk: 2,
      aiVerdict: 'PRILIKA',
      aiReason: 'Solidna cena za M1',
      aiEstimatedValue: 800,
    },
    {
      title: 'Sony A7III body',
      price: 1100,
      priceText: '1100€',
      url: 'https://www.bolha.com/ad/4',
      location: 'Koper',
      description: 'Sony A7III body, 12000 spročil, 2 bateriji.',
      aiScore: 6,
      aiRisk: 4,
      aiVerdict: 'SUMNJIVO',
      aiReason: 'Visoka števila spročil',
      aiEstimatedValue: 1150,
    },
    {
      title: 'Avto radio Bluetooth Pioneer',
      price: 90,
      priceText: '90€',
      url: 'https://www.bolha.com/ad/5',
      location: 'Celje',
      description: 'Pioneer avto radio z Bluetooth, USB, AUX.',
      aiScore: 7,
      aiRisk: 3,
      aiVerdict: 'PRILIKA',
      aiReason: 'Dobra cena za Pioneer',
      aiEstimatedValue: 120,
    },
    {
      title: 'PlayStation 5 - novo',
      price: 550,
      priceText: '550€',
      url: 'https://www.bolha.com/ad/6',
      location: 'Ljubljana',
      description: 'PS5 Disc edition, 2 controllerja, 1 leto garancije.',
      aiScore: 8,
      aiRisk: 2,
      aiVerdict: 'PRILIKA',
      aiReason: 'Ugodna cena za komplet',
      aiEstimatedValue: 620,
    },
    {
      title: 'Nike Air Jordan 1 Mid',
      price: 75,
      priceText: '75€',
      url: 'https://www.bolha.com/ad/7',
      location: 'Kranj',
      description: 'Nike Air Jordan 1 Mid, velikost 43, novo.',
      aiScore: 6,
      aiRisk: 3,
      aiVerdict: 'PRILIKA',
      aiReason: 'OK cena',
      aiEstimatedValue: 95,
    },
    {
      title: 'Bosch vijačni set 100 kosov',
      price: 28,
      priceText: '28€',
      url: 'https://www.bolha.com/ad/8',
      location: 'Ljubljana',
      description: 'Bosch vijačni set, 100 kosov, v službeni torbi.',
      aiScore: 5,
      aiRisk: 2,
      aiVerdict: 'NEZANIMIVO',
      aiReason: 'Nizka donosnost',
      aiEstimatedValue: 35,
    },
  ];

  let created = 0;
  for (const dl of demoListings) {
    const existing = await prisma.listing.findFirst({ where: { url: dl.url } });
    if (existing) {
      // Update AI fields
      await prisma.listing.update({
        where: { id: existing.id },
        data: {
          price: dl.price,
          priceText: dl.priceText,
          aiScore: dl.aiScore,
          aiRisk: dl.aiRisk,
          aiVerdict: dl.aiVerdict,
          aiReason: dl.aiReason,
          aiEstimatedValue: dl.aiEstimatedValue,
          aiEvaluatedAt: new Date(),
        },
      });
    } else {
      await prisma.listing.create({
        data: {
          monitorId: monitor.id,
          externalId: `demo-${dl.url.split('/').pop()}`,
          title: dl.title,
          price: dl.price,
          priceText: dl.priceText,
          url: dl.url,
          location: dl.location,
          description: dl.description,
          aiScore: dl.aiScore,
          aiRisk: dl.aiRisk,
          aiVerdict: dl.aiVerdict,
          aiReason: dl.aiReason,
          aiEstimatedValue: dl.aiEstimatedValue,
          aiEvaluatedAt: new Date(),
        },
      });
      created++;
    }
  }

  console.log(`✓ Seeded ${demoListings.length} demo listings (${created} new, ${demoListings.length - created} updated)`);

  // Verify
  const total = await prisma.listing.count();
  console.log(`Total listings in DB: ${total}`);
  await prisma.$disconnect();
}

main().catch(console.error).finally(() => process.exit(0));
