CREATE TABLE "web_access_credentials" (
	"user_id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"encrypted_api_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "posting_source" jsonb;--> statement-breakpoint
ALTER TABLE "web_access_credentials" ADD CONSTRAINT "web_access_credentials_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Copy ciphertext unchanged: no keys are decrypted and the legacy table remains for rollback.
INSERT INTO "web_access_credentials" ("user_id", "provider", "encrypted_api_key")
SELECT "user_id", 'firecrawl', "encrypted_api_key" FROM "firecrawl_credentials"
ON CONFLICT ("user_id") DO NOTHING;
