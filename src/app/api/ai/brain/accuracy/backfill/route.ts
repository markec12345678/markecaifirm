// v8.25 / v8.95.2-small-batch: Manual backfill trigger — POST calls backfillSnapshotAccuracy().
//
// For testing/debugging — same as /api/cron/backfill-accuracy but WITHOUT auth
// (it's under /api/ai/... which is the user-facing API surface). The cron
// endpoint requires MONITOR_CRON_KEY; this one doesn't (manual trigger from UI).
//
// POST /api/ai/brain/accuracy/backfill
// GET  /api/ai/brain/accuracy/backfill  (alias — same handler)
// → { ok, backfilled30d, backfilled90d, totalSnapshots }
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-small-batch) + enforceBudget
// guard. SHARED handler za GET in POST (obe metodi kličeta isto logiko —
// match-a brain/actual-profit vzorec z method: 'GET' bypass POST-only check).
// DETERMINISTIC — endpoint ne kliče AI direktno; enforceBudget: true je
// non-breaking (konsistentno z vsemi v8.94.x migracijami).

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { backfillSnapshotAccuracy } from '@/lib/brain/snapshots';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrainAccuracyBackfillInput {}

const backfillHandler = withAiRoute<BrainAccuracyBackfillInput>({
  endpoint: '/api/ai/brain/accuracy/backfill',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2: budget guard + avtomatski recordAiCall
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  // GET + POST — brez telesa; parseBody vrne prazen objekt
  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    ctx.logger.info('/api/ai/brain/accuracy/backfill', 'manual backfill trigger');

    const result = await backfillSnapshotAccuracy();

    ctx.logger.info('/api/ai/brain/accuracy/backfill', 'backfill complete', {
      totalSnapshots: result.totalSnapshots,
      backfilled30d: result.backfilled30d,
      backfilled90d: result.backfilled90d,
    });

    return apiOk(result);
  },
});

export const GET = backfillHandler;
export const POST = backfillHandler;
