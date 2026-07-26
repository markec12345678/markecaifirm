// v6.14: AI Inventory Insurance Optimizer — analiza tveganj inventarja in zavarovanje
// POST /api/ai/insurance-optimizer
// Body: { location?: string, storageType?: 'home'|'garage'|'storage_unit'|'shop' }
// Returns: { ok, riskAnalysis: { totalValue, concentrationRisk, theftRisk, damageRisk, depreciationRisk },
//            items: [{ id, title, value, riskScore, recommendation }], policy: { type, coverage, deductible, premium, providers }, recommendations }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// Kategorije z različnimi profili tveganja
const CATEGORY_RISK_PROFILES: Record<string, { theftRisk: number; damageRisk: number; depreciationRate: number; liquidityRisk: number }> = {
  'elektronika': { theftRisk: 9, damageRisk: 6, depreciationRate: 25, liquidityRisk: 3 },
  'telefoni': { theftRisk: 10, damageRisk: 7, depreciationRate: 30, liquidityRisk: 2 },
  'računalništvo': { theftRisk: 8, damageRisk: 5, depreciationRate: 20, liquidityRisk: 3 },
  'avto': { theftRisk: 6, damageRisk: 8, depreciationRate: 15, liquidityRisk: 4 },
  'nepremičnine': { theftRisk: 2, damageRisk: 4, depreciationRate: 3, liquidityRisk: 8 },
  'kolesa': { theftRisk: 8, damageRisk: 5, depreciationRate: 15, liquidityRisk: 4 },
  'pohištvo': { theftRisk: 3, damageRisk: 7, depreciationRate: 8, liquidityRisk: 6 },
  'umetnine': { theftRisk: 7, damageRisk: 8, depreciationRate: 0, liquidityRisk: 9 },
  'orožje': { theftRisk: 9, damageRisk: 3, depreciationRate: 2, liquidityRisk: 7 },
  'nakit': { theftRisk: 9, damageRisk: 4, depreciationRate: 0, liquidityRisk: 5 },
  'drugo': { theftRisk: 5, damageRisk: 5, depreciationRate: 10, liquidityRisk: 5 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const location = String(body?.location || '').trim();
    const storageType = ['home', 'garage', 'storage_unit', 'shop'].includes(String(body?.storageType))
      ? String(body.storageType) : 'home';

    // 1. Pridobi held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        message: 'Ni itemov v skladišču za analizo zavarovalnih tveganj.',
      });
    }

    // 2. Izračunaj tveganja per item
    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const cat = (t.category || 'drugo').toLowerCase();
      const profile = CATEGORY_RISK_PROFILES[cat] ?? CATEGORY_RISK_PROFILES['drugo'];
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));

      // Risk score kombinacija
      const depreciationLoss = Math.round((cost * profile.depreciationRate / 100) * (daysHeld / 365));
      const riskScore = Math.min(100,
        profile.theftRisk * 4 +
        profile.damageRisk * 3 +
        profile.liquidityRisk * 2 +
        Math.min(20, daysHeld / 7) // stalled povečuje tveganje
      );

      return {
        id: t.id,
        title: t.title,
        category: cat,
        cost,
        estimatedValue: estValue,
        daysHeld,
        theftRisk: profile.theftRisk,
        damageRisk: profile.damageRisk,
        depreciationRate: profile.depreciationRate,
        liquidityRisk: profile.liquidityRisk,
        depreciationLoss,
        riskScore: Math.round(riskScore),
      };
    });

    // 3. Skupna analiza tveganj
    const totalValue = items.reduce((s, i) => s + i.estimatedValue, 0);
    const totalCost = items.reduce((s, i) => s + i.cost, 0);

    // Concentration risk (koliko % vrednosti je v top 3 itemih)
    const sortedByValue = [...items].sort((a, b) => b.estimatedValue - a.estimatedValue);
    const top3Value = sortedByValue.slice(0, 3).reduce((s, i) => s + i.estimatedValue, 0);
    const concentrationPct = totalValue > 0 ? Math.round((top3Value / totalValue) * 100) : 0;

    // Kategorijska koncentracija
    const byCatValue: Record<string, number> = {};
    for (const i of items) {
      byCatValue[i.category] = (byCatValue[i.category] ?? 0) + i.estimatedValue;
    }
    const topCat = Object.entries(byCatValue).sort(([, a], [, b]) => b - a)[0];
    const topCatPct = totalValue > 0 && topCat ? Math.round((topCat[1] / totalValue) * 100) : 0;

    // Storage type risk multiplier
    const storageMultipliers: Record<string, { theft: number; damage: number }> = {
      home: { theft: 1.0, damage: 1.0 },
      garage: { theft: 1.3, damage: 1.2 },
      storage_unit: { theft: 1.5, damage: 1.1 },
      shop: { theft: 1.8, damage: 1.4 },
    };
    const storageMult = storageMultipliers[storageType] ?? storageMultipliers.home;

    const avgTheftRisk = Math.round(items.reduce((s, i) => s + i.theftRisk, 0) / items.length * storageMult.theft);
    const avgDamageRisk = Math.round(items.reduce((s, i) => s + i.damageRisk, 0) / items.length * storageMult.damage);
    const avgDepreciationRate = Math.round(items.reduce((s, i) => s + i.depreciationRate, 0) / items.length);
    const totalDepreciationLoss = items.reduce((s, i) => s + i.depreciationLoss, 0);

    const concentrationRisk = concentrationPct > 60 ? 'high' : concentrationPct > 40 ? 'medium' : 'low';
    const theftRiskLevel = avgTheftRisk >= 7 ? 'high' : avgTheftRisk >= 5 ? 'medium' : 'low';
    const damageRiskLevel = avgDamageRisk >= 7 ? 'high' : avgDamageRisk >= 5 ? 'medium' : 'low';
    const depreciationRiskLevel = avgDepreciationRate >= 20 ? 'high' : avgDepreciationRate >= 10 ? 'medium' : 'low';

    // 4. AI analiza
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = items.slice(0, 25).map(i =>
      `- ${i.title} | ${i.category} | vrednost: ${i.estimatedValue}€ | theftRisk: ${i.theftRisk}/10 | damageRisk: ${i.damageRisk}/10 | depRate: ${i.depreciationRate}%/leto | ${i.daysHeld}d v skladišču`
    ).join('\n');

    const prompt = `Si ekspert za zavarovalništvo pri preprodaji rabljenih dobrin.
Analiziraj inventar in predlagaj optimalno zavarovanje ter mitigacijo tveganj.

INVENTAR (${items.length} itemov, skupna vrednost ${totalValue}€):
${itemsStr}

SKUPNA ANALIZA:
- Koncentracijsko tveganje: ${concentrationPct}% v top 3 itemih (${concentrationRisk})
- Top kategorija: ${topCat?.[0] ?? 'neznan'} (${topCatPct}% vrednosti)
- Povp. theft risk: ${avgTheftRisk}/10 (${theftRiskLevel})
- Povp. damage risk: ${avgDamageRisk}/10 (${damageRiskLevel})
- Povp. depreciation rate: ${avgDepreciationRate}%/leto (${depreciationRiskLevel})
- Skupna izguba zaradi amortizacije: ${totalDepreciationLoss}€
- Storage type: ${storageType}

Slovensko zavarovalniško okolje:
- Osnovno hišno zavarovanje pokriva do 5.000€ ali 10.000€ osebne premične lastnine
- Dodatno zavarovanje premičnin (Triglav, Adriatic, Zavarovalnica Sava) — do 50.000€
- Specialno zavarovanje za preprodajalce (business insurance) — višje premije, popolna pokritost
- Self-insurance (rezerva) za nizkovredne iteme (<200€)

Strategije zavarovanja:
- "self_insured": brez zavarovanja, sam pokriva izgube (za mali inventory <5.000€)
- "home_extension": razširi hišno zavarovanje na dodatne premičnine
- "business_policy": specialno poslovno zavarovanje za preprodajalce
- "hybrid": self-insured za <500€, business policy za >500€ iteme
- "per_item": individualno zavarovanje vsakega dragocenega itema

Odgovori LE z JSON:
{
  "risk_summary": "<povzetek tveganj, max 200 znakov>",
  "recommended_strategy": "<self_insured|home_extension|business_policy|hybrid|per_item>",
  "policy": {
    "type": "<tip zavarovanja>",
    "coverage_eur": <number>,
    "deductible_eur": <number>,
    "estimated_annual_premium_eur": <number>,
    "providers": ["<slovenski zavarovalnica, npr. Triglav>", "..."]
  },
  "high_risk_items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "risk": "<theft|damage|depreciation|stalled>",
      "recommendation": "<kaj narediti, max 100 znakov>"
    }
  ],
  "recommendations": [
    {
      "action": "<konkretno dejanje, max 120 znakov>",
      "priority": "<high|medium|low>",
      "savings_eur": <number>
    }
  ],
  "self_insurance_reserve": <number, koliko denarja rezervirati za self-insurance>
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
    const validIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));

    const highRiskItems = (parsed?.high_risk_items || [])
      .filter((h: any) => validIds.has(String(h?.id ?? '')))
      .map((h: any) => {
        const id = String(h.id);
        const orig = itemMap.get(id)!;
        return {
          id,
          title: orig.title,
          category: orig.category,
          estimatedValue: orig.estimatedValue,
          riskScore: orig.riskScore,
          risk: ['theft', 'damage', 'depreciation', 'stalled'].includes(String(h?.risk)) ? String(h.risk) : 'damage',
          recommendation: String(h?.recommendation ?? '').slice(0, 200),
        };
      });

    const result = {
      riskSummary: String(parsed?.risk_summary ?? '').slice(0, 400),
      recommendedStrategy: ['self_insured', 'home_extension', 'business_policy', 'hybrid', 'per_item'].includes(String(parsed?.recommended_strategy))
        ? String(parsed.recommended_strategy) : 'hybrid',
      policy: {
        type: String(parsed?.policy?.type ?? '').slice(0, 80),
        coverageEur: Math.max(0, Number(parsed?.policy?.coverage_eur ?? totalValue)),
        deductibleEur: Math.max(0, Number(parsed?.policy?.deductible_eur ?? 0)),
        estimatedAnnualPremiumEur: Math.max(0, Number(parsed?.policy?.estimated_annual_premium_eur ?? 0)),
        providers: Array.isArray(parsed?.policy?.providers)
          ? parsed.policy.providers.slice(0, 5).map((p: any) => String(p).slice(0, 60))
          : [],
      },
      highRiskItems,
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        savingsEur: Number(r?.savings_eur ?? 0) || 0,
      })),
      selfInsuranceReserve: Math.max(0, Number(parsed?.self_insurance_reserve ?? 0)),
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
      riskAnalysis: {
        totalValue,
        totalCost,
        itemCount: items.length,
        concentrationRisk,
        concentrationPct,
        topCategory: topCat?.[0] ?? null,
        topCategoryPct: topCatPct,
        theftRisk: avgTheftRisk,
        theftRiskLevel,
        damageRisk: avgDamageRisk,
        damageRiskLevel,
        depreciationRate: avgDepreciationRate,
        depreciationRiskLevel,
        totalDepreciationLoss,
        storageType,
      },
      items: items.sort((a, b) => b.riskScore - a.riskScore),
      analysis: result,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
