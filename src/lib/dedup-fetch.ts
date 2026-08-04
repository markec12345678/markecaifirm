/** v7.32: Deduplicated fetch for GET requests (2s TTL). */
const cache = new Map<string, { promise: Promise<Response>; expiresAt: number }>();
const TTL = 2000;

export function dedupFetch(url: string, options?: RequestInit): Promise<Response> {
  const method = options?.method ?? 'GET';
  if (method !== 'GET' || options?.body !== undefined) return fetch(url, options);
  const now = Date.now();
  const existing = cache.get(url);
  if (existing && existing.expiresAt > now) return existing.promise.then(res => res.clone());
  const promise = fetch(url, options);
  cache.set(url, { promise, expiresAt: now + TTL });
  return promise.then(res => res.clone());
}

export function invalidateDedup(url: string): void { cache.delete(url); }
