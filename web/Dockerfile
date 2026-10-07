# ArchTrace web — multi-stage production image (Zero-Data Retention ready)
# Build context: monorepo root (see docker-compose.yml).
# Next.js 16 requires Node >= 20.9 — node:18-alpine is not supported.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY web/package.json web/package-lock.json ./web/
WORKDIR /app/web
RUN npm ci

# --- Build ---
FROM base AS builder
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY core ./core
COPY web ./web
WORKDIR /app/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# NEXT_PUBLIC_* se inlinan en el bundle en build time
ARG NEXT_PUBLIC_TEACHER_WS_URL=ws://127.0.0.1:8080
ARG NEXT_PUBLIC_PROJECT_ROOT=
ARG NEXT_PUBLIC_EDITOR_SCHEME=
ENV NEXT_PUBLIC_TEACHER_WS_URL=$NEXT_PUBLIC_TEACHER_WS_URL
ENV NEXT_PUBLIC_PROJECT_ROOT=$NEXT_PUBLIC_PROJECT_ROOT
ENV NEXT_PUBLIC_EDITOR_SCHEME=$NEXT_PUBLIC_EDITOR_SCHEME

RUN npm run build

# --- Runner (minimal) ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone + tracing root → layout: /app/web/server.js (+ core trazado)
COPY --from=builder /app/web/public ./web/public
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static

USER nextjs

EXPOSE 3000

# Healthcheck sin dependencias extra (wget de busybox en alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "web/server.js"]
