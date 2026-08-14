import { PrismaClient } from '@prisma/client'

// eslint-disable-next-line no-console
console.log('[db.ts] module loaded at', new Date().toISOString(), 'schemaVersion=v8.30-auto-pilot');

// v7.32: Prisma logging only in dev — 'query' level dumps SQL with parameter
// values, which is a security/privacy concern in production.
const logLevel = process.env.NODE_ENV === 'production'
  ? ['error', 'warn']
  : ['query', 'error', 'warn']

// v8.23 / v8.24: Detect schema-mismatch in the cached dev-mode PrismaClient singleton.
// Next.js dev server hot-reloads source files but `globalThis.prisma` persists
// across reloads. When the Prisma schema is extended (e.g. v8.23 added
// BrainSnapshot model; v8.24 added 4 new Settings fields: userRiskTolerance,
// userMaxAcceptableRisk, userLiquidityReserve, userInvestmentHorizon) and
// `prisma generate` runs, the cached PrismaClient instance still points at the
// OLD generated client (without the new model's accessor / new fields). We
// detect this by comparing a SCHEMA_VERSION marker stored alongside the cached
// client — if it doesn't match the current code's SCHEMA_VERSION, we discard
// the stale cache, forcing a fresh instantiation that picks up the newly-
// generated @prisma/client. In production this branch never runs (the cached
// client is always in sync because schema is baked at build time).
//
// IMPORTANT: bump SCHEMA_VERSION whenever you add/remove Prisma model fields or
// models. The string is arbitrary — just needs to change so the equality check
// fails and the stale client is discarded.
const SCHEMA_VERSION = 'v8.30-auto-pilot' // bumped for v8.30 auto-pilot fields on ActionDraft + Settings

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaSchemaVersion?: string
}

// Discard stale client when schema version doesn't match (covers v8.23
// BrainSnapshot model AND v8.24 Settings fields in one check).
if (globalForPrisma.prisma && globalForPrisma.__prismaSchemaVersion !== SCHEMA_VERSION) {
  // eslint-disable-next-line no-console
  console.log('[db.ts] Discarding stale PrismaClient (schema version mismatch)',
    'old:', globalForPrisma.__prismaSchemaVersion, 'new:', SCHEMA_VERSION);
  globalForPrisma.prisma = undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevel as any,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.__prismaSchemaVersion = SCHEMA_VERSION
}
