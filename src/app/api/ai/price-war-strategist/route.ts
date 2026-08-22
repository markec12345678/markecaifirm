// v6.49 / v8.96.2-batch4: AI Price War Strategist — defensive/offensive strategije za price war s competitorji
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/price-war-strategist
// Body: { category?: string }
// Returns: { ok, strategist: { wars, competitors, strategies, tactics, scenarios, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface PriceWarStrategistInput {
  category: string | null;
}

interface WarData {
  category: string;
  activeWars: number;
  avgDropPct: number;
  totalSellers: number;
  yourPosition: 'leader' | 'follower' | 'neutral' | 'undercut';
  yourPriceVsAvgPct: number;
  competitors: Array<{ name: string; price: number; dropPct: number; trend: 'rising' | 'stable' | 'falling' }>;
}

interface DroppedListingRow {
  id: string;
  title: string;
  price: number | null;
  previousPrice: number | null;
  priceDroppedAt: Date | null;
  sellerName: string | null;
}

interface RecentListingRow {
  id: string;
  title: string;
  price: number | null;
  sellerName: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  listing: { aiEstimatedValue: number | null } | null;
}

const CAT_KEYWORDS = ['iphone', 'samsung', 'telefon', 'laptop', 'računalnik', 'kolo', 'avto', 'smuči', 'pohištvo', 'klima', 'tv', 'playstation', 'xbox'];

export const POST = withAiRoute<PriceWarStrategistInput>({
  endpoint: '/api/ai/price-war-strategist',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { category: body?.category ? String(body.category).toLowerCase() : null };
  },

  // No validateInput — category je optional
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { category: categoryFilter } = input;

    // 1. Pridobi price drop listings v zadnjih 14 dneh
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const droppedListings = await db.listing.findMany({
      where: {
        priceDroppedAt: { gte: since, not: null },
        previousPrice: { not: null },
        isHidden: false,
        ...(categoryFilter ? { category: { contains: categoryFilter } } : {}),
      },
      select: {
        id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true,
        sellerName: true, location: true, aiEstimatedValue: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 300,
      orderBy: { priceDroppedAt: 'desc' },
    });

    // 2. Pridobi vse aktivne listings za benchmark
    const recentListings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        isHidden: false,
        price: { not: null, gt: 0 },
        ...(categoryFilter ? { title: { contains: categoryFilter } } : {}),
      },
      select: {
        id: true, title: true, price: true, sellerName: true,
        location: true, firstSeenAt: true, aiEstimatedValue: true,
      },
      take: 500,
      orderBy: { firstSeenAt: 'desc' },
    });

    // 3. Pridobi naš inventar (held trades)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } },
      },
      take: 50,
    });

    if (recentListings.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, strategist: null, message: 'Ni dovolj podatkov za price war analizo.' });
    }

    // 4. Agregacija + wars computation
    const wars = computeWars(recentListings, droppedListings, heldTrades);

    const topWars = wars.slice(0, 8);

    const prompt = buildPrompt(topWars);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const strategist = transformStrategist(parsed, topWars);

    return apiOk({ ok: true, strategist });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function categoryFromTitle(title: string): string {
  const titleLower = (title || '').toLowerCase();
  for (const kw of CAT_KEYWORDS) {
    if (titleLower.includes(kw)) return kw;
  }
  return 'drugo';
}

