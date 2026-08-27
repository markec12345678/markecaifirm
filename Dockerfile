# =============================================================================
# Markec AI Firm — Production Dockerfile
# =============================================================================
# Multi-stage build za minimalno image velikost:
#   1. deps:      install dependencies
#   2. builder:   build Next.js standalone
#   3. runner:    minimal runtime image
#
# Build:   docker build -t markec-ai-firm:v9.82.1 .
# Run:     docker run -p 3000:3000 -v markec-db:/app/db markec-ai-firm:v9.82.1
# =============================================================================

# --- Stage 1: deps -----------------------------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy lockfile + package.json za caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- Stage 2: builder --------------------------------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:./db/custom.db"
RUN bun run build

# --- Stage 3: runner ---------------------------------------------------------
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:./db/custom.db"
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user za varnost
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build artifacts
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Create db directory z pravimi pravicami
RUN mkdir -p /app/db && chown -R nextjs:nodejs /app/db

# Volume za persistent database
VOLUME ["/app/db"]

USER nextjs

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["bun", "server.js"]
