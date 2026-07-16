#!/bin/sh
# Runs on every backend container start in the docker-compose demo stack:
#   1. Applies committed migrations (idempotent — `prisma migrate deploy`
#      only applies migrations not yet recorded in `_prisma_migrations`).
#   2. Seeds the single admin user (idempotent — prisma/seed.ts skips if the
#      seed email already exists; see that file for the printed-once
#      password behavior).
#   3. Execs the real CMD (node dist/main.js), so it becomes PID 1 and
#      receives signals correctly (`docker compose stop` / restart).
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] Seeding admin user (no-op if already seeded)..."
npx prisma db seed || echo "[entrypoint] Seed step reported an error — check SEED_ADMIN_PASSWORD policy requirements above if you set one."

echo "[entrypoint] Starting Content Hub backend..."
exec "$@"
