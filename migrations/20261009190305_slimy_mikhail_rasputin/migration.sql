-- Large installations can build this first without blocking sign-ins, which makes this statement a no-op:
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "account_provider_id_account_id_unique" ON "account" ("provider_id","account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_id_account_id_unique" ON "account" ("provider_id","account_id");
