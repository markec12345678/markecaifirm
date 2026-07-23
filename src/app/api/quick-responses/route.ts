import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quick-responses
 * Returns saved quick response templates.
 */
export async function GET() {
  const settings = await getSettingsRow();
  let templates: Array<{ name: string; text: string }> = [];
  try {
    templates = JSON.parse(settings.quickResponseTemplates || '[]');
  } catch { /* ignore */ }
  return NextResponse.json({ templates });
}

/**
 * POST /api/quick-responses
 * Save all templates (replace).
 * Body: { templates: [{ name, text }, ...] }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!Array.isArray(body?.templates)) {
    return NextResponse.json({ error: 'Manjkajo templates' }, { status: 400 });
  }
  // Validate
  const valid = body.templates
    .filter((t: any) => t && typeof t.name === 'string' && typeof t.text === 'string')
    .slice(0, 50); // max 50 templates
  await db.settings.update({
    where: { id: 'singleton' },
    data: { quickResponseTemplates: JSON.stringify(valid) },
  });
  return NextResponse.json({ ok: true, count: valid.length });
}
