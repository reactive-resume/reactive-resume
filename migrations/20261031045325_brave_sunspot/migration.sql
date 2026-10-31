CREATE TABLE "career_answer" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"employer" text NOT NULL,
	"application_id" text,
	"source_application_id" text,
	"fact_ids" jsonb NOT NULL,
	"story_ids" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"duplicate_key" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "career_answer_user_id_duplicate_key_index" ON "career_answer" ("user_id","duplicate_key");--> statement-breakpoint
ALTER TABLE "career_answer" ADD CONSTRAINT "career_answer_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "career_answer" ADD CONSTRAINT "career_answer_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "career_answer" ADD CONSTRAINT "career_answer_source_application_id_application_id_fkey" FOREIGN KEY ("source_application_id") REFERENCES "application"("id") ON DELETE SET NULL;