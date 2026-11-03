ALTER TABLE "application" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "application_user_id_trashed_at_index" ON "application" ("user_id","trashed_at");