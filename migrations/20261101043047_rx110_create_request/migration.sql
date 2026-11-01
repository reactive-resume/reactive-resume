CREATE TABLE "create_request" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "create_request_user_id_index" ON "create_request" ("user_id");--> statement-breakpoint
ALTER TABLE "create_request" ADD CONSTRAINT "create_request_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;