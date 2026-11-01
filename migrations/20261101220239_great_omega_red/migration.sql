ALTER TABLE "application" ADD COLUMN "submitted_at" timestamp with time zone;

-- Backfill durable lifetime submission evidence from sound existing evidence. A sent stage, a sent version or a
-- sent-stage activity entry means the job was submitted; use the earliest sent-stage time, or applied_at for a sent
-- row or a row with a sent version but no activity. Saved rows that only carry the default applied_at stay null, so a never-applied job
-- can still perform a genuine first submission.
UPDATE "application"
SET "submitted_at" = COALESCE(
	(
		SELECT MIN((entry->>'at')::timestamptz)
		FROM jsonb_array_elements("activity") AS entry
		WHERE entry->>'type' = 'stage'
			AND entry->>'stage' IN ('applied', 'screening', 'interview', 'offer')
	),
	CASE
		WHEN "status" IN ('applied', 'screening', 'interview', 'offer')
			OR "sent_resume_version_id" IS NOT NULL
			OR "sent_cover_letter_version_id" IS NOT NULL
		THEN "applied_at"
		ELSE NULL
	END
)
WHERE "submitted_at" IS NULL
	AND (
		"status" IN ('applied', 'screening', 'interview', 'offer')
		OR "sent_resume_version_id" IS NOT NULL
		OR "sent_cover_letter_version_id" IS NOT NULL
		OR EXISTS (
			SELECT 1
			FROM jsonb_array_elements("activity") AS entry
			WHERE entry->>'type' = 'stage'
				AND entry->>'stage' IN ('applied', 'screening', 'interview', 'offer')
		)
	);
