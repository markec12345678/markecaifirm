// v6.15 / v8.96.1-batch2: AI Profit Margin Optimizer — optimizira dobičkovno maržo preko pristojbin, davkov, shippinga
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/margin-optimizer
// Body: { tradeIds?: string[] }
// Returns: { ok, items: [{ id, title, currentMargin, optimizedMargin, improvements: [...] }], summary, recommendations }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// Platform fees (realni podatki)
const PLATFORM_FEES: Record<string, { pct: number; fixedFee: number; currencyConversionFee: number }> = {
  bolha: { pct: 0, fixedFee: 0, currencyConversionFee: 0 },
  vinted: { pct: 0.05, fixedFee: 0.30, currencyConversionFee: 0.02 },
  facebook: { pct: 0, fixedFee: 0, currencyConversionFee: 0 },
  avtonet: { pct: 0, fixedFee: 5, currencyConversionFee: 0 },
  ebay: { pct: 0.10, fixedFee: 0.30, currencyConversionFee: 0.04 },
  kleinanzeigen: { pct: 0, fixedFee: 0, currencyConversionFee: 0 },
};

// Shipping options
const SHIPPING_OPTIONS = [
  { name: 'GLS', sloveniaEur: 4.50, euEur: 12 },
  { name: 'DPD', sloveniaEur: 4.20, euEur: 11 },
  { name: 'Pošta SI', sloveniaEur: 3.50, euEur: 9 },
  { name: 'DHL', sloveniaEur: 8, euEur: 18 },
  { name: 'Personal pickup', sloveniaEur: 0, euEur: 0 },
];

interface MarginOptimizerInput {
  tradeIds: string[];
}

export const POST = withAiRoute<MarginOptimizerInput>({
  endpoint: '/api/ai/margin-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeIds: string[] = Array.isArray(body?.tradeIds) ? body.tradeIds.filter(Boolean) : [];
    return { tradeIds };
  },

  // No validateInput — tradeIds je opcijski (če prazen, vzame vse held)
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeIds } = input;

    // 1. Pridobi sold trades za kontekst
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
        ...(tradeIds.length > 0 ? { id: { in: tradeIds } } : {}),
      },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      take: 30,
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        message: 'Ni held tradeov za optimizacijo marže.',
      });
    }

    // 2. Pripravi iteme z izračunom trenutne marže
    const items = computeItems(heldTrades);

    // 3. AI optimizacija marže
    const prompt = buildPrompt(items);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizedItems = transformItems(parsed, items);

    // Summary
    const totalCurrentMargin = optimizedItems.reduce((s, i) => s + i.currentMargin, 0);
    const totalOptimizedMargin = optimizedItems.reduce((s, i) => s + i.optimizedMarginEur, 0);
    const totalImprovement = totalOptimizedMargin - totalCurrentMargin;
    const avgImprovementPct = optimizedItems.length > 0
      ? Math.round(optimizedItems.reduce((s, i) => s + i.improvementPct, 0) / optimizedItems.length)
      : 0;

    const recommendations = (parsed?.recommendations || []).slice(0, 6).map((r: any) => String(r).slice(0, 300));

    return apiOk({
      ok: true,
      items: optimizedItems,
      summary: {
        summary: String(parsed?.summary ?? '').slice(0, 500),
        totalItems: optimizedItems.length,
        totalCurrentMargin: Math.round(totalCurrentMargin),
        totalOptimizedMargin: Math.round(totalOptimizedMargin),
        totalImprovement: Math.round(totalImprovement),
        avgImprovementPct,
        platformFees: PLATFORM_FEES,
        shippingOptions: SHIPPING_OPTIONS,
      },
      recommendations,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface ItemRow {
  id: string;
  title: string;
  category: string;
  buyLocation: string;
  cost: number;
  estimatedValue: number;
  currentMargin: number;
  currentMarginPct: number;
  daysHeld: number;
}

function computeItems(heldTrades: Array<{
  id: string; title: string; category: string | null; buyPrice: number; buyFees: number | null;
  buyDate: Date; buyLocation: string | null;
  listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
}>): ItemRow[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estimatedValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const currentMargin = estimatedValue - cost;
    const currentMarginPct = cost > 0 ? Math.round((currentMargin / cost) * 100) : 0;
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      buyLocation: t.buyLocation || 'neznan',
      cost,
      estimatedValue,
      currentMargin,
      currentMarginPct,
      daysHeld,
    };
  });
}

