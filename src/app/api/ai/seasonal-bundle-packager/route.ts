// v6.49: AI Seasonal Bundle Packager — ustvarja season-aware bundle pakete iz inventarja
// POST /api/ai/seasonal-bundle-packager
// Body: { season?: 'spring'|'summer'|'autumn'|'winter'|'christmas'|'easter'|'back_to_school'|'black_friday' }
// Returns: { ok, packager: { season, bundles, targeting, pricing, timeline, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface SeasonInfo {
  key: string;
  name: string;
  months: number[];
  description: string;
  buyerPersonas: string[];
  hotCategories: string[];
  coldCategories: string[];
  premiumMultiplier: number;
}

const SEASONS: Record<string, SeasonInfo> = {
  spring: {
    key: 'spring', name: 'Pomlad', months: [3, 4, 5],
    description: 'Spomladanska sezona — obnova, cleaning, outdoor aktivnosti',
    buyerPersonas: ['family_cleaning', 'gardener', 'cyclist', 'student_exam'],
    hotCategories: ['kolesa', 'vrtna_oprema', 'cleaning', 'telefoni', 'pohištvo'],
    coldCategories: ['smuči', 'grelec', 'zimska_obutev'],
    premiumMultiplier: 1.0,
  },
  summer: {
    key: 'summer', name: 'Poletje', months: [6, 7, 8],
    description: 'Poletna sezona — dopust, outdoor, festivali',
    buyerPersonas: ['tourist', 'festival_goer', 'beach_lover', 'parent_summer'],
    hotCategories: ['kolesa', 'kemping', 'klima', 'telefoni', 'foto', 'outdoor'],
    coldCategories: ['smuči', 'grelec', 'zimska_obutev'],
    premiumMultiplier: 1.1,
  },
  autumn: {
    key: 'autumn', name: 'Jesen', months: [9, 10, 11],
    description: 'Jesenska sezona — back-to-school, priprava na zimo',
    buyerPersonas: ['student', 'parent_school', 'home_preparer', 'driver_winter_prep'],
    hotCategories: ['računalniki', 'telefoni', 'avto_gume', 'kolesa', 'pohištvo'],
    coldCategories: ['klima', 'kemping'],
    premiumMultiplier: 1.05,
  },
  winter: {
    key: 'winter', name: 'Zima', months: [12, 1, 2],
    description: 'Zimska sezona — mraz, šport, počitnice',
    buyerPersonas: ['skier', 'family_warmth', 'driver_winter', 'home_body'],
    hotCategories: ['smuči', 'grelec', 'zimska_obutev', 'klima', 'avto_gume', 'telefoni'],
    coldCategories: ['kolesa', 'kemping', 'klima_hlad'],
    premiumMultiplier: 1.15,
  },
  christmas: {
    key: 'christmas', name: 'Božič', months: [12],
    description: 'Božična sezona — darila, electronics, lux',
    buyerPersonas: ['gift_giver', 'parent_christmas', 'last_minute_shopper', 'luxury_buyer'],
    hotCategories: ['telefoni', 'elektronika', 'igrače', 'lux', 'darila'],
    coldCategories: ['smuči', 'kemping'],
    premiumMultiplier: 1.3,
  },
  easter: {
    key: 'easter', name: 'Velika noč', months: [3, 4],
    description: 'Velikonočna sezona — obnova, spomladanska darila',
    buyerPersonas: ['family_easter', 'gift_giver', 'spring_renewal'],
    hotCategories: ['pohištvo', 'telefoni', 'čokolada', 'darila'],
    coldCategories: [],
    premiumMultiplier: 1.1,
  },
  back_to_school: {
    key: 'back_to_school', name: 'Začetek šole', months: [8, 9],
    description: 'Šolska sezona — laptops, telefoni, šolska oprema',
    buyerPersonas: ['student', 'parent_school', 'student_university'],
    hotCategories: ['računalniki', 'telefoni', 'tableti', 'šolska_oprema', 'kolesa'],
    coldCategories: [],
    premiumMultiplier: 1.1,
  },
  black_friday: {
    key: 'black_friday', name: 'Black Friday', months: [11],
    description: 'Black Friday — popusti, electronics, promocije',
    buyerPersonas: ['deal_hunter', 'tech_buyer', 'early_christmas_shopper'],
    hotCategories: ['telefoni', 'elektronika', 'računalniki', 'gaming', 'hišni_aparati'],
    coldCategories: [],
    premiumMultiplier: 0.95, // nižja marža, večji volumen
  },
};

