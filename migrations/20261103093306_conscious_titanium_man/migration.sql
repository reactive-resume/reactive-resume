CREATE TABLE "ai_request" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"action" text NOT NULL,
	"provider_id" text NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_answer" ADD COLUMN "ai_operation_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "career_artifact" ADD COLUMN "ai_operation_id" text;--> statement-breakpoint
ALTER TABLE "career_transcript" ADD COLUMN "ai_operation_id" text;--> statement-breakpoint
ALTER TABLE "resume_writing_review" ADD COLUMN "ai_operation_id" text;--> statement-breakpoint
CREATE INDEX "ai_request_user_id_created_at_index" ON "ai_request" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_request_user_id_operation_id_index" ON "ai_request" ("user_id","operation_id");--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;