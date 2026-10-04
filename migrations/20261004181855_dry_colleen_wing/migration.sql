ALTER TABLE "ai_providers" ADD COLUMN "credential_method" text DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "credential_scope" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "needs_reauth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "reauth_reason" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "reauth_at" timestamp with time zone;