function getCurrentSeason(): SeasonInfo {
  const month = new Date().getMonth() + 1; // 1-12
  for (const season of Object.values(SEASONS)) {
    if (season.months.includes(month)) {
      // Vrni specific season (christmas > winter, easter > spring, back_to_school > autumn)
      if (season.key === 'christmas') return SEASONS.christmas;
      if (season.key === 'easter') return SEASONS.easter;
      if (season.key === 'back_to_school') return SEASONS.back_to_school;
      if (season.key === 'black_friday') return SEASONS.black_friday;
      return season;
    }
  }
  return SEASONS.winter;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedSeason = body?.season && SEASONS[body.season] ? body.season : getCurrentSeason().key;
    const season = SEASONS[requestedSeason];

    // 1. Pridobi held trade-e
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: { aiEstimatedValue: true, dealScore: true, imageUrl: true, location: true, description: true },
        },
      },
      take: 40,
    });

    if (heldTrades.length < 2) {
      return NextResponse.json({ ok: true, packager: null, message: 'Potrebnih vsaj 2 held trade za bundle pakiranje.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // 2. Kategorizacija held tradeov glede na sezonsko ujemanje
    const items = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));

      const isHot = season.hotCategories.some(hc => cat.includes(hc) || hc.includes(cat));
      const isCold = season.coldCategories.some(cc => cat.includes(cc) || cc.includes(cat));
      const seasonalFit = isHot ? 'hot' : isCold ? 'cold' : 'neutral';
      const seasonalPriceMultiplier = isHot ? season.premiumMultiplier : isCold ? 0.85 : 1.0;
      const seasonalPriceEur = Math.round(estValue * seasonalPriceMultiplier);

      return {
        id: t.id, title: t.title, category: cat, cost, estValue, seasonalPriceEur,
        daysHeld, seasonalFit, dealScore: t.listing?.dealScore ?? 50,
        description: (t.listing?.description || '').slice(0, 200),
      };
    });

    const itemsStr = items.map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.seasonalPriceEur}€ | ${i.seasonalFit} za ${season.key} | ${i.daysHeld}d`
    ).join('\n');

    const prompt = `Si AI seasonal bundle packager za slovenske oglasne platforme.
Ustvari season-aware bundle pakete iz inventarja, ki maksimirajo profit in konverzijo.

SEZONA: ${season.name} (${season.key})
Opis: ${season.description}
Buyer personae: ${season.buyerPersonas.join(', ')}
Vroče kategorije: ${season.hotCategories.join(', ')}
Hladne kategorije: ${season.coldCategories.join(', ')}
Premium multiplier: ${season.premiumMultiplier}x

INVENTAR (${items.length}):
${itemsStr}

Bundle strategije glede na sezono:
1. CHRISTMAS_GIFT_PACK: 2-3 darila skupaj (parent + child, couple gift set)
2. SUMMER_OUTING_KIT: kolo + kemping + foto oprema za dopust
3. BACK_TO_SCHOOL_BUNDLE: laptop + telefon + šolska oprema
4. WINTER_WARMTH_PACK: grelec + klima + zimska obutev
5. SPRING_CLEANING_KIT: čistila + pohištvo + outdoor
6. STUDENT_PACK: laptop + telefon + kolo (za fakulteto)
7. FAMILY_PACK: 2-3 itemi za celo družino
8. HOBBY_STARTER: začetni set za novo aktivnost (kolo + oprema, foto + stativ)