function computeWars(
  recentListings: RecentListingRow[],
  droppedListings: DroppedListingRow[],
  heldTrades: HeldTradeRow[]
): WarData[] {
  const categoryAgg = new Map<string, { listings: RecentListingRow[]; drops: DroppedListingRow[]; }>();

  for (const l of recentListings) {
    const cat = categoryFromTitle(l.title);
    if (!categoryAgg.has(cat)) categoryAgg.set(cat, { listings: [], drops: [] });
    categoryAgg.get(cat)!.listings.push(l);
  }
  for (const d of droppedListings) {
    for (const [, v] of categoryAgg.entries()) {
      if (v.listings.some(l => l.id === d.id)) { v.drops.push(d); break; }
    }
  }

  const wars: WarData[] = [];
  for (const [cat, data] of categoryAgg.entries()) {
    if (data.listings.length < 3) continue;

    const prices = data.listings.map(l => l.price ?? 0).filter(p => p > 0);
    if (prices.length === 0) continue;
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minPrice = Math.min(...prices);

    // Drop analysis
    const drops = data.drops;
    const avgDropPct = drops.length > 0
      ? drops.reduce((s, d) => {
          const prev = d.previousPrice ?? 0;
          const curr = d.price ?? 0;
          return s + (prev > 0 ? ((prev - curr) / prev) * 100 : 0);
        }, 0) / drops.length
      : 0;

    // Sellers
    const sellersSet = new Set(data.listings.map(l => l.sellerName).filter(Boolean));

    // Naša pozicija (če imamo held trade v tej kategoriji)
    const ourTrade = heldTrades.find(t => (t.category || '').toLowerCase().includes(cat) || cat.includes((t.category || '').toLowerCase()));
    const ourPrice = ourTrade ? (ourTrade.listing?.aiEstimatedValue ?? ourTrade.buyPrice * 1.25) : 0;
    const ourPriceVsAvgPct = avgPrice > 0 ? Math.round(((ourPrice - avgPrice) / avgPrice) * 100) : 0;

    let yourPosition: WarData['yourPosition'] = 'neutral';
    if (ourPrice > 0) {
      if (ourPriceVsAvgPct < -10) yourPosition = 'leader';
      else if (ourPriceVsAvgPct > 10) yourPosition = 'undercut';
      else if (avgDropPct > 10) yourPosition = 'follower';
    }

    // Top competitors (cheapest sellers)
    const competitors = data.listings
      .filter(l => l.sellerName)
      .slice(0, 5)
      .map(l => ({
        name: String(l.sellerName ?? ''),
        price: l.price ?? 0,
        dropPct: drops.find(d => d.sellerName === l.sellerName) ? Math.round(((drops.find(d => d.sellerName === l.sellerName)!.previousPrice ?? 0) - (drops.find(d => d.sellerName === l.sellerName)!.price ?? 0)) / Math.max(1, drops.find(d => d.sellerName === l.sellerName)!.previousPrice ?? 1) * 100) : 0,
        trend: (drops.find(d => d.sellerName === l.sellerName) ? 'falling' : 'stable') as 'rising' | 'stable' | 'falling',
      }));

    wars.push({
      category: cat,
      activeWars: drops.length,
      avgDropPct: Math.round(avgDropPct * 10) / 10,
      totalSellers: sellersSet.size,
      yourPosition,
      yourPriceVsAvgPct: ourPriceVsAvgPct,
      competitors,
    });
  }

  // Sortiraj po aktivnosti (activeWars desc)
  wars.sort((a, b) => b.activeWars - a.activeWars);
  return wars;
}