function buildPrompt(items: ItemRow[]): string {
  const itemsStr = items.map(i =>
    `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est. prodajna: ${i.estimatedValue}€ | marža: ${i.currentMargin}€ (${i.currentMarginPct}%) | ${i.daysHeld}d v skladišču | kupljeno na: ${i.buyLocation}`
  ).join('\n');

  const platformsStr = Object.entries(PLATFORM_FEES).map(([p, f]) =>
    `- ${p}: ${f.pct * 100}% provizija + ${f.fixedFee}€ fiksno + ${f.currencyConversionFee * 100}% konverzija`
  ).join('\n');

  const shippingStr = SHIPPING_OPTIONS.map(s =>
    `- ${s.name}: SI ${s.sloveniaEur}€, EU ${s.euEur}€`
  ).join('\n');

  return `Si ekspert za optimizacijo dobičkovne marže pri preprodaji.
Optimiziraj maržo za vsak item preko pristojbin, davkov, shippinga in platforme.

ITEMI V SKLADIŠČU:
${itemsStr}

PLATFORM PRISTOJBINE:
${platformsStr}

SHIPPING MOŽNOSTI:
${shippingStr}

Slovenski davčni kontekst:
- Capital gains 40% nad 5.000€ neoporečnega na leto
- DDV vključen v ceni za rabljene dobrine (če nisi DDV zaveznanec)
- Osebni prevoz: brez DDV
- Če si "zasebnik" — brez DDV obveznosti do določene meje

Optimizacijske strategije (več na item):
1. "platform_switch": prodaj na platformi z nižjimi pristojbinami (FB 0% vs eBay 10%)
2. "shipping_optimization": izberi cenejši shipping (personal pickup > GLS > DHL)
3. "bundle_strategy": bundle 2+ itemov za zmanjšanje shipping na enoto
4. "fee_negotiation": dogovori se z buyerjem za split fees
5. "tax_optimization": razporedi prodaje čez leta za <5k neoporečnega
6. "currency_optimization": prodaj v EUR (izogibaj se konverzijskim pristojbinam)
7. "premium_positioning": višja cena na premium platformi čeprav višja provizija
8. "volume_discount": več itemov istemu buyerju = popust v pristojbini

Za vsak item:
1. Izračunaj optimized_margin z aplikacijo 2-3 strategij
2. Prikaži breakdown prihrankov (platform_fee, shipping, currency, tax)
3. Določ optimalno platformo in shipping
4. Priporoči specifično akcijo

Odgovori LE z JSON:
{
  "summary": "<povzetek optimizacije, max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "optimized_platform": "<bolha|vinted|facebook|avtonet|ebay|kleinanzeigen>",
      "optimized_shipping": "<GLS|DPD|Pošta SI|DHL|Personal pickup>",
      "optimized_price_eur": <number>,
      "current_margin_eur": <number>,
      "optimized_margin_eur": <number>,
      "improvement_eur": <number>,
      "improvement_pct": <number>,
      "improvements": [
        {
          "type": "<platform_switch|shipping_optimization|bundle_strategy|fee_negotiation|tax_optimization|currency_optimization|premium_positioning|volume_discount>",
          "savings_eur": <number>,
          "description": "<max 80 znakov>"
        }
      ],
      "reasoning": "<max 100 znakov>"
    }
  ],
  "recommendations": ["<splošno priporočilo, max 150 znakov>", "..."]
}`;
}

function transformItems(parsed: any, items: ItemRow[]): Array<{
  id: string;
  title: string;
  category: string;
  cost: number;
  estimatedValue: number;
  currentMargin: number;
  currentMarginPct: number;
  optimizedPlatform: string;
  optimizedShipping: string;
  optimizedPriceEur: number;
  optimizedMarginEur: number;
  optimizedMarginPct: number;
  improvementEur: number;
  improvementPct: number;
  improvements: Array<{ type: string; savingsEur: number; description: string }>;
  reasoning: string;
}> {
  const validIds = new Set(items.map(i => i.id));
  const itemMap = new Map(items.map(i => [i.id, i]));

  return (parsed?.items || [])
    .filter((it: any) => validIds.has(String(it?.id ?? '')))
    .map((it: any) => {
      const id = String(it.id);
      const orig = itemMap.get(id)!;
      const optimizedMarginEur = Number(it?.optimized_margin_eur ?? orig.currentMargin);
      const improvementEur = optimizedMarginEur - orig.currentMargin;
      return {
        id,
        title: orig.title,
        category: orig.category,
        cost: orig.cost,
        estimatedValue: orig.estimatedValue,
        currentMargin: orig.currentMargin,
        currentMarginPct: orig.currentMarginPct,
        optimizedPlatform: String(it?.optimized_platform ?? 'bolha').slice(0, 30),
        optimizedShipping: String(it?.optimized_shipping ?? 'Personal pickup').slice(0, 30),
        optimizedPriceEur: Math.max(0, Number(it?.optimized_price_eur ?? orig.estimatedValue)),
        optimizedMarginEur: Math.round(optimizedMarginEur),
        optimizedMarginPct: orig.cost > 0 ? Math.round((optimizedMarginEur / orig.cost) * 100) : 0,
        improvementEur: Math.round(improvementEur),
        improvementPct: Math.round(Number(it?.improvement_pct ?? (orig.currentMargin > 0 ? (improvementEur / orig.currentMargin) * 100 : 0))),
        improvements: (Array.isArray(it?.improvements) ? it.improvements : []).slice(0, 5).map((imp: any) => ({
          type: String(imp?.type ?? '').slice(0, 50),
          savingsEur: Math.max(0, Number(imp?.savings_eur ?? 0)),
          description: String(imp?.description ?? '').slice(0, 200),
        })),
        reasoning: String(it?.reasoning ?? '').slice(0, 250),
      };
    });
}
