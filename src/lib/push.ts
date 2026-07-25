/**
 * v1.5: Web Push notifications using VAPID.
 * Generates keys on first use, sends push to all subscribed browsers.
 */
import webpush from 'web-push';
import { db } from './db';
import { getSettingsRow } from './pipeline';

/** Ensure VAPID keys exist; generate if missing. Returns public key. */
export async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const settings = await getSettingsRow();
  if (settings.vapidPublicKey && settings.vapidPrivateKey) {
    return { publicKey: settings.vapidPublicKey, privateKey: settings.vapidPrivateKey };
  }
  // Generate new keys
  const keys = webpush.generateVAPIDKeys();
  await db.settings.update({
    where: { id: 'singleton' },
    data: {
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: keys.privateKey,
    },
  });
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

/** Subscribe a browser to push notifications. */
export async function subscribeToPush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Napaka pri shranjevanju' };
  }
}

/** Unsubscribe a browser. */
export async function unsubscribeFromPush(endpoint: string): Promise<{ ok: boolean }> {
  try {
    await db.pushSubscription.delete({ where: { endpoint } });
    return { ok: true };
  } catch {
    return { ok: true }; // Already deleted
  }
}

/** Send a push notification to ALL subscribed browsers. */
export async function sendPushNotification(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  const settings = await getSettingsRow();
  if (!settings.pushEnabled || !settings.vapidPublicKey || !settings.vapidPrivateKey) {
    return { sent: 0, failed: 0, errors: ['Push ni omogočen ali manjkajo VAPID ključi'] };
  }

  // Configure web-push
  webpush.setVapidDetails(
    `mailto:markec@ai-firm.local`,
    settings.vapidPublicKey,
    settings.vapidPrivateKey
  );

  const subscriptions = await db.pushSubscription.findMany();
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, errors: ['Ni registriranih naprav'] };
  }

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const failedEndpoints: string[] = [];

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        message
      );
      sent++;
    } catch (e: any) {
      failed++;
      const status = e?.statusCode ?? 0;
      // 404 = endpoint no longer valid, 410 = gone
      if (status === 404 || status === 410) {
        failedEndpoints.push(sub.endpoint);
      } else {
        errors.push(`${sub.endpoint.slice(-20)}: ${e?.message ?? 'napaka'}`);
      }
    }
  }));

  // Clean up invalid subscriptions
  if (failedEndpoints.length > 0) {
    await db.pushSubscription.deleteMany({
      where: { endpoint: { in: failedEndpoints } },
    });
  }

  return { sent, failed, errors };
}

/** Send a test push notification. */
export async function testPush(): Promise<{ ok: boolean; message: string }> {
  const result = await sendPushNotification({
    title: '✅ Markec AI Firm — test',
    body: 'Push notifications delujejo! Prejemal boš obvestila o novih priložnostih.',
    url: '/',
  });
  if (result.sent > 0) {
    return { ok: true, message: `Poslano na ${result.sent} naprav` };
  }
  return {
    ok: false,
    message: result.errors[0] ?? 'Ni naprav za prejem (registriraj napravo z gumbom v nastavitvah)',
  };
}
