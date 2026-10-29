CREATE TABLE "application_lane" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"label" text,
	"color" text NOT NULL,
	"position" integer NOT NULL,
	"system_key" text,
	"closed_reason" text,
	"retired_at" timestamp with time zone,
	CONSTRAINT "application_lane_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "application_lane_owner_system_unique" UNIQUE("user_id","system_key")
);
--> statement-breakpoint
CREATE TABLE "application_pipeline" (
	"user_id" text PRIMARY KEY,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "lane_id" text;--> statement-breakpoint
CREATE INDEX "application_user_id_lane_id_index" ON "application" ("user_id","lane_id");--> statement-breakpoint
CREATE INDEX "application_lane_user_id_index" ON "application_lane" ("user_id");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_lane_owner_fk" FOREIGN KEY ("user_id","lane_id") REFERENCES "application_lane"("user_id","id");--> statement-breakpoint
ALTER TABLE "application_lane" ADD CONSTRAINT "application_lane_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "application_pipeline" ADD CONSTRAINT "application_pipeline_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Expand only: canonical statuses, submission snapshots, timestamps and legacy activity stay intact.
INSERT INTO application_pipeline (user_id) SELECT id FROM "user" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO application_lane (id, user_id, category, label, color, position, system_key)
SELECT 'application-lane:' || u.id || ':' || d.category, u.id, d.category, NULL, d.color, d.position, d.category
FROM "user" u CROSS JOIN (VALUES
 ('saved', '#8D8C80', 0), ('applied', '#578BC7', 1), ('screening', '#319FA8', 2),
 ('interview', '#BB9135', 3), ('offer', '#449D70', 4), ('closed', '#C36B5C', 5)
) AS d(category, color, position) ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE application a SET lane_id = l.id FROM application_lane l
WHERE a.user_id = l.user_id AND a.status = l.system_key AND a.lane_id IS NULL;
--> statement-breakpoint
-- Older servers may keep creating/writing applications during a rolling deployment or rollback.
-- Resolve their omitted lane to a deterministic default without rewriting legacy timeline JSON.
-- Owner-only guest transfers also choose the target owner's category default; explicit foreign lanes still fail.
CREATE FUNCTION application_assign_lane() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen application_lane%ROWTYPE;
BEGIN
 IF NEW.lane_id IS NOT NULL THEN
  SELECT * INTO chosen FROM application_lane WHERE id = NEW.lane_id AND user_id = NEW.user_id;
 END IF;
 IF NEW.lane_id IS NULL OR
  (TG_OP = 'UPDATE' AND NEW.lane_id IS NOT DISTINCT FROM OLD.lane_id AND
   (chosen.id IS NULL OR NEW.status IS DISTINCT FROM OLD.status OR
    (chosen.closed_reason IS NOT NULL AND NEW.closed_reason IS DISTINCT FROM chosen.closed_reason))) THEN
  INSERT INTO application_pipeline (user_id) VALUES (NEW.user_id) ON CONFLICT DO NOTHING;
  INSERT INTO application_lane (id, user_id, category, label, color, position, system_key)
  SELECT 'application-lane:' || NEW.user_id || ':' || d.category, NEW.user_id, d.category, NULL, d.color, d.position, d.category
  FROM (VALUES
   ('saved', '#8D8C80', 0), ('applied', '#578BC7', 1), ('screening', '#319FA8', 2),
   ('interview', '#BB9135', 3), ('offer', '#449D70', 4), ('closed', '#C36B5C', 5)
  ) AS d(category, color, position) ON CONFLICT DO NOTHING;
  SELECT * INTO chosen FROM application_lane WHERE user_id = NEW.user_id AND system_key = NEW.status;
  NEW.lane_id := chosen.id;
 END IF;
 IF chosen.id IS NULL OR chosen.category <> NEW.status OR chosen.retired_at IS NOT NULL OR
  (chosen.closed_reason IS NOT NULL AND chosen.closed_reason IS DISTINCT FROM NEW.closed_reason) THEN
  RAISE EXCEPTION 'Application lane must be active, owned and compatible with its category and outcome' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER application_assign_lane_trigger BEFORE INSERT OR UPDATE OF user_id, status, lane_id, closed_reason ON application
FOR EACH ROW EXECUTE FUNCTION application_assign_lane();
