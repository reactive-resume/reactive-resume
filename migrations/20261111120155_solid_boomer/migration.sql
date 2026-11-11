-- Large installations can build these first without blocking writes, which makes the statements below no-ops.
-- Check pg_index.indisvalid afterwards: a failed concurrent build leaves an invalid index of the same name.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_actions_user_id_index" ON "agent_actions" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_threads_source_resume_id_index" ON "agent_threads" ("source_resume_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_threads_application_id_index" ON "agent_threads" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_resume_id_index" ON "application" ("resume_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_cover_letter_id_index" ON "application" ("cover_letter_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_sent_resume_version_id_index" ON "application" ("sent_resume_version_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_sent_cover_letter_version_id_index" ON "application" ("sent_cover_letter_version_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_answer_application_id_index" ON "career_answer" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_answer_source_application_id_index" ON "career_answer" ("source_application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_artifact_application_id_index" ON "career_artifact" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_fact_application_id_index" ON "career_fact" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_job_user_id_index" ON "career_job" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_notification_application_id_index" ON "career_notification" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_opportunity_tracked_application_id_index" ON "career_opportunity" ("tracked_application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_schedule_user_id_index" ON "career_schedule" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_schedule_application_id_index" ON "career_schedule" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_story_application_id_index" ON "career_story" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_transcript_application_id_index" ON "career_transcript" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "career_workspace_user_id_index" ON "career_workspace" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_access_token_session_id_index" ON "oauth_access_token" ("session_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_access_token_user_id_index" ON "oauth_access_token" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_access_token_refresh_id_index" ON "oauth_access_token" ("refresh_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_session_id_index" ON "oauth_refresh_token" ("session_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_user_id_index" ON "oauth_refresh_token" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_user_id_index" ON "session" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_source_resume_id_index" ON "cover_letter" ("source_resume_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_source_application_id_index" ON "cover_letter" ("source_application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_version_user_id_index" ON "cover_letter_version" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "resume_application_id_index" ON "resume" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "resume_version_user_id_index" ON "resume_version" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "feedback_event_user_id_index" ON "feedback_event" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_actions_user_id_index" ON "agent_actions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_threads_source_resume_id_index" ON "agent_threads" ("source_resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_threads_application_id_index" ON "agent_threads" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_resume_id_index" ON "application" ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_cover_letter_id_index" ON "application" ("cover_letter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_sent_resume_version_id_index" ON "application" ("sent_resume_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_sent_cover_letter_version_id_index" ON "application" ("sent_cover_letter_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_answer_application_id_index" ON "career_answer" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_answer_source_application_id_index" ON "career_answer" ("source_application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_artifact_application_id_index" ON "career_artifact" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_fact_application_id_index" ON "career_fact" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_job_user_id_index" ON "career_job" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_notification_application_id_index" ON "career_notification" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_opportunity_tracked_application_id_index" ON "career_opportunity" ("tracked_application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_schedule_user_id_index" ON "career_schedule" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_schedule_application_id_index" ON "career_schedule" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_story_application_id_index" ON "career_story" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_transcript_application_id_index" ON "career_transcript" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "career_workspace_user_id_index" ON "career_workspace" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_session_id_index" ON "oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_user_id_index" ON "oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_refresh_id_index" ON "oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_session_id_index" ON "oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_user_id_index" ON "oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_user_id_index" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cover_letter_source_resume_id_index" ON "cover_letter" ("source_resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cover_letter_source_application_id_index" ON "cover_letter" ("source_application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cover_letter_version_user_id_index" ON "cover_letter_version" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_application_id_index" ON "resume" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_version_user_id_index" ON "resume_version" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_event_user_id_index" ON "feedback_event" ("user_id");
