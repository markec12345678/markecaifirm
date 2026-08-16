// v8.63: List all distinct tags (for autocomplete)
import { NextResponse } from 'next/server';
import { getAllTags } from '@/lib/trades/tag-performance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tags = await getAllTags();
    return NextResponse.json({ ok: true, tags });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
