import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// v7.32: Prisma logging only in dev — 'query' level dumps SQL with parameter
// values, which is a security/privacy concern in production.
const logLevel = process.env.NODE_ENV === 'production'
  ? ['error', 'warn']
  : ['query', 'error', 'warn']

// v8.23: Detect schema-mismatch in the cached dev-mode PrismaClient singleton.
// Next.js dev server hot-reloads source files but `globalThis.prisma` persists
// across reloads. When the Prisma schema is extended (e.g. v8.23 added
// BrainSnapshot model) and `prisma generate` runs, the cached PrismaClient
// instance still points at the OLD generated client (without the new model's
// accessor). We detect this by probing for the latest model accessor and
// discarding the stale cache, forcing a fresh instantiation that picks up the
// newly-generated @prisma/client. In production this branch never runs (the
// cached client is always in sync because schema is baked at build time).
const cachedPrisma = globalForPrisma.prisma
if (
  cachedPrisma &&
  typeof (cachedPrisma as unknown as { brainSnapshot?: unknown }).brainSnapshot === 'undefined'
) {
  // Stale client from before v8.23 — discard so a fresh one is created below.
  globalForPrisma.prisma = undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevel as any,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
