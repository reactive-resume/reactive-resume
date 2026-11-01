ALTER TABLE "career_schedule" ADD COLUMN "ai_provider_version" text;
--> statement-breakpoint
UPDATE "career_schedule" SET "enabled" = false
WHERE "kind" = 'prepare' AND "ai_provider_version" IS NULL;
--> statement-breakpoint
UPDATE "career_job" SET "status" = 'canceled', "lease" = NULL, "lease_until" = NULL
WHERE "status" IN ('queued', 'running') AND "schedule_id" IN (
 SELECT "id" FROM "career_schedule" WHERE "kind" = 'prepare' AND "ai_provider_version" IS NULL
);
