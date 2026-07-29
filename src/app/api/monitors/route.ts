import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isUrlSafe } from '@/lib/url-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const monitors = await db.monitor.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { listings: true, alerts: true } },
    },
  });
  return NextResponse.json(monitors);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const required = ['name', 'source', 'sourceUrl'];
  for (const f of required) {
    if (!body?.[f] || typeof body[f] !== 'string') {
      return NextResponse.json({ error: `Manjka obvezno polje: ${f}` }, { status: 400 });
    }
  }

  // v6.92: SSRF zaščita za monitor sourceUrl.
  // Monitor.sourceUrl kliče scraper s strežnika — uporabnik naj ne more dosegati internih IP-jev.
  // Dovolimo http:// za lokalne Bolha/Nepremičnine URL-je (prek ALLOW_HTTP_URLS env).
  const urlSafe = isUrlSafe(body.sourceUrl);
  if (!urlSafe.safe) {
    return NextResponse.json({ error: `sourceUrl ni varen: ${urlSafe.reason}` }, { status: 400 });
  }

  const monitor = await db.monitor.create({
    data: {
      name: body.name,
      source: body.source,
      sourceUrl: body.sourceUrl,
      keywords: body.keywords ?? '',
      excludeKeywords: body.excludeKeywords ?? '',
      minPrice: typeof body.minPrice === 'number' ? body.minPrice : null,
      maxPrice: typeof body.maxPrice === 'number' ? body.maxPrice : null,
      intervalMinutes: typeof body.intervalMinutes === 'number' ? body.intervalMinutes : 30,
      isActive: body.isActive !== false,
      customPrompt: body.customPrompt ?? '',
      // v4.4: tags
      tags: body.tags ?? '',
      // v1.2: schedule window
      runStartHour: typeof body.runStartHour === 'number' ? body.runStartHour : null,
      runEndHour: typeof body.runEndHour === 'number' ? body.runEndHour : null,
      // v1.3: auto-pause threshold
      autoPauseThreshold: typeof body.autoPauseThreshold === 'number' ? body.autoPauseThreshold : 5,
      // v2.5: notification channels
      notificationChannels: typeof body.notificationChannels === 'string' ? body.notificationChannels : '{}',
    },
  });
  return NextResponse.json(monitor, { status: 201 });
}
