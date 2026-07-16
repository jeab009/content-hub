# Content Hub backend — NestJS API (demo/local docker-compose deployment)
#
# This is a demo-rollout image (see root README.md "Demo deployment via
# Docker Compose"), not a hardened production build — Phase 1 has no cloud
# infra/registry to push a production image to. It follows the multi-stage
# + non-root pattern described for future production use.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Prisma's engine binaries are dynamically linked against OpenSSL, which
# node:20-alpine doesn't ship — without this, `prisma generate`/`migrate`
# fail with "Could not parse schema engine response" (opaque; not an OpenSSL
# error message on the surface). Confirmed needed by an actual `docker
# compose up` run in this environment, not just from docs.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
RUN addgroup -g 1001 -S nodejs && adduser -S contenthub -u 1001
# NOTE: devDependencies (prisma CLI, ts-node, dotenv-cli) are deliberately
# kept in this image, not pruned to production-only — the entrypoint runs
# `prisma migrate deploy` + `prisma db seed` (which shells out to ts-node)
# on every container start. That's the right tradeoff for a one-command
# local demo stack; a real production image would run migrations as a
# separate release step/job and prune devDependencies here. See the
# Deployment Report for this explicit scope note.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R contenthub:nodejs /app
USER contenthub
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('node:net').connect(4000,'127.0.0.1').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
