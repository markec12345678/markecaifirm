// v6.38: AI Listing Quality Predictor — napove kakovost oglasa pred objavo
// POST /api/ai/quality-predictor
// Body: { listingId?: string, tradeId?: string }
// Returns: { ok, prediction: { qualityScore, grade, components, issues, improvements, projectedPerformance } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId, tradeId } = body;

    let title = '', description = '', imageUrl = '', price = 0, category = '';
    if (tradeId) {
      const trade = await db.trade.findUnique({ where: { id: String(tradeId) }, select: { title: true, category: true, buyPrice: true, listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true } } } });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      title = trade.title; category = trade.category || ''; price = trade.listing?.aiEstimatedValue ?? trade.buyPrice;
      description = trade.listing?.detailDescription || trade.listing?.description || ''; imageUrl = trade.listing?.imageUrl || '';
    } else if (listingId) {
      const l = await db.listing.findUnique({ where: { id: String(listingId) }, select: { title: true, description: true, detailDescription: true, imageUrl: true, price: true, monitor: { select: { source: true } } } });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      title = l.title; description = l.detailDescription || l.description; imageUrl = l.imageUrl || ''; price = l.price ?? 0; category = l.monitor?.source || '';
    } else { return NextResponse.json({ error: 'listingId ali tradeId je obvezen' }, { status: 400 }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const prompt = `Si AI listing quality predictor. Napovej kakovost oglasa pred objavo.
Analiziraj naslov, opis, ceno in sliko za napoved uspešnosti.

NASLOV: ${title}
KATEGORIJA: ${category}
CENA: ${price}€
OPIS: ${description.slice(0, 800)}
SLIKA: ${imageUrl ? 'na voljo' : 'ni slike'}

Quality komponente (vsaka 0-100):
1. TITLE_QUALITY: ali naslov vsebuje ključne besede, brand, model, stanje?
2. DESCRIPTION_QUALITY: ali je opis popoln (stanje, specifikacije, kontakt)?
3. PRICE_COMPETITIVENESS: ali je cena konkurenčna glede na trg?
4. IMAGE_QUALITY: ali slika privlači kupca?
5. SEO_SCORE: ali ga bodo našli v iskanju?
6. TRUST_SCORE: ali vzbuja zaupanje (račun, garancija, prevzem)?
7. COMPLETENESS: ali manjka kaj ključnega?
8. CONVERSION_POTENTIAL: ali bo konvertiral v povpraševanje?

Quality grade: A+ (90+), A (80+), B+ (70+), B (60+), C (50+), D (<50)

Odgovori LE z JSON:
{
  "quality_score": <number 0-100>,
  "grade": "<A+|A|B+|B|C|D>",
  "components": [
    { "name": "<title|description|price|image|seo|trust|completeness|conversion>", "score": <number 0-100>, "weight_pct": <number>, "issues": ["<max 60 znakov>"], "strengths": ["<max 60 znakov>"] }
  ],
  "issues": [
    { "type": "<missing_info|poor_image|bad_title|overpriced|underpriced|low_seo|low_trust|incomplete>", "severity": "<high|medium|low>", "description": "<max 100 znakov>", "fix": "<max 100 znakov>" }
  ],
  "improvements": [
    { "action": "<max 100 znakov>", "impact": "<high|medium|low>", "expected_score_increase": <number>, "difficulty": "<easy|medium|hard>" }
  ],
  "projected_performance": {
    "expected_views_7d": <number>,
    "expected_inquiries_7d": <number>,
    "expected_sell_probability_30d_pct": <number>,
    "expected_sell_time_days": <number>,
    "expected_final_price_eur": <number>
  },
  "quick_fixes": ["<max 80 znakov>", "..."],
  "reasoning": "<max 200 znakov>"
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

    const prediction = {
      qualityScore: Math.max(0, Math.min(100, Number(parsed?.quality_score ?? 50))),
      grade: ['A+', 'A', 'B+', 'B', 'C', 'D'].includes(String(parsed?.grade)) ? String(parsed.grade) : 'C',
      components: (parsed?.components || []).slice(0, 8).map((c: any) => ({
        name: String(c?.name ?? '').slice(0, 50), score: Math.max(0, Math.min(100, Number(c?.score ?? 50))),
        weightPct: Math.max(0, Math.min(100, Number(c?.weight_pct ?? 0))),
        issues: (c?.issues || []).slice(0, 3).map((i: any) => String(i).slice(0, 100)),
        strengths: (c?.strengths || []).slice(0, 3).map((s: any) => String(s).slice(0, 100)),
      })),
      issues: (parsed?.issues || []).slice(0, 8).map((i: any) => ({
        type: String(i?.type ?? '').slice(0, 50), severity: ['high', 'medium', 'low'].includes(String(i?.severity)) ? String(i.severity) : 'medium',
        description: String(i?.description ?? '').slice(0, 200), fix: String(i?.fix ?? '').slice(0, 200),
      })),
      improvements: (parsed?.improvements || []).slice(0, 6).map((im: any) => ({
        action: String(im?.action ?? '').slice(0, 200), impact: ['high', 'medium', 'low'].includes(String(im?.impact)) ? String(im.impact) : 'medium',
        expectedScoreIncrease: Math.round(Number(im?.expected_score_increase ?? 0)), difficulty: ['easy', 'medium', 'hard'].includes(String(im?.difficulty)) ? String(im.difficulty) : 'medium',
      })),
      projectedPerformance: {
        expectedViews7d: Math.max(0, Number(parsed?.projected_performance?.expected_views_7d ?? 0)),
        expectedInquiries7d: Math.max(0, Number(parsed?.projected_performance?.expected_inquiries_7d ?? 0)),
        expectedSellProbability30dPct: Math.max(0, Math.min(100, Number(parsed?.projected_performance?.expected_sell_probability_30d_pct ?? 30))),
        expectedSellTimeDays: Math.max(0, Number(parsed?.projected_performance?.expected_sell_time_days ?? 30)),
        expectedFinalPriceEur: Math.max(0, Number(parsed?.projected_performance?.expected_final_price_eur ?? price)),
      },
      quickFixes: (parsed?.quick_fixes || []).slice(0, 5).map((q: any) => String(q).slice(0, 150)),
      reasoning: String(parsed?.reasoning ?? '').slice(0, 400),
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, prediction });
  } catch (e: any) { logger.error("/api/ai/quality-predictor", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
