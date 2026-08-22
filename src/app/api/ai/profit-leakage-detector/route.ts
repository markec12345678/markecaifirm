// v7.69 / v8.96.5-batch1: AI Profit Leakage Detector — AI identificira kje
// profit "teče" — skrite cene, zamujene priložnosti, suboptimalne cene. Pove
// natančno koliko profita se izgublja in kje. Refaktoriran z withAiRoute
// helperjem (v8.96) + enforceBudget guard.
//
// "Letna izguba: 450€. Glavni vir: podcenajevanje elektronike (-12%). Fix:
//  prodajaj pri 95% estValue → +200€/leto."
//
// Razlika od profit-efficiency-analyzer (ki meri kako učinkovito pretvaraš čas
// v profit — profitPerDay, timeEfficiencyScore) — ta gleda RAZLIKOM med
// actual in ideal profitom (leakage) in identificira vire izgub. Razlika od
// net-profit (ki prikazuje skupni profit) — ta meri koliko profita MANJKA.
// Razlika od price-elasticity (ki gleda kako cena vpliva na prodajo) — ta
// gleda kako suboptimalna prodajna cena pušča profit na mizi. Razlika od
// inventory-capital-efficiency-optimizer (ki optimizira kapitalsko alokacijo)
// — ta identificira FINANCNE POMAKANJA v prodajni/procesu.
//
// GET+POST /api/ai/profit-leakage-detector
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitLeakageDetectorInput {}

// --- Types ---------------------------------------------------------------

type LeakageSource = 'PRICING' | 'FEE' | 'HOLDING_COST' | 'OPPORTUNITY';

interface LeakageHotspot {
  tradeId: string;
  title: string;
  actualProfit: number;
  idealProfit: number;
  leakage: number;
  leakagePercent: number;
  primaryLeakageSource: string;
  detail: string;
}

interface SystemicIssue {
  issue: string;
  affectedCount: number;
  estimatedLoss: number;
  pattern: string;
}

interface FixPriority {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  fix: string;
  estimatedRecovery: number;
  effort: string;
}

interface AiLeakageResponse {
  leakageHotspots?: unknown;
  systemicIssues?: unknown;
  estimatedAnnualLeakage?: unknown;
  fixPriorities?: unknown;
  expectedRecovery?: unknown;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: { aiEstimatedValue: number | null } | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyDate: Date | null;
  listing: { aiEstimatedValue: number | null } | null;
}

