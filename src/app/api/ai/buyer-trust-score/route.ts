// v6.46 / v8.94-refactor: AI Buyer Trust Score — ocenjuje zaupanja vrednost kupca (scam risk, payment reliability, behavior)
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/buyer-trust-score
// Body: { customerName?: string }
// Returns: { ok, scoring: { buyers, riskFactors, trustLevels, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BuyerTrustScoreInput {
  customerName: string | null;
}

// Trust score komponente
interface BuyerData {
  name: string;
  purchases: number;
  totalSpent: number;
  avgOrderValue: number;
  firstPurchase: Date | null;
  lastPurchase: Date | null;
  daysAsCustomer: number;
  daysSinceLastPurchase: number;
  categories: Set<string>;
  items: string[];
  avgDaysBetweenPurchases: number;
  repeatPurchaseRate: number; // 0-100
  paymentReliabilityScore: number; // 0-100
  communicationScore: number; // 0-100
  locationConsistency: boolean;
}

export const POST = withAiRoute<BuyerTrustScoreInput>({
  endpoint: '/api/ai/buyer-trust-score',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      customerName: body?.customerName ? String(body.customerName).trim() : null,
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { customerName } = input;

    // 1. Pridobi sold trade-e z sellLocation (kupec)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, sellPrice: true, sellFees: true,
        sellDate: true, buyDate: true,
        sellLocation: true,
      },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, scoring: null, message: 'Ni prodaj za trust score analizo.' });
    }

    // 2. Agregacija po sellLocation (kupec)
    const buyers = aggregateBuyers(soldTrades);

    if (customerName && !buyers.some(b => b.name === customerName)) {
      return apiOk({ ok: true, scoring: null, message: `Kupec "${customerName}" ni najden v zgodovini prodaj.` });
    }

    // 3. Izračun metrik za vsakega kupca
    const buyersWithMetrics = computeBuyerMetrics(buyers, Date.now());

    const targetBuyers = customerName
      ? buyersWithMetrics.filter(b => b.name === customerName)
      : buyersWithMetrics.slice(0, 25);

    // 4. AI klic
    const prompt = buildPrompt(targetBuyers);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    // 5. Transformacija rezultatov
    const scoring = transformScoring(parsed, targetBuyers);

    return apiOk({ ok: true, scoring });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface SoldTrade {
  title: string;
  category: string | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  sellLocation: string | null;
}

function aggregateBuyers(soldTrades: SoldTrade[]): BuyerData[] {
  const buyerMap = new Map<string, BuyerData>();

  for (const t of soldTrades) {
    const name = (t.sellLocation || '').trim();
    if (!name || name.length < 2) continue;
    if (!t.sellDate) continue;

    if (!buyerMap.has(name)) {
      buyerMap.set(name, {
        name,
        purchases: 0,
        totalSpent: 0,
        avgOrderValue: 0,
        firstPurchase: t.sellDate,
        lastPurchase: t.sellDate,
        daysAsCustomer: 0,
        daysSinceLastPurchase: 0,
        categories: new Set<string>(),
        items: [],
        avgDaysBetweenPurchases: 0,
        repeatPurchaseRate: 0,
        paymentReliabilityScore: 70,
        communicationScore: 65,
        locationConsistency: true,
      });
    }
    const b = buyerMap.get(name)!;
    b.purchases += 1;
    b.totalSpent += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    if (t.sellDate < (b.firstPurchase as Date)) b.firstPurchase = t.sellDate;
    if (t.sellDate > (b.lastPurchase as Date)) b.lastPurchase = t.sellDate;
    if (t.category) b.categories.add(t.category);
    b.items.push(t.title);
  }

  return Array.from(buyerMap.values()).filter(b => b.purchases >= 1);
}

