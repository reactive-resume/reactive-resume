ALTER TABLE "application" ADD COLUMN "follow_up_date_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Preserve legacy raw dates; discriminator keeps their calendar day separate from exact reminder times.
UPDATE application SET follow_up_date_only=true WHERE follow_up_at IS NOT NULL AND follow_up_at=date_trunc('day',follow_up_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
--> statement-breakpoint
-- Adopt the newest existing reminder only when the application has no follow-up.
-- Existing application dates/notes stay authoritative. Duplicate delivery rows are consolidated.
WITH newest AS (
 SELECT DISTINCT ON (s.user_id, s.application_id) s.* FROM career_schedule s
 JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up'
 ORDER BY s.user_id,s.application_id,s.updated_at DESC,s.id DESC
)
UPDATE application a SET follow_up_at=n.next_run_at, follow_up_note=COALESCE(a.follow_up_note,NULLIF(n.query,''))
FROM newest n WHERE a.id=n.application_id AND a.user_id=n.user_id AND a.follow_up_at IS NULL;
--> statement-breakpoint
-- Keep duplicate reminders and job history in account exports, but only the newest row delivers.
UPDATE career_schedule s SET enabled=false FROM career_schedule newer
WHERE s.kind='follow-up' AND newer.kind='follow-up' AND s.user_id=newer.user_id
AND s.application_id=newer.application_id AND (s.updated_at,s.id)<(newer.updated_at,newer.id);
--> statement-breakpoint
UPDATE career_job j SET status='canceled',lease=NULL,lease_until=NULL
FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
WHERE j.schedule_id=s.id AND s.kind='follow-up' AND j.status IN ('queued','running')
AND ((CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END) IS DISTINCT FROM s.next_run_at OR NOT s.enabled OR EXISTS (SELECT 1 FROM career_job done WHERE done.schedule_id=s.id AND done.user_id=s.user_id AND done.status='completed' AND ((a.follow_up_date_only AND (done.due_at AT TIME ZONE s.timezone)::date=(a.follow_up_at AT TIME ZONE 'UTC')::date)
 OR (NOT a.follow_up_date_only AND done.due_at=a.follow_up_at))));
--> statement-breakpoint
-- Move the delivery index to the projected clock. A completed occurrence stays delivered only when the projection moves
-- the same occurrence: a logical-day follow-up on the same calendar day, or an exact-time follow-up at the same instant.
-- An explicit time that differs from the completed reminder is a new occurrence and must remain eligible for delivery.
-- Completed history keeps its original due time; only pending queued/running work moves to the projected clock.
WITH projected AS (
 SELECT s.id,s.last_queued_at,s.next_run_at AS current_at,a.follow_up_date_only AS date_only,
  CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END AS at,
  EXISTS (SELECT 1 FROM career_job done WHERE done.schedule_id=s.id AND done.user_id=s.user_id AND done.status='completed' AND ((a.follow_up_date_only AND (done.due_at AT TIME ZONE s.timezone)::date=(a.follow_up_at AT TIME ZONE 'UTC')::date)
 OR (NOT a.follow_up_date_only AND done.due_at=a.follow_up_at))) AS completed,
  a.follow_up_note
 FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up' AND a.follow_up_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM career_schedule newer WHERE newer.user_id=s.user_id AND newer.application_id=s.application_id AND newer.kind='follow-up' AND (newer.updated_at,newer.id)>(s.updated_at,s.id))
)
UPDATE career_schedule s SET next_run_at=p.at,query=COALESCE(p.follow_up_note,''),
last_queued_at=CASE
 WHEN p.completed THEN p.at
 WHEN p.at IS NOT DISTINCT FROM p.current_at THEN s.last_queued_at
 ELSE NULL END
FROM projected p WHERE s.id=p.id;
--> statement-breakpoint
INSERT INTO career_schedule(id,user_id,application_id,kind,query,timezone,enabled,next_run_at)
SELECT 'follow-up:'||a.id,a.user_id,a.id,'follow-up',COALESCE(a.follow_up_note,''),u.timezone,true,CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE u.timezone ELSE a.follow_up_at END
FROM application a JOIN "user" u ON u.id=a.user_id WHERE a.follow_up_at IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM career_schedule s WHERE s.user_id=a.user_id AND s.application_id=a.id AND s.kind='follow-up');
