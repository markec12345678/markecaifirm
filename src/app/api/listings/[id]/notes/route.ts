import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/listings/:id/notes
 * Body: { notes?, contactStatus?, sellerResponse? }
 * Updates personal notes and/or contact tracking for a listing.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: any = {};
  if (typeof body.notes === 'string') {
    data.userNotes = body.notes;
    data.userNotesUpdatedAt = new Date();
  }
  if (typeof body.contactStatus === 'string') {
    const valid = ['none', 'contacted', 'responded', 'closed'];
    if (!valid.includes(body.contactStatus)) {
      return NextResponse.json({ error: `Neveljaven contactStatus` }, { status: 400 });
    }
    data.contactStatus = body.contactStatus;
    if (body.contactStatus === 'contacted' && !body.contactedAt) {
      data.contactedAt = new Date();
    }
  }
  if (typeof body.contactedAt === 'string') {
    data.contactedAt = new Date(body.contactedAt);
  }
  if (typeof body.sellerResponse === 'string') {
    data.sellerResponse = body.sellerResponse;
  }

  const updated = await db.listing.update({ where: { id }, data });
  return NextResponse.json({
    ok: true,
    userNotes: updated.userNotes,
    userNotesUpdatedAt: updated.userNotesUpdatedAt,
    contactStatus: updated.contactStatus,
    contactedAt: updated.contactedAt,
    sellerResponse: updated.sellerResponse,
  });
}
