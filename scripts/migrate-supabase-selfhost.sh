#!/usr/bin/env sh
set -eu

# Run this on the VPS that hosts Supabase self-hosted.
# It runs Prisma migrate from a temporary Node container inside the same Docker
# network as the Supabase Postgres container, so port 5432 does not need to be public.

DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_CONTAINER="${DB_CONTAINER:-}"
DOCKER_NETWORK="${DOCKER_NETWORK:-}"
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"
RUN_SEED="${RUN_SEED:-false}"

if [ -z "$DB_PASSWORD" ]; then
  echo "DB_PASSWORD is required." >&2
  exit 1
fi

if [ -z "$DB_CONTAINER" ]; then
  DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '(^|[-_])(supabase-)?db($|[-_])|postgres' | head -n 1 || true)"
fi

if [ -z "$DB_CONTAINER" ]; then
  echo "Could not find Supabase/Postgres container. Set DB_CONTAINER." >&2
  exit 1
fi

if [ -z "$DOCKER_NETWORK" ]; then
  DOCKER_NETWORK="$(docker inspect "$DB_CONTAINER" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | head -n 1)"
fi

if [ -z "$DOCKER_NETWORK" ]; then
  echo "Could not detect Docker network for $DB_CONTAINER. Set DOCKER_NETWORK." >&2
  exit 1
fi

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"

docker run --rm \
  --network "$DOCKER_NETWORK" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e DIRECT_URL="$DATABASE_URL" \
  -v "$PWD:/app" \
  -w /app \
  "$NODE_IMAGE" \
  sh -lc '
    set -eu
    npm ci --workspaces --include-workspace-root
    npm run db:generate
    npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
    npx prisma migrate status --schema packages/db/prisma/schema.prisma
    if [ "${RUN_SEED:-false}" = "true" ]; then
      echo "RUN_SEED=true was set. Seeding is intended only for staging/dev."
      npm run db:seed
    fi
  '
