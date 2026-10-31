-- Account timezone owns logical-day follow-ups. This runs inside the existing user write,
-- including both auth update paths, before its lock is released; no after-commit gap.
CREATE FUNCTION sync_account_follow_up_clock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 a application%ROWTYPE;
 s career_schedule%ROWTYPE;
 at_new timestamptz;
 completed boolean;
BEGIN
 FOR a IN SELECT * FROM application WHERE user_id=NEW.id AND follow_up_date_only AND follow_up_at IS NOT NULL ORDER BY id FOR UPDATE LOOP
  at_new := ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE NEW.timezone;
  IF (at_new AT TIME ZONE NEW.timezone)::date <> (a.follow_up_at AT TIME ZONE 'UTC')::date OR (at_new AT TIME ZONE NEW.timezone)::time <> time '09:00' THEN
   RAISE EXCEPTION 'A follow-up date does not exist in the selected timezone';
  END IF;
  SELECT * INTO s FROM career_schedule WHERE user_id=NEW.id AND application_id=a.id AND kind='follow-up' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
   -- last_queued_at is the occurrence watermark; terminal jobs retain their original actual due time.
   SELECT s.last_queued_at IS NOT NULL AND COALESCE((SELECT status='completed' FROM career_job WHERE schedule_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1),false) INTO completed;
   IF at_new IS DISTINCT FROM s.next_run_at THEN
    UPDATE career_job SET status='canceled',lease=NULL,lease_until=NULL WHERE schedule_id=s.id AND status IN ('queued','running');
   END IF;
   UPDATE career_schedule SET timezone=NEW.timezone,next_run_at=at_new,
    last_queued_at=CASE WHEN completed THEN at_new WHEN at_new IS DISTINCT FROM s.next_run_at THEN NULL ELSE s.last_queued_at END
   WHERE id=s.id;
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_follow_up_clock AFTER UPDATE OF timezone ON "user"
FOR EACH ROW EXECUTE FUNCTION sync_account_follow_up_clock();
--> statement-breakpoint
-- Reconcile logical-day indices created before this clock policy; completed jobs keep their historical due times.
UPDATE "user" SET timezone=timezone WHERE EXISTS (SELECT 1 FROM application a WHERE a.user_id="user".id AND a.follow_up_date_only AND a.follow_up_at IS NOT NULL);
