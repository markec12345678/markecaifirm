// v7.39: Capital Allocation Advisor — "imam 500€, kje naj investiram?"
//
// Analizira:
// - Zgodovino ROI per kategorija
// - Trenutno razpolozljivost capital-a (cash = ne vezano v inventar)
// - Deal velocity per kategorija
// - Inventory aging (kje so item-i zastarali)
//
// POST /api/ai/capital-allocation-advisor
// Body: { availableCapital?: number }
// Returns: { ok, recommendation: { split, reasoning, expectedRoi, expectedProfit } }

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
    const body = await req.json().catch(() => ({}));
    const availableCapital = body?.availableCapital ? Number(body.availableCapital) : null;

    // 1. Capital currently tied in inventory
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, buyFees: true, category: true },
    });
    const capitalTied = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    // 2. Sold history per category
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
      take: 100,
    });

    // Group by category
    const catStats = new Map<string, { count: number; invested: number; returned: number; profit: number; holdDays: number[] }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim();
      const cur = catStats.get(cat) || { count: 0, invested: 0, returned: 0, profit: 0, holdDays: [] };
      cur.count += 1;
      cur.invested += t.buyPrice + (t.buyFees ?? 0);
      cur.returned += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      cur.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      if (t.sellDate) {
        const days = (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86400000;
        if (days >= 0) cur.holdDays.push(days);
      }
      catStats.set(cat, cur);
    }

    const categoryPerformance = Array.from(catStats.entries())
      .map(([cat, s]) => ({
        category: cat,
        count: s.count,
        roi: s.invested > 0 ? Math.round((s.profit / s.invested) * 100) : 0,
        totalProfit: Math.round(s.profit),
        avgHoldDays: s.holdDays.length > 0 ? Math.round(s.holdDays.reduce((a, b) => a + b, 0) / s.holdDays.length) : 0,
        moneyVelocity: s.holdDays.length > 0 ? Math.round((365 / (s.holdDays.reduce((a, b) => a + b, 0) / s.holdDays.length)) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.roi - a.roi);

    // 3. Current held distribution
    const heldByCategory = new Map<string, number>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').trim();
      heldByCategory.set(cat, (heldByCategory.get(cat) ?? 0) + 1);
    }

    // AI analysis
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const capital = availableCapital ?? 500; // default 500€ if not specified

    const prompt = `Si financial advisor za preprodajo rabljenih dobrin.

GLAVNO VPRAŠANJE: "Imam ${capital}€ na voljo za investicijo. Kako naj jih razdelim za maksimalen dobiček?"

TRENUTNO STANJE:
- Capital vezan v inventarju: ${capitalTied}€ (${heldTrades.length} item-ov)
- Skupno prodanih trade-ov: ${soldTrades.length}

ZGODOVINA PO KATEGORIJAH:
${categoryPerformance.map(c => `- ${c.category}: ${c.count} prodaj, ROI ${c.roi}%, profit ${c.totalProfit}€, avg hold ${c.avgHoldDays}d, velocity ${c.moneyVelocity}x/leto`).join('\n')}

TRENTNO HELD:
${Array.from(heldByCategory.entries()).map(([cat, count]) => `- ${cat}: ${count} item-ov`).join('\n') || 'Ni held item-ov.'}

NALOGA:
1. Razdeli ${capital}€ med kategorije (allocations)
2. Za vsako kategorijo daj: znesek, utemeljitev, expected ROI, expected profit
3. Opozori na kategorije ki se izogibaj (nizek ROI, dolg hold)
4. Skupni expected profit + ROI

PRAVILA:
- Ne daj več kot 40% v eno kategorijo (diverzifikacija)
- Preferiraj kategorije z visokim ROI + visoko velocity
- Opozori če je kategorija že preveč zastopana v inventarju
- Upoštevaj: kategorije z malo prodajami = višje tveganje

Odgovori LE z JSON:
{
  "allocations": [
    { "category": "<string>", "amount_eur": <number>, "pct": <number>, "reasoning": "<string>", "expected_roi_pct": <number>, "expected_profit_eur": <number> }
  ],
  "total_expected_profit_eur": <number>,
  "total_expected_roi_pct": <number>,
  "avoid_categories": ["<string>", "..."],
  "strategy_summary": "<2-3 stavki>",
  "risk_assessment": "<1 stavek>"
}`;

    let raw = '';
    try {
      raw = await callProviderForRaw(aiSettings, prompt);
    } catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else {
        // Fallback: simple allocation based on ROI
        const top3 = categoryPerformance.slice(0, 3);
        const allocations = top3.map((c, i) => ({
          category: c.category,
          amountEur: Math.round(capital * (i === 0 ? 0.4 : i === 1 ? 0.35 : 0.25)),
          pct: i === 0 ? 40 : i === 1 ? 35 : 25,
          reasoning: `ROI ${c.roi}%, velocity ${c.moneyVelocity}x/leto`,
          expectedRoiPct: c.roi,
          expectedProfitEur: Math.round(capital * (i === 0 ? 0.4 : i === 1 ? 0.35 : 0.25) * c.roi / 100),
        }));
        return NextResponse.json({
          ok: true,
          availableCapital: capital,
          capitalTied,
          allocations,
          totalExpectedProfit: allocations.reduce((s, a) => s + a.expectedProfitEur, 0),
          totalExpectedRoi: Math.round((allocations.reduce((s, a) => s + a.expectedProfitEur, 0) / capital) * 100),
          note: 'AI ni na voljo — izračunano iz lokalne zgodovine.',
        });
      }
    }

    const parsed: any = parseJsonLooseExported(raw);

    return NextResponse.json({
      ok: true,
      availableCapital: capital,
      capitalTied,
      heldCount: heldTrades.length,
      categoryPerformance,
      allocations: (parsed?.allocations || []).slice(0, 6).map((a: any) => ({
        category: String(a?.category ?? '').slice(0, 50),
        amountEur: Math.round(Number(a?.amount_eur ?? 0)),
        pct: Math.max(0, Math.min(100, Number(a?.pct ?? 0))),
        reasoning: String(a?.reasoning ?? '').slice(0, 200),
        expectedRoiPct: Math.round(Number(a?.expected_roi_pct ?? 0)),
        expectedProfitEur: Math.round(Number(a?.expected_profit_eur ?? 0)),
      })),
      totalExpectedProfit: Math.round(Number(parsed?.total_expected_profit_eur ?? 0)),
      totalExpectedRoi: Math.round(Number(parsed?.total_expected_roi_pct ?? 0)),
      avoidCategories: (parsed?.avoid_categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
      strategySummary: String(parsed?.strategy_summary ?? '').slice(0, 400),
      riskAssessment: String(parsed?.risk_assessment ?? '').slice(0, 200),
    });
  } catch (err: any) {
    logger.error('/api/ai/capital-allocation-advisor', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
