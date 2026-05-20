#!/usr/bin/env sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"

docker compose \
  --env-file "$ENV_FILE" \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  run --rm api \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