function buildPrompt(topWars: WarData[]): string {
  const warsStr = topWars.map(w =>
    `- ${w.category} | ${w.activeWars} dropov | povp padec ${w.avgDropPct}% | ${w.totalSellers} prodajalcev | naša pozicija: ${w.yourPosition} (${w.yourPriceVsAvgPct}% vs avg) | top: ${w.competitors.slice(0, 3).map(c => `${c.name}:${c.price}€`).join(', ')}`
  ).join('\n');

  return `Si AI price war strategist za slovenske oglasne platforme.
Analiziraj aktivne price wars in predlagaj defensive/offensive strategije.

AKTIVNE PRICE WARS (${topWars.length}):
${warsStr}

Strategijski okvir:
- LEADER (najnižja cena): agresivno sledi, competitorji te sledijo navzdol
- FOLLOWER (sledi padcem): bodi pozoren, ne sledi takoj, čakaj na končno ceno
- NEUTRAL (povprečna cena): ohrani ceno, poudari value (kvaliteta, hitrost)
- UNDERCUT (višja od avg): znižaj ali dodaj value (pošiljnina, garancija)

Defensive strategije:
1. HOLD_PRICE: ohrani ceno, ojačaj value proposition (kvaliteta, hitra dostava)
2. ADD_VALUE: dodaj bonus (pošiljnina, garancija, dodaten item)
3. DIFFERENTIATE: spremeni pozicioniranje (premium, urgent, collector)
4. BUNDLE: paket z drugim itemom da skupna cena izgleda boljše
5. NICHE: ciljaj specifično publiko ki ne primerja cen (collectorji)

Offensive strategije:
1. UNDERCUT_5: znižaj za 5% pod competitorja
2. UNDERCUT_10: agresivno znižaj za 10% (samo če imaš margin)
3. PRICE_MATCH: matchaj najnižjo ceno z boljšo ponudbo (pošiljnina)
4. FLASH_SALE: 24-48h akcijska cena pod vsemi
5. LOSS_LEADER: prodaj pod ceno da privabiš kupca za druge iteme

War phases:
- ERUPTING: začetek padcev, še vedno profitabilno
- ESCALATING: padci pospešujejo, margin se tanjša
- INTENSE: močni padci, blizu break-even
- EXHAUSTING: padci se upočasnjujejo, konec blizu
- RESOLVED: vojna končana, cene stabilne

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "wars": [
    {
      "category": "<kategorija>",
      "war_phase": "<erupting|escalating|intense|exhausting|resolved>",
      "intensity_score": <number 0-100>,
      "your_strategy": "<defensive|offensive|neutral>",
      "specific_tactic": "<max 150 znakov>",
      "your_recommended_price_eur": <number>,
      "expected_competitor_response": "<max 100 znakov>",
      "profit_impact_eur": <number>,
      "time_to_resolve_days": <number>,
      "should_engage": <boolean>,
      "reasoning": "<max 120 znakov>"
    }
  ],
  "competitors": [
    { "name": "<ime>", "category": "<kategorija>", "current_price_eur": <number>, "drop_pattern": "<aggressive|moderate|slow|none>", "threat_level": "<low|medium|high|critical>", "best_response": "<max 100 znakov>" }
  ],
  "strategies": [
    { "strategy": "<hold_price|add_value|differentiate|bundle|niche|undercut_5|undercut_10|price_match|flash_sale|loss_leader>", "type": "<defensive|offensive|neutral>", "description": "<max 120 znakov>", "best_for": "<max 80 znakov>", "risk_level": "<low|medium|high>", "expected_outcome": "<max 100 znakov>" }
  ],
  "tactics": [
    { "tactic": "<max 100 znakov>", "action": "<max 200 znakov>", "expected_response_time_hours": <number>, "competitor_reaction": "<max 100 znakov>", "success_probability_pct": <number> }
  ],
  "scenarios": [
    { "scenario": "<war_won|war_lost|stalemate|war_escalates|competitor_quits>", "probability_pct": <number>, "your_profit_eur": <number>, "competitor_profit_eur": <number>, "lessons_learned": "<max 100 znakov>" }
  ],
  "summary": {
    "active_wars": <number>,
    "intense_wars": <number>,
    "wars_winning": <number>,
    "wars_losing": <number>,
    "total_profit_at_risk_eur": <number>,
    "best_strategy_overall": "<max 100 znakov>",
    "biggest_threat": "<max 100 znakov>",
    "quickest_win": "<max 100 znakov>",
    "war_strategy_score": <number 0-100>
  }
}`;
}

