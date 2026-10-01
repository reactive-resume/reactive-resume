-- v6 schema generated from packages/db/src/schema; v5 data conversions run once before legacy columns leave.
CREATE TABLE "cover_letter_version" (
	"id" text PRIMARY KEY,
	"cover_letter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"kind" text DEFAULT 'auto' NOT NULL,
	"name" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_slug_redirect" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"resume_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_slug_redirect_user_id_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "web_access_credentials" (
	"user_id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"encrypted_api_key" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "agent_threads_active_in_place_unique";
--> statement-breakpoint
DROP INDEX "resume_user_id_index";
--> statement-breakpoint
ALTER TABLE "agent_threads" ADD COLUMN "cover_letter_id" text;
--> statement-breakpoint
ALTER TABLE "agent_threads" ADD COLUMN "edits_proposed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_threads" ADD COLUMN "edits_accepted" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "closed_reason" text;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "cover_letter_id" text;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "sent_resume_version_id" text;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "sent_check_score" smallint;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "sent_cover_letter_version_id" text;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "posting_source" jsonb;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "requirements" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "layout" text DEFAULT 'freeform' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "recipient_name" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "recipient_company" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "letter_date" text;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "sender_linked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "design_linked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "is_locked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "application_id" text;
--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "auto_name" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "resume_version" ADD COLUMN "kind" text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE "resume_version" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "resume_version" ADD COLUMN "session_id" text;
--> statement-breakpoint
CREATE INDEX "agent_threads_cover_letter_id_index" ON "agent_threads" ("cover_letter_id");
--> statement-breakpoint
CREATE INDEX "cover_letter_version_cover_letter_id_created_at_index" ON "cover_letter_version" ("cover_letter_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "cover_letter_version_session_unique" ON "cover_letter_version" ("cover_letter_id","session_id") WHERE "kind" = 'auto';
--> statement-breakpoint
CREATE INDEX "resume_slug_redirect_resume_id_index" ON "resume_slug_redirect" ("resume_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resume_version_session_unique" ON "resume_version" ("resume_id","session_id") WHERE "kind" = 'auto';
--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_cover_letter_id_cover_letter_id_fkey" FOREIGN KEY ("cover_letter_id") REFERENCES "cover_letter"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_cover_letter_id_cover_letter_id_fkey" FOREIGN KEY ("cover_letter_id") REFERENCES "cover_letter"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_sent_resume_version_id_resume_version_id_fkey" FOREIGN KEY ("sent_resume_version_id") REFERENCES "resume_version"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_QJaGmijrxJ0T_fkey" FOREIGN KEY ("sent_cover_letter_version_id") REFERENCES "cover_letter_version"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "cover_letter_version" ADD CONSTRAINT "cover_letter_version_cover_letter_id_cover_letter_id_fkey" FOREIGN KEY ("cover_letter_id") REFERENCES "cover_letter"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "cover_letter_version" ADD CONSTRAINT "cover_letter_version_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "resume" ADD CONSTRAINT "resume_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "resume_slug_redirect" ADD CONSTRAINT "resume_slug_redirect_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "resume_slug_redirect" ADD CONSTRAINT "resume_slug_redirect_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "web_access_credentials" ADD CONSTRAINT "web_access_credentials_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Preserve v5 version kinds before dropping their labels.
UPDATE "resume_version" SET "kind" = CASE "label" WHEN 'Imported' THEN 'import' WHEN 'AI edit' THEN 'ai' WHEN 'Before restore' THEN 'before-restore' WHEN 'Restored version' THEN 'restored' ELSE 'auto' END;
--> statement-breakpoint
-- The closed stage replaces `rejected` (closed, not selected) and the `archived` flag (closed, no reason).
-- Backfill before dropping the legacy archived flag below.
UPDATE "application" SET "status" = 'closed', "closed_reason" = 'not-selected' WHERE "status" = 'rejected';--> statement-breakpoint
UPDATE "application" SET "status" = 'closed' WHERE "archived" = true AND "status" <> 'closed';--> statement-breakpoint
UPDATE "application" SET "activity" = (
	SELECT jsonb_agg(
		CASE WHEN entry->>'type' = 'stage' AND entry->>'stage' = 'rejected'
			THEN jsonb_set(entry, '{stage}', '"closed"')
			ELSE entry
		END
		ORDER BY position
	)
	FROM jsonb_array_elements("activity") WITH ORDINALITY AS items(entry, position)
)
WHERE "activity" @> '[{"type": "stage", "stage": "rejected"}]';--> statement-breakpoint
-- A letter written for exactly one application becomes that application's letter.
UPDATE "application" SET "cover_letter_id" = letters."id"
FROM (
	SELECT "source_application_id", min("id") AS "id"
	FROM "cover_letter"
	WHERE "source_application_id" IS NOT NULL
	GROUP BY "source_application_id"
	HAVING count(*) = 1
) AS letters
WHERE "application"."id" = letters."source_application_id" AND "application"."cover_letter_id" IS NULL;
--> statement-breakpoint
-- Letters are documents of their own. Every cover letter a resume still carries (a custom section of type
-- `cover-letter`, one letter per item, hidden ones too) becomes a saved letter linked to that resume's sender
-- details and design, as it read inside the resume. A resume that carried exactly one letter, used by exactly one
-- application without a letter, hands it to that application. Then the sections leave the resumes and their page
-- layouts.
-- Resume versions keep their history as it was; restoring one saves its letters again (once) as letters.
-- Idempotent: a letter already saved from the same item with the same text isn't saved twice. rollback.sql
-- puts the letters back into their resumes.
WITH letter_items AS (
	SELECT
		r.id AS resume_id,
		r.user_id,
		r.name AS resume_name,
		r.data,
		s.section,
		i.item,
		count(*) OVER (PARTITION BY r.id) AS letters_in_resume
	FROM "resume" r
	CROSS JOIN LATERAL jsonb_array_elements(r.data->'customSections') AS s(section)
	CROSS JOIN LATERAL jsonb_array_elements(s.section->'items') AS i(item)
	WHERE jsonb_typeof(r.data->'customSections') = 'array'
		AND s.section->>'type' = 'cover-letter'
		AND jsonb_typeof(s.section->'items') = 'array'
),
inserted AS (
	INSERT INTO "cover_letter" (
		"id", "user_id", "name", "recipient", "content", "style", "layout", "sender_linked", "design_linked", "source_resume_id",
		"source_application_id"
	)
	SELECT
		gen_random_uuid()::text,
		l.user_id,
		left(
			coalesce(nullif(btrim(l.resume_name), ''), 'Resume') || ' — ' ||
			coalesce(nullif(btrim(l.section->>'title'), ''), 'Cover letter'),
			100
		),
		coalesce(l.item->>'recipient', ''),
		coalesce(l.item->>'content', ''),
		jsonb_build_object(
			'basics', l.data->'basics',
			'picture', l.data->'picture',
			'metadata', (l.data->'metadata') - 'notes' - 'layout',
			'sectionId', l.section->>'id',
			'itemId', l.item->>'id'
		),
		'freeform',
		true,
		true,
		l.resume_id,
		CASE WHEN l.letters_in_resume = 1 THEN (
			SELECT min(a."id") FROM "application" a
			WHERE a."resume_id" = l.resume_id AND a."cover_letter_id" IS NULL
			HAVING count(*) = 1
		) END
	FROM letter_items l
	WHERE NOT EXISTS (
		SELECT 1 FROM "cover_letter" c
		WHERE c."user_id" = l.user_id
			AND c."source_resume_id" = l.resume_id
			AND c."style"->>'itemId' = l.item->>'id'
			AND c."content" = coalesce(l.item->>'content', '')
	)
	RETURNING "id", "user_id", "name", "recipient", "content", "style", "layout", "recipient_name",
		"recipient_company", "letter_date", "source_resume_id", "source_application_id"
),
versions AS (
	INSERT INTO "cover_letter_version" ("id", "cover_letter_id", "user_id", "data", "kind")
	SELECT
		gen_random_uuid()::text,
		"id",
		"user_id",
		jsonb_build_object(
			'name', "name",
			'recipient', "recipient",
			'content', "content",
			'style', "style",
			'layout', "layout",
			'recipientName', "recipient_name",
			'recipientCompany', "recipient_company",
			'letterDate', "letter_date"
		),
		'created'
	FROM inserted
	RETURNING "id"
)
UPDATE "application" a
SET "cover_letter_id" = inserted."id"
FROM inserted
WHERE a."id" = inserted."source_application_id" AND a."cover_letter_id" IS NULL;--> statement-breakpoint
WITH letters AS (
	SELECT r.id, array_agg(s.section->>'id') AS ids
	FROM "resume" r
	CROSS JOIN LATERAL jsonb_array_elements(r.data->'customSections') AS s(section)
	WHERE jsonb_typeof(r.data->'customSections') = 'array' AND s.section->>'type' = 'cover-letter'
	GROUP BY r.id
),
cleaned AS (
	SELECT
		r.id,
		letters.ids,
		jsonb_set(
			r.data,
			'{customSections}',
			(
				SELECT coalesce(jsonb_agg(s.section ORDER BY s.position), '[]'::jsonb)
				FROM jsonb_array_elements(r.data->'customSections') WITH ORDINALITY AS s(section, position)
				WHERE s.section->>'type' IS DISTINCT FROM 'cover-letter'
			)
		) AS data
	FROM "resume" r
	JOIN letters ON letters.id = r.id
)
UPDATE "resume" r
SET "data" = CASE
	WHEN jsonb_typeof(c.data#>'{metadata,layout,pages}') = 'array' THEN jsonb_set(
		c.data,
		'{metadata,layout,pages}',
		(
			SELECT coalesce(jsonb_agg(
				p.page
				|| CASE WHEN jsonb_typeof(p.page->'main') = 'array' THEN jsonb_build_object('main', (
					SELECT coalesce(jsonb_agg(m.id ORDER BY m.position), '[]'::jsonb)
					FROM jsonb_array_elements(p.page->'main') WITH ORDINALITY AS m(id, position)
					WHERE NOT (m.id #>> '{}') = ANY (c.ids)
				)) ELSE '{}'::jsonb END
				|| CASE WHEN jsonb_typeof(p.page->'sidebar') = 'array' THEN jsonb_build_object('sidebar', (
					SELECT coalesce(jsonb_agg(sb.id ORDER BY sb.position), '[]'::jsonb)
					FROM jsonb_array_elements(p.page->'sidebar') WITH ORDINALITY AS sb(id, position)
					WHERE NOT (sb.id #>> '{}') = ANY (c.ids)
				)) ELSE '{}'::jsonb END
				ORDER BY p.position
			), '[]'::jsonb)
			FROM jsonb_array_elements(c.data#>'{metadata,layout,pages}') WITH ORDINALITY AS p(page, position)
		)
	)
	ELSE c.data
END
FROM cleaned c
WHERE r.id = c.id;
--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "archived";
--> statement-breakpoint
ALTER TABLE "resume_version" DROP COLUMN "label";
