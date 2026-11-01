-- Forward correction for installations that recorded an earlier RX-106 owner migration. Completed history
-- stays untouched. Match any completed logical-day occurrence (or the exact explicit instant), even when a newer
-- queued, canceled or failed job exists. Cancel only pending duplicates of a completed occurrence; unrelated
-- pending work and failed history remain unchanged. Clear an incorrectly inherited watermark for a distinct instant.
WITH projected AS (
 SELECT s.id,s.user_id,s.timezone,s.last_queued_at,s.next_run_at,
  CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END AS at,
  a.follow_up_date_only AS date_only
 FROM career_schedule s JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 WHERE s.kind='follow-up' AND a.follow_up_at IS NOT NULL
), occurrence AS (
 SELECT p.*,j.due_at AS completed_at,
  (p.date_only AND (p.at AT TIME ZONE p.timezone)::date=(j.due_at AT TIME ZONE p.timezone)::date)
   OR (NOT p.date_only AND p.at=j.due_at) AS delivered
 FROM projected p
 LEFT JOIN LATERAL (
  SELECT due_at FROM career_job WHERE schedule_id=p.id AND user_id=p.user_id AND status='completed'
  ORDER BY ((p.date_only AND (p.at AT TIME ZONE p.timezone)::date=(due_at AT TIME ZONE p.timezone)::date)
   OR (NOT p.date_only AND p.at=due_at)) DESC,created_at DESC,id DESC LIMIT 1
 ) j ON true
 WHERE p.next_run_at=p.at
), repaired AS (
 UPDATE career_schedule s SET last_queued_at=CASE WHEN o.delivered THEN o.at ELSE NULL END
 FROM occurrence o WHERE s.id=o.id AND o.completed_at IS NOT NULL
 AND s.last_queued_at IS DISTINCT FROM CASE WHEN o.delivered THEN o.at ELSE NULL END
 RETURNING s.id
)
UPDATE career_job j SET status='canceled',lease=NULL,lease_until=NULL
FROM occurrence o WHERE o.delivered AND j.schedule_id=o.id AND j.user_id=o.user_id
AND j.status IN ('queued','running')
AND ((o.date_only AND (j.due_at AT TIME ZONE o.timezone)::date=(o.at AT TIME ZONE o.timezone)::date)
 OR (NOT o.date_only AND j.due_at=o.at));