Bundle pricing:
- VOLUME_DISCOUNT: 5-15% popust za paket
- SEASONAL_PREMIUM: +10-30% nad posamezne (božič, black friday)
- PSYCHOLOGICAL: 199€, 299€, 499€ pragovi
- ANCHOR: en drag item + 2 cenejši kot "bonus"
- LOSS_LEADER: en item blizu nabavne, drugi z visoko maržo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "season": {
    "current_season": "${season.key}",
    "days_remaining": <number>,
    "peak_buying_window": "<max 100 znakov>",
    "best_listing_date": "<YYYY-MM-DD>",
    "urgency_level": "<low|medium|high|critical>"
  },
  "bundles": [
    {
      "bundle_name": "<max 60 znakov>",
      "bundle_type": "<christmas_gift_pack|summer_outing_kit|back_to_school_bundle|winter_warmth_pack|spring_cleaning_kit|student_pack|family_pack|hobby_starter>",
      "item_ids": ["<trade_id>"],
      "target_persona": "<max 80 znakov>",
      "individual_total_eur": <number>,
      "bundle_price_eur": <number>,
      "discount_pct": <number>,
      "seasonal_premium_pct": <number>,
      "profit_eur": <number>,
      "margin_pct": <number>,
      "selling_point": "<max 150 znakov>",
      "best_platform": "<bolha|facebook|vinted|ebay>",
      "expected_sell_days": <number>,
      "expected_buyer_count": <number>
    }
  ],
  "targeting": [
    { "persona": "<max 80 znakov>", "demographics": "<max 100 znakov>", "preferred_channel": "<email|sms|social|in_person>", "best_time_to_contact": "<max 80 znakov>", "expected_conversion_pct": <number> }
  ],
  "pricing": [
    { "strategy": "<volume_discount|seasonal_premium|psychological|anchor|loss_leader>", "description": "<max 120 znakov>", "best_for_bundle_type": "<max 80 znakov>", "expected_revenue_increase_pct": <number> }
  ],
  "timeline": [
    { "phase": "<prep|launch|peak|clearance>", "date_range": "<max 80 znakov>", "actions": ["<max 80 znakov>"], "expected_revenue_eur": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_impact_eur": <number>, "items_affected": <number> }
  ],
  "summary": {
    "total_bundles_created": <number>,
    "total_bundle_revenue_eur": <number>,
    "total_bundle_profit_eur": <number>,
    "avg_bundle_margin_pct": <number>,
    "items_used": <number>,
    "items_remaining": <number>,
    "best_bundle": "<max 80 znakov>",
    "seasonal_efficiency_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>",
    "time_sensitive_action": "<max 100 znakov>"
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    // Izračun dni do konca sezone
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const seasonMonths = season.months;
    const lastSeasonMonth = Math.max(...seasonMonths);
    let daysRemaining: number;
    if (seasonMonths.includes(currentMonth)) {
      // Trenutno v sezoni
      const nextMonth = currentMonth + 1;
      const endOfSeason = new Date(now.getFullYear(), lastSeasonMonth, 0); // zadnji dan sezone
      daysRemaining = Math.max(0, Math.round((endOfSeason.getTime() - now.getTime()) / (24*60*60*1000)));
    } else {
      // Ni v sezoni, izračun do naslednje sezone
      const nextSeasonMonth = seasonMonths.find(m => m > currentMonth) ?? seasonMonths[0];
      const targetYear = nextSeasonMonth > currentMonth ? now.getFullYear() : now.getFullYear() + 1;
      const seasonStart = new Date(targetYear, nextSeasonMonth - 1, 1);
      daysRemaining = Math.max(0, Math.round((seasonStart.getTime() - now.getTime()) / (24*60*60*1000)));
    }

    const packager = {
      season: {
        key: season.key,
        name: season.name,
        description: season.description,
        buyerPersonas: season.buyerPersonas,
        hotCategories: season.hotCategories,
        coldCategories: season.coldCategories,
        premiumMultiplier: season.premiumMultiplier,
        daysRemaining,
        peakBuyingWindow: String(parsed?.season?.peak_buying_window ?? '').slice(0, 200),
        bestListingDate: String(parsed?.season?.best_listing_date ?? '').slice(0, 20),
        urgencyLevel: ['low', 'medium', 'high', 'critical'].includes(String(parsed?.season?.urgency_level)) ? String(parsed.season.urgency_level) : 'medium',
      },
      insights: String(parsed?.insights ?? '').slice(0, 500),
      bundles: (parsed?.bundles || [])
        .filter((b: any) => (b?.item_ids || []).some((id: any) => validIds.has(String(id))))
        .slice(0, 12)
        .map((b: any) => ({
          bundleName: String(b?.bundle_name ?? '').slice(0, 100),
          bundleType: ['christmas_gift_pack', 'summer_outing_kit', 'back_to_school_bundle', 'winter_warmth_pack', 'spring_cleaning_kit', 'student_pack', 'family_pack', 'hobby_starter'].includes(String(b?.bundle_type)) ? String(b.bundle_type) : 'family_pack',
          itemIds: (b?.item_ids || []).filter((id: any) => validIds.has(String(id))).slice(0, 6).map((id: any) => String(id).slice(0, 50)),
          targetPersona: String(b?.target_persona ?? '').slice(0, 150),
          individualTotalEur: Math.max(0, Math.round(Number(b?.individual_total_eur ?? 0))),
          bundlePriceEur: Math.max(0, Math.round(Number(b?.bundle_price_eur ?? 0))),
          discountPct: Math.round(Number(b?.discount_pct ?? 0)),
          seasonalPremiumPct: Math.round(Number(b?.seasonal_premium_pct ?? 0)),
          profitEur: Math.round(Number(b?.profit_eur ?? 0)),
          marginPct: Math.round(Number(b?.margin_pct ?? 0)),
          sellingPoint: String(b?.selling_point ?? '').slice(0, 300),
          bestPlatform: ['bolha', 'facebook', 'vinted', 'ebay'].includes(String(b?.best_platform)) ? String(b.best_platform) : 'bolha',
          expectedSellDays: Math.max(1, Number(b?.expected_sell_days ?? 7)),
          expectedBuyerCount: Math.max(0, Number(b?.expected_buyer_count ?? 0)),
        })),
      targeting: (parsed?.targeting || []).slice(0, 6).map((t: any) => ({
        persona: String(t?.persona ?? '').slice(0, 150),
        demographics: String(t?.demographics ?? '').slice(0, 200),
        preferredChannel: ['email', 'sms', 'social', 'in_person'].includes(String(t?.preferred_channel)) ? String(t.preferred_channel) : 'email',
        bestTimeToContact: String(t?.best_time_to_contact ?? '').slice(0, 150),
        expectedConversionPct: Math.max(0, Math.min(100, Number(t?.expected_conversion_pct ?? 30))),
      })),
      pricing: (parsed?.pricing || []).slice(0, 5).map((p: any) => ({
        strategy: ['volume_discount', 'seasonal_premium', 'psychological', 'anchor', 'loss_leader'].includes(String(p?.strategy)) ? String(p.strategy) : 'volume_discount',
        description: String(p?.description ?? '').slice(0, 250),
        bestForBundleType: String(p?.best_for_bundle_type ?? '').slice(0, 150),
        expectedRevenueIncreasePct: Math.round(Number(p?.expected_revenue_increase_pct ?? 0)),
      })),
      timeline: (parsed?.timeline || []).slice(0, 4).map((tl: any) => ({
        phase: ['prep', 'launch', 'peak', 'clearance'].includes(String(tl?.phase)) ? String(tl.phase) : 'prep',
        dateRange: String(tl?.date_range ?? '').slice(0, 150),
        actions: (tl?.actions || []).slice(0, 5).map((a: any) => String(a).slice(0, 150)),
        expectedRevenueEur: Math.round(Number(tl?.expected_revenue_eur ?? 0)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
      })),
      summary: {
        totalBundlesCreated: Math.max(0, Number(parsed?.summary?.total_bundles_created ?? 0)),
        totalBundleRevenueEur: Math.round(Number(parsed?.summary?.total_bundle_revenue_eur ?? 0)),
        totalBundleProfitEur: Math.round(Number(parsed?.summary?.total_bundle_profit_eur ?? 0)),
        avgBundleMarginPct: Math.round(Number(parsed?.summary?.avg_bundle_margin_pct ?? 0)),
        itemsUsed: Math.max(0, Number(parsed?.summary?.items_used ?? 0)),
        itemsRemaining: Math.max(0, Number(parsed?.summary?.items_remaining ?? items.length)),
        bestBundle: String(parsed?.summary?.best_bundle ?? '').slice(0, 150),
        seasonalEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.seasonal_efficiency_score ?? 50))),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        timeSensitiveAction: String(parsed?.summary?.time_sensitive_action ?? '').slice(0, 200),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, packager });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
