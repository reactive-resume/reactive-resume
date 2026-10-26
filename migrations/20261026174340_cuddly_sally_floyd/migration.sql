CREATE TABLE "custom_domain" (
	"user_id" text PRIMARY KEY,
	"hostname" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "show_in_search_engines" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "hide_contact_details" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_verified_hostname" ON "custom_domain" ("hostname") WHERE "verified_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_primary_unique" ON "resume" ("user_id") WHERE "is_primary";--> statement-breakpoint
ALTER TABLE "custom_domain" ADD CONSTRAINT "custom_domain_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;