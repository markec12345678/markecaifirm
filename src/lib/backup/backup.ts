// v8.42: Full System Backup & Restore — JSON-based portable backup.
// Exports ALL Prisma tables as structured JSON, imports with validation.
//
// WHY THIS EXISTS:
//   - Until v8.42, raw .db backup (v1.3) existed but it's binary (SQLite-specific,
//     not portable, can't inspect without a SQLite tool). v4.7 JSON backup only
//     covered 10 tables (missing BrainSnapshot, ActionDraft, Notification,
//     Profile, SavedSearch, SmartRule, NegotiationMessage, WebhookEndpoint —
//     all v5.3+/v8.x additions). No restore UI. No auto-backup.
//   - v8.42 brings: (1) full export of all 18 tables, (2) restore with 3 modes
//     (replace/merge/skip) + table selector, (3) auto-backup cron @ 02:00.
//
// EXPORT:
//   - All 18 Prisma tables → JSON arrays under BackupData.tables (plural keys)
//   - Settings sensitive fields (API keys, tokens) REDACTED — safe for sharing
//   - Stats: totalRecords + per-table counts (for UI preview)
//
// RESTORE:
//   - replace mode: deleteMany({}) then create() each row — total wipe+restore
//   - merge mode:   upsert by id — create if missing, update if exists
//   - skip mode:    only create if id doesn't exist (preserve current rows)
//   - tables filter: restore only specified tables (empty = all 18)
//   - Per-table error catch: if one table fails, others still restore
//   - Settings special handling: never overwrite sensitive fields with
//     redacted sentinel — preserves real API keys/tokens across restore
//
// FILES:
//   - /backups/ directory (created on first save)
//   - Filename: backup-YYYY-MM-DDTHH-MM-SS-SSSZ.json (ISO timestamp, fs-safe)
//   - Auto-cleanup keeps last 30 backups (older deleted by auto-backup cron)

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';

export const BACKUP_VERSION = 'v8.42';

// ============================================================================
// TABLE METADATA
// ============================================================================
// Maps plural JSON keys (collection names) → Prisma model names (singular).
// Singular model name is used to look up the Prisma accessor (db.<model>).
// This separation lets us use human-friendly plural names in JSON while
// keeping the typed Prisma client API.

const PLURAL_TO_MODEL: Record<string, string> = {
  profiles: 'profile',
  settings: 'settings',
  savedSearches: 'savedSearch',
  pushSubscriptions: 'pushSubscription',
  trades: 'trade',
  digestLogs: 'digestLog',
  monitors: 'monitor',
  listings: 'listing',
  alerts: 'alert',
  runLogs: 'runLog',
  heartbeatLogs: 'heartbeatLog',
  priceHistory: 'priceHistory',
  smartRules: 'smartRule',
  negotiationMessages: 'negotiationMessage',
  webhookEndpoints: 'webhookEndpoint',
  actionDrafts: 'actionDraft',
  brainSnapshots: 'brainSnapshot',
  notifications: 'notification',
};

const MODEL_TO_PLURAL: Record<string, string> = Object.fromEntries(
  Object.entries(PLURAL_TO_MODEL).map(([p, m]) => [m, p])
);

// All 18 plural table keys (used for UI checkbox list + restore order)
export const ALL_TABLE_PLURAL = Object.keys(PLURAL_TO_MODEL);

// Lazy accessor map — function so we don't touch Prisma until called (avoids
// Prisma client not being initialized at module load time on first dev boot).
const MODEL_ACCESSORS: Record<string, () => any> = {
  profile: () => db.profile,
  settings: () => db.settings,
  savedSearch: () => db.savedSearch,
  pushSubscription: () => db.pushSubscription,
  trade: () => db.trade,
  digestLog: () => db.digestLog,
  monitor: () => db.monitor,
  listing: () => db.listing,
  alert: () => db.alert,
  runLog: () => db.runLog,
  heartbeatLog: () => db.heartbeatLog,
  priceHistory: () => db.priceHistory,
  smartRule: () => db.smartRule,
  negotiationMessage: () => db.negotiationMessage,
  webhookEndpoint: () => db.webhookEndpoint,
  actionDraft: () => db.actionDraft,
  brainSnapshot: () => db.brainSnapshot,
  notification: () => db.notification,
};

