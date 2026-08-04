import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// v7.32: Prisma logging only in dev — 'query' level dumps SQL with parameter
// values, which is a security/privacy concern in production.
const logLevel = process.env.NODE_ENV === 'production'
  ? ['error', 'warn']
  : ['query', 'error', 'warn']

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevel as any,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
