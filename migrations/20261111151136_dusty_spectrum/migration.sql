-- Large installations can build these first without blocking writes:
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
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_access_token_client_id_index" ON "oauth_access_token" ("client_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_client_user_id_index" ON "oauth_client" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_consent_client_id_index" ON "oauth_consent" ("client_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_session_id_index" ON "oauth_refresh_token" ("session_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_user_id_index" ON "oauth_refresh_token" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "oauth_refresh_token_client_id_index" ON "oauth_refresh_token" ("client_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_user_id_index" ON "session" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_source_resume_id_index" ON "cover_letter" ("source_resume_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_source_application_id_index" ON "cover_letter" ("source_application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "cover_letter_version_user_id_index" ON "cover_letter_version" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "resume_application_id_index" ON "resume" ("application_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "resume_version_user_id_index" ON "resume_version" ("user_id");
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "feedback_event_user_id_index" ON "feedback_event" ("user_id");
--
-- An index that already exists and is valid is left alone, and its table is not locked. One that exists but is not
-- valid (a concurrent build that failed) stops the migration: drop it, build it again, then run the migration again.
DO $$
DECLARE
	wanted record;
	existing regclass;
BEGIN
	FOR wanted IN
		SELECT * FROM (VALUES
			('agent_actions_user_id_index', 'agent_actions', 'user_id'),
			('agent_threads_source_resume_id_index', 'agent_threads', 'source_resume_id'),
			('agent_threads_application_id_index', 'agent_threads', 'application_id'),
			('application_resume_id_index', 'application', 'resume_id'),
			('application_cover_letter_id_index', 'application', 'cover_letter_id'),
			('application_sent_resume_version_id_index', 'application', 'sent_resume_version_id'),
			('application_sent_cover_letter_version_id_index', 'application', 'sent_cover_letter_version_id'),
			('career_answer_application_id_index', 'career_answer', 'application_id'),
			('career_answer_source_application_id_index', 'career_answer', 'source_application_id'),
			('career_artifact_application_id_index', 'career_artifact', 'application_id'),
			('career_fact_application_id_index', 'career_fact', 'application_id'),
			('career_job_user_id_index', 'career_job', 'user_id'),
			('career_notification_application_id_index', 'career_notification', 'application_id'),
			('career_opportunity_tracked_application_id_index', 'career_opportunity', 'tracked_application_id'),
			('career_schedule_user_id_index', 'career_schedule', 'user_id'),
			('career_schedule_application_id_index', 'career_schedule', 'application_id'),
			('career_story_application_id_index', 'career_story', 'application_id'),
			('career_transcript_application_id_index', 'career_transcript', 'application_id'),
			('career_workspace_user_id_index', 'career_workspace', 'user_id'),
			('oauth_access_token_session_id_index', 'oauth_access_token', 'session_id'),
			('oauth_access_token_user_id_index', 'oauth_access_token', 'user_id'),
			('oauth_access_token_refresh_id_index', 'oauth_access_token', 'refresh_id'),
			('oauth_access_token_client_id_index', 'oauth_access_token', 'client_id'),
			('oauth_client_user_id_index', 'oauth_client', 'user_id'),
			('oauth_consent_client_id_index', 'oauth_consent', 'client_id'),
			('oauth_refresh_token_session_id_index', 'oauth_refresh_token', 'session_id'),
			('oauth_refresh_token_user_id_index', 'oauth_refresh_token', 'user_id'),
			('oauth_refresh_token_client_id_index', 'oauth_refresh_token', 'client_id'),
			('session_user_id_index', 'session', 'user_id'),
			('cover_letter_source_resume_id_index', 'cover_letter', 'source_resume_id'),
			('cover_letter_source_application_id_index', 'cover_letter', 'source_application_id'),
			('cover_letter_version_user_id_index', 'cover_letter_version', 'user_id'),
			('resume_application_id_index', 'resume', 'application_id'),
			('resume_version_user_id_index', 'resume_version', 'user_id'),
			('feedback_event_user_id_index', 'feedback_event', 'user_id')
		) AS t(index_name, table_name, column_name)
	LOOP
		existing := to_regclass(quote_ident(wanted.index_name));
		IF existing IS NULL THEN
			EXECUTE format('CREATE INDEX %I ON %I (%I)', wanted.index_name, wanted.table_name, wanted.column_name);
		ELSIF NOT (SELECT indisvalid FROM pg_index WHERE indexrelid = existing) THEN
			RAISE EXCEPTION 'Index % exists but is not valid. Drop it, build it again, then run the migration again.', wanted.index_name;
		END IF;
	END LOOP;
END $$;
