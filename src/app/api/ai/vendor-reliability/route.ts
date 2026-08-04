// v6.25: AI Vendor Reliability Scorer — oceni zanesljivost prodajalcev
// POST /api/ai/vendor-reliability
// Body: {}
// Returns: { ok, vendors: [{ name, reliabilityScore, metrics, riskFactors, recommendation }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    // 1. Pridobi sold trades z buyLocation (prodajalci od katerih smo kupovali)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true,
        sellFees: true, buyLocation: true, buyDate: true, sellDate: true },
      take: 300,
    });

    // 2. Pridobi held trades z buyLocation
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { title: true, category: true, buyPrice: true, buyLocation: true, buyDate: true },
    });

    // 3. Pridobi listinge z sellerName za dodatne podatke
    const listingsWithSellers = await db.listing.findMany({
      where: { sellerName: { not: null }, isHidden: false },
      select: { sellerName: true, sellerListingCount: true, price: true,
        aiVerdict: true, dealScore: true, firstSeenAt: true,
        monitor: { select: { source: true } } },
      take: 500,
    });

    if (soldTrades.length === 0 && listingsWithSellers.length === 0) {
      return NextResponse.json({ ok: true, vendors: [], message: 'Ni podatkov o prodajalcih.' });
    }

    // 4. Agregacija po buyLocation (vendor)
    const byVendor: Record<string, {
      purchases: any[]; count: number; totalSpent: number; totalRevenue: number;
      totalProfit: number; avgRoi: number; avgDaysToSell: number; successCount: number;
      categories: Set<string>; lastPurchase: Date; firstPurchase: Date;
    }> = {};

    for (const t of soldTrades) {
      const vendor = t.buyLocation || 'neznan';
      if (!byVendor[vendor]) {
        byVendor[vendor] = { purchases: [], count: 0, totalSpent: 0, totalRevenue: 0,
          totalProfit: 0, avgRoi: 0, avgDaysToSell: 0, successCount: 0,
          categories: new Set(), lastPurchase: new Date(0), firstPurchase: new Date(8e15) };
      }
      const v = byVendor[vendor];
      v.purchases.push(t);
      v.count++;
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      v.totalSpent += cost;
      v.totalRevenue += revenue;
      v.totalProfit += revenue - cost;
      v.avgRoi += cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
      if (revenue > cost) v.successCount++;
      v.categories.add(t.category || 'drugo');
      if (t.buyDate > v.lastPurchase) v.lastPurchase = t.buyDate;
      if (t.buyDate < v.firstPurchase) v.firstPurchase = t.buyDate;
      if (t.sellDate && t.buyDate) {
        v.avgDaysToSell += Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      }
    }

    for (const vendor of Object.keys(byVendor)) {
      const v = byVendor[vendor];
      v.avgRoi = v.count > 0 ? Math.round(v.avgRoi / v.count) : 0;
      v.avgDaysToSell = v.count > 0 ? Math.round(v.avgDaysToSell / v.count) : 0;
    }

    // 5. Agregacija listingov po sellerName
    const bySeller: Record<string, { listingCount: number; avgDealScore: number; opportunityCount: number; sources: Set<string> }> = {};
    for (const l of listingsWithSellers) {
      const seller = l.sellerName || 'neznan';
      if (!bySeller[seller]) bySeller[seller] = { listingCount: 0, avgDealScore: 0, opportunityCount: 0, sources: new Set() };
      bySeller[seller].listingCount++;
      bySeller[seller].avgDealScore += l.dealScore ?? 0;
      if (l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70) bySeller[seller].opportunityCount++;
      if (l.monitor?.source) bySeller[seller].sources.add(l.monitor.source);
    }
    for (const seller of Object.keys(bySeller)) {
      bySeller[seller].avgDealScore = bySeller[seller].listingCount > 0
        ? Math.round(bySeller[seller].avgDealScore / bySeller[seller].listingCount) : 0;
    }

    // 6. AI analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const vendorsStr = Object.entries(byVendor)
      .sort(([, a], [, b]) => b.totalProfit - a.totalProfit)
      .slice(0, 20)
      .map(([name, v]) => `- ${name}: ${v.count} nakupov, ${v.totalSpent}€ porabljenih, ${v.totalProfit}€ dobička, ${v.avgRoi}% ROI, ${v.avgDaysToSell}d prodaja, ${v.successCount}/${v.count} uspešnih, kategorije: ${Array.from(v.categories).join('/')}`)
      .join('\n');

    const prompt = `Si ekspert za vendor management in ocenjevanje zanesljivosti dobaviteljev.
Oceni zanesljivost vsakega prodajalca (vendor) na podlagi zgodovine nakupov in prodaj.

PRODAJALCI Z ZGODOVINO:
${vendorsStr || '- Ni podatkov'}

Pravila za ocenjevanje:
1. reliabilityScore (0-100): višje = bolj zanesljiv
2. Upoštevaj: ROI, success rate, število nakupov, diverzifikacija kategorij, čas sodelovanja
3. Identificiraj risk factors: visoka volatility, nizek success rate, nova sodelovanja
4. Priporoči: continue_buying (zanesljiv), cautious (mešano), reduce (tvegano), avoid (nevarno)
5. Za nove prodajalce (1 nakup) daj nižjo oceno (manj podatkov)

Vendor tierji:
- "tier_1_platinum": reliabilityScore > 80, ROI > 30%, success rate > 80%
- "tier_2_gold": reliabilityScore > 60, ROI > 15%, success rate > 60%
- "tier_3_silver": reliabilityScore > 40, ROI > 0%, success rate > 40%
- "tier_4_bronze": reliabilityScore > 20 (tvegano)
- "tier_5_avoid": reliabilityScore < 20 (nevarno)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o prodajalcih, max 250 znakov>",
  "vendors": [
    {
      "name": "<ime prodajalca>",
      "reliability_score": <number 0-100>,
      "tier": "<tier_1_platinum|tier_2_gold|tier_3_silver|tier_4_bronze|tier_5_avoid>",
      "metrics": {
        "total_purchases": <number>,
        "total_spent_eur": <number>,
        "total_profit_eur": <number>,
        "avg_roi_pct": <number>,
        "success_rate_pct": <number>,
        "avg_days_to_sell": <number>,
        "categories_count": <number>,
        "days_active": <number>
      },
      "strengths": ["<prednost, max 80 znakov>", "..."],
      "risk_factors": ["<tveganje, max 80 znakov>", "..."],
      "recommendation": "<continue_buying|cautious|reduce|avoid>",
      "best_categories": ["<kategorija z najboljšim ROI>", "..."],
      "reasoning": "<max 150 znakov>"
    }
  ],
  "summary": {
    "total_vendors": <number>,
    "tier_1_count": <number>,
    "tier_2_count": <number>,
    "tier_5_count": <number>,
    "avg_reliability_score": <number>,
    "best_vendor": "<ime>",
    "worst_vendor": "<ime>",
    "total_spent_all_vendors_eur": <number>,
    "total_profit_all_vendors_eur": <number>
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const vendorMap = new Map(Object.entries(byVendor));

    const vendors = (parsed?.vendors || [])
      .filter((v: any) => vendorMap.has(String(v?.name ?? '')))
      .map((v: any) => {
        const name = String(v.name);
        const orig = vendorMap.get(name)!;
        return {
          name,
          reliabilityScore: Math.max(0, Math.min(100, Number(v?.reliability_score ?? 50))),
          tier: ['tier_1_platinum', 'tier_2_gold', 'tier_3_silver', 'tier_4_bronze', 'tier_5_avoid'].includes(String(v?.tier))
            ? String(v.tier) : 'tier_3_silver',
          metrics: {
            totalPurchases: orig.count,
            totalSpentEur: Math.round(orig.totalSpent),
            totalProfitEur: Math.round(orig.totalProfit),
            avgRoiPct: orig.avgRoi,
            successRatePct: orig.count > 0 ? Math.round((orig.successCount / orig.count) * 100) : 0,
            avgDaysToSell: orig.avgDaysToSell,
            categoriesCount: orig.categories.size,
            daysActive: Math.round((orig.lastPurchase.getTime() - orig.firstPurchase.getTime()) / (24 * 60 * 60 * 1000)),
          },
          strengths: (v?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
          riskFactors: (v?.risk_factors || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
          recommendation: ['continue_buying', 'cautious', 'reduce', 'avoid'].includes(String(v?.recommendation))
            ? String(v.recommendation) : 'cautious',
          bestCategories: (v?.best_categories || []).slice(0, 3).map((c: any) => String(c).slice(0, 50)),
          reasoning: String(v?.reasoning ?? '').slice(0, 250),
        };
      })
      .sort((a, b) => b.reliabilityScore - a.reliabilityScore);

    const summary = {
      totalVendors: vendors.length,
      tier1Count: vendors.filter(v => v.tier === 'tier_1_platinum').length,
      tier2Count: vendors.filter(v => v.tier === 'tier_2_gold').length,
      tier5Count: vendors.filter(v => v.tier === 'tier_5_avoid').length,
      avgReliabilityScore: vendors.length > 0 ? Math.round(vendors.reduce((s, v) => s + v.reliabilityScore, 0) / vendors.length) : 0,
      bestVendor: vendors[0]?.name ?? '',
      worstVendor: vendors[vendors.length - 1]?.name ?? '',
      totalSpentAllVendorsEur: Math.round(Object.values(byVendor).reduce((s, v) => s + v.totalSpent, 0)),
      totalProfitAllVendorsEur: Math.round(Object.values(byVendor).reduce((s, v) => s + v.totalProfit, 0)),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      vendors,
      summary,
    });
  } catch (e: any) {
    logger.error("/api/ai/vendor-reliability", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
