// v6.44: AI Inventory Insurance Optimizer v2 — napredna analiza zavarovalnih tveganj z vizualno analizo
// POST /api/ai/insurance-optimizer-v2
// Body: {}
// Returns: { ok, optimizer: { riskMatrix, policies, items: [], recommendations, claims, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const CATEGORY_RISK_PROFILES: Record<string, { theft: number; damage: number; depreciation: number; liquidity: number }> = {
  'elektronika': { theft: 9, damage: 6, depreciation: 25, liquidity: 3 },
  'telefoni': { theft: 10, damage: 7, depreciation: 30, liquidity: 2 },
  'avto': { theft: 6, damage: 8, depreciation: 12, liquidity: 4 },
  'nepremicnine': { theft: 2, damage: 4, depreciation: 3, liquidity: 8 },
  'kolesa': { theft: 8, damage: 5, depreciation: 15, liquidity: 4 },
  'pohištvo': { theft: 3, damage: 7, depreciation: 8, liquidity: 6 },
  'drugo': { theft: 5, damage: 5, depreciation: 10, liquidity: 5 },
};

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, imageUrl: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) { return NextResponse.json({ ok: true, optimizer: null, message: 'Ni held tradeov za insurance v2.' }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const profile = CATEGORY_RISK_PROFILES[cat] ?? CATEGORY_RISK_PROFILES['drugo'];
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const depreciationLoss = Math.round(cost * (profile.depreciation / 100) * (daysHeld / 365));
      const riskScore = Math.min(100, profile.theft * 4 + profile.damage * 3 + profile.liquidity * 2 + Math.min(20, daysHeld / 7));
      return { id: t.id, title: t.title, category: cat, cost, estValue, daysHeld, profile, depreciationLoss, riskScore, aiRisk: t.listing?.aiRisk ?? 5 };
    });

    const totalValue = items.reduce((s, i) => s + i.estValue, 0);
    const totalRisk = items.reduce((s, i) => s + i.riskScore, 0);
    const avgRisk = items.length > 0 ? Math.round(totalRisk / items.length) : 50;

    const itemsStr = items.slice(0, 20).map(i => `- [${i.id}] ${i.title} | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | theft ${i.profile.theft}/10 | damage ${i.profile.damage}/10 | deprec ${i.profile.depreciation}%/leto | risk ${i.riskScore}/100`).join('\n');

    const prompt = `Si AI insurance optimizer v2 z napredno analizo zavarovalnih tveganj.
Analiziraj inventar z 4-dimenzionalno risk matriko (theft/damage/depreciation/liquidity).

INVENTAR (${items.length}, skupna vrednost ${Math.round(totalValue)}€):
${itemsStr}

Risk matrika (4 dimenzije):
1. THEFT RISK: verjetnost kraje (1-10, telefoni=10, nepremicnine=2)
2. DAMAGE RISK: verjetnost poškodbe (1-10, avto=8, pohištvo=7)
3. DEPRECIATION RATE: letni % padca vrednosti (elektronika=30%, nepremicnine=3%)
4. LIQUIDITY RISK: težava prodaje (1-10, nepremicnine=8, telefoni=2)

Zavarovalne police:
1. HOME_INSURANCE: hišno zavarovanje (do 5.000€ ali 10.000€ premičnin)
2. BUSINESS_INSURANCE: poslovno zavarovanje za preprodajalce
3. PER_ITEM: individualno zavarovanje dragocenih itemov (>500€)
4. SELF_INSURANCE: rezerva za self-covered izgube
5. TRANSIT_INSURANCE: zavarovanje med transportom (shipping)

Claim scenariji:
- Theft: verjetnost × vrednost = expected loss
- Damage: verjetnost × vrednost × 50% (delna izguba)
- Depreciation: že izračunano (drži predolgo)
- Total loss: popolna izguba (požar, poplava)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "risk_matrix": {
    "theft": {"avg_risk": <number>, "high_risk_items": <number>, "expected_annual_loss_eur": <number>},
    "damage": {"avg_risk": <number>, "high_risk_items": <number>, "expected_annual_loss_eur": <number>},
    "depreciation": {"avg_rate_pct": <number>, "annual_loss_eur": <number>},
    "liquidity": {"avg_risk": <number>, "stalled_items": <number>}
  },
  "policies": [
    { "type": "<home_insurance|business_insurance|per_item|self_insurance|transit_insurance>", "coverage_eur": <number>, "deductible_eur": <number>, "annual_premium_eur": <number>, "covers": ["<theft|damage|depreciation|transit>"], "recommended": <boolean>, "reasoning": "<max 80 znakov>" }
  ],
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "value_eur": <number>, "risk_score": <number 0-100>, "risk_level": "<low|medium|high|critical>", "primary_risk": "<theft|damage|depreciation|liquidity>", "recommended_action": "<insure|self_insure|sell_now|monitor>", "insurance_value_eur": <number>, "reasoning": "<max 80 znakov>" }
  ],
  "recommendations": [
    { "action": "<max 120 znakov>", "priority": "<high|medium|low>", "risk_addressed": "<max 50 znakov>", "expected_savings_eur": <number> }
  ],
  "claims": [
    { "scenario": "<theft|damage|total_loss|depreciation>", "probability_pct": <number>, "expected_loss_eur": <number>, "covered_by": "<policy_type|self>", "uncovered_eur": <number>, "mitigation": "<max 80 znakov>" }
  ],
  "summary": {
    "overall_risk_score": <number 0-100>,
    "total_insured_value_eur": <number>,
    "total_uninsured_value_eur": <number>,
    "recommended_annual_premium_eur": <number>,
    "expected_annual_loss_eur": <number>,
    "insurance_efficiency_score": <number 0-100>
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

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      riskMatrix: {
        theft: { avgRisk: Math.round(Number(parsed?.risk_matrix?.theft?.avg_risk ?? 5)), highRiskItems: Math.max(0, Number(parsed?.risk_matrix?.theft?.high_risk_items ?? 0)), expectedAnnualLossEur: Math.round(Number(parsed?.risk_matrix?.theft?.expected_annual_loss_eur ?? 0)) },
        damage: { avgRisk: Math.round(Number(parsed?.risk_matrix?.damage?.avg_risk ?? 5)), highRiskItems: Math.max(0, Number(parsed?.risk_matrix?.damage?.high_risk_items ?? 0)), expectedAnnualLossEur: Math.round(Number(parsed?.risk_matrix?.damage?.expected_annual_loss_eur ?? 0)) },
        depreciation: { avgRatePct: Math.round(Number(parsed?.risk_matrix?.depreciation?.avg_rate_pct ?? 10)), annualLossEur: Math.round(Number(parsed?.risk_matrix?.depreciation?.annual_loss_eur ?? 0)) },
        liquidity: { avgRisk: Math.round(Number(parsed?.risk_matrix?.liquidity?.avg_risk ?? 5)), stalledItems: Math.max(0, Number(parsed?.risk_matrix?.liquidity?.stalled_items ?? 0)) },
      },
      policies: (parsed?.policies || []).slice(0, 6).map((p: any) => ({
        type: String(p?.type ?? '').slice(0, 50), coverageEur: Math.max(0, Number(p?.coverage_eur ?? 0)),
        deductibleEur: Math.max(0, Number(p?.deductible_eur ?? 0)), annualPremiumEur: Math.max(0, Number(p?.annual_premium_eur ?? 0)),
        covers: (p?.covers || []).slice(0, 4).map((c: any) => String(c).slice(0, 30)),
        recommended: Boolean(p?.recommended ?? false), reasoning: String(p?.reasoning ?? '').slice(0, 150),
      })),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        valueEur: Math.max(0, Number(it?.value_eur ?? 0)), riskScore: Math.max(0, Math.min(100, Number(it?.risk_score ?? 50))),
        riskLevel: ['low', 'medium', 'high', 'critical'].includes(String(it?.risk_level)) ? String(it.risk_level) : 'medium',
        primaryRisk: ['theft', 'damage', 'depreciation', 'liquidity'].includes(String(it?.primary_risk)) ? String(it.primaryRisk) : 'damage',
        recommendedAction: ['insure', 'self_insure', 'sell_now', 'monitor'].includes(String(it?.recommended_action)) ? String(it.recommended_action) : 'monitor',
        insuranceValueEur: Math.max(0, Number(it?.insurance_value_eur ?? 0)), reasoning: String(it?.reasoning ?? '').slice(0, 200),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 250), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        riskAddressed: String(r?.risk_addressed ?? '').slice(0, 80), expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)),
      })),
      claims: (parsed?.claims || []).slice(0, 5).map((c: any) => ({
        scenario: String(c?.scenario ?? '').slice(0, 30), probabilityPct: Math.round(Number(c?.probability_pct ?? 0)),
        expectedLossEur: Math.round(Number(c?.expected_loss_eur ?? 0)), coveredBy: String(c?.covered_by ?? '').slice(0, 50),
        uncoveredEur: Math.round(Number(c?.uncovered_eur ?? 0)), mitigation: String(c?.mitigation ?? '').slice(0, 150),
      })),
      summary: {
        overallRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_risk_score ?? avgRisk))),
        totalInsuredValueEur: Math.round(Number(parsed?.summary?.total_insured_value_eur ?? 0)),
        totalUninsuredValueEur: Math.round(Number(parsed?.summary?.total_uninsured_value_eur ?? totalValue)),
        recommendedAnnualPremiumEur: Math.round(Number(parsed?.summary?.recommended_annual_premium_eur ?? 0)),
        expectedAnnualLossEur: Math.round(Number(parsed?.summary?.expected_annual_loss_eur ?? 0)),
        insuranceEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.insurance_efficiency_score ?? 50))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