interface CancelledTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  listing: { aiEstimatedValue: number | null } | null;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const CARRYING_COST_PER_DAY = 0.5; // 0.50€ per day per held item
const VALID_PRIORITY: readonly ('HIGH' | 'MEDIUM' | 'LOW')[] = [
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// --- Deterministic analysis (fallback) -----------------------------------

interface LeakageItemBase {
  tradeId: string;
  title: string;
  category: string;
  actualProfit: number;
  idealProfit: number;
  pricingLeakage: number;
  feeLeakage: number;
  holdingCostLeakage: number;
  opportunityLeakage: number;
  daysHeld: number;
  sold: boolean;
}

function buildDeterministicHotspots(items: LeakageItemBase[]): LeakageHotspot[] {
  return items
    .map(it => {
      const leakage =
        it.pricingLeakage +
        it.feeLeakage +
        it.holdingCostLeakage +
        it.opportunityLeakage;
      const leakagePercent =
        it.idealProfit > 0 ? (leakage / it.idealProfit) * 100 : 0;

      const sources: Array<{ src: LeakageSource; amt: number }> = [
        { src: 'PRICING', amt: it.pricingLeakage },
        { src: 'FEE', amt: it.feeLeakage },
        { src: 'HOLDING_COST', amt: it.holdingCostLeakage },
        { src: 'OPPORTUNITY', amt: it.opportunityLeakage },
      ];
      sources.sort((a, b) => b.amt - a.amt);
      const primary = sources[0]?.src ?? 'PRICING';

      let detail: string;
      switch (primary) {
        case 'PRICING':
          detail = `Prodano pod estValue za ${Math.round(it.pricingLeakage)}€ izgube v ceni.`;
          break;
        case 'FEE':
          detail = `Visoke pristojbine (${Math.round(it.feeLeakage)}€) — kupi/prodaj z manj pristojbinami.`;
          break;
        case 'HOLDING_COST':
          detail = `Predolgo držano (${Math.round(it.daysHeld)} dni × 0.50€ = ${Math.round(it.holdingCostLeakage)}€ carrying cost).`;
          break;
        case 'OPPORTUNITY':
          detail = `Preklicano — zamujena priložnost za ${Math.round(it.opportunityLeakage)}€ potential profit.`;
          break;
        default:
          detail = 'Izguba iz neznanega vira.';
      }

      return {
        tradeId: it.tradeId,
        title: it.title,
        actualProfit: Math.round(it.actualProfit),
        idealProfit: Math.round(it.idealProfit),
        leakage: Math.round(leakage),
        leakagePercent: Math.round(leakagePercent * 10) / 10,
        primaryLeakageSource: primary,
        detail,
      };
    })
    .sort((a, b) => b.leakage - a.leakage);
}

function buildDeterministicSystemic(items: LeakageItemBase[]): SystemicIssue[] {
  const issues: SystemicIssue[] = [];

  // Group by category for pricing leakage pattern
  const byCatPricing = new Map<string, { count: number; loss: number }>();
  for (const it of items) {
    if (it.pricingLeakage <= 0) continue;
    const cur = byCatPricing.get(it.category) || { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += it.pricingLeakage;
    byCatPricing.set(it.category, cur);
  }
  for (const [category, d] of byCatPricing) {
    if (d.count >= 1 && d.loss > 0) {
      issues.push({
        issue: `Podcenajevanje v kategoriji "${category}"`,
        affectedCount: d.count,
        estimatedLoss: Math.round(d.loss),
        pattern: `Povprečno ${Math.round(d.loss / d.count)}€ izgube na prodajo — prodajaj višje.`,
      });
    }
  }

  // Fee leakage
  const feeItems = items.filter(it => it.feeLeakage > 0);
  if (feeItems.length >= 1) {
    const totalLoss = feeItems.reduce((s, i) => s + i.feeLeakage, 0);
    issues.push({
      issue: 'Visoke pristojbine pri nakupu/prodaji',
      affectedCount: feeItems.length,
      estimatedLoss: Math.round(totalLoss),
      pattern: `Povprečno ${Math.round(totalLoss / feeItems.length)}€ pristojbin na trade — optimiziraj kanale (direktno, brez posrednika).`,
    });
  }

  // Holding cost pattern
  const longHeld = items.filter(it => it.daysHeld > 45);
  if (longHeld.length >= 1) {
    const totalLoss = longHeld.reduce((s, i) => s + i.holdingCostLeakage, 0);
    issues.push({
      issue: 'Predolgo držanje inventarja (>45 dni)',
      affectedCount: longHeld.length,
      estimatedLoss: Math.round(totalLoss),
      pattern: `Carrying cost 0.50€/dan × ${Math.round(
        longHeld.reduce((s, i) => s + i.daysHeld, 0) / longHeld.length,
      )} dni povprečno — pospeši prodajo.`,
    });
  }

  // Opportunity leakage
  const oppItems = items.filter(it => it.opportunityLeakage > 0);
  if (oppItems.length >= 1) {
    const totalLoss = oppItems.reduce((s, i) => s + i.opportunityLeakage, 0);
    issues.push({
      issue: 'Preklicani trade-i z potencialnim profitom',
      affectedCount: oppItems.length,
      estimatedLoss: Math.round(totalLoss),
      pattern: `${oppItems.length} preklicanih trade-ov z ${Math.round(totalLoss / oppItems.length)}€ povprečnim zamujenim profitom.`,
    });
  }

  return issues.sort((a, b) => b.estimatedLoss - a.estimatedLoss);
}

function buildDeterministicFixes(
  systemic: SystemicIssue[],
): { fixPriorities: FixPriority[]; expectedRecovery: number } {
  const fixPriorities: FixPriority[] = [];

  for (let i = 0; i < systemic.length; i++) {
    const s = systemic[i];
    if (!s) continue;
    const priority: 'HIGH' | 'MEDIUM' | 'LOW' =
      i === 0 ? 'HIGH' : i < 3 ? 'MEDIUM' : 'LOW';
    const recovery = Math.round(s.estimatedLoss * 0.7); // assume 70% recoverable
    fixPriorities.push({
      priority,
      fix: `Popravi: ${s.issue} — ${s.pattern}`,
      estimatedRecovery: recovery,
      effort:
        priority === 'HIGH'
          ? '1-2 tedna'
          : priority === 'MEDIUM'
            ? '2-4 tedne'
            : '1-2 meseca',
    });
  }

  const expectedRecovery = fixPriorities.reduce(
    (s, f) => s + f.estimatedRecovery,
    0,
  );

  return { fixPriorities, expectedRecovery };
}

// --- AI prompt + merge helpers (pure, extracted OUTSIDE handler) ----------

function buildHotspotBlock(hotspots: LeakageHotspot[]): string {
  return hotspots
    .slice(0, 20)
    .map(
      (h, i) =>
        `${i + 1}. tradeId=${h.tradeId}, title="${h.title}", actualProfit=${h.actualProfit}€, idealProfit=${h.idealProfit}€, leakage=${h.leakage}€ (${h.leakagePercent}%), source=${h.primaryLeakageSource}, detail="${h.detail}"`,
    )
    .join('\n');
}

function buildSystemicBlock(systemic: SystemicIssue[]): string {
  return systemic
    .slice(0, 10)
    .map(
      (s, i) =>
        `${i + 1}. issue="${s.issue}", affectedCount=${s.affectedCount}, estimatedLoss=${s.estimatedLoss}€, pattern="${s.pattern}"`,
    )
    .join('\n');
}

interface PromptTotals {
  totalActualProfit: number;
  totalIdealProfit: number;
  totalLeakage: number;
  leakagePercent: number;
  estimatedAnnualLeakage: number;
  annualFactor: number;
  hotspotCount: number;
  systemicCount: number;
}

function buildPrompt(
  hotspotBlock: string,
  systemicBlock: string,
  totals: PromptTotals,
): string {
  return `Si AI analitik profitnih izgub za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraj kako profit "teče" — kje izgubljaš denar: podcenajevanje, visoke pristojbine, predolgo držanje, zamujene priložnosti.

PODATKI O LEAKAGE HOTSPOTS (top ${Math.min(20, totals.hotspotCount)} od ${totals.hotspotCount}):
${hotspotBlock || '—'}

PODATKI O SISTEMSKIH TEŽAVAH (top ${Math.min(10, totals.systemicCount)} od ${totals.systemicCount}):
${systemicBlock || '—'}

SKUPNE METRIKE:
- totalActualProfit: ${Math.round(totals.totalActualProfit)}€
- totalIdealProfit: ${Math.round(totals.totalIdealProfit)}€
- totalLeakage: ${Math.round(totals.totalLeakage)}€
- leakagePercent: ${Math.round(totals.leakagePercent * 10) / 10}%
- estimatedAnnualLeakage: ${totals.estimatedAnnualLeakage}€ (annualFactor=${totals.annualFactor.toFixed(2)})

PRAVILA ZA ANALIZO:
1. leakageHotspots: top 10 item-ov z največ leakage — za vsak napiši specifičen "detail" (kaj natančno je šlo narobe pri tem item-u).
2. systemicIssues: 3-7 vzorcev ki se ponavljajo (npr. "vedno podcenjuješ elektroniko za 12%") — vsak z affectedCount, estimatedLoss in pattern opisom.
3. estimatedAnnualLeakage: letna projekcija izgube v EUR (uporabi annualFactor ${totals.annualFactor.toFixed(2)}).
4. fixPriorities: 3-5 ranked popravkov z priority (HIGH/MEDIUM/LOW), fix opisom, estimatedRecovery v EUR (70-90% izgube obvladljive) in effort (1-2 tedna / 2-4 tedne / 1-2 meseca).
5. expectedRecovery: vsota estimatedRecovery iz fixPriorities (max 80% od totalLeakage).

VRNI LE JSON:
{
  "leakageHotspots": [
    {
      "tradeId": "abc",
      "title": "...",
      "actualProfit": 0,
      "idealProfit": 0,
      "leakage": 0,
      "leakagePercent": 0,
      "primaryLeakageSource": "PRICING",
      "detail": "..."
    }
  ],
  "systemicIssues": [
    {
      "issue": "...",
      "affectedCount": 0,
      "estimatedLoss": 0,
      "pattern": "..."
    }
  ],
  "estimatedAnnualLeakage": 0,
  "fixPriorities": [
    {
      "priority": "HIGH",
      "fix": "...",
      "estimatedRecovery": 0,
      "effort": "1-2 tedna"
    }
  ],
  "expectedRecovery": 0
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeResult {
  hotspots: LeakageHotspot[];
  systemicIssues: SystemicIssue[];
  fixPriorities: FixPriority[];
  expectedRecovery: number;
  aiAnnualLeakage: number;
  aiUsed: boolean;
}

function mergeAiIntoLeakage(
  parsed: AiLeakageResponse | null,
  baselineHotspots: LeakageHotspot[],
  baselineSystemic: SystemicIssue[],
  baselineFixes: { fixPriorities: FixPriority[]; expectedRecovery: number },
  totalLeakage: number,
  estimatedAnnualLeakage: number,
): MergeResult {
  // Start with deterministic baseline
  let hotspots: LeakageHotspot[] = baselineHotspots.slice(0, 10);
  let systemicIssues: SystemicIssue[] = baselineSystemic.slice(0, 7);
  let fixPriorities: FixPriority[] = baselineFixes.fixPriorities.slice(0, 5);
  let expectedRecovery = baselineFixes.expectedRecovery;
  let aiAnnualLeakage = estimatedAnnualLeakage;
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Parse leakageHotspots — preserve DB numbers from baseline
    if (Array.isArray(parsed.leakageHotspots)) {
      const aiHotspots: LeakageHotspot[] = [];
      const baselineMap = new Map(baselineHotspots.map(h => [h.tradeId, h]));
      for (const h of parsed.leakageHotspots) {
        const a = h as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;
        const tradeId = clampString(a.tradeId, 100, '');
        const baseline = baselineMap.get(tradeId);
        if (!baseline) continue; // only allow tradeIds we know
        const source = clampEnum(
          a.primaryLeakageSource,
          [
            'PRICING',
            'FEE',
            'HOLDING_COST',
            'OPPORTUNITY',
          ] as const,
          baseline.primaryLeakageSource as LeakageSource,
        );
        aiHotspots.push({
          tradeId: baseline.tradeId,
          title: baseline.title,
          actualProfit: baseline.actualProfit,
          idealProfit: baseline.idealProfit,
          leakage: baseline.leakage,
          leakagePercent: baseline.leakagePercent,
          primaryLeakageSource: source,
          detail: clampString(a.detail, 300, baseline.detail),
        });
      }
      if (aiHotspots.length > 0) hotspots = aiHotspots;
    }

    // Parse systemicIssues
    if (Array.isArray(parsed.systemicIssues)) {
      const aiSystemic: SystemicIssue[] = [];
      for (const s of parsed.systemicIssues) {
        const a = s as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;
        aiSystemic.push({
          issue: clampString(a.issue, 200, '—'),
          affectedCount: clampNumber(a.affectedCount, 0, 10000, 1),
          estimatedLoss: clampNumber(
            a.estimatedLoss,
            0,
            totalLeakage * 2,
            0,
          ),
          pattern: clampString(a.pattern, 300, '—'),
        });
      }
      if (aiSystemic.length > 0) systemicIssues = aiSystemic;
    }

    // Parse fixPriorities
    if (Array.isArray(parsed.fixPriorities)) {
      const aiFixes: FixPriority[] = [];
      for (const f of parsed.fixPriorities) {
        const a = f as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;
        const priority = clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM');
        const recovery = clampNumber(
          a.estimatedRecovery,
          0,
          totalLeakage * 0.8,
          0,
        );
        aiFixes.push({
          priority,
          fix: clampString(a.fix, 300, '—'),
          estimatedRecovery: recovery,
          effort: clampString(a.effort, 50, '1-2 tedna'),
        });
      }
      if (aiFixes.length > 0) fixPriorities = aiFixes;
    }

    // Parse estimatedAnnualLeakage + expectedRecovery (clamped)
    aiAnnualLeakage = clampNumber(
      parsed.estimatedAnnualLeakage,
      0,
      estimatedAnnualLeakage * 2,
      estimatedAnnualLeakage,
    );

    let aiExpected = clampNumber(
      parsed.expectedRecovery,
      0,
      totalLeakage * 0.8,
      baselineFixes.expectedRecovery,
    );
    // If AI returned fixPriorities, recompute from sum
    if (fixPriorities.length > 0) {
      const sumRecovery = fixPriorities.reduce(
        (s, f) => s + f.estimatedRecovery,
        0,
      );
      if (sumRecovery > 0) aiExpected = sumRecovery;
    }
    expectedRecovery = aiExpected;

    aiUsed = true;
  }

  return { hotspots, systemicIssues, fixPriorities, expectedRecovery, aiAnnualLeakage, aiUsed };
}

// --- Handler -------------------------------------------------------------

const profitLeakageHandler = withAiRoute<ProfitLeakageDetectorInput>({
  endpoint: '/api/ai/profit-leakage-detector',
  maxDuration: 60,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    // 1) Query all SOLD trades with full data
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: { select: { aiEstimatedValue: true } },
      },
      take: 5000,
    }) as unknown as SoldTradeRow[];

    // Query HELD trades for carrying cost
    const heldTrades = await db.trade.findMany({
      where: { status: 'held', buyPrice: { gt: 0 } },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: { select: { aiEstimatedValue: true } },
      },
      take: 2000,
    }) as unknown as HeldTradeRow[];

    // Query CANCELLED trades for opportunity leakage
    const cancelledTrades = await db.trade.findMany({
      where: { status: 'cancelled', buyPrice: { gt: 0 } },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: { select: { aiEstimatedValue: true } },
      },
      take: 2000,
    }) as unknown as CancelledTradeRow[];

    const totalSold = soldTrades.length;

    // Empty state
    if (
      totalSold === 0 &&
      heldTrades.length === 0 &&
      cancelledTrades.length === 0
    ) {
      return apiOk({
        ok: true,
        summary: {
          totalActualProfit: 0,
          totalIdealProfit: 0,
          totalLeakage: 0,
          leakagePercent: 0,
          estimatedAnnualLeakage: 0,
        },
        leakageSources: {
          pricingLeakage: { amount: 0, count: 0, avgPercent: 0 },
          feeLeakage: { amount: 0, count: 0, avgPercent: 0 },
          holdingCostLeakage: { amount: 0, count: 0, avgDays: 0 },
          opportunityLeakage: { amount: 0, count: 0 },
        },
        hotspots: [],
        systemicIssues: [],
        fixPriorities: [],
        expectedRecovery: 0,
        aiUsed: false,
        message:
          'Ni prodanih, aktivnih ali preklicanih trade-ov — Profit Leakage analiza ni mogoča. Dodaš trades z buyPrice in sellPrice za začetek.',
      });
    }

    // 2) Compute per-trade leakage
    const leakageItems: LeakageItemBase[] = [];

    for (const t of soldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? sellPrice;

      const actualProfit = sellPrice - sellFees - buyPrice - buyFees;
      const idealProfit = Math.max(0, aiEstimatedValue - buyPrice);

      // Pricing leakage: sold below estValue
      const pricingLeakage = Math.max(0, aiEstimatedValue - sellPrice);

      // Fee leakage: >5% of trade value
      const tradeValue = sellPrice + buyPrice;
      const totalFees = buyFees + sellFees;
      const feeThreshold = tradeValue * 0.05;
      const feeLeakage = Math.max(0, totalFees - feeThreshold);

      // Holding cost leakage: days × 0.50€/day (only above 14-day grace)
      let daysHeld = 0;
      if (t.buyDate && t.sellDate) {
        const holdMs =
          new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime();
        if (Number.isFinite(holdMs) && holdMs > 0) {
          daysHeld = Math.round(holdMs / DAY_MS);
        }
      }
      const holdingCostLeakage =
        daysHeld > 14 ? (daysHeld - 14) * CARRYING_COST_PER_DAY : 0;

      leakageItems.push({
        tradeId: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase() || 'drugo',
        actualProfit,
        idealProfit,
        pricingLeakage,
        feeLeakage,
        holdingCostLeakage,
        opportunityLeakage: 0,
        daysHeld,
        sold: true,
      });
    }

    // Process CANCELLED trades for opportunity leakage
    for (const t of cancelledTrades) {
      const buyPrice = t.buyPrice ?? 0;
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? buyPrice;
      const potentialProfit = Math.max(0, aiEstimatedValue - buyPrice);
      if (potentialProfit > 0) {
        leakageItems.push({
          tradeId: t.id,
          title: t.title,
          category: (t.category || 'drugo').trim().toLowerCase() || 'drugo',
          actualProfit: 0,
          idealProfit: potentialProfit,
          pricingLeakage: 0,
          feeLeakage: 0,
          holdingCostLeakage: 0,
          opportunityLeakage: potentialProfit,
          daysHeld: 0,
          sold: false,
        });
      }
    }

    // HELD trades → ongoing carrying cost
    let heldCarryingCost = 0;
    const nowMs = Date.now();
    for (const t of heldTrades) {
      const buyDate = t.buyDate ? new Date(t.buyDate).getTime() : null;
      if (!buyDate) continue;
      const daysHeld = Math.max(0, Math.round((nowMs - buyDate) / DAY_MS));
      if (daysHeld > 14) {
        heldCarryingCost += (daysHeld - 14) * CARRYING_COST_PER_DAY;
      }
    }

    // 3) Aggregate totals
    const totalActualProfit = leakageItems.reduce(
      (s, i) => s + i.actualProfit,
      0,
    );
    const totalIdealProfit = leakageItems.reduce(
      (s, i) => s + i.idealProfit,
      0,
    );
    const totalLeakage =
      leakageItems.reduce(
        (s, i) =>
          s +
          i.pricingLeakage +
          i.feeLeakage +
          i.holdingCostLeakage +
          i.opportunityLeakage,
        0,
      ) + heldCarryingCost;
    const leakagePercent =
      totalIdealProfit > 0 ? (totalLeakage / totalIdealProfit) * 100 : 0;

    // Per-source aggregates
    const pricingLeakageItems = leakageItems.filter(
      i => i.pricingLeakage > 0,
    );
    const feeLeakageItems = leakageItems.filter(i => i.feeLeakage > 0);
    const holdingLeakageItems = leakageItems.filter(
      i => i.holdingCostLeakage > 0,
    );
    const opportunityLeakageItems = leakageItems.filter(
      i => i.opportunityLeakage > 0,
    );

    const pricingLeakageAmount = pricingLeakageItems.reduce(
      (s, i) => s + i.pricingLeakage,
      0,
    );
    const feeLeakageAmount = feeLeakageItems.reduce(
      (s, i) => s + i.feeLeakage,
      0,
    );
    const holdingCostLeakageAmount =
      holdingLeakageItems.reduce((s, i) => s + i.holdingCostLeakage, 0) +
      heldCarryingCost;
    const opportunityLeakageAmount = opportunityLeakageItems.reduce(
      (s, i) => s + i.opportunityLeakage,
      0,
    );

    // Annual projection based on date range of sold trades
    let annualFactor = 1;
    if (soldTrades.length > 1) {
      const buyDates = soldTrades
        .map(t => t.buyDate)
        .filter((d): d is Date => d != null)
        .map(d => new Date(d).getTime())
        .sort((a, b) => a - b);
      if (buyDates.length > 0) {
        const span = buyDates[buyDates.length - 1]! - buyDates[0]!;
        const spanDays = Math.max(1, span / DAY_MS);
        annualFactor = 365 / spanDays;
      }
    }
    const estimatedAnnualLeakage = Math.round(totalLeakage * annualFactor);

    // Build leakage sources payload (reused in both cached and uncached paths)
    const leakageSourcesPayload = {
      pricingLeakage: {
        amount: Math.round(pricingLeakageAmount),
        count: pricingLeakageItems.length,
        avgPercent:
          pricingLeakageItems.length > 0
            ? Math.round(
                (pricingLeakageItems.reduce(
                  (s, i) =>
                    s +
                    (i.idealProfit > 0
                      ? (i.pricingLeakage / i.idealProfit) * 100
                      : 0),
                  0,
                ) /
                  pricingLeakageItems.length) *
                  10,
              ) / 10
            : 0,
      },
      feeLeakage: {
        amount: Math.round(feeLeakageAmount),
        count: feeLeakageItems.length,
        avgPercent:
          feeLeakageItems.length > 0
            ? Math.round(
                (feeLeakageItems.reduce((s, i) => {
                  const denom =
                    i.actualProfit + i.pricingLeakage + i.feeLeakage;
                  return s + (denom > 0 ? (i.feeLeakage / denom) * 100 : 0);
                }, 0) /
                  feeLeakageItems.length) *
                  10,
              ) / 10
            : 0,
      },
      holdingCostLeakage: {
        amount: Math.round(holdingCostLeakageAmount),
        count: holdingLeakageItems.length + heldTrades.length,
        avgDays:
          holdingLeakageItems.length > 0
            ? Math.round(
                holdingLeakageItems.reduce((s, i) => s + i.daysHeld, 0) /
                  holdingLeakageItems.length,
              )
            : 0,
      },
      opportunityLeakage: {
        amount: Math.round(opportunityLeakageAmount),
        count: opportunityLeakageItems.length,
      },
    };

    // 4) AI cache check (6h TTL)
    const cacheKey = `profit-leakage-detector:${totalSold}`;
    const cached = getCachedAI<{
      leakageHotspots: LeakageHotspot[];
      systemicIssues: SystemicIssue[];
      estimatedAnnualLeakage: number;
      fixPriorities: FixPriority[];
      expectedRecovery: number;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        summary: {
          totalActualProfit: Math.round(totalActualProfit),
          totalIdealProfit: Math.round(totalIdealProfit),
          totalLeakage: Math.round(totalLeakage),
          leakagePercent: Math.round(leakagePercent * 10) / 10,
          estimatedAnnualLeakage: cached.estimatedAnnualLeakage ?? estimatedAnnualLeakage,
        },
        leakageSources: leakageSourcesPayload,
        hotspots: cached.leakageHotspots ?? [],
        systemicIssues: cached.systemicIssues ?? [],
        fixPriorities: cached.fixPriorities ?? [],
        expectedRecovery: cached.expectedRecovery ?? 0,
        cached: true,
        aiUsed: true,
      });
    }

    // 5) Build deterministic baseline (used both as fallback and starting point)
    const baselineHotspots = buildDeterministicHotspots(leakageItems);
    const baselineSystemic = buildDeterministicSystemic(leakageItems);
    const baselineFixes = buildDeterministicFixes(baselineSystemic);

    // 6) AI prompt with grounding
    const hotspotBlock = buildHotspotBlock(baselineHotspots);
    const systemicBlock = buildSystemicBlock(baselineSystemic);
    const prompt = buildPrompt(hotspotBlock, systemicBlock, {
      totalActualProfit,
      totalIdealProfit,
      totalLeakage,
      leakagePercent,
      estimatedAnnualLeakage,
      annualFactor,
      hotspotCount: baselineHotspots.length,
      systemicCount: baselineSystemic.length,
    });

    let hotspots: LeakageHotspot[] = baselineHotspots.slice(0, 10);
    let systemicIssues: SystemicIssue[] = baselineSystemic.slice(0, 7);
    let fixPriorities: FixPriority[] = baselineFixes.fixPriorities.slice(0, 5);
    let expectedRecovery = baselineFixes.expectedRecovery;
    let aiAnnualLeakage = estimatedAnnualLeakage;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiLeakageResponse | null;

      const merged = mergeAiIntoLeakage(
        parsed,
        baselineHotspots,
        baselineSystemic,
        baselineFixes,
        totalLeakage,
        estimatedAnnualLeakage,
      );
      hotspots = merged.hotspots;
      systemicIssues = merged.systemicIssues;
      fixPriorities = merged.fixPriorities;
      expectedRecovery = merged.expectedRecovery;
      aiAnnualLeakage = merged.aiAnnualLeakage;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-leakage-detector',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        leakageHotspots: hotspots,
        systemicIssues,
        estimatedAnnualLeakage: aiAnnualLeakage,
        fixPriorities,
        expectedRecovery,
      });
    }

    return apiOk({
      ok: true,
      summary: {
        totalActualProfit: Math.round(totalActualProfit),
        totalIdealProfit: Math.round(totalIdealProfit),
        totalLeakage: Math.round(totalLeakage),
        leakagePercent: Math.round(leakagePercent * 10) / 10,
        estimatedAnnualLeakage: aiAnnualLeakage,
      },
      leakageSources: leakageSourcesPayload,
      hotspots,
      systemicIssues,
      fixPriorities,
      expectedRecovery: Math.round(expectedRecovery),
      aiUsed,
    });
  },
});

export const GET = profitLeakageHandler;
export const POST = profitLeakageHandler;