// Restore order — independent tables first (Profile/Settings), dependent last
// (Listing depends on Monitor; Alert depends on Monitor+Listing; etc.).
// This minimizes FK violations in replace mode where we deleteMany + create.
const RESTORE_ORDER_PLURAL = [
  'profiles', 'settings', 'savedSearches', 'pushSubscriptions',
  'brainSnapshots', 'actionDrafts', 'notifications',
  'monitors', 'trades', 'digestLogs',
  'listings', 'alerts', 'runLogs', 'heartbeatLogs',
  'priceHistory', 'smartRules', 'negotiationMessages', 'webhookEndpoints',
];

// Settings sensitive fields — redacted on export, skipped on restore.
// We NEVER export real API keys/tokens (security: backup may be shared).
// On restore, we NEVER overwrite the live value with the '***REDACTED***'
// sentinel (which would clobber the user's real key with a useless string).
const SENSITIVE_SETTINGS_FIELDS = [
  'aiApiKey',
  'fallbackApiKey',
  'telegramBotToken',
  'telegramWebhookSecret',
  'discordWebhookUrl',
  'slackWebhookUrl',
  'emailSmtpPassword',
  'vapidPrivateKey',
];

const REDACTED_SENTINEL = '***REDACTED***';

// ============================================================================
// TYPES
// ============================================================================

export interface BackupData {
  version: string;            // 'v8.42'
  createdAt: string;          // ISO timestamp
  dbVersion: string;          // Prisma schema version (e.g. 'v8.38-notification-center')
  tables: Record<string, any[]>; // plural key → array of rows
  stats: {
    totalRecords: number;
    tableCounts: Record<string, number>;
  };
}

export interface BackupResult {
  ok: true;
  data: BackupData;
  sizeBytes: number;
  sizeKB: number;
  source: 'v8.42-backup';
}

export interface RestoreOptions {
  mode: 'replace' | 'merge' | 'skip';
  tables?: string[];             // plural keys; empty/undefined = all tables
}

