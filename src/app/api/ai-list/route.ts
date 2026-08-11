// v7.01: AI Hub — vrne seznam vseh AI endpointov z opisi in body shemo
// GET /api/ai-list
// Returns: { endpoints: [{ name, description, bodyHint, category }] }
//
// v7.32: Memoized for 5 minutes — was re-reading 254 route.ts files per request.
// v8.15: Recursive scan — discovers nested endpoints like `brain/profit`.
//        Endpoints in subdirectories are surfaced as `subdir/endpoint` and
//        categorized via `categorize()` (e.g. `brain/profit` → 'brain').

import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, statSync, existsSync, type Dirent } from 'fs';
import { join, relative } from 'path';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache: 5-min TTL, invalidated by directory mtime change
let cache: { result: any; builtAt: number; dirMtime: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// v8.15: Known Brain-layer endpoint families. Endpoints under these top-level
// subdirectories are categorized as `brain` (a new category in AI Hub).
const BRAIN_SUBDIRS = new Set(['brain']);

function categorize(name: string): string {
  const n = name.toLowerCase();
  // v8.15: Brain layer — anything under `brain/...`
  if (n.startsWith('brain/') || BRAIN_SUBDIRS.has(n.split('/')[0])) return 'brain';
  if (n.startsWith('buyer') || n.includes('customer')) return 'buyer';
  if (n.startsWith('inventory') || n.includes('stockout') || n.includes('shrinkage') || n.includes('liquidation') || n.includes('rebalancer') || n.includes('turnover') || n.includes('aging')) return 'inventory';
  if (n.startsWith('listing') || n.includes('description') || n.includes('title') || n.includes('seo') || n.includes('thumbnail') || n.includes('image') || n.includes('tag') || n.includes('content') || n.includes('ctr') || n.includes('conversion') || n.includes('engagement') || n.includes('virality') || n.includes('performance')) return 'listing';
  if (n.includes('price') || n.includes('pricing') || n.includes('margin') || n.includes('profit') || n.includes('bundle') || n.includes('cash') || n.includes('budget') || n.includes('seasonal') || n.includes('demand') || n.includes('depreciation') || n.includes('roi') || n.includes('cost')) return 'pricing';
  if (n.includes('risk') || n.includes('fraud') || n.includes('fake') || n.includes('insurance') || n.includes('hedge') || n.includes('parity') || n.includes('saturation') || n.includes('anomal')) return 'risk';
  if (n.includes('negotiation') || n.includes('negotiate') || n.includes('auction') || n.includes('sniper') || n.includes('bid') || n.includes('seller')) return 'negotiation';
  if (n.includes('report') || n.includes('summary') || n.includes('dashboard') || n.includes('forecast') || n.includes('benchmark') || n.includes('insights') || n.includes('trend') || n.includes('monthly') || n.includes('daily') || n.includes('playbook') || n.includes('automation') || n.includes('autonomous')) return 'reports';
  return 'misc';
}

/**
 * v8.15: Recursively discover route.ts files under src/app/api/ai/.
 * Returns relative endpoint names like `buyer-matchmaker`, `brain/profit`.
 * Recursion depth is capped at 2 (top-level + 1 subdirectory) — Brain layer
 * is the only known nested family today.
 */
function discoverEndpoints(aiDir: string, currentDir: string, depth: number, acc: string[]): string[] {
  const MAX_DEPTH = 2;
  let entries: Dirent[];
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip node_modules and other well-known noise directories.
    const nameStr = String(entry.name);
    if (nameStr === 'node_modules' || nameStr.startsWith('.')) continue;
    const subDir = join(currentDir, entry.name);
    const routePath = join(subDir, 'route.ts');
    const relName = relative(aiDir, subDir).split('/').join('/');
    if (existsSync(routePath)) {
      acc.push(relName);
    }
    if (depth + 1 < MAX_DEPTH) {
      discoverEndpoints(aiDir, subDir, depth + 1, acc);
    }
  }
  return acc;
}

export async function GET() {
  try {
    const aiDir = join(process.cwd(), 'src', 'app', 'api', 'ai');

    // v7.32: Serve from cache if fresh
    const dirMtime = statSync(aiDir).mtimeMs;
    const now = Date.now();
    if (cache && (now - cache.builtAt < CACHE_TTL_MS) && cache.dirMtime === dirMtime) {
      return NextResponse.json(cache.result);
    }

    // v8.15: Recursive endpoint discovery (top-level + brain/... subdirectory).
    const endpointNames = discoverEndpoints(aiDir, aiDir, 0, []);

    const endpoints: Array<{ name: string; description: string; bodyHint: string; category: string }> = [];

    for (const name of endpointNames) {
      const routePath = join(aiDir, name, 'route.ts');
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
        name,
        description,
        bodyHint,
        category: categorize(name),
      });
    }

    // Sortiraj abecedno
    endpoints.sort((a, b) => a.name.localeCompare(b.name));

    const categoryCounts: Record<string, number> = {
      buyer: 0,
      inventory: 0,
      listing: 0,
      pricing: 0,
      risk: 0,
      negotiation: 0,
      reports: 0,
      misc: 0,
      brain: 0,
    };
    for (const e of endpoints) {
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    }

    const result = {
      ok: true,
      total: endpoints.length,
      endpoints,
      categories: categoryCounts,
    };

    // v7.32: Store in cache
    cache = { result, builtAt: Date.now(), dirMtime };

    return NextResponse.json(result);
  } catch (e: any) {
    logger.error("/api/ai-list", "GET handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
