-- Run after migration on the remote Postgres/Supabase database.

-- Expected public tables created by Prisma.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Exposed public tables without RLS.
-- For this MVP, Prisma/NestJS is the trusted data access layer.
-- If Supabase REST/PostgREST is exposed directly to browser users, enable RLS and add tenant policies before release.
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND c.relrowsecurity = false
ORDER BY 1, 2;

-- Dangerous browser-role grants for Prisma tables.
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, table_name, privilege_type;

-- Current role and RLS bypass status.
SELECT current_user, session_user;
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;

-- Prisma migration status table.
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at;
