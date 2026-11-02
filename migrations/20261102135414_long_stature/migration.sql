CREATE TABLE "feedback_comment" (
	"id" text PRIMARY KEY,
	"link_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_event" (
	"id" text PRIMARY KEY,
	"link_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_link" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"resume_id" text NOT NULL,
	"label" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"resume_name" text NOT NULL,
	"allow_comments" boolean DEFAULT true NOT NULL,
	"application_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_comment_link_id_created_at_index" ON "feedback_comment" ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_comment_user_id_index" ON "feedback_comment" ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_event_link_id_created_at_index" ON "feedback_event" ("link_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_link_user_id_created_at_index" ON "feedback_link" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_link_resume_id_index" ON "feedback_link" ("resume_id");--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_link_id_feedback_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "feedback_link"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_comment" ADD CONSTRAINT "feedback_comment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_event" ADD CONSTRAINT "feedback_event_link_id_feedback_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "feedback_link"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_event" ADD CONSTRAINT "feedback_event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_link" ADD CONSTRAINT "feedback_link_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_link" ADD CONSTRAINT "feedback_link_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE CASCADE;