function computeBuyerMetrics(buyers: BuyerData[], now: number): BuyerData[] {
  return buyers.map(b => {
    b.avgOrderValue = Math.round(b.totalSpent / b.purchases);
    if (b.firstPurchase && b.lastPurchase) {
      b.daysAsCustomer = Math.max(1, Math.round((now - b.firstPurchase.getTime()) / (24 * 60 * 60 * 1000)));
      b.daysSinceLastPurchase = Math.round((now - b.lastPurchase.getTime()) / (24 * 60 * 60 * 1000));
      if (b.purchases > 1) {
        b.avgDaysBetweenPurchases = Math.round(((b.lastPurchase.getTime() - b.firstPurchase.getTime()) / (24 * 60 * 60 * 1000)) / (b.purchases - 1));
      }
    }
    b.repeatPurchaseRate = b.purchases > 1 ? Math.min(100, Math.round((b.purchases / Math.max(1, b.daysAsCustomer / 30)) * 50)) : 0;

    // Hevristični trust score (brez AI)
    // - Več nakupov = višji trust (max 30)
    // - Višji total spent = višji trust (max 25)
    // - Dni kot kupec = višji trust (max 15)
    // - Nedavni nakup = višji trust (max 15)
    // - Kategorijska diverziteta = višji trust (max 15)
    const purchaseScore = Math.min(30, b.purchases * 6);
    const spentScore = Math.min(25, Math.round(b.totalSpent / 50));
    const longevityScore = Math.min(15, Math.round(b.daysAsCustomer / 30));
    const recencyScore = Math.max(0, 15 - Math.round(b.daysSinceLastPurchase / 30));
    const diversityScore = Math.min(15, b.categories.size * 3);

    b.paymentReliabilityScore = Math.min(100, 50 + purchaseScore + spentScore + longevityScore);
    b.communicationScore = Math.min(100, 50 + recencyScore + diversityScore + Math.round(b.repeatPurchaseRate / 4));

    return b;
  });
}

function buildPrompt(targetBuyers: BuyerData[]): string {
  const buyersStr = targetBuyers.map(b =>
    `- ${b.name} | ${b.purchases}x nakup | ${b.totalSpent}€ skupaj | ${b.avgOrderValue}€ povprečno | ${b.daysAsCustomer}d kot kupec | ${b.daysSinceLastPurchase}d od zadnjega | ${b.categories.size} kategorij | payment ${b.paymentReliabilityScore}/100 | comm ${b.communicationScore}/100`
  ).join('\n');

  return `Si AI buyer trust score analyst za slovenske oglasne platforme.
Oceni zaupanja vrednost vsakega kupca na podlagi obnašanja in zgodovine nakupov.

KUPCI ZA ANALIZO (${targetBuyers.length}):
${buyersStr}

Trust score komponente (0-100 vsaka):
1. PAYMENT_RELIABILITY: ali vedno plača (pravočasno, pravi znesek, brez frauda)
2. COMMUNICATION_QUALITY: ali jasno komunicira, brez sumljivih zahtev
3. SCAM_RISK: verjetnost da je scammer (1-100, višji = večji risk)
4. CHURN_RISK: verjetnost da neha kupovati (0-100)
5. LIFETIME_VALUE_POTENTIAL: napovedana vrednost kupca v 12 mesecih (EUR)

Red flags:
- Kupi samo najcenejše iteme (potential flipper)
- Tlači cene (lowball offers)
- Zahteva off-platform komunikacijo (off Bolha = scam signal)
- Hitra zaporedna nakupa istega itema (potential reseller)
- Plača z nepreverljivimi metodami (cash, neposredni nakazili)
- Lokacija se spreminja med nakupi
- Ni zgodovine (nov kupec = višji risk)

Green flags:
- Redni povratniki (loyal)
- Visoka avg order value
- Kupuje raznolike kategorije
- Stik že več mesecev
- Plača prek platforme (varno)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "trust_score": <number 0-100>,
      "trust_level": "<platinum|gold|silver|bronze|risky|scammer>",
      "payment_reliability": <number 0-100>,
      "communication_quality": <number 0-100>,
      "scam_risk": <number 0-100>,
      "churn_risk": <number 0-100>,
      "lifetime_value_potential_eur": <number>,
      "risk_factors": ["<max 80 znakov>"],
      "green_flags": ["<max 80 znakov>"],
      "recommended_action": "<accept_priority|accept_standard|verify_first|decline|blacklist>",
      "action_reasoning": "<max 120 znakov>",
      "max_safe_transaction_eur": <number>,
      "preferred_payment_method": "<paypal|bank_transfer|cash_on_delivery|platform_escrow|cash>"
    }
  ],
  "risk_factors_summary": [
    { "factor": "<max 80 znakov>", "affected_buyers": <number>, "severity": "<low|medium|high|critical>", "mitigation": "<max 120 znakov>" }
  ],
  "trust_levels": [
    { "level": "<platinum|gold|silver|bronze|risky|scammer>", "buyer_count": <number>, "avg_trust_score": <number>, "total_revenue_eur": <number>, "strategy": "<max 120 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "risk_addressed": "<max 80 znakov>" }
  ],
  "summary": {
    "total_buyers": <number>,
    "avg_trust_score": <number>,
    "platinum_count": <number>,
    "gold_count": <number>,
    "silver_count": <number>,
    "bronze_count": <number>,
    "risky_count": <number>,
    "scammer_count": <number>,
    "total_safe_transaction_value_eur": <number>,
    "trust_efficiency_score": <number 0-100>,
    "biggest_risk": "<max 100 znakov>",
    "safest_buyer": "<max 100 znakov>"
  }
}`;
}

