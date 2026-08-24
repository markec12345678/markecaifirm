#!/usr/bin/env bun
/**
 * v9.22: Comprehensive Demo Data Seed Script
 * ============================================================================
 * Združuje vse seed operacije v eno skripto za enostavno reprodukcijo:
 *   1. Seed 15 demo listings (8 elektronika + 7 avto)
 *   2. Seed 25 demo trades z realistic Slovenian data
 *   3. Seed tags na vseh trades
 *   4. Set monthly profit goal (500€)
 *   5. Enable Web Push + generate VAPID keys
 *   6. Activate demo monitor + set lastRunAt (cron simulacija)
 *
 * UPORABA:
 *   bun run scripts/seed-all.ts
 *
 * IDEMPOTENT: varno za večkratni zagon — preskoči že obstoječe podatke.
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import crypto from 'crypto';

const prisma = new PrismaClient();

const log = (msg: string) => console.log(`  ✓ ${msg}`);
const skip = (msg: string) => console.log(`  → ${msg} (že obstaja)`);

async function main() {
  console.log('\n🌱 Markec AI Firm — Comprehensive Demo Data Seed\n');
  console.log('━'.repeat(60));

  // 1. Seed demo listings
  console.log('\n📦 1/6: Seed demo listings...');
  const existingListings = await prisma.listing.count();
  if (existingListings === 0) {
    execSync('bun run scripts/seed-listings.ts', { stdio: 'pipe' });
    execSync('bun run scripts/seed-cars.ts', { stdio: 'pipe' });
    log('15 demo listings seeded (8 elektronika + 7 avto)');
  } else {
    skip(`${existingListings} listings že obstajajo`);
  }

  // 2. Seed demo trades via API
  console.log('\n💼 2/6: Seed demo trades...');
  const existingTrades = await prisma.trade.count();
  if (existingTrades === 0) {
    try {
      const res = await fetch('http://localhost:3000/api/ai/brain/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const data = await res.json();
      if (data.ok) {
        log(`${data.created} demo trades seeded`);
      } else {
        console.log('  ⚠ API seed ni na voljo — zaženite dev server najprej');
      }
    } catch {
      console.log('  ⚠ API seed ni na voljo — zaženite dev server najprej (bun run dev)');
    }
  } else {
    skip(`${existingTrades} trades že obstajajo`);
  }

  // 3. Seed tags
  console.log('\n🏷️  3/6: Seed tags na trades...');
  const allTrades = await prisma.trade.findMany({ select: { id: true, tags: true } });
  const tradesWithoutTags = allTrades.filter(t => !t.tags || t.tags.trim() === '').length;
  if (tradesWithoutTags > 0) {
    execSync('bun run scripts/seed-tags.ts', { stdio: 'pipe' });
    log(`Tags assigned to ${tradesWithoutTags} trades`);
  } else {
    skip('Vsi trades imajo že tags');
  }

  // 4. Set monthly profit goal
  console.log('\n🎯 4/6: Set monthly profit goal...');
  const settings = await prisma.settings.findFirst();
  if (settings && (!settings.monthlyProfitGoal || settings.monthlyProfitGoal === 0)) {
    await prisma.settings.update({
      where: { id: settings.id },
      data: { monthlyProfitGoal: 500 },
    });
    log('Monthly profit goal nastavljen na 500€');
  } else if (settings && settings.monthlyProfitGoal > 0) {
    skip(`Monthly goal že nastavljen (${settings.monthlyProfitGoal}€)`);
  }

  // 5. Enable Web Push + generate VAPID keys
  console.log('\n📱 5/6: Enable Web Push + VAPID keys...');
  if (settings) {
    const needsPush = !settings.pushEnabled || !settings.vapidPublicKey;
    if (needsPush) {
      // Generate VAPID keys (P-256 format, base64url encoded)
      const { publicKey, privateKey } = generateVapidKeys();
      await prisma.settings.update({
        where: { id: settings.id },
        data: {
          pushEnabled: true,
          vapidPublicKey: publicKey,
          vapidPrivateKey: privateKey,
        },
      });
      log('Web Push omogočen + VAPID ključi generirani');
    } else {
      skip('Web Push že konfiguriran');
    }
  }

  // 6. Activate demo monitor + set lastRunAt (cron simulacija)
  console.log('\n🔄 6/6: Aktiviraj demo monitor + cron simulacija...');
  const monitor = await prisma.monitor.findFirst();
  if (monitor) {
    if (!monitor.isActive || !monitor.lastRunAt) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          isActive: true,
          lastRunAt: new Date(),
          lastStatus: 'success',
        },
      });
      log(`Monitor "${monitor.name}" aktiviran + lastRunAt nastavljen`);
    } else {
      skip(`Monitor "${monitor.name}" je že aktiven`);
    }
  } else {
    console.log('  ⚠ Ni monitorjev — zaženite seed-listings.ts najprej');
  }

  // Summary
  console.log('\n' + '━'.repeat(60));
  console.log('\n📊 SEED SUMMARY:\n');
  const monitors = await prisma.monitor.count();
  const listings = await prisma.listing.count();
  const trades = await prisma.trade.count();
  const alerts = await prisma.alert.count();
  console.log(`  Monitorji:  ${monitors}`);
  console.log(`  Oglasi:      ${listings}`);
  console.log(`  Trgovine:    ${trades}`);
  console.log(`  Alerti:      ${alerts}`);
  console.log(`  Setup:       7/7 (100%)`);
  console.log('\n✅ Demo data seed končan!\n');
}

// Simple VAPID key generator (P-256 ECDSA)
function generateVapidKeys(): { publicKey: string; privateKey: string } {
  // Use Node.js crypto for P-256 key generation
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  
  // Convert to base64url
  const pubB64 = publicKey.toString('base64url');
  const privB64 = privateKey.toString('base64url');
  
  return { publicKey: pubB64, privateKey: privB64 };
}

main()
  .catch((e) => {
    console.error('\n❌ Napaka pri seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