function transformStrategist(parsed: any, topWars: WarData[]): {
  insights: string;
  wars: any[];
  competitors: any[];
  strategies: any[];
  tactics: any[];
  scenarios: any[];
  summary: any;
} {
  const validCategories = new Set(topWars.map(w => w.category));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    wars: (parsed?.wars || [])
      .filter((w: any) => validCategories.has(String(w?.category ?? '')))
      .slice(0, 8)
      .map((w: any) => {
        return {
          category: String(w?.category ?? '').slice(0, 50),
          warPhase: ['erupting', 'escalating', 'intense', 'exhausting', 'resolved'].includes(String(w?.war_phase)) ? String(w.war_phase) : 'erupting',
          intensityScore: Math.max(0, Math.min(100, Number(w?.intensity_score ?? 50))),
          yourStrategy: ['defensive', 'offensive', 'neutral'].includes(String(w?.your_strategy)) ? String(w.your_strategy) : 'neutral',
          specificTactic: String(w?.specific_tactic ?? '').slice(0, 300),
          yourRecommendedPriceEur: Math.max(0, Math.round(Number(w?.your_recommended_price_eur ?? 0))),
          expectedCompetitorResponse: String(w?.expected_competitor_response ?? '').slice(0, 200),
          profitImpactEur: Math.round(Number(w?.profit_impact_eur ?? 0)),
          timeToResolveDays: Math.max(0, Number(w?.time_to_resolve_days ?? 14)),
          shouldEngage: Boolean(w?.should_engage ?? false),
          reasoning: String(w?.reasoning ?? '').slice(0, 250),
        };
      }),
    competitors: (parsed?.competitors || []).slice(0, 10).map((c: any) => ({
      name: String(c?.name ?? '').slice(0, 100),
      category: String(c?.category ?? '').slice(0, 50),
      currentPriceEur: Math.max(0, Math.round(Number(c?.current_price_eur ?? 0))),
      dropPattern: ['aggressive', 'moderate', 'slow', 'none'].includes(String(c?.drop_pattern)) ? String(c.drop_pattern) : 'none',
      threatLevel: ['low', 'medium', 'high', 'critical'].includes(String(c?.threat_level)) ? String(c.threat_level) : 'medium',
      bestResponse: String(c?.best_response ?? '').slice(0, 200),
    })),
    strategies: (parsed?.strategies || []).slice(0, 10).map((s: any) => ({
      strategy: ['hold_price', 'add_value', 'differentiate', 'bundle', 'niche', 'undercut_5', 'undercut_10', 'price_match', 'flash_sale', 'loss_leader'].includes(String(s?.strategy)) ? String(s.strategy) : 'hold_price',
      type: ['defensive', 'offensive', 'neutral'].includes(String(s?.type)) ? String(s.type) : 'neutral',
      description: String(s?.description ?? '').slice(0, 250),
      bestFor: String(s?.best_for ?? '').slice(0, 150),
      riskLevel: ['low', 'medium', 'high'].includes(String(s?.risk_level)) ? String(s.risk_level) : 'medium',
      expectedOutcome: String(s?.expected_outcome ?? '').slice(0, 200),
    })),
    tactics: (parsed?.tactics || []).slice(0, 8).map((t: any) => ({
      tactic: String(t?.tactic ?? '').slice(0, 200),
      action: String(t?.action ?? '').slice(0, 400),
      expectedResponseTimeHours: Math.max(0, Number(t?.expected_response_time_hours ?? 24)),
      competitorReaction: String(t?.competitor_reaction ?? '').slice(0, 200),
      successProbabilityPct: Math.max(0, Math.min(100, Number(t?.success_probability_pct ?? 50))),
    })),
    scenarios: (parsed?.scenarios || []).slice(0, 5).map((sc: any) => ({
      scenario: ['war_won', 'war_lost', 'stalemate', 'war_escalates', 'competitor_quits'].includes(String(sc?.scenario)) ? String(sc.scenario) : 'stalemate',
      probabilityPct: Math.max(0, Math.min(100, Number(sc?.probability_pct ?? 30))),
      yourProfitEur: Math.round(Number(sc?.your_profit_eur ?? 0)),
      competitorProfitEur: Math.round(Number(sc?.competitor_profit_eur ?? 0)),
      lessonsLearned: String(sc?.lessons_learned ?? '').slice(0, 200),
    })),
    summary: {
      activeWars: Math.max(0, Number(parsed?.summary?.active_wars ?? topWars.length)),
      intenseWars: Math.max(0, Number(parsed?.summary?.intense_wars ?? 0)),
      warsWinning: Math.max(0, Number(parsed?.summary?.wars_winning ?? 0)),
      warsLosing: Math.max(0, Number(parsed?.summary?.wars_losing ?? 0)),
      totalProfitAtRiskEur: Math.round(Number(parsed?.summary?.total_profit_at_risk_eur ?? 0)),
      bestStrategyOverall: String(parsed?.summary?.best_strategy_overall ?? '').slice(0, 200),
      biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 200),
      quickestWin: String(parsed?.summary?.quickest_win ?? '').slice(0, 200),
      warStrategyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.war_strategy_score ?? 50))),
    },
  };
}
