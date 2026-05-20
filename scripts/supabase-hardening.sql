-- Optional hardening for Supabase/Postgres after the Prisma migration.
-- Review placeholders before running. Do not paste weak passwords here.

-- 1. Revoke direct browser roles from Prisma-owned tables.
-- Keep this when the NestJS API is the only data access path.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 2. Optional: create a dedicated application role instead of using postgres.
-- Replace the password first, then use this role in API_DATABASE_URL/DATABASE_URL.
-- CREATE ROLE app_prisma LOGIN PASSWORD 'REPLACE_WITH_LONG_RANDOM_PASSWORD' NOINHERIT;
-- GRANT USAGE ON SCHEMA public TO app_prisma;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_prisma;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_prisma;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_prisma;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   GRANT USAGE, SELECT ON SEQUENCES TO app_prisma;

-- 3. RLS should be designed and tested before exposing tables through Supabase REST.
-- Do not enable this blindly while the application still connects as postgres.
-- ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
