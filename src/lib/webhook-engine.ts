// v5.4: Webhook Engine — pošiljanje alertov na zunanje servise (Zapier, Make, n8n)
// Pokliče se ob kreaciji alerta, price drop, target hit, ali new listing

import { db } from './db';
import crypto from 'crypto';

export type WebhookEvent = 'alert.created' | 'price.drop' | 'target.hit' | 'listing.new' | 'trade.sold';

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: any;
}

/**
 * Trigger all webhooks subscribed to a specific event.
 */
export async function triggerWebhooks(event: WebhookEvent, data: any): Promise<void> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { isActive: true },
  });

  for (const endpoint of endpoints) {
    try {
      const events: string[] = JSON.parse(endpoint.events || '[]');
      if (!events.includes(event) && !events.includes('*')) continue;

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };

      const body = JSON.stringify(payload);
      const signature = endpoint.secret
        ? crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')
        : null;

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Markec-Event': event,
          ...(signature ? { 'X-Markec-Signature': signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      await db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastTriggeredAt: new Date(),
          lastResponseStatus: res.status,
          lastError: res.ok ? null : `HTTP ${res.status}`,
          triggerCount: { increment: 1 },
          ...(res.ok ? {} : { failCount: { increment: 1 } }),
        },
      });
    } catch (e: any) {
      await db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastTriggeredAt: new Date(),
          lastError: (e?.message ?? 'napaka').slice(0, 500),
          triggerCount: { increment: 1 },
          failCount: { increment: 1 },
        },
      });
    }
  }
}
