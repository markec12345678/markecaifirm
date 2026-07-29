/**
 * v6.92: SSRF (Server-Side Request Forgery) zaščita.
 *
 * Preprečuje, da uporabnik konfigurira URL, ki bi lahko dosegel:
 * - AWS metadata endpoint (169.254.169.254) — kritekčno za krajo IAM ključev v AWS
 * - Internal services (localhost, 10.x, 172.16-31.x, 192.168.x, fd00::, ::1)
 * - Cloudflare/Kubernetes internal IPs (100.64.0.0/10 — CGNAT, fdc* — ULA)
 * - Link-local (169.254.x, fe80::)
 *
 * Uporablja se za:
 * - webhook URL (uporabnik konfigurira v Settings UI)
 * - monitor sourceUrl (uporabnik konfigurira v Monitors UI)
 * - poljuben drug URL, ki ga aplikacija klice s serverja
 */

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  /** Public-safe prikaz (maskirano, da ne razkrije internih IP-jev v logih) */
  maskedUrl?: string;
}

/**
 * Preveri ali je URL varen za server-side fetch.
 * Vrne { safe: true } ali { safe: false, reason }.
 */
export function isUrlSafe(rawUrl: string): UrlSafetyResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, reason: 'URL je prazen ali neveljaven' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'URL ni veljaven (parse error)' };
  }

  // Dovoljeni samo http(s)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Dovoljeni samo http:// in https:// (ne ${parsed.protocol})` };
  }

  // HTTPS zahtevamo za produkcijo (lahko onemogočimo z ALLOW_HTTP_URLS env)
  const allowHttp = process.env.ALLOW_HTTP_URLS === '1';
  if (parsed.protocol === 'http:' && !allowHttp) {
    return { safe: false, reason: 'Samo HTTPS URL-ji so dovoljeni (za production). Za localhost dodaj ALLOW_HTTP_URLS=1 v .env.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 1. Block localhost in vsa varianta
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    // Dovoljeno, če gre za app's own domain (ne za outbound webhook)
    // a za SSRF zaščito blokiramo tudi localhost — uporabnik naj ne pošilja webhook-ov na localhost
    return { safe: false, reason: 'localhost in 127.0.0.1 nista dovoljena za outbound URL (morebitni SSRF)' };
  }

  // 2. Block AWS/GCP/Azure metadata endpoint-e
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata') {
    return { safe: false, reason: 'Cloud metadata endpoint-i so blokirani (SSRF zaščita)' };
  }

  // 3. Block link-local (169.254.x — vključno z AWS metadata)
  if (hostname.startsWith('169.254.')) {
    return { safe: false, reason: 'Link-local naslovi (169.254.x) so blokirani' };
  }

  // 4. Block private IPv4 range (RFC 1918 + CGNAT)
  if (isPrivateIpv4(hostname)) {
    return { safe: false, reason: 'Privatni IP naslovi (RFC 1918 / CGNAT) so blokirani' };
  }

  // 5. Block IPv6 privatne (ULA) + link-local
  if (isPrivateIpv6(hostname)) {
    return { safe: false, reason: 'Privatni IPv6 naslovi (ULA / link-local) so blokirani' };
  }

  // 6. Block DNS rebinding (hostname se resolvuje na privatni IP)
  // To zahteva DNS lookup, ki je expensive — naredimo samo, če je URL zelo sumljiv.
  // Tukaj samo vrnemo safe=true; pravi DNS check naj bo v callerju (async funkcija).
  return {
    safe: true,
    maskedUrl: maskUrl(parsed),
  };
}

/**
 * Async razširitev isUrlSafe — naredi tudi DNS lookup za preprečevanje DNS rebinding.
 * Uporablja se za kritične outbound URL-je (npr. webhook test).
 */
export async function isUrlSafeWithDns(rawUrl: string): Promise<UrlSafetyResult> {
  const basic = isUrlSafe(rawUrl);
  if (!basic.safe) return basic;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'URL ni veljaven' };
  }

  // Skip DNS check za localhost (že blokirano zgoraj, a če je dovoljen z ALLOW_HTTP_URLS)
  const hostname = parsed.hostname;
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    // IP naslov ali localhost — že preverjeno z isPrivateIpv4/v6
    return basic;
  }

  // DNS lookup za hostname
  try {
    const { resolve4, resolve6 } = await import('dns').then(m => ({ resolve4: m.promises.resolve4, resolve6: m.promises.resolve6 }));
    const [ipv4, ipv6] = await Promise.all([
      resolve4(hostname).catch(() => [] as string[]),
      resolve6(hostname).catch(() => [] as string[]),
    ]);

    for (const ip of [...ipv4, ...ipv6]) {
      if (isPrivateIp(ip)) {
        return { safe: false, reason: `Hostname ${hostname} se resolvuje na privatni IP (${maskIp(ip)}) — DNS rebinding napad` };
      }
      if (ip.startsWith('169.254.')) {
        return { safe: false, reason: `Hostname ${hostname} se resolvuje na link-local (${maskIp(ip)}) — SSRF` };
      }
    }
  } catch {
    // DNS napaka — ne blokiraj (lahko je lokalni hostname)
  }

  return basic;
}

function isPrivateIpv4(hostname: string): boolean {
  // IPv4 regex
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, aStr, bStr] = m;
  const a = parseInt(aStr, 10);
  const b = parseInt(bStr, 10);
  if (a === 10) return true;                    // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;       // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 0) return true;                     // 0.0.0.0/8
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|]$/g, '');
  if (h === '::1' || h === '::') return true;  // loopback
  if (h.startsWith('fe80')) return true;        // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA (fc00::/7)
  if (h.startsWith('ff')) return true;         // multicast
  return false;
}

function isPrivateIp(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

function maskUrl(parsed: URL): string {
  // Public-safe prikaz: hostname + path, brez query/fragment
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
}

function maskIp(ip: string): string {
  // Public-safe prikaz IP-ja: pokaži samo prvi oktet
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.x.x.x`;
  return ip.split(':').slice(0, 2).join(':') + ':x:x:x';
}

/**
 * Pomožna funkcija za API route: vrne NextResponse error, če URL ni varen.
 *
 * Uporaba:
 *   const safe = isUrlSafe(body.webhookUrl);
 *   if (!safe.safe) return NextResponse.json({ error: safe.reason }, { status: 400 });
 */
export function unsafeUrlError(result: UrlSafetyResult): string | null {
  return result.safe ? null : (result.reason ?? 'URL ni varen');
}