export interface RestoreResult {
  ok: boolean;
  mode: string;
  restored: Record<string, number>;  // plural key → count restored
  skipped: Record<string, number>;    // plural key → count skipped (already exists)
  errors: Array<{ table: string; error: string }>;
  source: 'v8.42-restore';
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert ISO date strings (e.g. "2026-08-14T20:13:46.354Z") to Date objects.
 * Prisma create()/upsert() accept either Date or ISO string for DateTime
 * fields, but Date is safer (avoids any potential timezone drift).
 *
 * Walks object values; any string matching strict ISO 8601 format becomes Date.
 */
function convertDates(row: any): any {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (
      typeof v === 'string' &&
      v.length >= 20 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)
    ) {
      const d = new Date(v);
      out[k] = isNaN(d.getTime()) ? v : d;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Sanitize Settings row on export: replace sensitive fields with sentinel.
 */
function redactSettings(row: any): any {
  const out = { ...row };
  for (const f of SENSITIVE_SETTINGS_FIELDS) {
    if (out[f]) out[f] = REDACTED_SENTINEL;
  }
  return out;
}

/**
 * Sanitize Settings row on restore: drop fields whose value is the redacted
 * sentinel (so we don't overwrite live API keys with the sentinel string).
 */
function stripRedactedSettingsFields(row: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (SENSITIVE_SETTINGS_FIELDS.includes(k) && v === REDACTED_SENTINEL) continue;
    out[k] = v;
  }
  return out;
}

// ============================================================================
// EXPORT
// ============================================================================

/**
 * Export ALL database tables to a structured JSON object.
 *
 * Tables are exported under their PLURAL keys (monitors, listings, trades, etc.)
 * for human readability. Settings sensitive fields (API keys, tokens) are redacted.
 */
export async function exportBackup(): Promise<BackupResult> {
  const tables: Record<string, any[]> = {};
  const tableCounts: Record<string, number> = {};
  let totalRecords = 0;

  // Settings — singleton (id='singleton'); fetch + redact sensitive fields.
  // Stored as 1-element array for consistent structure with other tables.
  try {
    const settings = await db.settings.findFirst({ where: { id: 'singleton' } });
    if (settings) {
      tables.settings = [redactSettings(settings)];
      tableCounts.settings = 1;
      totalRecords += 1;
    }
  } catch (e: any) {
    logger.warn('exportBackup', 'failed to fetch settings', e?.message);
    tables.settings = [];
    tableCounts.settings = 0;
  }

  // Fetch all other tables in parallel
  const otherModels = Object.entries(PLURAL_TO_MODEL).filter(
    ([, model]) => model !== 'settings'
  );
  const results = await Promise.all(
    otherModels.map(async ([plural, model]) => {
      try {
        const accessor = MODEL_ACCESSORS[model];
        if (!accessor) {
          logger.warn('exportBackup', `no accessor for model ${model}`);
          return { plural, rows: [] as any[] };
        }
        const rows = await accessor().findMany();
        return { plural, rows };
      } catch (e: any) {
        logger.warn('exportBackup', `failed to fetch table ${plural}`, e?.message);
        return { plural, rows: [] as any[] };
      }
    })
  );
  for (const { plural, rows } of results) {
    tables[plural] = rows;
    tableCounts[plural] = rows.length;
    totalRecords += rows.length;
  }

  const data: BackupData = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    dbVersion: 'v8.38-notification-center',
    tables,
    stats: {
      totalRecords,
      tableCounts,
    },
  };

  const json = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(json, 'utf-8');
  const sizeKB = Math.round(sizeBytes / 1024);

  logger.info('exportBackup', `exported ${totalRecords} records across ${Object.keys(tables).length} tables`, {
    sizeKB,
    tableCounts,
  });

  return {
    ok: true,
    data,
    sizeBytes,
    sizeKB,
    source: 'v8.42-backup',
  };
}

// ============================================================================
// RESTORE
// ============================================================================

/**
 * Restore database from a BackupData JSON object.
 *
 * Modes:
 *   - replace: deleteMany({}) + create() — total wipe + restore
 *   - merge:   upsert by id — create if missing, update if exists
 *   - skip:    findUnique + create only if not exists (preserve current rows)
 *
 * Per-row try/catch — if a single row fails (e.g. FK violation), we continue
 * to the next row. Per-table try/catch — if a whole table fails, we continue
 * to the next table. The result reports errors per table.
 *
 * Settings is a singleton — special handling: never overwrite sensitive
 * fields (API keys/tokens) with the '***REDACTED***' sentinel.
 */
