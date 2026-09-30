CREATE TABLE "resume_critique_comment" (
	"id" text PRIMARY KEY,
	"resume_id" text NOT NULL,
	"critiquer_id" text NOT NULL,
	"resume_owner_user_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"x_normalized" double precision NOT NULL,
	"y_normalized" double precision NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_critique_critiquer" (
	"id" text PRIMARY KEY,
	"resume_id" text NOT NULL,
	"resume_owner_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "resume_user_id_index";--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "critique_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "critique_password" text;--> statement-breakpoint
CREATE INDEX "resume_critique_comment_resume_id_critiquer_id_created_at_index" ON "resume_critique_comment" ("resume_id","critiquer_id","created_at");--> statement-breakpoint
CREATE INDEX "resume_critique_comment_resume_id_status_index" ON "resume_critique_comment" ("resume_id","status");--> statement-breakpoint
CREATE INDEX "resume_critique_critiquer_resume_id_created_at_index" ON "resume_critique_critiquer" ("resume_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "resume_critique_comment" ADD CONSTRAINT "resume_critique_comment_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_critique_comment" ADD CONSTRAINT "resume_critique_comment_jnSywrACChg9_fkey" FOREIGN KEY ("critiquer_id") REFERENCES "resume_critique_critiquer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_critique_comment" ADD CONSTRAINT "resume_critique_comment_resume_owner_user_id_user_id_fkey" FOREIGN KEY ("resume_owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_critique_critiquer" ADD CONSTRAINT "resume_critique_critiquer_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_critique_critiquer" ADD CONSTRAINT "resume_critique_critiquer_resume_owner_user_id_user_id_fkey" FOREIGN KEY ("resume_owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;