function transformScoring(parsed: any, targetBuyers: BuyerData[]): any {
  const validNames = new Set(targetBuyers.map(b => b.name));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    buyers: (parsed?.buyers || [])
      .filter((b: any) => validNames.has(String(b?.name ?? '')))
      .slice(0, 25)
      .map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        trustScore: Math.max(0, Math.min(100, Number(b?.trust_score ?? 50))),
        trustLevel: ['platinum', 'gold', 'silver', 'bronze', 'risky', 'scammer'].includes(String(b?.trust_level)) ? String(b.trust_level) : 'bronze',
        paymentReliability: Math.max(0, Math.min(100, Number(b?.payment_reliability ?? 50))),
        communicationQuality: Math.max(0, Math.min(100, Number(b?.communication_quality ?? 50))),
        scamRisk: Math.max(0, Math.min(100, Number(b?.scam_risk ?? 30))),
        churnRisk: Math.max(0, Math.min(100, Number(b?.churn_risk ?? 30))),
        lifetimeValuePotentialEur: Math.round(Number(b?.lifetime_value_potential_eur ?? 0)),
        riskFactors: (b?.risk_factors || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
        greenFlags: (b?.green_flags || []).slice(0, 5).map((f: any) => String(f).slice(0, 150)),
        recommendedAction: ['accept_priority', 'accept_standard', 'verify_first', 'decline', 'blacklist'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'accept_standard',
        actionReasoning: String(b?.action_reasoning ?? '').slice(0, 250),
        maxSafeTransactionEur: Math.round(Number(b?.max_safe_transaction_eur ?? 500)),
        preferredPaymentMethod: ['paypal', 'bank_transfer', 'cash_on_delivery', 'platform_escrow', 'cash'].includes(String(b?.preferred_payment_method)) ? String(b.preferred_payment_method) : 'platform_escrow',
      })),
    riskFactorsSummary: (parsed?.risk_factors_summary || []).slice(0, 8).map((r: any) => ({
      factor: String(r?.factor ?? '').slice(0, 150),
      affectedBuyers: Math.max(0, Number(r?.affected_buyers ?? 0)),
      severity: ['low', 'medium', 'high', 'critical'].includes(String(r?.severity)) ? String(r.severity) : 'medium',
      mitigation: String(r?.mitigation ?? '').slice(0, 200),
    })),
    trustLevels: (parsed?.trust_levels || []).slice(0, 6).map((l: any) => ({
      level: ['platinum', 'gold', 'silver', 'bronze', 'risky', 'scammer'].includes(String(l?.level)) ? String(l.level) : 'bronze',
      buyerCount: Math.max(0, Number(l?.buyer_count ?? 0)),
      avgTrustScore: Math.max(0, Math.min(100, Number(l?.avg_trust_score ?? 50))),
      totalRevenueEur: Math.round(Number(l?.total_revenue_eur ?? 0)),
      strategy: String(l?.strategy ?? '').slice(0, 200),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
      riskAddressed: String(r?.risk_addressed ?? '').slice(0, 150),
    })),
    summary: {
      totalBuyers: targetBuyers.length,
      avgTrustScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_trust_score ?? 50))),
      platinumCount: Math.max(0, Number(parsed?.summary?.platinum_count ?? 0)),
      goldCount: Math.max(0, Number(parsed?.summary?.gold_count ?? 0)),
      silverCount: Math.max(0, Number(parsed?.summary?.silver_count ?? 0)),
      bronzeCount: Math.max(0, Number(parsed?.summary?.bronze_count ?? 0)),
      riskyCount: Math.max(0, Number(parsed?.summary?.risky_count ?? 0)),
      scammerCount: Math.max(0, Number(parsed?.summary?.scammer_count ?? 0)),
      totalSafeTransactionValueEur: Math.round(Number(parsed?.summary?.total_safe_transaction_value_eur ?? 0)),
      trustEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.trust_efficiency_score ?? 50))),
      biggestRisk: String(parsed?.summary?.biggest_risk ?? '').slice(0, 200),
      safestBuyer: String(parsed?.summary?.safest_buyer ?? '').slice(0, 200),
    },
  };
}