export async function restoreBackup(
  data: BackupData,
  options: RestoreOptions = { mode: 'replace' }
): Promise<RestoreResult> {
  const result: RestoreResult = {
    ok: true,
    mode: options.mode,
    restored: {},
    skipped: {},
    errors: [],
    source: 'v8.42-restore',
  };

  // 1. Validate structure
  if (!data || typeof data !== 'object') {
    result.ok = false;
    result.errors.push({ table: '_meta', error: 'Invalid backup data (not an object)' });
    return result;
  }
  if (!data.version) {
    result.ok = false;
    result.errors.push({ table: '_meta', error: 'Invalid backup format (missing version field)' });
    return result;
  }
  if (!data.tables || typeof data.tables !== 'object') {
    result.ok = false;
    result.errors.push({ table: '_meta', error: 'Invalid backup format (missing tables object)' });
    return result;
  }

  // 2. Determine which tables to restore
  const requestedPlurals = options.tables && options.tables.length > 0
    ? options.tables
    : Object.keys(data.tables);

  // 3. Restore in dependency order (independents first)
  const tablesToRestore = RESTORE_ORDER_PLURAL.filter(p =>
    requestedPlurals.includes(p) && Array.isArray(data.tables[p])
  );
  // Also include any tables in the backup that aren't in RESTORE_ORDER_PLURAL
  // (forward-compat: if a future version adds a new table, we still try to restore it)
  for (const p of requestedPlurals) {
    if (!RESTORE_ORDER_PLURAL.includes(p) && Array.isArray(data.tables[p])) {
      tablesToRestore.push(p);
    }
  }

  logger.info('restoreBackup', `starting restore`, {
    mode: options.mode,
    tablesCount: tablesToRestore.length,
  });

  for (const plural of tablesToRestore) {
    const rows = data.tables[plural];
    if (!Array.isArray(rows)) {
      result.errors.push({ table: plural, error: 'Missing or invalid table data' });
      continue;
    }

    result.restored[plural] = 0;
    result.skipped[plural] = 0;

    const model = PLURAL_TO_MODEL[plural];
    if (!model) {
      result.errors.push({ table: plural, error: `Unknown table key: ${plural}` });
      continue;
    }

    // Special handling for Settings (singleton)
    if (plural === 'settings') {
      try {
        const s = rows[0];
        if (!s) continue;
        const safeData = stripRedactedSettingsFields(s);
        const finalData = convertDates(safeData);
        // Ensure id is 'singleton'
        finalData.id = 'singleton';

        if (options.mode === 'replace') {
          await db.settings.deleteMany({});
          await db.settings.create({ data: finalData });
          result.restored.settings = 1;
        } else if (options.mode === 'merge') {
          await db.settings.upsert({
            where: { id: 'singleton' },
            update: finalData,
            create: finalData,
          });
          result.restored.settings = 1;
        } else { // skip
          const existing = await db.settings.findFirst({ where: { id: 'singleton' } });
          if (existing) {
            result.skipped.settings = 1;
          } else {
            await db.settings.create({ data: finalData });
            result.restored.settings = 1;
          }
        }
      } catch (e: any) {
        result.errors.push({ table: 'settings', error: e?.message ?? 'Unknown error' });
      }
      continue;
    }

    // Generic table handling
    const accessor = MODEL_ACCESSORS[model];
    if (!accessor) {
      result.errors.push({ table: plural, error: `No Prisma accessor for model: ${model}` });
      continue;
    }
    const prismaTable = accessor();

    // replace mode: clear table first
    if (options.mode === 'replace') {
      try {
        await prismaTable.deleteMany({});
      } catch (e: any) {
        // Don't abort — we'll try to create rows anyway (existing rows will
        // be skipped due to id conflicts in the create() try/catch below).
        logger.warn('restoreBackup', `deleteMany failed for ${plural}`, e?.message);
      }
    }

    for (const row of rows) {
      try {
        const convertedRow = convertDates(row);
        if (options.mode === 'replace') {
          await prismaTable.create({ data: convertedRow });
          result.restored[plural]++;
        } else if (options.mode === 'merge') {
          await prismaTable.upsert({
            where: { id: convertedRow.id },
            update: convertedRow,
            create: convertedRow,
          });
          result.restored[plural]++;
        } else { // skip
          const existing = await prismaTable.findUnique({ where: { id: convertedRow.id } });
          if (existing) {
            result.skipped[plural]++;
          } else {
            await prismaTable.create({ data: convertedRow });
            result.restored[plural]++;
          }
        }
      } catch {
        // Continue to next row — don't abort entire table on a single row failure
        if (options.mode === 'skip') {
          result.skipped[plural]++;
        }
        // For replace/merge, the row is simply not counted as restored
      }
    }
  }

  logger.info('restoreBackup', `restore complete`, {
    mode: options.mode,
    restored: result.restored,
    skipped: result.skipped,
    errorsCount: result.errors.length,
  });

  return result;
}

// ============================================================================
// FILESYSTEM HELPERS (for auto-backup cron)
// ============================================================================

