/**
 * AI provider abstraction — supports Ollama, OpenAI, Anthropic, and any OpenAI-compatible endpoint.
 * Single interface for listing evaluation.
 */

export type AiProviderType = 'ollama' | 'openai' | 'anthropic' | 'openai-compatible';

export interface AiSettings {
  provider: AiProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ListingEvaluationInput {
  title: string;
  priceText: string;
  price?: number | null;
  location?: string;
  description?: string;
  source: string;
  monitorName: string;
  customPrompt?: string;
}

export interface ListingEvaluation {
  prilika: boolean;
  ocena_tveganja: number; // 1-10
  ocena_prilike: number;  // 1-10
  razlog: string;
  predvidena_trzna_vrednost?: number | null; // EUR
  verdict: 'PRILIKA' | 'SUMNJIVO' | 'NEZANIMIVO';
}

const SYSTEM_PROMPT = `Si izkušen analitik slovenskega trga rabljenih dobrin in nepremičnin.
Tvoja naloga je oceniti, ali je oglas resnična priložnost za zaslužek (preprodaja, najem, investicija)
ali pa sumljiv oglas (morebitna prevara).

Oceniš:
1. PRILIKA (boolean) — ali je cena vsaj 20% pod realno tržno vrednostjo ALI gre za izjemno redko/iskano ponudbo?
2. OCENA_TVEGANJA (1-10) — 1 = zelo varno, 10 = skoraj gotovo prevara. Upoštevaj:
   - rdeče zastave: "pošiljam samo", "paysafecard", "western union", "predračun", prevelika ugodnost
   - krajši opis = sumljivo, daljši z konkretnimi podrobnostmi = verodostojneje
   - fotografije amaterske = bolje kot profesionalne (prevaranti uporabljajo stock)
   - "nujna prodaja" / "selim se" / "dedovanje" — lahko je res, lahko pa taktika
3. OCENA_PRILIKE (1-10) — 1 = nič posebnega, 10 = izjemna priložnost
4. RAZLOG — v 1-2 stavkih v slovenščini pojasni oceno
5. PREDVIDENA_TRZNA_VREDNOST — EUR znesek (samo številka) ali null če ne moreš oceniti
6. VERDICT — PRILIKA (ocena_prilike >= 7 in ocena_tveganja <= 3) | SUMNJIVO (ocena_tveganja >= 6) | NEZANIMIVO

Vedno odgovori JSON, nič drugega.`;

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    prilika: { type: 'boolean' },
    ocena_tveganja: { type: 'integer', minimum: 1, maximum: 10 },
    ocena_prilike: { type: 'integer', minimum: 1, maximum: 10 },
    razlog: { type: 'string' },
    predvidena_trzna_vrednost: { type: ['integer', 'null'] },
    verdict: { type: 'string', enum: ['PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'] },
  },
  required: ['prilika', 'ocena_tveganja', 'ocena_prilike', 'razlog', 'verdict'],
};

function buildUserPrompt(input: ListingEvaluationInput): string {
  const custom = input.customPrompt?.trim()
    ? `\n\nDODATNA NAVODILA UPORABNIKA ZA TA MONITOR:\n${input.customPrompt}`
    : '';
  return `OCENI NASLEDNJI OGLAS:

Vir: ${input.source}
Monitor: ${input.monitorName}
Naslov: ${input.title}
Cena: ${input.priceText}${input.price ? ` (${input.price} EUR)` : ''}
Lokacija: ${input.location || 'ni podatka'}
Opis:
${input.description || '(brez opisa)'}

Vrni JSON.${custom}`;
}

/** Call Ollama with structured JSON output via format schema. */
async function callOllama(settings: AiSettings, userPrompt: string): Promise<string> {
  const url = settings.baseUrl.replace(/\/$/, '') + '/api/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      format: JSON_SCHEMA,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.message?.content ?? '';
}

