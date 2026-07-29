// v5.4: Webhook endpoints API — CRUD za zunanje webhook integracije
// GET /api/webhooks — list all
// POST /api/webhooks — create new
// PATCH /api/webhooks — update
// DELETE /api/webhooks?id=xxx — delete
// POST /api/webhooks?test=xxx — send test event

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { triggerWebhooks } from '@/lib/webhook-engine';
import { isUrlSafeWithDns, isUrlSafe } from '@/lib/url-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_EVENTS = ['alert.created', 'price.drop', 'target.hit', 'listing.new', 'trade.sold', '*'];

export async function GET() {
  const endpoints = await db.webhookEndpoint.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({
    endpoints: endpoints.map(e => ({
      ...e,
      events: JSON.parse(e.events || '[]'),
    })),
  });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const testId = url.searchParams.get('test');

  // Test mode: send test event to specific endpoint
  if (testId) {
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id: testId } });
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook ne obstaja' }, { status: 404 });
    }
    // v6.92: SSRF check — endpoint URL je bil morda nastavljen pred fixom
    const safe = await isUrlSafeWithDns(endpoint.url);
    if (!safe.safe) {
      return NextResponse.json({ ok: false, error: `Webhook URL ni varen: ${safe.reason}` });
    }
    try {
      const testPayload = {
        event: 'alert.created',
        timestamp: new Date().toISOString(),
        data: {
          test: true,
          message: '🧪 Test webhook od Markec AI Firm',
          endpoint: endpoint.name,
        },
      };
      const body = JSON.stringify(testPayload);
      const crypto = await import('crypto');
      const signature = endpoint.secret
        ? crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')
        : null;

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Markec-Event': 'alert.created',
          'X-Markec-Test': 'true',
          ...(signature ? { 'X-Markec-Signature': signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      return NextResponse.json({
        ok: res.ok,
        status: res.status,
        responseText: await res.text().catch(() => ''),
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? 'Napaka' });
    }
  }

  // Create mode
  try {
    const body = await req.json();
    const { name, url: webhookUrl, secret, events } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Ime je obvezno' }, { status: 400 });
    }
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
      return NextResponse.json({ error: 'URL mora biti veljaven HTTP(S) URL' }, { status: 400 });
    }

    // v6.92: SSRF zaščita — prepreči webhook URL-je na internih/privatnih IP-jih
    const urlSafe = isUrlSafe(webhookUrl);
    if (!urlSafe.safe) {
      return NextResponse.json({ error: `URL ni varen: ${urlSafe.reason}` }, { status: 400 });
    }

    const eventList: string[] = Array.isArray(events) ? events.filter((e: string) => VALID_EVENTS.includes(e)) : [];
    if (eventList.length === 0) {
      return NextResponse.json({ error: 'Izberi vsaj en event' }, { status: 400 });
    }

    const endpoint = await db.webhookEndpoint.create({
      data: {
        name: name.trim(),
        url: webhookUrl.trim(),
        secret: typeof secret === 'string' ? secret.trim() : '',
        events: JSON.stringify(eventList),
        isActive: true,
      },
    });

    return NextResponse.json({
      ok: true,
      endpoint: {
        ...endpoint,
        events: JSON.parse(endpoint.events),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, url: webhookUrl, secret, events, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
    }

    const endpoint = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook ne obstaja' }, { status: 404 });
    }

    const data: any = {};
    if (typeof name === 'string') data.name = name.trim();
    if (typeof webhookUrl === 'string') {
      // v6.92: SSRF zaščita tudi pri PATCH update
      const urlSafe = isUrlSafe(webhookUrl);
      if (!urlSafe.safe) {
        return NextResponse.json({ error: `URL ni varen: ${urlSafe.reason}` }, { status: 400 });
      }
      data.url = webhookUrl.trim();
    }
    if (typeof secret === 'string') data.secret = secret.trim();
    if (Array.isArray(events)) {
      data.events = JSON.stringify(events.filter((e: string) => VALID_EVENTS.includes(e)));
    }
    if (typeof isActive === 'boolean') data.isActive = isActive;

    const updated = await db.webhookEndpoint.update({ where: { id }, data });
    return NextResponse.json({
      ok: true,
      endpoint: {
        ...updated,
        events: JSON.parse(updated.events),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
  }
  try {
    await db.webhookEndpoint.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