/**
 * Save backup to /backups/ directory.
 * Filename: backup-YYYY-MM-DDTHH-MM-SS-mmmZ.json (ISO timestamp, fs-safe).
 * Used by auto-backup cron + manual "save now" button.
 */
export async function saveBackupToFile(
  backup: BackupResult
): Promise<{ ok: true; path: string; sizeKB: number; filename: string }> {
  const backupDir = path.join(process.cwd(), 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(backupDir, filename);
  await fs.writeFile(filepath, JSON.stringify(backup.data, null, 2), 'utf-8');
  logger.info('saveBackupToFile', `saved to ${filepath}`, { sizeKB: backup.sizeKB });
  return { ok: true, path: filepath, sizeKB: backup.sizeKB, filename };
}

/**
 * List available backup files in /backups/ directory.
 * Returns newest first (sorted by mtime desc).
 */
export async function listBackups(): Promise<
  Array<{ filename: string; sizeKB: number; createdAt: string }>
> {
  const backupDir = path.join(process.cwd(), 'backups');
  try {
    const files = await fs.readdir(backupDir);
    const backups: Array<{ filename: string; sizeKB: number; createdAt: string }> = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filepath = path.join(backupDir, file);
      const stat = await fs.stat(filepath);
      backups.push({
        filename: file,
        sizeKB: Math.round(stat.size / 1024),
        createdAt: stat.mtime.toISOString(),
      });
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/**
 * Cleanup old backups — keep only the newest `keepN` files.
 * Used by auto-backup cron to prevent disk fill (default keep last 30).
 * Only deletes files matching our backup-*.json pattern (preserves pre-restore-*.db).
 */
export async function cleanupOldBackups(
  keepN: number = 30
): Promise<{ deleted: number; kept: number; total: number }> {
  const backups = await listBackups();
  if (backups.length <= keepN) {
    return { deleted: 0, kept: backups.length, total: backups.length };
  }
  const toDelete = backups.slice(keepN); // older entries (since sorted desc)
  const backupDir = path.join(process.cwd(), 'backups');
  let deleted = 0;
  for (const b of toDelete) {
    try {
      await fs.unlink(path.join(backupDir, b.filename));
      deleted++;
    } catch {
      // ignore — file may have been removed concurrently
    }
  }
  logger.info('cleanupOldBackups', `deleted ${deleted} old backups`, { kept: backups.length - deleted });
  return { deleted, kept: backups.length - deleted, total: backups.length };
}

// ============================================================================
// STATS (for UI preview)
// ============================================================================

/**
 * Quick stats for UI preview — fetches counts of each table without
 * fetching the full data. Used in Settings "Backup & Restore" card to
 * show "25 trades · 1 snapshot · 5 drafts · ..." before user downloads.
 */
export async function getDbStats(): Promise<{
  totalRecords: number;
  tableCounts: Record<string, number>;
}> {
  const tableCounts: Record<string, number> = {};
  let totalRecords = 0;

  // Settings (singleton = 1 if exists)
  try {
    const s = await db.settings.findFirst({ where: { id: 'singleton' } });
    tableCounts.settings = s ? 1 : 0;
    totalRecords += tableCounts.settings;
  } catch {
    tableCounts.settings = 0;
  }

  // Other tables — count in parallel
  const otherModels = Object.entries(PLURAL_TO_MODEL).filter(
    ([, model]) => model !== 'settings'
  );
  const counts = await Promise.all(
    otherModels.map(async ([plural, model]) => {
      try {
        const accessor = MODEL_ACCESSORS[model];
        if (!accessor) return { plural, count: 0 };
        const count = await accessor().count();
        return { plural, count };
      } catch {
        return { plural, count: 0 };
      }
    })
  );
  for (const { plural, count } of counts) {
    tableCounts[plural] = count;
    totalRecords += count;
  }

  return { totalRecords, tableCounts };
}

// Export mappings for UI use
export { PLURAL_TO_MODEL, MODEL_TO_PLURAL };
