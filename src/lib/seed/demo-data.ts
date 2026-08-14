// v8.35: Seed Demo Data — creates realistic Slovenian trade history so the
// Brain system has real data to work with. Without this, Actual Profit shows
// 0€, accuracy can't be computed, and all brains use default inputs.
//
// Creates 25 trades across 4 sources (Bolha, Vinted, Avtonet, mobile.de)
// with varied categories (electronics, sneakers, auto, tools, clothing),
// margins (some profitable, some loss), and dates (last 90 days).
//
// IDEMPOTENT: if trades already exist (count > 0), skips and returns
// { skipped: N } — does NOT delete existing trades.
//
// Deterministic (aiUsed: false): no AI/LLM SDK is called.

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// --- Helpers ---------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  // Round to start of day for stable, deterministic seed data.
  d.setHours(10, 0, 0, 0);
  return d;
}

// --- Types -----------------------------------------------------------------

export interface SeedTradeInput {
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null; // null = still held
  sellFees: number;
  buyDate: Date;
  sellDate: Date | null;
  buyLocation: string;
  sellLocation: string;
  status: 'held' | 'sold' | 'cancelled';
}

export interface SeedResult {
  ok: true;
  created: number;
  skipped: number; // already existed
  total: number;
  source: 'v8.35-seed-demo-data';
}

// --- 25 realistic Slovenian trades ----------------------------------------
//
// Mix of:
//   - 4 sources: Bolha, Vinted, Avtonet, mobile.de
//   - 5 categories: elektronika, obutev, oblačila, avto, orodje
//   - Margins: mostly profitable, but 1 deliberate loss (Yeezy 350)
//   - Statuses: 19 sold, 5 held (inventory aging), 1 cancelled
//   - Dates: spread across last 90 days (so 30d/90d accuracy windows work)
//   - Total ~3200€ realized profit (validates Master Brain projections)

