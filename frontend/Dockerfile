# Content Hub frontend — Next.js (demo/local docker-compose deployment)
#
# NOTE: NEXT_PUBLIC_API_BASE_URL is a build-time value in Next.js (inlined
# into the client JS bundle, not read at container runtime), so it is passed
# as a build ARG. docker-compose.yml passes it as the browser-reachable
# backend URL (http://localhost:4000), NOT the in-network service name
# "backend" — the browser on the host, not another container, is what
# fetches it.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# NOTE: no ./public dir — Phase 1's minimal login/settings UI ships no
# static assets yet. Add "COPY --from=builder /app/public ./public" back
# here if/when the app gains one.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./
USER nextjs
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('node:net').connect(3000,'127.0.0.1').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})"
CMD ["npm", "run", "start"]
