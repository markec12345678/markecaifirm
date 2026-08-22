// v7.45 / v8.96.0-refactor: Loss Recovery Playbook — ko izgubiš denar, AI analizira zakaj.
// Refaktoriran z withAiRoute helperjem (v8.96.0) + enforceBudget guard.
//
// Analizira vse losing trades (profit < 0) in identificira vzorce:
// - Preveč plačano (buyPrice > estValue)?
// - Predolgo držano (depreciation)?
// - Slaba kategorija (nizek ROI)?
// - Slab prodajalec (high risk)?
// → AI predlaga kako se izogniti podobnim izgubam
//
// GET /api/ai/loss-recovery-playbook

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface LossRecoveryPlaybookInput {}

export const GET = withAiRoute<LossRecoveryPlaybookInput>({
  endpoint: '/api/ai/loss-recovery-playbook',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint je GET-only

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — telo zahtevka je prazno

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // Get all losing trades
    const losingTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, notes: true,
        listing: {
          select: {
            aiVerdict: true, aiScore: true, aiRisk: true,
            aiEstimatedValue: true, dealScore: true, sellerName: true,
          },
        },
      },
      take: 200,
    });

    // Filter to only losses
    const losses = computeLosses(losingTrades);

    if (losses.length === 0) {
      return apiOk({
        ok: true,
        losses: [],
        message: '🎉 Nobenih izgub! Vsi prodani trade-i so bili profitable.',
      });
    }

    const patterns = computePatterns(losses);

    const prompt = buildPrompt(losses, patterns);

    // Local fallback preserved — original vrača deterministic response ko AI fail-a
    // (z fallback-jem ki je že v callAi interno implementiran; če še vedno fail-a,
    // vrnemo deterministic fallback z hardcoded pravili).
    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      return buildFallbackResponse(losses, patterns);
    }

    const parsed: any = parseAi(raw);

    return buildSuccessResponse(parsed, losses, patterns);
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface LosingTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  buyDate: Date;
  sellDate: Date | null;
  notes: string | null;
  listing: {
    aiVerdict: string | null;
    aiScore: number | null;
    aiRisk: number | null;
    aiEstimatedValue: number | null;
    dealScore: number | null;
    sellerName: string | null;
  } | null;
}

interface LossItem extends LosingTradeRow {
  profit: number;
}

interface WorstCategory {
  category: string;
  count: number;
  totalLoss: number;
  avgLoss: number;
}

interface WorstSeller {
  seller: string;
  count: number;
  totalLoss: number;
}

interface LossPatterns {
  totalLoss: number;
  avgLoss: number;
  overpaid: LossItem[];
  heldTooLong: LossItem[];
  highRisk: LossItem[];
  worstCategories: WorstCategory[];
  worstSellers: WorstSeller[];
}

function computeLosses(losingTrades: LosingTradeRow[]): LossItem[] {
  return losingTrades.map(t => {
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    return { ...t, profit };
  }).filter(t => t.profit < 0);
}

