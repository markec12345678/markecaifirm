// v6.29 / v8.95.5-other: AI Inventory Insurance Claim Predictor — napove uspešnost zavarovalnih zahtevkov.
// Refaktoriran z withAiRoute helperjem (v8.95.5-other) + enforceBudget guard.
//
// POST /api/ai/insurance-claim
// Body: {}
// Returns: { ok, claims: [{ tradeId, title, claimType, claimAmount, successProbability, evidence, process }], insights, summary }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Input {}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  buyLocation: string | null;
  listing: { aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null } | null;
}

interface HeldItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  buyLocation: string;
  aiRisk: number;
}

interface Claim {
  tradeId: string;
  title: string;
  claimType: string;
  claimAmountEur: number;
  successProbabilityPct: number;
  evidenceNeeded: string[];
  process: {
    whereToFile: string;
    deadlineDays: number;
    steps: string[];
  };
  priority: string;
  reasoning: string;
}

const CLAIM_TYPES = [
  'damage_in_transit', 'not_as_described', 'fake_counterfeit', 'theft_loss',
  'seller_fraud', 'warranty_claim', 'platform_protection', 'payment_chargeback',
] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const DEFAULT_CLAIM_TYPE = 'platform_protection';
const DEFAULT_PRIORITY = 'low';
const DEFAULT_DEADLINE_DAYS = 30;

function includes<T extends string>(arr: ReadonlyArray<T>, v: string): v is T {
  return (arr as ReadonlyArray<string>).includes(v);
}

export const POST = withAiRoute<Input>({
  endpoint: '/api/ai/insurance-claim',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async () => ({}),

  // No validateInput — body ni uporabljen

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, claims: [], message: 'Ni held tradeov za analizo zavarovalnih zahtevkov.' });
    }

    const items = buildItems(heldTrades);
    const prompt = buildPrompt(items);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(items.map(i => i.id));
    const claims = transformClaims(parsed, validIds);
    const summary = computeSummary(claims);

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      claims,
      summary,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildItems(heldTrades: HeldTradeRow[]): HeldItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return {
      id: t.id,
      title: t.title,
      category: t.category || 'drugo',
      cost,
      estValue,
      daysHeld,
      buyLocation: t.buyLocation || 'neznan',
      aiRisk: t.listing?.aiRisk ?? 5,
    };
  });
}

function buildPrompt(items: HeldItem[]): string {
  const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est: ${i.estValue}€ | ${i.daysHeld}d | vir: ${i.buyLocation} | AI risk: ${i.aiRisk}/10`).join('\n');

  return `Si ekspert za zavarovalne zahtevke in vrednotenje škod pri preprodaji.
Za vsak held item analiziraj morebitne zavarovalne zahtevke (škoda, izguba, kraja, napaka prodajalca).

INVENTAR:
${itemsStr}

Tipi zavarovalnih zahtevkov:
1. "damage_in_transit": škoda pri transportu (če si kupil z shipping)
2. "not_as_described": item ne ustreza opisu (napačen model, poškodovan)
3. "fake_counterfeit": izkazalo se je kot ponaredek
4. "theft_loss": kraja ali izguba itema
5. "seller_fraud": prodajalec prevarel (vzel denar, ne dobavil)
6. "warranty_claim": garancijska zahteva (če ima garancijo)
7. "platform_protection": zaščita platforme (Bolha/Vinted buyer protection)
8. "payment_chargeback": chargeback prek banke/PayPal

Pravila:
1. Za vsak item oceni: ali obstaja realna podlaga za zahtevek?
2. successProbability (0-100%): verjetnost uspešnega zahtevka
3. claimAmount: koliko lahko zahtevamo nazaj
4. Potreben dokazni material (screenshot, komunikacija, račun)
5. Postopek: kje in kako vložiti zahtevek

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "claims": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "claim_type": "<damage_in_transit|not_as_described|fake_counterfeit|theft_loss|seller_fraud|warranty_claim|platform_protection|payment_chargeback>",
      "claim_amount_eur": <number>,
      "success_probability_pct": <number 0-100>,
      "evidence_needed": ["<dokaz, max 80 znakov>", "..."],
      "process": {
        "where_to_file": "<kje vložiti, max 80 znakov>",
        "deadline_days": <number>,
        "steps": ["<korak, max 100 znakov>", "..."]
      },
      "priority": "<high|medium|low>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_claims": <number>,
    "total_claim_amount_eur": <number>,
    "high_probability_count": <number>,
    "expected_recovery_eur": <number>,
    "avg_success_probability": <number>
  }
}`;
}

function transformClaims(parsed: any, validIds: Set<string>): Claim[] {
  return (parsed?.claims || [])
    .filter((c: any) => validIds.has(String(c?.id ?? '')))
    .map((c: any): Claim => ({
      tradeId: String(c?.id ?? ''),
      title: String(c?.title ?? '').slice(0, 150),
      claimType: includes(CLAIM_TYPES, String(c?.claim_type)) ? String(c.claim_type) : DEFAULT_CLAIM_TYPE,
      claimAmountEur: Math.max(0, Number(c?.claim_amount_eur ?? 0)),
      successProbabilityPct: Math.max(0, Math.min(100, Number(c?.success_probability_pct ?? 0))),
      evidenceNeeded: (c?.evidence_needed || []).slice(0, 6).map((e: any) => String(e).slice(0, 150)),
      process: {
        whereToFile: String(c?.process?.where_to_file ?? '').slice(0, 200),
        deadlineDays: Math.max(0, Number(c?.process?.deadline_days ?? DEFAULT_DEADLINE_DAYS)),
        steps: (c?.process?.steps || []).slice(0, 6).map((s: any) => String(s).slice(0, 200)),
      },
      priority: includes(PRIORITIES, String(c?.priority)) ? String(c.priority) : DEFAULT_PRIORITY,
      reasoning: String(c?.reasoning ?? '').slice(0, 250),
    }))
    .sort((a: Claim, b: Claim) => b.successProbabilityPct - a.successProbabilityPct);
}

function computeSummary(claims: Claim[]) {
  return {
    totalClaims: claims.length,
    totalClaimAmountEur: claims.reduce((s, c) => s + c.claimAmountEur, 0),
    highProbabilityCount: claims.filter(c => c.successProbabilityPct >= 60).length,
    expectedRecoveryEur: Math.round(claims.reduce((s, c) => s + (c.claimAmountEur * c.successProbabilityPct / 100), 0)),
    avgSuccessProbability: claims.length > 0 ? Math.round(claims.reduce((s, c) => s + c.successProbabilityPct, 0) / claims.length) : 0,
  };
}
