/** v7.32: Anti-detection fetch helper — proxy rotation + request delay + realistic headers. */
import { db } from './db';
import { logger } from './logger';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

interface ProxyConfig { url: string; username?: string; password?: string; type: 'http' | 'socks5'; }
interface ADS { proxyEnabled: boolean; proxyList: ProxyConfig[]; realisticHeaders: boolean; requestMinDelay: number; requestMaxDelay: number; }

let cached: { data: ADS; expiresAt: number } | null = null;

async function getSettings(): Promise<ADS> {
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const s = await db.settings.findUnique({ where: { id: 'singleton' }, select: { proxyEnabled: true, proxyList: true, realisticHeaders: true, requestMinDelay: true, requestMaxDelay: true } });
    let proxies: ProxyConfig[] = [];
    try { const p = JSON.parse(s?.proxyList || '[]'); if (Array.isArray(p)) proxies = p; } catch { /* */ }
    const data: ADS = { proxyEnabled: s?.proxyEnabled ?? false, proxyList: proxies, realisticHeaders: s?.realisticHeaders ?? true, requestMinDelay: s?.requestMinDelay ?? 1000, requestMaxDelay: s?.requestMaxDelay ?? 5000 };
    cached = { data, expiresAt: Date.now() + 30000 };
    return data;
  } catch { return { proxyEnabled: false, proxyList: [], realisticHeaders: true, requestMinDelay: 1000, requestMaxDelay: 5000 }; }
}

const UAS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'];

function buildHeaders(realistic: boolean, extra?: Record<string, string>): Record<string, string> {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  if (!realistic) return { 'User-Agent': ua, Accept: 'text/html,*/*;q=0.8', ...(extra || {}) };
  return { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'sl-SI,sl;q=0.9,en;q=0.8', 'Sec-Ch-Ua': '"Chromium";v="124", "Not-A.Brand";v="99"', 'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': '"Windows"', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', ...(extra || {}) };
}

export async function fetchWithAntiDetection(url: string, opts: { headers?: Record<string, string>; method?: string } = {}): Promise<Response> {
  const s = await getSettings();
  if (s.requestMinDelay > 0 && s.requestMaxDelay >= s.requestMinDelay) await new Promise(r => setTimeout(r, s.requestMinDelay + Math.random() * (s.requestMaxDelay - s.requestMinDelay)));
  const headers = buildHeaders(s.realisticHeaders, opts.headers);
  let dispatcher: Dispatcher | undefined;
  if (s.proxyEnabled && s.proxyList.length > 0) {
    const proxy = s.proxyList[Math.floor(Math.random() * s.proxyList.length)];
    try { dispatcher = new ProxyAgent({ uri: proxy.url }); logger.info('anti-detection', `Using proxy ${proxy.url.replace(/\/\/[^@]*@/, '//***@')}`); } catch { /* fall through */ }
  }
  if (dispatcher) { const res = await undiciFetch(url, { method: opts.method || 'GET', headers, redirect: 'follow', dispatcher } as any); return res as unknown as Response; }
  return fetch(url, { method: opts.method || 'GET', headers, redirect: 'follow' });
}

export function resetAntiDetectionCache(): void { cached = null; }
