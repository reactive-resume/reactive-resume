CREATE TABLE "application_profile" (
	"user_id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"revision" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_profile" ADD CONSTRAINT "application_profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;