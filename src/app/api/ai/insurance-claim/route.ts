// v6.29: AI Inventory Insurance Claim Predictor — napove uspešnost zavarovalnih zahtevkov
// POST /api/ai/insurance-claim
// Body: {}
// Returns: { ok, claims: [{ tradeId, title, claimType, claimAmount, successProbability, evidence, process }], insights, summary }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        buyLocation: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, claims: [], message: 'Ni held tradeov za analizo zavarovalnih zahtevkov.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const items = heldTrades.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      return { id: t.id, title: t.title, category: t.category || 'drugo', cost, estValue, daysHeld,
        buyLocation: t.buyLocation || 'neznan', aiRisk: t.listing?.aiRisk ?? 5 };
    });

    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] ${i.title} | ${i.category} | nabavna: ${i.cost}€ | est: ${i.estValue}€ | ${i.daysHeld}d | vir: ${i.buyLocation} | AI risk: ${i.aiRisk}/10`).join('\n');

    const prompt = `Si ekspert za zavarovalne zahtevke in vrednotenje škod pri preprodaji.
Za vsak held item analiziraj morebitne zavarovalne zahtevke (škoda, izguba, kraja, napaka prodajalca).

INVENTAR:
${itemsStr}

Tipi zavarovalnih zahtevkov:
1. "damage_in_transit": škoda pri transportu (če si kupil z shipping)
2. "not_as_described": item ne ustreza opisu (napačen model, poškodovan)
3. "fake_counterfeit": izkazalo se je kot ponaredek
4. "theft_loss": kraja ali izguba itema
5. "seller_fraud": prodajalec prevarel (vzel denar, ne dobavil)
6. "warranty_claim": garancijska zahteva (če ima garancijo)
7. "platform_protection": zaščita platforme (Bolha/Vinted buyer protection)
8. "payment_chargeback": chargeback prek banke/PayPal

Pravila:
1. Za vsak item oceni: ali obstaja realna podlaga za zahtevek?
2. successProbability (0-100%): verjetnost uspešnega zahtevka
3. claimAmount: koliko lahko zahtevamo nazaj
4. Potreben dokazni material (screenshot, komunikacija, račun)
5. Postopek: kje in kako vložiti zahtevek

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "claims": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "claim_type": "<damage_in_transit|not_as_described|fake_counterfeit|theft_loss|seller_fraud|warranty_claim|platform_protection|payment_chargeback>",
      "claim_amount_eur": <number>,
      "success_probability_pct": <number 0-100>,
      "evidence_needed": ["<dokaz, max 80 znakov>", "..."],
      "process": {
        "where_to_file": "<kje vložiti, max 80 znakov>",
        "deadline_days": <number>,
        "steps": ["<korak, max 100 znakov>", "..."]
      },
      "priority": "<high|medium|low>",
      "reasoning": "<max 120 znakov>"
    }
  ],
  "summary": {
    "total_claims": <number>,
    "total_claim_amount_eur": <number>,
    "high_probability_count": <number>,
    "expected_recovery_eur": <number>,
    "avg_success_probability": <number>
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
    const validIds = new Set(items.map(i => i.id));

    const claims = (parsed?.claims || [])
      .filter((c: any) => validIds.has(String(c?.id ?? '')))
      .map((c: any) => ({
        tradeId: String(c?.id ?? ''),
        title: String(c?.title ?? '').slice(0, 150),
        claimType: ['damage_in_transit', 'not_as_described', 'fake_counterfeit', 'theft_loss', 'seller_fraud', 'warranty_claim', 'platform_protection', 'payment_chargeback'].includes(String(c?.claim_type))
          ? String(c.claim_type) : 'platform_protection',
        claimAmountEur: Math.max(0, Number(c?.claim_amount_eur ?? 0)),
        successProbabilityPct: Math.max(0, Math.min(100, Number(c?.success_probability_pct ?? 0))),
        evidenceNeeded: (c?.evidence_needed || []).slice(0, 6).map((e: any) => String(e).slice(0, 150)),
        process: {
          whereToFile: String(c?.process?.where_to_file ?? '').slice(0, 200),
          deadlineDays: Math.max(0, Number(c?.process?.deadline_days ?? 30)),
          steps: (c?.process?.steps || []).slice(0, 6).map((s: any) => String(s).slice(0, 200)),
        },
        priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'low',
        reasoning: String(c?.reasoning ?? '').slice(0, 250),
      }))
      .sort((a, b) => b.successProbabilityPct - a.successProbabilityPct);

    const summary = {
      totalClaims: claims.length,
      totalClaimAmountEur: claims.reduce((s, c) => s + c.claimAmountEur, 0),
      highProbabilityCount: claims.filter(c => c.successProbabilityPct >= 60).length,
      expectedRecoveryEur: Math.round(claims.reduce((s, c) => s + (c.claimAmountEur * c.successProbabilityPct / 100), 0)),
      avgSuccessProbability: claims.length > 0 ? Math.round(claims.reduce((s, c) => s + c.successProbabilityPct, 0) / claims.length) : 0,
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
      claims,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
