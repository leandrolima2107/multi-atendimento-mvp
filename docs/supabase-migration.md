# Supabase/Postgres Migration Runbook

## Status

This project is Prisma/NestJS-first. Supabase can host the Postgres database, while application access remains server-side through the API.

## Required Secrets

Create `.env.supabase.local` from `.env.supabase.example` and replace `[YOUR-PASSWORD]`:

```powershell
Copy-Item .env.supabase.example .env.supabase.local
```

Never commit `.env.supabase.local`.

## Self-Hosted Supabase

For self-hosted Supabase, the Postgres port should usually stay private. Run migrations from the VPS, inside the Supabase Docker network, instead of exposing `5432` publicly.

Copy or pull this repository on the VPS and run:

```sh
chmod +x scripts/migrate-supabase-selfhost.sh
DB_PASSWORD='REAL_PASSWORD' sh scripts/migrate-supabase-selfhost.sh
```

If auto-detection does not find the Supabase database container/network:

```sh
DB_CONTAINER='supabase-db' \
DOCKER_NETWORK='supabase_default' \
DB_HOST='db' \
DB_PASSWORD='REAL_PASSWORD' \
sh scripts/migrate-supabase-selfhost.sh
```

Use `RUN_SEED=true` only on staging/dev. Do not seed production with the demo users.

## Direct Remote Postgres

Use this only if Postgres is intentionally reachable from your machine.

```powershell
Test-NetConnection -ComputerName 161.97.113.95 -Port 5432
```

If `TcpTestSucceeded` is `False`, keep the database private and use the self-hosted VPS path above.

## Migrate

```powershell
powershell -ExecutionPolicy Bypass -File scripts/migrate-supabase.ps1
```

Use `-Seed -AllowDevSeed` only in a disposable staging database. The default seed creates development users and must not be used as a production bootstrap.

## Verify

```powershell
npx prisma migrate status --schema packages/db/prisma/schema.prisma
```

Run `scripts/supabase-verify.sql` in psql or the Supabase SQL editor.

Review `scripts/supabase-hardening.sql` before exposing any table through Supabase REST/PostgREST.

## RLS Note

Do not expose Prisma tables directly to browser users through Supabase REST until RLS policies are designed and tested. The current MVP enforces tenant isolation in the NestJS API.

If the runtime uses Supabase only as managed Postgres, prefer a dedicated database role for the API instead of `postgres`.
