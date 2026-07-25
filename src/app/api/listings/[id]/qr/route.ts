// v4.4: QR code for sharing a listing — generated locally, no external API.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import QRCode from 'qrcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await db.listing.findUnique({ where: { id }, select: { url: true, title: true } });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }

  const url = new URL(req.url);
  const size = Math.min(1024, Math.max(64, parseInt(url.searchParams.get('size') ?? '256', 10) || 256));

  try {
    const pngBuffer = await QRCode.toBuffer(listing.url, {
      type: 'png',
      margin: 1,
      width: size,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=86400',
        'X-Listing-Title': encodeURIComponent(listing.title.slice(0, 100)),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'QR generation failed' }, { status: 500 });
  }
}
