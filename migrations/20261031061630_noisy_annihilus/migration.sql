CREATE TABLE "storage_cleanup_job" (
	"id" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_cleanup_job_owner_key_unique" UNIQUE("owner_id","storage_key")
);
--> statement-breakpoint
CREATE INDEX "storage_cleanup_job_due_index" ON "storage_cleanup_job" ("status","next_attempt_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_account_storage_cleanup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	-- The account prefix covers every document prefix, so replace narrower jobs with one durable account job. No user
	-- foreign key exists on purpose: this row must survive the deletion that created it.
	DELETE FROM storage_cleanup_job WHERE owner_id = OLD.id;
	INSERT INTO storage_cleanup_job (id, owner_id, storage_key)
	VALUES (OLD.id || ':account', OLD.id, 'uploads/' || OLD.id)
	ON CONFLICT (owner_id, storage_key) DO NOTHING;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_account_storage_cleanup
AFTER DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION enqueue_account_storage_cleanup();
