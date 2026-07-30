// v7.01: AI Hub — vrne seznam vseh AI endpointov z opisi in body shemo
// GET /api/ai-list
// Returns: { endpoints: [{ name, description, bodyHint, category }] }

import { NextResponse } from 'next/server';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function categorize(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith('buyer') || n.includes('customer')) return 'buyer';
  if (n.startsWith('inventory') || n.includes('stockout') || n.includes('shrinkage') || n.includes('liquidation') || n.includes('rebalancer') || n.includes('turnover') || n.includes('aging')) return 'inventory';
  if (n.startsWith('listing') || n.includes('description') || n.includes('title') || n.includes('seo') || n.includes('thumbnail') || n.includes('image') || n.includes('tag') || n.includes('content') || n.includes('ctr') || n.includes('conversion') || n.includes('engagement') || n.includes('virality') || n.includes('performance')) return 'listing';
  if (n.includes('price') || n.includes('pricing') || n.includes('margin') || n.includes('profit') || n.includes('bundle') || n.includes('cash') || n.includes('budget') || n.includes('seasonal') || n.includes('demand') || n.includes('depreciation') || n.includes('roi') || n.includes('cost')) return 'pricing';
  if (n.includes('risk') || n.includes('fraud') || n.includes('fake') || n.includes('insurance') || n.includes('hedge') || n.includes('parity') || n.includes('saturation') || n.includes('anomal')) return 'risk';
  if (n.includes('negotiation') || n.includes('negotiate') || n.includes('auction') || n.includes('sniper') || n.includes('bid') || n.includes('seller')) return 'negotiation';
  if (n.includes('report') || n.includes('summary') || n.includes('dashboard') || n.includes('forecast') || n.includes('benchmark') || n.includes('insights') || n.includes('trend') || n.includes('monthly') || n.includes('daily') || n.includes('playbook') || n.includes('automation') || n.includes('autonomous')) return 'reports';
  return 'misc';
}

export async function GET() {
  try {
    const aiDir = join(process.cwd(), 'src', 'app', 'api', 'ai');
    const entries = readdirSync(aiDir, { withFileTypes: true });
    const endpoints: Array<{ name: string; description: string; bodyHint: string; category: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const routePath = join(aiDir, entry.name, 'route.ts');
      let description = '';
      let bodyHint = '{}';
      try {
        const content = readFileSync(routePath, 'utf-8');
        // Preberi prvi komentar (opis)
        const lines = content.split('\n');
        for (const line of lines.slice(0, 10)) {
          const m = line.match(/^\/\/\s*(.+)$/);
          if (m) {
            description = m[1].trim();
            break;
          }
        }
        // Preberi body hint (prva polja ki se dostopajo iz body)
        const bodyMatch = content.match(/body\?\.\w+/g);
        if (bodyMatch && bodyMatch.length > 0) {
          const uniqueFields = Array.from(new Set(bodyMatch.map(m => m.replace('body?.', ''))));
          // Zgradi primer body JSON
          const sampleBody: any = {};
          for (const f of uniqueFields.slice(0, 3)) {
            sampleBody[f] = f.includes('Id') ? '' : f.includes('Price') || f.includes('Budget') || f.includes('months') ? 0 : '';
          }
          bodyHint = JSON.stringify(sampleBody, null, 2);
        }
      } catch {
        // datoteka morda ne obstaja — skip
      }
      endpoints.push({
        name: entry.name,
        description,
        bodyHint,
        category: categorize(entry.name),
      });
    }

    // Sortiraj abecedno
    endpoints.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      total: endpoints.length,
      endpoints,
      categories: {
        buyer: endpoints.filter(e => e.category === 'buyer').length,
        inventory: endpoints.filter(e => e.category === 'inventory').length,
        listing: endpoints.filter(e => e.category === 'listing').length,
        pricing: endpoints.filter(e => e.category === 'pricing').length,
        risk: endpoints.filter(e => e.category === 'risk').length,
        negotiation: endpoints.filter(e => e.category === 'negotiation').length,
        reports: endpoints.filter(e => e.category === 'reports').length,
        misc: endpoints.filter(e => e.category === 'misc').length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