/** Call any OpenAI-compatible Chat Completions endpoint (includes real OpenAI). */
async function callOpenAiCompatible(settings: AiSettings, userPrompt: string): Promise<string> {
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  // Allow user to enter either base URL or full /v1 path
  const url = baseUrl.endsWith('/v1') || baseUrl.endsWith('/chat/completions')
    ? (baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions')
    : baseUrl + '/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/** Call Anthropic Messages API. */
async function callAnthropic(settings: AiSettings, userPrompt: string): Promise<string> {
  const baseUrl = settings.baseUrl.replace(/\/$/, '') || 'https://api.anthropic.com';
  const url = baseUrl.endsWith('/v1/messages')
    ? baseUrl
    : baseUrl + '/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT + '\n\nOdgovori SAMO z veljavnim JSON objektom.',
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  // Anthropic returns content blocks; concatenate text blocks
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? [];
  return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
}

function parseJsonLoose(raw: string): unknown {
  // Strip code fences and find first { ... }
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // Find first { and last }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

function normalizeEvaluation(parsed: any): ListingEvaluation {
  const risk = clamp(parseInt(String(parsed?.ocena_tveganja ?? '5'), 10) || 5, 1, 10);
  const opp = clamp(parseInt(String(parsed?.ocena_prilike ?? '5'), 10) || 5, 1, 10);
  const prilika = parsed?.prilika ?? (opp >= 7 && risk <= 3);
  let verdict: ListingEvaluation['verdict'] = parsed?.verdict;
  if (!verdict || !['PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'].includes(verdict)) {
    if (risk >= 6) verdict = 'SUMNJIVO';
    else if (opp >= 7 && risk <= 3) verdict = 'PRILIKA';
    else verdict = 'NEZANIMIVO';
  }
  let estVal: number | null | undefined = parsed?.predvidena_trzna_vrednost;
  if (estVal !== null && estVal !== undefined) {
    const n = parseInt(String(estVal), 10);
    estVal = isNaN(n) ? null : n;
  }
  return {
    prilika: Boolean(prilika),
    ocena_tveganja: risk,
    ocena_prilike: opp,
    razlog: String(parsed?.razlog ?? '').slice(0, 600),
    predvidena_trzna_vrednost: estVal ?? null,
    verdict,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function evaluateListing(
  settings: AiSettings,
  input: ListingEvaluationInput
): Promise<ListingEvaluation> {
  const userPrompt = buildUserPrompt(input);
  let raw = '';
  switch (settings.provider) {
    case 'ollama':
      raw = await callOllama(settings, userPrompt);
      break;
    case 'openai':
      raw = await callOpenAiCompatible(settings, userPrompt);
      break;
    case 'openai-compatible':
      raw = await callOpenAiCompatible(settings, userPrompt);
      break;
    case 'anthropic':
      raw = await callAnthropic(settings, userPrompt);
      break;
    default:
      throw new Error(`Unknown AI provider: ${settings.provider}`);
  }
  const parsed = parseJsonLoose(raw);
  return normalizeEvaluation(parsed);
}

/** Lightweight connectivity test used by the Settings page "Test connection" button. */
export async function testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string; modelInfo?: string }> {
  try {
    const sample: ListingEvaluationInput = {
      title: 'Test oglas — iPhone 13 Pro 256GB',
      priceText: '350 EUR',
      price: 350,
      location: 'Ljubljana',
      description: 'Prodam iPhone 13 Pro, kupljen januarja 2022, stanje 9/10, z polnilcem. Selim se v tujino zato nujna prodaja.',
      source: 'test',
      monitorName: 'connection-test',
    };
    const result = await evaluateListing(settings, sample);
    return {
      ok: true,
      message: `Povezava uspešna. Vzorec: ${result.verdict} (tveganje=${result.ocena_tveganja}, prilika=${result.ocena_prilike}).`,
      modelInfo: settings.model,
    };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'Neznana napaka' };
  }
}
