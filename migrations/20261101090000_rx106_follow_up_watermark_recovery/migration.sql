-- Forward correction for installations that recorded an earlier RX-106 owner migration (name-based Drizzle history
-- does not re-run edited SQL). It derives a follow-up watermark from the completed job history, so fresh installs and
-- already-correct rows are unchanged. A completed job must match the projected occurrence: same calendar day for a
-- logical-day follow-up, the same instant for an exact-time follow-up. A watermark that marks a different instant as
-- delivered is cleared so that occurrence can still run. Pending queued/running/failed work is never touched.
WITH occurrence AS (
 SELECT s.id,s.last_queued_at,s.next_run_at,
  CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END AS at,
  a.follow_up_date_only AS date_only,j.status AS job_status,j.due_at AS completed_at
 FROM career_schedule s
 JOIN application a ON a.id=s.application_id AND a.user_id=s.user_id
 LEFT JOIN LATERAL (SELECT status,due_at FROM career_job WHERE schedule_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) j ON true
 WHERE s.kind='follow-up' AND a.follow_up_at IS NOT NULL
 AND s.next_run_at=CASE WHEN a.follow_up_date_only THEN ((a.follow_up_at AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE s.timezone ELSE a.follow_up_at END
)
UPDATE career_schedule s SET last_queued_at=CASE
 WHEN o.job_status='completed' AND (
  (o.date_only AND (o.at AT TIME ZONE s.timezone)::date=(o.completed_at AT TIME ZONE s.timezone)::date)
  OR (NOT o.date_only AND o.at=o.completed_at)
 ) THEN o.at
 ELSE NULL END
FROM occurrence o
WHERE s.id=o.id AND o.job_status='completed'
AND s.last_queued_at IS DISTINCT FROM CASE
 WHEN (o.date_only AND (o.at AT TIME ZONE s.timezone)::date=(o.completed_at AT TIME ZONE s.timezone)::date)
  OR (NOT o.date_only AND o.at=o.completed_at)
 THEN o.at
 ELSE NULL END;
