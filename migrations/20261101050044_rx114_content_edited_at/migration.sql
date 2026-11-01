-- "Last edited" follows content only. The column is added without a default so the backfill below can freeze each
-- existing document's baseline at the time the library already showed: its updated_at. Metadata-only writes (tags,
-- sharing, lock, rename, Trash/restore) keep moving updated_at, the concurrency check, but no longer move this.
ALTER TABLE "cover_letter" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cover_letter" ALTER COLUMN "edited_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "cover_letter" SET "edited_at" = "updated_at" WHERE "edited_at" IS NULL;--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resume" ALTER COLUMN "edited_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "resume" SET "edited_at" = "updated_at" WHERE "edited_at" IS NULL;--> statement-breakpoint
-- New rows start at their creation time, and every write path (editor saves, patches, the assistant, restores, API and
-- MCP clients) changes these columns through an UPDATE, so the database keeps edited_at rather than each caller.
CREATE FUNCTION "touch_edited_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW."edited_at" := now();
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "resume_edited_at" BEFORE UPDATE OF "data" ON "resume"
	FOR EACH ROW WHEN (NEW."data" IS DISTINCT FROM OLD."data") EXECUTE FUNCTION "touch_edited_at"();--> statement-breakpoint
CREATE TRIGGER "cover_letter_edited_at" BEFORE UPDATE ON "cover_letter"
	FOR EACH ROW WHEN (
		(NEW."recipient", NEW."content", NEW."greeting", NEW."sign_off", NEW."style", NEW."layout", NEW."recipient_name",
			NEW."recipient_company", NEW."letter_date", NEW."sender_linked", NEW."design_linked", NEW."source_resume_id")
		IS DISTINCT FROM
		(OLD."recipient", OLD."content", OLD."greeting", OLD."sign_off", OLD."style", OLD."layout", OLD."recipient_name",
			OLD."recipient_company", OLD."letter_date", OLD."sender_linked", OLD."design_linked", OLD."source_resume_id")
	) EXECUTE FUNCTION "touch_edited_at"();
