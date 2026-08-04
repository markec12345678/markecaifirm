// v5.3: Smart Rules API — CRUD za kompleksna pravila alertov
// GET /api/smart-rules — list all rules
// POST /api/smart-rules — create new rule
//   Body: { name, description?, ruleType, config, channels?, isActive? }
// PATCH /api/smart-rules — update rule (body: { id, ...fields })
// DELETE /api/smart-rules?id=xxx — delete rule

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkSmartRules } from '@/lib/smart-rules-engine';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const check = url.searchParams.get('check') === '1';

    const rules = await db.smartRule.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Optional: check all rules immediately
    let checkResults: any[] = [];
    if (check) {
      checkResults = await checkSmartRules();
    }

    return NextResponse.json({
      rules: rules.map(r => ({
        ...r,
        config: JSON.parse(r.config),
        channels: JSON.parse(r.channels),
      })),
      checkResults,
    });

  } catch (err) {
    logger.error("/api/smart-rules", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, ruleType, config, channels, isActive } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Ime je obvezno' }, { status: 400 });
    }
    if (!['price_threshold', 'multiple_listings', 'price_drop_pct', 'ai_verdict_combo', 'time_based'].includes(ruleType)) {
      return NextResponse.json({ error: 'Neveljaven ruleType' }, { status: 400 });
    }
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'Config je obvezen (object)' }, { status: 400 });
    }

    const rule = await db.smartRule.create({
      data: {
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        ruleType,
        config: JSON.stringify(config),
        channels: JSON.stringify(Array.isArray(channels) ? channels : []),
        isActive: isActive !== false,
      },
    });

    return NextResponse.json({
      ok: true,
      rule: {
        ...rule,
        config: JSON.parse(rule.config),
        channels: JSON.parse(rule.channels),
      },
    });
  } catch (e: any) {
    logger.error("/api/smart-rules", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, description, config, channels, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
    }

    const rule = await db.smartRule.findUnique({ where: { id } });
    if (!rule) {
      return NextResponse.json({ error: 'Pravilo ne obstaja' }, { status: 404 });
    }

    const data: any = {};
    if (typeof name === 'string') data.name = name.trim();
    if (typeof description === 'string') data.description = description.trim();
    if (config && typeof config === 'object') data.config = JSON.stringify(config);
    if (Array.isArray(channels)) data.channels = JSON.stringify(channels);
    if (typeof isActive === 'boolean') data.isActive = isActive;

    const updated = await db.smartRule.update({ where: { id }, data });
    return NextResponse.json({
      ok: true,
      rule: {
        ...updated,
        config: JSON.parse(updated.config),
        channels: JSON.parse(updated.channels),
      },
    });
  } catch (e: any) {
    logger.error("/api/smart-rules", "PATCH handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
    }
    try {
      await db.smartRule.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/smart-rules", "DELETE handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
