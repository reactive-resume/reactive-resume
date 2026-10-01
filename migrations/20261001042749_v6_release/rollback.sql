-- Restore v5 compatibility; additive v6 tables and columns remain. The migration ledger is unchanged.
BEGIN;

-- Puts letters back into their resumes, for app versions that still show cover letters inside a resume. Run it by
-- hand before downgrading. Only letters saved from a resume's own section come back (their style names that
-- section); library letters stay in the library, where older versions list them too. Each letter returns as a
-- cover-letter section at the end of its resume's first page (one section per resume per run: run it again for a
-- resume that had several). The letters themselves are kept.
WITH returning_letters AS (
	SELECT
		c."source_resume_id" AS resume_id,
		c."style"->>'sectionId' AS section_id,
		jsonb_agg(
			jsonb_build_object(
				'id', c."style"->>'itemId',
				'hidden', false,
				'recipient', c."recipient",
				'content', c."content"
			)
			ORDER BY c."created_at"
		) AS items
	FROM "cover_letter" c
	WHERE c."source_resume_id" IS NOT NULL
		AND c."trashed_at" IS NULL
		AND c."style"->>'sectionId' IS NOT NULL
		AND c."style"->>'sectionId' <> 'library-cover-letter'
	GROUP BY c."source_resume_id", c."style"->>'sectionId'
)
UPDATE "resume" r
SET "data" = jsonb_set(
	jsonb_set(
		r.data,
		'{customSections}',
		coalesce(r.data->'customSections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
			'id', l.section_id,
			'type', 'cover-letter',
			'title', '',
			'icon', 'envelope-simple',
			'columns', 1,
			'hidden', false,
			'keepTogether', false,
			'startOnNewPage', false,
			'items', l.items
		))
	),
	'{metadata,layout,pages,0,main}',
	coalesce(r.data#>'{metadata,layout,pages,0,main}', '[]'::jsonb) || to_jsonb(l.section_id)
)
FROM returning_letters l
WHERE r.id = l.resume_id
	AND jsonb_typeof(r.data#>'{metadata,layout,pages,0}') = 'object'
	AND NOT (coalesce(r.data->'customSections', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', l.section_id)));

-- Restores the columns the contract step dropped, for older app versions. Closed applications without a reason
-- were archived ones; version labels come back from their kind.
ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
UPDATE "application" SET "archived" = true WHERE "status" = 'closed' AND "closed_reason" IS NULL;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "label" text DEFAULT '' NOT NULL;
UPDATE "resume_version" SET "label" = CASE "kind"
	WHEN 'created' THEN 'Created'
	WHEN 'import' THEN 'Imported'
	WHEN 'auto' THEN 'Manual save'
	WHEN 'before-restore' THEN 'Before restore'
	WHEN 'restored' THEN 'Restored version'
	WHEN 'ai' THEN 'AI edit'
	WHEN 'sent' THEN 'Sent'
	ELSE coalesce("name", '')
END;

-- Reverses the closed stage for app versions before 6.0, which only know `rejected` and `archived`.
-- Run it by hand before downgrading; the added columns can stay, older versions ignore them.
UPDATE "application" SET "activity" = (
	SELECT jsonb_agg(
		CASE WHEN entry->>'type' = 'stage' AND entry->>'stage' = 'closed'
			THEN jsonb_set(entry, '{stage}', '"rejected"')
			ELSE entry
		END
		ORDER BY position
	)
	FROM jsonb_array_elements("activity") WITH ORDINALITY AS items(entry, position)
)
WHERE "activity" @> '[{"type": "stage", "stage": "closed"}]';

-- Closed as not selected was `rejected`.
UPDATE "application" SET "status" = 'rejected' WHERE "status" = 'closed' AND "closed_reason" = 'not-selected';

-- Any other closed application is archived at the last stage it reached before closing.
UPDATE "application" SET "archived" = true, "status" = coalesce((
	SELECT entry->>'stage'
	FROM jsonb_array_elements("activity") AS items(entry)
	WHERE entry->>'type' = 'stage' AND entry->>'stage' NOT IN ('closed', 'rejected')
	ORDER BY (entry->>'at')::timestamptz DESC
	LIMIT 1
), 'saved')
WHERE "status" = 'closed';

COMMIT;
