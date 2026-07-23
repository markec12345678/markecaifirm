import { NextRequest, NextResponse } from 'next/server';
import { subscribeToPush, unsubscribeFromPush, ensureVapidKeys } from '@/lib/push';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/push/subscribe
 * Returns VAPID public key for browser subscription.
 */
export async function GET() {
  const settings = await getSettingsRow();
  // Ensure keys exist (generate on first call)
  if (!settings.vapidPublicKey) {
    await ensureVapidKeys();
  }
  const fresh = await getSettingsRow();
  return NextResponse.json({
    pushEnabled: fresh.pushEnabled,
    vapidPublicKey: fresh.vapidPublicKey,
  });
}

/**
 * POST /api/push/subscribe
 * Body: { subscription: { endpoint, keys: { p256dh, auth } } }
 * or { action: 'unsubscribe', endpoint: '...' }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body?.action === 'unsubscribe') {
    const result = await unsubscribeFromPush(body.endpoint);
    return NextResponse.json(result);
  }

  if (!body?.subscription?.endpoint || !body?.subscription?.keys?.p256dh || !body?.subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Manjkajo podatki o naročnini' }, { status: 400 });
  }

  const result = await subscribeToPush(body.subscription);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
