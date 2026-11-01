CREATE TABLE "resume_writing_review" (
	"resume_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"request_generation" integer DEFAULT 1 NOT NULL,
	"input_text" text,
	"passages" jsonb,
	"review" jsonb,
	"requested_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "test_error_kind" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "user_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "web_access_credentials" ADD COLUMN "test_result" jsonb;--> statement-breakpoint
ALTER TABLE "web_access_credentials" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resume_writing_review" ADD CONSTRAINT "resume_writing_review_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_writing_review" ADD CONSTRAINT "resume_writing_review_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
UPDATE "ai_providers" SET "user_disabled" = true WHERE NOT "enabled" AND "test_status" = 'success';
--> statement-breakpoint
UPDATE "ai_providers" AS p SET "is_default" = true
WHERE p.id IN (
 SELECT DISTINCT ON (user_id) id FROM "ai_providers" AS candidate
 WHERE enabled AND test_status = 'success'
 AND NOT EXISTS (SELECT 1 FROM "ai_providers" AS chosen WHERE chosen.user_id = candidate.user_id AND chosen.is_default)
 ORDER BY user_id, created_at, id
);
