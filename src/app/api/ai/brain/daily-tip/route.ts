// v8.52 / v8.94.9-c-refactor: Daily AI Tip API — GET returns today's tip
// without sending. POST sends it (Notification Center + Telegram).
// Refaktoriran z withAiRoute helperjem (v8.94.9-c) + enforceBudget guard.
//
// GET  /api/ai/brain/daily-tip  — vrne današnji tip (brez pošiljanja)
// POST /api/ai/brain/daily-tip  — pošlje tip (Notification Center + Telegram)
//
// Opomba: poslovna logika živi v src/lib/brain/daily-tip.ts (deljena z
// /api/cron/daily-ai-tip cron job-om). Route je tanek delegat — brez AI
// klica direktno v handler-ju (heuristic-only). enforceBudget: true po
// konsenzu vseh v8.94.x migracij (recordAiCall je additive, ne breaking).

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { generateDailyTip, sendDailyTip } from '@/lib/brain/daily-tip';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 15;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DailyTipInput {}

export const GET = withAiRoute<DailyTipInput>({
  endpoint: '/api/ai/brain/daily-tip',
  maxDuration: 15,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall
  method: 'GET',
  parseBody: async () => ({}),
  // Brez validateInput — GET brez input polj
  handler: async (_input, _ctx: AiRouteContext) => {
    const tip = await generateDailyTip();
    return apiOk(tip);
  },
});

export const POST = withAiRoute<DailyTipInput>({
  endpoint: '/api/ai/brain/daily-tip',
  maxDuration: 15,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall
  method: 'POST',
  parseBody: async () => ({}),
  // Brez validateInput — POST brez input polj
  handler: async (_input, _ctx: AiRouteContext) => {
    const result = await sendDailyTip();
    return apiOk(result);
  },
});
