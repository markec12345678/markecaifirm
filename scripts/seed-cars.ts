// v8.71: Seed additional listings with year + location variety for Iskalnik testing
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  let monitor = await prisma.monitor.findFirst({ where: { name: 'Demo Avto Bolha' } });
  if (!monitor) {
    monitor = await prisma.monitor.create({
      data: {
        name: 'Demo Avto Bolha',
        source: 'bolha',
        sourceUrl: 'https://www.bolha.com/avto',
        tags: 'avto',
        isActive: false,
      },
    });
  }

  const carListings = [
    {
      title: 'VW Golf 7 2.0 TDI 2020 Ljubljana',
      price: 14500,
      priceText: '14.500€',
      url: 'https://www.bolha.com/ad/car1',
      location: 'Ljubljana',
      description: 'VW Golf 7, 2.0 TDI, letnik 2020, 85000 km, avtomatik, klima, tempomat, Servisna knjiga.',
      detailDescription: 'VW Golf 7, 2.0 TDI, letnik 2020, 85000 km.\nAvtomatik, klima, tempomat, servisna knjiga.\nPrvi lastnik, garažiran, nepuščen.\nZimski + letni pnevmatike v kompletu.',
      aiScore: 8, aiRisk: 2, aiVerdict: 'PRILIKA', aiReason: 'Dobra cena za letnik 2020', aiEstimatedValue: 15500,
    },
    {
      title: 'VW Golf 7 1.6 TDI 2019 Maribor',
      price: 12800,
      priceText: '12.800€',
      url: 'https://www.bolha.com/ad/car2',
      location: 'Maribor',
      description: 'VW Golf 7, 1.6 TDI, 2019, 102000 km, ročni menjalnik, odlično stanje.',
      detailDescription: 'VW Golf 7, 1.6 TDI, letnik 2019, 102000 km.\nRočni menjalnik, klima, radio Bluetooth.\nDrugi lastnik, vse servisno opravljeno.',
      aiScore: 7, aiRisk: 3, aiVerdict: 'PRILIKA', aiReason: 'OK cena', aiEstimatedValue: 13500,
    },
    {
      title: 'VW Golf 8 GTI 2021 Kranj',
      price: 19500,
      priceText: '19.500€',
      url: 'https://www.bolha.com/ad/car3',
      location: 'Kranj',
      description: 'VW Golf 8 GTI, 2021, 45000 km, 245 KM, sport paket, LED žaromety.',
      detailDescription: 'VW Golf 8 GTI Performance, letnik 2021, 45000 km.\n245 KM, DSG avtomatik, sport paket.\nLED žarometi, virtual cockpit, navigacija.\nPrvi lastnik, garažiran.',
      aiScore: 9, aiRisk: 2, aiVerdict: 'PRILIKA', aiReason: 'Premium različica, odlična cena', aiEstimatedValue: 21000,
    },
    {
      title: 'VW Golf 7 1.4 TSI 2018 Celje',
      price: 9500,
      priceText: '9.500€',
      url: 'https://www.bolha.com/ad/car4',
      location: 'Celje',
      description: 'VW Golf 5, 1.4 TSI, 2018, 125000 km, ročni, klima, USB.',
      detailDescription: 'VW Golf 5, 1.4 TSI, letnik 2018, 125000 km.\nRočni menjalnik, klima, USB, Bluetooth.\nTretji lastnik, manjša praska na odbijaču.',
      aiScore: 6, aiRisk: 4, aiVerdict: 'SUMNJIVO', aiReason: 'Veliko km, tretji lastnik', aiEstimatedValue: 9800,
    },
    {
      title: 'VW Golf 5 2.0 TDI 2020 Novo Mesto',
      price: 13900,
      priceText: '13.900€',
      url: 'https://www.bolha.com/ad/car5',
      location: 'Novo Mesto',
      description: 'VW Golf 5, 2.0 TDI, 2020, 78000 km, avtomatik, DSG, LED.',
      detailDescription: 'VW Golf 5, 2.0 TDI DSG, letnik 2020, 78000 km.\nDSG avtomatik, LED žarometi, navigacija.\nPrvi lastnik, full servis zgodovina.\nZimske gume vključene.',
      aiScore: 8, aiRisk: 2, aiVerdict: 'PRILIKA', aiReason: 'Nizka kilometrina, prvi lastnik', aiEstimatedValue: 14800,
    },
    {
      title: 'BMW 320d 2021 Ljubljana',
      price: 28000,
      priceText: '28.000€',
      url: 'https://www.bolha.com/ad/car6',
      location: 'Ljubljana',
      description: 'BMW 320d, 2021, 38000 km, 190 KM, xDrive, M paket.',
      detailDescription: 'BMW 320d xDrive M Sport, letnik 2021, 38000 km.\n190 KM, 8-stopenjski avtomatik.\nM paket, LED laser, Harman Kardon.\nPrvi lastnik, garažiran.',
      aiScore: 8, aiRisk: 2, aiVerdict: 'PRILIKA', aiReason: 'Premium BMW, solidna cena', aiEstimatedValue: 29500,
    },
    {
      title: 'Audi A4 2.0 TDI 2020 Koper',
      price: 22500,
      priceText: '22.500€',
      url: 'https://www.bolha.com/ad/car7',
      location: 'Koper',
      description: 'Audi A4 2.0 TDI, 2020, 62000 km, S-Line, virtual cockpit.',
      detailDescription: 'Audi A4 2.0 TDI S-Line, letnik 2020, 62000 km.\nS-Line paket, virtual cockpit, LED matrix.\nQuattro, 7-stopenjski S-Tronic.\nDrugi lastnik, vse servisno.',
      aiScore: 7, aiRisk: 3, aiVerdict: 'PRILIKA', aiReason: 'Soliden Avdi', aiEstimatedValue: 23000,
    },
  ];

  let created = 0;
  for (const cl of carListings) {
    const existing = await prisma.listing.findFirst({ where: { url: cl.url } });
    if (existing) {
      await prisma.listing.update({
        where: { id: existing.id },
        data: {
          price: cl.price, priceText: cl.priceText,
          aiScore: cl.aiScore, aiRisk: cl.aiRisk, aiVerdict: cl.aiVerdict,
          aiReason: cl.aiReason, aiEstimatedValue: cl.aiEstimatedValue,
          aiEvaluatedAt: new Date(),
          detailDescription: cl.detailDescription,
        },
      });
    } else {
      await prisma.listing.create({
        data: {
          monitorId: monitor.id,
          externalId: `demo-car-${cl.url.split('/').pop()}`,
          title: cl.title,
          price: cl.price,
          priceText: cl.priceText,
          url: cl.url,
          location: cl.location,
          description: cl.description,
          detailDescription: cl.detailDescription,
          aiScore: cl.aiScore, aiRisk: cl.aiRisk, aiVerdict: cl.aiVerdict,
          aiReason: cl.aiReason, aiEstimatedValue: cl.aiEstimatedValue,
          aiEvaluatedAt: new Date(),
        },
      });
      created++;
    }
  }

  console.log(`✓ Seeded ${carListings.length} car listings (${created} new)`);
  const total = await prisma.listing.count();
  console.log(`Total listings: ${total}`);
  await prisma.$disconnect();
}

main().catch(console.error).finally(() => process.exit(0));
