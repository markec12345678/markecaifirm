// v6.45: AI Customer Segmentation Engine — RFM analiza (Recency, Frequency, Monetary) z 5 segmenti
// POST /api/ai/customer-segmentation
// Body: { minPurchases?: number }
// Returns: { ok, segmentation: { segments, customers, insights, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// 5 segmentov glede na RFM
const SEGMENT_RULES = {
  champions:   { minR: 7, minF: 3, minM: 500, description: 'Najboljši kupci — nedavni, pogosti, visoka vrednost' },
  loyal:       { minR: 7, minF: 2, minM: 200, description: 'Zvesti kupci — redni povratniki' },
  potential:   { minR: 7, minF: 1, minM: 100, description: 'Potential — novi kupci z možnostjo rasti' },
  at_risk:     { minR: 7, minF: 2, minM: 200, description: 'V nevarnosti — nekdaj aktivni, sedaj nedejavni > 90 dni' },
  lost:        { minR: 7, minF: 1, minM: 50,  description: 'Izgubljeni — nobenega nakupa > 180 dni' },
} as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const minPurchases = Math.max(1, Number(body?.minPurchases ?? 1));

    // 1. Pridobi vse sold trade-e z sellLocation (kupec)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true,
        sellDate: true, buyDate: true,
        sellLocation: true,
      },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length < minPurchases) {
      return NextResponse.json({
        ok: true,
        segmentation: null,
        message: `Potrebnih vsaj ${minPurchases} prodaj z sellLocation za RFM analizo.`,
      });
    }

    // 2. Agregacija po sellLocation (= kupec za naš biznis)
    const customerMap = new Map<string, {
      name: string;
      purchases: number;
      totalSpent: number;
      avgOrderValue: number;
      firstPurchase: Date;
      lastPurchase: Date;
      categories: Set<string>;
      items: string[];
    }>();

    for (const t of soldTrades) {
      const name = (t.sellLocation || 'Neznan kupec').trim();
      if (!name || name.length < 2) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);

      if (!t.sellDate) continue;
      const sellDate = t.sellDate;
      if (!customerMap.has(name)) {
        customerMap.set(name, {
          name,
          purchases: 0,
          totalSpent: 0,
          avgOrderValue: 0,
          firstPurchase: sellDate,
          lastPurchase: sellDate,
          categories: new Set<string>(),
          items: [],
        });
      }
      const c = customerMap.get(name)!;
      c.purchases += 1;
      c.totalSpent += revenue;
      if (sellDate < c.firstPurchase) c.firstPurchase = sellDate;
      if (sellDate > c.lastPurchase) c.lastPurchase = sellDate;
      if (t.category) c.categories.add(t.category);
      c.items.push(t.title);
    }

    const customers = Array.from(customerMap.values())
      .filter(c => c.purchases >= minPurchases)
      .map(c => {
        c.avgOrderValue = Math.round(c.totalSpent / c.purchases);
        return c;
      });

    if (customers.length === 0) {
      return NextResponse.json({
        ok: true,
        segmentation: null,
        message: 'Ni dovolj kupcev z najmanj ' + minPurchases + ' nakupi.',
      });
    }

    // 3. RFM scoring (1-10 vsaka dimenzija)
    const now = Date.now();
    const allTotalSpent = customers.map(c => c.totalSpent);
    const allPurchases = customers.map(c => c.purchases);
    const allRecencyDays = customers.map(c => Math.round((now - c.lastPurchase.getTime()) / (24*60*60*1000)));
    const maxSpent = Math.max(...allTotalSpent, 1);
    const maxPurch = Math.max(...allPurchases, 1);
    const minRecency = Math.min(...allRecencyDays);
    const maxRecency = Math.max(...allRecencyDays, 1);

    const rfmCustomers = customers.map(c => {
      const recencyDays = Math.round((now - c.lastPurchase.getTime()) / (24*60*60*1000));
      const rScore = Math.max(1, Math.min(10, Math.round(10 - ((recencyDays - minRecency) / Math.max(1, maxRecency - minRecency)) * 9)));
      const fScore = Math.max(1, Math.min(10, Math.round((c.purchases / maxPurch) * 10)));
      const mScore = Math.max(1, Math.min(10, Math.round((c.totalSpent / maxSpent) * 10)));

      // Določi segment glede na RFM
      let segment = 'lost';
      if (recencyDays <= 30 && c.purchases >= 3 && c.totalSpent >= 500) segment = 'champions';
      else if (recencyDays <= 60 && c.purchases >= 2 && c.totalSpent >= 200) segment = 'loyal';
      else if (recencyDays <= 30 && c.purchases === 1) segment = 'potential';
      else if (recencyDays > 90 && c.purchases >= 2 && c.totalSpent >= 200) segment = 'at_risk';
      else if (recencyDays > 180) segment = 'lost';
      else segment = 'potential';

      return {
        name: c.name,
        purchases: c.purchases,
        totalSpent: Math.round(c.totalSpent),
        avgOrderValue: c.avgOrderValue,
        recencyDays,
        firstPurchase: c.firstPurchase.toISOString().slice(0, 10),
        lastPurchase: c.lastPurchase.toISOString().slice(0, 10),
        categories: Array.from(c.categories).slice(0, 5),
        topItems: c.items.slice(0, 3),
        rfm: { r: rScore, f: fScore, m: mScore },
        rfmScore: Math.round((rScore + fScore + mScore) / 3 * 10), // 0-100
        segment,
      };
    });

    // 4. Segmenti agregacija
    const segmentAgg = (Object.keys(SEGMENT_RULES) as Array<keyof typeof SEGMENT_RULES>).map(segKey => {
      const segCustomers = rfmCustomers.filter(c => c.segment === segKey);
      const totalSpent = segCustomers.reduce((s, c) => s + c.totalSpent, 0);
      const totalPurchases = segCustomers.reduce((s, c) => s + c.purchases, 0);
      const avgRfmScore = segCustomers.length > 0
        ? Math.round(segCustomers.reduce((s, c) => s + c.rfmScore, 0) / segCustomers.length)
        : 0;
      return {
        segment: segKey,
        description: SEGMENT_RULES[segKey].description,
        customerCount: segCustomers.length,
        totalSpentEur: totalSpent,
        totalPurchases,
        avgRfmScore,
        revenueSharePct: rfmCustomers.length > 0
          ? Math.round((segCustomers.length / rfmCustomers.length) * 100)
          : 0,
      };
    });

    // 5. AI za strategije in priporočila
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const totalRevenue = rfmCustomers.reduce((s, c) => s + c.totalSpent, 0);

    const customersStr = rfmCustomers.slice(0, 25).map(c =>
      `- ${c.name} | ${c.segment} | ${c.purchases}x nakup | ${c.totalSpent}€ | ${c.recencyDays}d nazadnje | RFM ${c.rfm.r}/${c.rfm.f}/${c.rfm.m} (${c.rfmScore}/100) | kategorije: ${c.categories.join(', ')}`
    ).join('\n');

    const prompt = `Si AI customer segmentation engine z RFM (Recency/Frequency/Monetary) analizo.
Analiziraj kupce in predlagaj strategijo za vsak segment.

KUPCI (${rfmCustomers.length}, skupni prihodek ${Math.round(totalRevenue)}€):
${customersStr}

5 segmentov:
1. CHAMPIONS: nedavni + pogosti + visoka vrednost → nagradi, ohrani, up-sell
2. LOYAL: zvesti, redni povratniki → loyalty program, ekskluzivne ponudbe
3. POTENTIAL: novi kupci z možnostjo rasti → onboarding, cross-sell
4. AT_RISK: nekdaj aktivni, sedaj nedejavni > 90 dni → win-back kampanja
5. LOST: nobenega nakupa > 180 dni → reactivation ali opusti

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "segments": [
    { "segment": "<champions|loyal|potential|at_risk|lost>", "strategy": "<max 100 znakov>", "tactic": "<max 150 znakov>", "expected_revenue_uplift_eur": <number>, "retention_probability_pct": <number>, "priority_action": "<max 100 znakov>" }
  ],
  "customers": [
    { "name": "<ime>", "segment": "<segment>", "next_best_action": "<max 120 znakov>", "expected_value_eur": <number>, "churn_risk_pct": <number 0-100>, "recommended_channel": "<email|sms|call|in_person|none>" }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "target_segment": "<segment|all>", "expected_impact_eur": <number>, "implementation_cost_eur": <number>, "roi_score": <number 0-100> }
  ],
  "summary": {
    "total_customers": <number>,
    "total_revenue_eur": <number>,
    "avg_customer_value_eur": <number>,
    "champions_count": <number>,
    "at_risk_count": <number>,
    "lost_count": <number>,
    "segmentation_efficiency_score": <number 0-100>,
    "biggest_opportunity": "<max 100 znakov>",
    "projected_revenue_uplift_eur": <number>
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
    const validNames = new Set(rfmCustomers.map(c => c.name));

    const segmentation = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      segments: (segmentAgg).map(s => {
        const aiSeg = (parsed?.segments || []).find((x: any) => String(x?.segment) === s.segment);
        return {
          ...s,
          strategy: String(aiSeg?.strategy ?? '').slice(0, 200),
          tactic: String(aiSeg?.tactic ?? '').slice(0, 300),
          expectedRevenueUpliftEur: Math.round(Number(aiSeg?.expected_revenue_uplift_eur ?? 0)),
          retentionProbabilityPct: Math.max(0, Math.min(100, Number(aiSeg?.retention_probability_pct ?? 50))),
          priorityAction: String(aiSeg?.priority_action ?? '').slice(0, 200),
        };
      }),
      customers: (parsed?.customers || [])
        .filter((c: any) => validNames.has(String(c?.name ?? '')))
        .slice(0, 50)
        .map((c: any) => ({
          name: String(c?.name ?? '').slice(0, 100),
          segment: ['champions', 'loyal', 'potential', 'at_risk', 'lost'].includes(String(c?.segment)) ? String(c.segment) : 'potential',
          nextBestAction: String(c?.next_best_action ?? '').slice(0, 250),
          expectedValueEur: Math.round(Number(c?.expected_value_eur ?? 0)),
          churnRiskPct: Math.max(0, Math.min(100, Number(c?.churn_risk_pct ?? 50))),
          recommendedChannel: ['email', 'sms', 'call', 'in_person', 'none'].includes(String(c?.recommended_channel)) ? String(c.recommended_channel) : 'email',
        })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        targetSegment: String(r?.target_segment ?? 'all').slice(0, 30),
        expectedImpactEur: Math.round(Number(r?.expected_impact_eur ?? 0)),
        implementationCostEur: Math.round(Number(r?.implementation_cost_eur ?? 0)),
        roiScore: Math.max(0, Math.min(100, Number(r?.roi_score ?? 50))),
      })),
      summary: {
        totalCustomers: rfmCustomers.length,
        totalRevenueEur: Math.round(totalRevenue),
        avgCustomerValueEur: rfmCustomers.length > 0 ? Math.round(totalRevenue / rfmCustomers.length) : 0,
        championsCount: rfmCustomers.filter(c => c.segment === 'champions').length,
        atRiskCount: rfmCustomers.filter(c => c.segment === 'at_risk').length,
        lostCount: rfmCustomers.filter(c => c.segment === 'lost').length,
        segmentationEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.segmentation_efficiency_score ?? 50))),
        biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 200),
        projectedRevenueUpliftEur: Math.round(Number(parsed?.summary?.projected_revenue_uplift_eur ?? 0)),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, segmentation });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