function computePatterns(losses: LossItem[]): LossPatterns {
  // Compute patterns
  const totalLoss = losses.reduce((s, t) => s + t.profit, 0);
  const avgLoss = Math.round(totalLoss / losses.length);

  // Pattern 1: Overpaid (buyPrice > estValue)
  const overpaid = losses.filter(t => t.listing?.aiEstimatedValue && t.buyPrice > t.listing.aiEstimatedValue);

  // Pattern 2: Held too long (sell - buy > 45 days)
  const heldTooLong = losses.filter(t => {
    if (!t.sellDate) return false;
    const days = (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86400000;
    return days > 45;
  });

  // Pattern 3: High risk listings (aiRisk >= 6)
  const highRisk = losses.filter(t => (t.listing?.aiRisk ?? 0) >= 6);

  // Pattern 4: Category concentration
  const lossByCategory = new Map<string, { count: number; loss: number }>();
  for (const t of losses) {
    const cat = t.category || 'drugo';
    const cur = lossByCategory.get(cat) || { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += t.profit;
    lossByCategory.set(cat, cur);
  }
  const worstCategories = Array.from(lossByCategory.entries())
    .map(([cat, d]) => ({ category: cat, count: d.count, totalLoss: Math.round(d.loss), avgLoss: Math.round(d.loss / d.count) }))
    .sort((a, b) => a.totalLoss - b.totalLoss);

  // Pattern 5: Seller recurrence
  const lossBySeller = new Map<string, { count: number; loss: number }>();
  for (const t of losses) {
    const seller = t.listing?.sellerName;
    if (!seller) continue;
    const cur = lossBySeller.get(seller) || { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += t.profit;
    lossBySeller.set(seller, cur);
  }
  const worstSellers = Array.from(lossBySeller.entries())
    .map(([seller, d]) => ({ seller, count: d.count, totalLoss: Math.round(d.loss) }))
    .sort((a, b) => a.totalLoss - b.totalLoss)
    .slice(0, 5);

  return { totalLoss, avgLoss, overpaid, heldTooLong, highRisk, worstCategories, worstSellers };
}

function buildPrompt(losses: LossItem[], patterns: LossPatterns): string {
  return `Si ekspert za analizo izgub pri preprodaji rabljenih dobrin.

Analiziraj te IZGUBNE trade-e in identificiraj vzorce:

IZGUBNI TRADE-I (${losses.length}):
${losses.map(t => `- ${t.title} | nabava ${t.buyPrice}€ | prodaja ${t.sellPrice}€ | izguba ${t.profit}€ | kategorija ${t.category} | AI risk ${t.listing?.aiRisk ?? '?'}/10 | est. vrednost ${t.listing?.aiEstimatedValue ?? '?'}€ | deal score ${t.listing?.dealScore ?? '?'}`).join('\n')}

VZORCI:
- Preveč plačano (buyPrice > estValue): ${patterns.overpaid.length} od ${losses.length}
- Predolgo držano (>45 dni): ${patterns.heldTooLong.length} od ${losses.length}
- Visoko tveganje (aiRisk >= 6): ${patterns.highRisk.length} od ${losses.length}
- Najslabše kategorije: ${patterns.worstCategories.slice(0, 3).map(c => `${c.category} (${c.totalLoss}€)`).join(', ')}
- Najslabši prodajalci: ${patterns.worstSellers.map(s => `${s.seller} (${s.totalLoss}€)`).join(', ')}

NALOGA:
1. Identificiraj TOP 3 vzroke izgub
2. Za vsak vzrok daj konkretno preprečevalno akcijo
3. Predlagaj pravila za preprečevanje v prihodnje

Odgovori LE z JSON:
{
  "top_causes": [
    { "cause": "<vzrok>", "frequency": "<pogost>", "impact_eur": <number>, "prevention": "<kako preprečiti>" }
  ],
  "rules": [
    "<pravilo 1 za preprečevanje>",
    "<pravilo 2>",
    "<pravilo 3>"
  ],
  "summary": "<2 stavka povzetek>"
}`;
}

function buildSuccessResponse(parsed: any, losses: LossItem[], patterns: LossPatterns) {
  return apiOk({
    ok: true,
    totalLosses: losses.length,
    totalLossEur: Math.round(patterns.totalLoss),
    avgLossEur: patterns.avgLoss,
    patterns: {
      overpaid: patterns.overpaid.length,
      heldTooLong: patterns.heldTooLong.length,
      highRisk: patterns.highRisk.length,
      overpaidPct: Math.round((patterns.overpaid.length / losses.length) * 100),
      heldTooLongPct: Math.round((patterns.heldTooLong.length / losses.length) * 100),
      highRiskPct: Math.round((patterns.highRisk.length / losses.length) * 100),
    },
    worstCategories: patterns.worstCategories,
    worstSellers: patterns.worstSellers,
    topCauses: (parsed?.top_causes || []).slice(0, 5).map((c: any) => ({
      cause: String(c?.cause ?? '').slice(0, 200),
      frequency: String(c?.frequency ?? '').slice(0, 50),
      impactEur: Math.round(Number(c?.impact_eur ?? 0)),
      prevention: String(c?.prevention ?? '').slice(0, 300),
    })),
    rules: (parsed?.rules || []).slice(0, 10).map((r: any) => String(r).slice(0, 300)),
    summary: String(parsed?.summary ?? '').slice(0, 400),
    losingTrades: losses.slice(0, 10).map(l => ({
      title: l.title,
      category: l.category,
      buyPrice: l.buyPrice,
      sellPrice: l.sellPrice,
      loss: Math.round(l.profit),
      aiRisk: l.listing?.aiRisk,
      estValue: l.listing?.aiEstimatedValue,
    })),
  });
}

function buildFallbackResponse(losses: LossItem[], patterns: LossPatterns) {
  return apiOk({
    ok: true,
    losses: losses.map(l => ({ title: l.title, loss: l.profit, category: l.category })),
    totalLoss: Math.round(patterns.totalLoss),
    avgLoss: patterns.avgLoss,
    patterns: { overpaid: patterns.overpaid.length, heldTooLong: patterns.heldTooLong.length, highRisk: patterns.highRisk.length },
    worstCategories: patterns.worstCategories,
    worstSellers: patterns.worstSellers,
    topCauses: [],
    rules: [
      'Preverjaj Sold Comps pred nakupom — ne plačuj več kot fair market value',
      'Ne drži item-ov >45 dni — znižaj ceno ali likvidiraj',
      'Ne kupuj od prodajalcev z aiRisk >= 6',
    ],
    summary: 'AI ni na voljo — priporočila iz vzorcev izgub.',
  });
}
