// v6.16: AI Customer Lifetime Value Predictor — napove vrednost kupca čez čas
// POST /api/ai/customer-ltv
// Body: { sellerName?: string, contactStatus?: string }
// Returns: { ok, customers: [{ name, totalSpent, purchaseCount, avgOrderValue, predictedLTV, segment, recommendations }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const filterSeller = String(body?.sellerName || '').trim();

    // 1. Pridobi sold trades z buyLocation (predpostavimo, da je to "kupec" za nas — prodajalec)
    // In pridobi listing-e z sellerName (to so ljudje od katerih smo kupovali)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, sellDate: true, buyDate: true,
        sellLocation: true, buyLocation: true,
      },
      take: 500,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        customers: [],
        message: 'Ni prodaj za analizo customer LTV.',
      });
    }

    // 2. Agregacija po buyLocation (klienti od katerih smo kupovali)
    // In po sellLocation (ljudje ki so kupili od nas)
    const byBuyer: Record<string, {
      purchases: any[];
      totalSpent: number;
      count: number;
      avgOrder: number;
      firstPurchase: Date;
      lastPurchase: Date;
      categories: Set<string>;
      profit: number;
    }> = {};

    for (const t of soldTrades) {
      const buyer = t.sellLocation || 'neznan';
      if (filterSeller && buyer !== filterSeller) continue;
      if (!byBuyer[buyer]) {
        byBuyer[buyer] = {
          purchases: [], totalSpent: 0, count: 0, avgOrder: 0,
          firstPurchase: new Date(8e15), lastPurchase: new Date(0),
          categories: new Set(), profit: 0,
        };
      }
      const b = byBuyer[buyer];
      b.purchases.push(t);
      b.totalSpent += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      b.count++;
      b.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      b.categories.add(t.category || 'drugo');
      if (t.sellDate) {
        if (t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
        if (t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      }
    }

    // Filtriraj samo kupce z vsaj 1 nakupom
    const topBuyers = Object.entries(byBuyer)
      .filter(([_, b]) => b.count >= 1)
      .map(([name, b]) => {
        const daysActive = b.firstPurchase.getTime() < b.lastPurchase.getTime()
          ? Math.round((b.lastPurchase.getTime() - b.firstPurchase.getTime()) / (24 * 60 * 60 * 1000))
          : 0;
        const avgOrder = b.count > 0 ? Math.round(b.totalSpent / b.count) : 0;
        // Purchase frequency (purchases per month)
        const monthsActive = Math.max(1, daysActive / 30);
        const frequencyPerMonth = b.count / monthsActive;
        // Repeat buyer = več kot 1 nakup
        const isRepeat = b.count > 1;
        return {
          name,
          totalSpent: Math.round(b.totalSpent),
          purchaseCount: b.count,
          avgOrderValue: avgOrder,
          profit: Math.round(b.profit),
          daysActive,
          monthsActive: Math.round(monthsActive),
          frequencyPerMonth: Math.round(frequencyPerMonth * 10) / 10,
          isRepeat,
          categories: Array.from(b.categories).slice(0, 5),
          firstPurchase: b.firstPurchase.toISOString(),
          lastPurchase: b.lastPurchase.toISOString(),
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 30);

    if (topBuyers.length === 0) {
      return NextResponse.json({
        ok: true,
        customers: [],
        message: 'Ni dovolj kupcev za LTV analizo.',
      });
    }

    // 3. AI LTV napoved
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const buyersStr = topBuyers.slice(0, 25).map(b =>
      `- ${b.name}: ${b.purchaseCount} nakupov, ${b.totalSpent}€ skupaj, ${b.avgOrderValue}€ povp., ${b.profit}€ dobička, ${b.daysActive}d aktiven, ${b.frequencyPerMonth}/mesec, kategorije: ${b.categories.join('/')}`
    ).join('\n');

    const prompt = `Si ekspert za customer lifetime value (CLV/LTV) analizo v e-commerce.
Za vsakega kupca napovej prihodnjo vrednost in predlagaj strategijo zadrževanja.

TOP KUPCI (po totalSpent):
${buyersStr}

Pravila za LTV:
1. Formula: LTV = avgOrderValue × purchaseFrequency × customerLifespan
2. Purchase frequency = purchases / months active
3. Customer lifespan = povprečni čas med prvim in zadnjim nakupom + predikcija
4. Segmentacija:
   - "vip": totalSpent > 500€ in repeat (več kot 1 nakup)
   - "loyal": totalSpent > 200€ in repeat
   - "occasional": totalSpent > 50€ in 1+ nakup
   - "one_time": samo 1 nakup < 50€
   - "at_risk": repeat ampak zadnji nakup > 90 dni nazaj

Za vsakega kupca:
1. Napovej predictedLTV (12 mesecev naprej)
2. Določi segment
3. Identificiraj churn risk (verjetnost da ne bo več kupoval)
4. Predlagaj retention strategijo (win-back email, bundle offer, lojalnostni popust, itd.)
5. Identificiraj cross-sell priložnosti (druge kategorije ki bi ga zanimale)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o kupcih, max 200 znakov>",
  "customers": [
    {
      "name": "<ime kupca>",
      "segment": "<vip|loyal|occasional|one_time|at_risk>",
      "predicted_ltv_12m_eur": <number>,
      "churn_risk_pct": <number 0-100>,
      "retention_strategy": "<win_back_email|bundle_offer|loyalty_discount|cross_sell|none>",
      "cross_sell_categories": ["<kategorija, max 30 znakov>", "..."],
      "personalized_offer": "<konkretna ponudba, max 120 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "summary": {
    "total_revenue": <number>,
    "total_profit": <number>,
    "repeat_customers_pct": <number 0-100>,
    "avg_customer_ltv": <number>,
    "vip_count": <number>,
    "at_risk_count": <number>
  }
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = {
          provider: aiSettings.fallbackProvider,
          baseUrl: aiSettings.fallbackBaseUrl || '',
          apiKey: aiSettings.fallbackApiKey || '',
          model: aiSettings.fallbackModel,
        };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const buyerMap = new Map(topBuyers.map(b => [b.name, b]));

    const customers = (parsed?.customers || [])
      .filter((c: any) => buyerMap.has(String(c?.name ?? '')))
      .map((c: any) => {
        const name = String(c.name);
        const orig = buyerMap.get(name)!;
        return {
          ...orig,
          segment: ['vip', 'loyal', 'occasional', 'one_time', 'at_risk'].includes(String(c?.segment))
            ? String(c.segment) : 'occasional',
          predictedLtv12mEur: Math.max(0, Number(c?.predicted_ltv_12m_eur ?? orig.totalSpent)),
          churnRiskPct: Math.max(0, Math.min(100, Number(c?.churn_risk_pct ?? 50))),
          retentionStrategy: ['win_back_email', 'bundle_offer', 'loyalty_discount', 'cross_sell', 'none'].includes(String(c?.retention_strategy))
            ? String(c.retention_strategy) : 'none',
          crossSellCategories: Array.isArray(c?.cross_sell_categories)
            ? c.cross_sell_categories.slice(0, 5).map((s: any) => String(s).slice(0, 50))
            : [],
          personalizedOffer: String(c?.personalized_offer ?? '').slice(0, 250),
          reasoning: String(c?.reasoning ?? '').slice(0, 200),
        };
      });

    const summary = {
      totalRevenue: topBuyers.reduce((s, b) => s + b.totalSpent, 0),
      totalProfit: topBuyers.reduce((s, b) => s + b.profit, 0),
      repeatCustomersPct: Math.round((topBuyers.filter(b => b.isRepeat).length / Math.max(1, topBuyers.length)) * 100),
      avgCustomerLtv: customers.length > 0
        ? Math.round(customers.reduce((s, c) => s + c.predictedLtv12mEur, 0) / customers.length)
        : 0,
      vipCount: customers.filter(c => c.segment === 'vip').length,
      atRiskCount: customers.filter(c => c.segment === 'at_risk').length,
    };

    // Increment AI usage
    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } });
    } else {
      await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } });
    }

    return NextResponse.json({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 500),
      customers,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