export const DEMO_TRADES: SeedTradeInput[] = [
  // Bolha — electronics (profitable)
  {
    title: 'iPhone 13 128GB',
    category: 'elektronika',
    buyPrice: 280,
    buyFees: 0,
    sellPrice: 380,
    sellFees: 15,
    buyDate: daysAgo(45),
    sellDate: daysAgo(20),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'Samsung Galaxy S22',
    category: 'elektronika',
    buyPrice: 220,
    buyFees: 0,
    sellPrice: 290,
    sellFees: 12,
    buyDate: daysAgo(60),
    sellDate: daysAgo(35),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'iPad Air 2022',
    category: 'elektronika',
    buyPrice: 350,
    buyFees: 5,
    sellPrice: 450,
    sellFees: 18,
    buyDate: daysAgo(50),
    sellDate: daysAgo(25),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'AirPods Pro 2',
    category: 'elektronika',
    buyPrice: 150,
    buyFees: 0,
    sellPrice: 200,
    sellFees: 8,
    buyDate: daysAgo(30),
    sellDate: daysAgo(10),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'MacBook Air M1',
    category: 'elektronika',
    buyPrice: 600,
    buyFees: 10,
    sellPrice: 750,
    sellFees: 25,
    buyDate: daysAgo(70),
    sellDate: daysAgo(40),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  // Bolha — sneakers (mixed; one loss to give accuracy signal)
  {
    title: 'Nike Air Jordan 1',
    category: 'obutev',
    buyPrice: 80,
    buyFees: 5,
    sellPrice: 140,
    sellFees: 6,
    buyDate: daysAgo(25),
    sellDate: daysAgo(8),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'Adidas Yeezy 350',
    category: 'obutev',
    buyPrice: 120,
    buyFees: 5,
    sellPrice: 90,
    sellFees: 4,
    buyDate: daysAgo(40),
    sellDate: daysAgo(15),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  }, // LOSS — bought 120€, sold 90€ (after fees net = 90-4-120-5 = -39€)
  {
    title: 'New Balance 550',
    category: 'obutev',
    buyPrice: 60,
    buyFees: 0,
    sellPrice: 110,
    sellFees: 5,
    buyDate: daysAgo(20),
    sellDate: daysAgo(5),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  // Vinted — clothing (profitable)
  {
    title: 'North Face jakna',
    category: 'oblačila',
    buyPrice: 45,
    buyFees: 3,
    sellPrice: 90,
    sellFees: 4,
    buyDate: daysAgo(35),
    sellDate: daysAgo(12),
    buyLocation: 'Vinted',
    sellLocation: 'Vinted',
    status: 'sold',
  },
  {
    title: 'Levis 501 jeans',
    category: 'oblačila',
    buyPrice: 25,
    buyFees: 2,
    sellPrice: 55,
    sellFees: 3,
    buyDate: daysAgo(28),
    sellDate: daysAgo(7),
    buyLocation: 'Vinted',
    sellLocation: 'Vinted',
    status: 'sold',
  },
  {
    title: 'Zara volnen pulover',
    category: 'oblačila',
    buyPrice: 15,
    buyFees: 2,
    sellPrice: 35,
    sellFees: 2,
    buyDate: daysAgo(22),
    sellDate: daysAgo(3),
    buyLocation: 'Vinted',
    sellLocation: 'Vinted',
    status: 'sold',
  },
  // Avtonet — auto parts (high margin)
  {
    title: 'Alu platišča 17"',
    category: 'avto',
    buyPrice: 200,
    buyFees: 20,
    sellPrice: 380,
    sellFees: 15,
    buyDate: daysAgo(55),
    sellDate: daysAgo(30),
    buyLocation: 'Avtonet',
    sellLocation: 'Avtonet',
    status: 'sold',
  },
  {
    title: 'Zimske gume 205/55',
    category: 'avto',
    buyPrice: 150,
    buyFees: 10,
    sellPrice: 240,
    sellFees: 10,
    buyDate: daysAgo(48),
    sellDate: daysAgo(22),
    buyLocation: 'Avtonet',
    sellLocation: 'Avtonet',
    status: 'sold',
  },
  {
    title: 'Avto radio Bluetooth',
    category: 'avto',
    buyPrice: 40,
    buyFees: 5,
    sellPrice: 75,
    sellFees: 3,
    buyDate: daysAgo(18),
    sellDate: daysAgo(2),
    buyLocation: 'Avtonet',
    sellLocation: 'Avtonet',
    status: 'sold',
  },
  // mobile.de — auto parts (high value, cross-border sourcing)
  {
    title: 'BMW E46 prednje žarometa',
    category: 'avto',
    buyPrice: 80,
    buyFees: 15,
    sellPrice: 160,
    sellFees: 8,
    buyDate: daysAgo(65),
    sellDate: daysAgo(38),
    buyLocation: 'mobile.de',
    sellLocation: 'mobile.de',
    status: 'sold',
  },
  {
    title: 'VW Golf VI zadnji odbijač',
    category: 'avto',
    buyPrice: 50,
    buyFees: 10,
    sellPrice: 120,
    sellFees: 6,
    buyDate: daysAgo(42),
    sellDate: daysAgo(18),
    buyLocation: 'mobile.de',
    sellLocation: 'mobile.de',
    status: 'sold',
  },
  // Still held (inventory aging signal — 5 items)
  {
    title: 'PlayStation 5',
    category: 'elektronika',
    buyPrice: 400,
    buyFees: 0,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(35),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'held',
  },
  {
    title: 'Xbox Series X',
    category: 'elektronika',
    buyPrice: 350,
    buyFees: 0,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(40),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'held',
  },
  {
    title: 'Sony A7III camera',
    category: 'elektronika',
    buyPrice: 800,
    buyFees: 15,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(50),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'held',
  },
  {
    title: 'Nike Air Max 97',
    category: 'obutev',
    buyPrice: 90,
    buyFees: 5,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(32),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'held',
  },
  // Cancelled (for history completeness — 1 item)
  {
    title: 'Samsung TV 55"',
    category: 'elektronika',
    buyPrice: 300,
    buyFees: 0,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(15),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'cancelled',
  },
  // Tools (profitable, Bolha)
  {
    title: 'Bosch vijačni set',
    category: 'orodje',
    buyPrice: 30,
    buyFees: 3,
    sellPrice: 65,
    sellFees: 3,
    buyDate: daysAgo(12),
    sellDate: daysAgo(1),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'Makita akumulatorska vijačna',
    category: 'orodje',
    buyPrice: 120,
    buyFees: 8,
    sellPrice: 180,
    sellFees: 7,
    buyDate: daysAgo(38),
    sellDate: daysAgo(14),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
  {
    title: 'Stanley ketan set',
    category: 'orodje',
    buyPrice: 25,
    buyFees: 2,
    sellPrice: null,
    sellFees: 0,
    buyDate: daysAgo(8),
    sellDate: null,
    buyLocation: 'Bolha',
    sellLocation: '',
    status: 'held',
  },
  {
    title: 'DeWalt kotna brusilka',
    category: 'orodje',
    buyPrice: 85,
    buyFees: 5,
    sellPrice: 130,
    sellFees: 5,
    buyDate: daysAgo(26),
    sellDate: daysAgo(9),
    buyLocation: 'Bolha',
    sellLocation: 'Bolha',
    status: 'sold',
  },
];

// --- Seeder ----------------------------------------------------------------

/**
 * Seed demo trades into the Trade table.
 *
 * IDEMPOTENT: if trades already exist (count > 0), skips and returns
 * { skipped: N } — does NOT delete existing trades (preserves user data).
 */
export async function seedDemoData(): Promise<SeedResult> {
  // 1. Check if trades already exist
  const existingCount = await db.trade.count();
  if (existingCount > 0) {
    logger.info('seedDemoData', `skipped — ${existingCount} trades already exist`);
    return {
      ok: true,
      created: 0,
      skipped: existingCount,
      total: existingCount,
      source: 'v8.35-seed-demo-data',
    };
  }

  // 2. Create all demo trades
  let created = 0;
  let failed = 0;
  for (const trade of DEMO_TRADES) {
    try {
      await db.trade.create({
        data: {
          title: trade.title,
          category: trade.category,
          buyPrice: trade.buyPrice,
          buyFees: trade.buyFees,
          sellPrice: trade.sellPrice,
          sellFees: trade.sellFees,
          buyDate: trade.buyDate,
          sellDate: trade.sellDate,
          buyLocation: trade.buyLocation,
          sellLocation: trade.sellLocation,
          status: trade.status,
        },
      });
      created++;
    } catch (err: any) {
      failed++;
      logger.error('seedDemoData', `failed to create trade "${trade.title}"`, err);
    }
  }

  logger.info('seedDemoData', `created ${created} demo trades (${failed} failures)`);
  return {
    ok: true,
    created,
    skipped: 0,
    total: created,
    source: 'v8.35-seed-demo-data',
  };
}

/**
 * Clear all trades (for re-seeding). Use with caution — deletes EVERYTHING
 * from the Trade table, not just seeded demo data.
 */
export async function clearAllTrades(): Promise<{ ok: true; deleted: number }> {
  const result = await db.trade.deleteMany({});
  logger.info('clearAllTrades', `deleted ${result.count} trades`);
  return { ok: true, deleted: result.count };
}
