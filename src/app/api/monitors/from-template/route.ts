// v4.6: Create monitor from a pre-defined template
// POST /api/monitors/from-template
// Body: { templateId: string, customName?: string, override?: Partial<MonitorTemplate> }
// Returns: { ok: true, monitor: {...} }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTemplateById } from '@/lib/monitor-templates';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { templateId, customName, override } = body;

    if (!templateId || typeof templateId !== 'string') {
      return NextResponse.json({ error: 'templateId je obvezen' }, { status: 400 });
    }

    const template = getTemplateById(templateId);
    if (!template) {
      return NextResponse.json({ error: `Template "${templateId}" ne obstaja` }, { status: 404 });
    }

    // Allow user overrides for specific fields
    const name = customName?.trim() || template.name;
    const sourceUrl = override?.sourceUrl?.trim() || template.sourceUrl;
    const keywords = override?.keywords ?? template.keywords;
    const excludeKeywords = override?.excludeKeywords ?? template.excludeKeywords;
    const minPrice = override?.minPrice ?? template.minPrice;
    const maxPrice = override?.maxPrice ?? template.maxPrice;
    const intervalMinutes = override?.intervalMinutes ?? template.intervalMinutes;
    const customPrompt = override?.customPrompt ?? template.customPrompt;
    const tags = override?.tags ?? template.tags;

    // Check if monitor with same name + source URL already exists
    const existing = await db.monitor.findFirst({
      where: {
        OR: [
          { name },
          { sourceUrl },
        ],
      },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: false,
        error: `Monitor s tem imenom ali URL že obstaja (ID: ${existing.id})`,
        existingId: existing.id,
      }, { status: 409 });
    }

    const monitor = await db.monitor.create({
      data: {
        name,
        source: template.source,
        sourceUrl,
        keywords,
        excludeKeywords,
        minPrice: typeof minPrice === 'number' ? minPrice : null,
        maxPrice: typeof maxPrice === 'number' ? maxPrice : null,
        intervalMinutes,
        isActive: true,
        customPrompt,
        tags,
      },
    });

    return NextResponse.json({
      ok: true,
      monitor,
      templateId: template.id,
      templateName: template.name,
    });
  } catch (e: any) {
    logger.error("/api/monitors/from-template", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka pri ustvarjanju monitorja' }, { status: 500 });
  }
}

// GET returns list of available templates
export async function GET() {
  try {
    const { MONITOR_TEMPLATES, getTemplatesByCategory } = await import('@/lib/monitor-templates');
    return NextResponse.json({
      templates: MONITOR_TEMPLATES,
      byCategory: {
        all: getTemplatesByCategory('all').length,
        elektronika: getTemplatesByCategory('elektronika').length,
        avto: getTemplatesByCategory('avto').length,
        nepremicnine: getTemplatesByCategory('nepremicnine').length,
        moda: getTemplatesByCategory('moda').length,
        orodje: getTemplatesByCategory('orodje').length,
        sport: getTemplatesByCategory('sport').length,
        drugo: getTemplatesByCategory('drugo').length,
      },
    });

  } catch (err) {
    logger.error("/api/monitors/from-template", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
