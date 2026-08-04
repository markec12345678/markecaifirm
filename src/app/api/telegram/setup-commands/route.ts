// v5.0: Setup Telegram bot commands — register /commands with Telegram
// POST /api/telegram/setup-commands — calls setMyCommands API

import { NextRequest, NextResponse } from 'next/server';
import { getSettingsRow } from '@/lib/pipeline';
import { setupBotCommands, getBotCommandsList } from '@/lib/telegram-bot';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const settings = await getSettingsRow();
    const botToken = body.botToken ?? settings.telegramBotToken;

    if (!botToken) {
      return NextResponse.json({ error: 'Telegram bot token ni nastavljen' }, { status: 400 });
    }

    const result = await setupBotCommands(botToken);
    return NextResponse.json({
      ...result,
      commands: getBotCommandsList(),
    });
  } catch (e: any) {
    logger.error("/api/telegram/setup-commands", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      commands: getBotCommandsList(),
      count: getBotCommandsList().length,
    });

  } catch (err) {
    logger.error("/api/telegram/setup-commands", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
