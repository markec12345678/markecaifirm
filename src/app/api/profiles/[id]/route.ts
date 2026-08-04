// v4.9: Profile by ID — update or delete
// PATCH /api/profiles/:id — update profile (name, description, icon, color)
// DELETE /api/profiles/:id — delete profile (sets profileId=null on related monitors/trades)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const profile = await db.profile.findUnique({ where: { id } });
    if (!profile) {
      return NextResponse.json({ error: 'Profile ne obstaja' }, { status: 404 });
    }

    const data: any = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.description === 'string') data.description = body.description.trim();
    if (typeof body.icon === 'string' && body.icon.trim()) data.icon = body.icon.trim();
    if (typeof body.color === 'string' && body.color.trim()) data.color = body.color.trim();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Ni polj za posodobitev' }, { status: 400 });
    }

    const updated = await db.profile.update({ where: { id }, data });
    return NextResponse.json({ ok: true, profile: updated });

  } catch (err) {
    logger.error("/api/profiles/[id]", "PATCH handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const profile = await db.profile.findUnique({ where: { id } });
    if (!profile) {
      return NextResponse.json({ error: 'Profile ne obstaja' }, { status: 404 });
    }

    // Check if this is the active profile — if so, unset it
    const settings = await db.settings.findFirst({ where: { id: 'singleton' } });
    if (settings?.activeProfileId === id) {
      await db.settings.update({
        where: { id: 'singleton' },
        data: { activeProfileId: null },
      });
    }

    // Delete profile — monitors and trades will have profileId set to null (onDelete: SetNull)
    await db.profile.delete({ where: { id } });

    return NextResponse.json({ ok: true });

  } catch (err) {
    logger.error("/api/profiles/[id]", "DELETE handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
