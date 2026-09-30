CREATE TABLE "firecrawl_credentials" (
	"user_id" text PRIMARY KEY,
	"encrypted_api_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firecrawl_credentials" ADD CONSTRAINT "firecrawl_credentials_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;