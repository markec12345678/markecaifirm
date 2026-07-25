// v4.9: Profiles API — CRUD operations for profiles + active profile switching
// GET /api/profiles — list all profiles + active profile ID
// POST /api/profiles — create new profile (body: { name, description?, icon?, color? })
// PATCH /api/profiles — set active profile (body: { activeProfileId: string | null })
// PATCH /api/profiles/[id] — update profile
// DELETE /api/profiles/[id] — delete profile (sets profileId=null on related records)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: List all profiles + active profile ID + counts
export async function GET() {
  const settings = await db.settings.findFirst({ where: { id: 'singleton' } });
  const activeProfileId = settings?.activeProfileId ?? null;

  const profiles = await db.profile.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: { monitors: true, trades: true },
      },
    },
  });

  return NextResponse.json({
    profiles: profiles.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      color: p.color,
      createdAt: p.createdAt,
      monitorsCount: p._count.monitors,
      tradesCount: p._count.trades,
    })),
    activeProfileId,
  });
}

// POST: Create new profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, icon, color } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Ime profila je obvezno' }, { status: 400 });
    }

    const profile = await db.profile.create({
      data: {
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        icon: typeof icon === 'string' && icon.trim() ? icon.trim() : '📁',
        color: typeof color === 'string' && color.trim() ? color.trim() : 'primary',
      },
    });

    return NextResponse.json({ ok: true, profile });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka pri ustvarjanju profila' }, { status: 500 });
  }
}

// PATCH: Set active profile
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { activeProfileId } = body;

    // null is valid (means "show all data")
    if (activeProfileId !== null && typeof activeProfileId !== 'string') {
      return NextResponse.json({ error: 'activeProfileId mora biti string ali null' }, { status: 400 });
    }

    // If setting to a specific profile, verify it exists
    if (activeProfileId) {
      const profile = await db.profile.findUnique({ where: { id: activeProfileId } });
      if (!profile) {
        return NextResponse.json({ error: 'Profile ne obstaja' }, { status: 404 });
      }
    }

    await db.settings.upsert({
      where: { id: 'singleton' },
      update: { activeProfileId },
      create: { id: 'singleton', activeProfileId },
    });

    return NextResponse.json({ ok: true, activeProfileId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
