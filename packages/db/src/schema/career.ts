import type { AnswerEvidence } from "@reactive-resume/schema/application-answers";
import type {
	CareerNotice,
	CareerProfileData,
	CareerSource,
	CareerStoryData,
	CareerWorkspace,
	SavedItemData,
} from "@reactive-resume/schema/career";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { aiProvider } from "./agent";
import { application } from "./applications";
import { user } from "./auth";

const owned = () => ({
	id: pg
		.text("id")
		.primaryKey()
		.$defaultFn(() => generateId()),
	userId: pg
		.text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});
const applicationId = () => pg.text("application_id").references(() => application.id, { onDelete: "cascade" });

export const careerProfile = pg.pgTable("career_profile", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	data: pg.jsonb("data").notNull().$type<CareerProfileData>(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});
export const careerFact = pg.pgTable(
	"career_fact",
	{
		...owned(),
		applicationId: applicationId(),
		text: pg.text("text").notNull(),
		category: pg.text("category").notNull(),
		source: pg.jsonb("source").notNull().$type<CareerSource>(),
		sourceKey: pg.text("source_key").notNull(),
		status: pg.text("status").notNull().default("active"),
		revisions: pg.jsonb("revisions").notNull().$type<Array<{ text: string; at: string }>>().default([]),
	},
	(t) => [pg.index().on(t.userId, t.applicationId, t.status), pg.uniqueIndex().on(t.userId, t.sourceKey)],
);
export const careerStory = pg.pgTable(
	"career_story",
	{
		...owned(),
		applicationId: applicationId(),
		data: pg.jsonb("data").notNull().$type<CareerStoryData>(),
	},
	(t) => [pg.index().on(t.userId, t.applicationId)],
);
export const careerArtifact = pg.pgTable(
	"career_artifact",
	{
		...owned(),
		applicationId: applicationId(),
		interviewId: pg.text("interview_id"),
		title: pg.text("title").notNull(),
		data: pg.jsonb("data").notNull().$type<SavedItemData>(),
		/** What the coach read to write it: switched-on facts and stories. */
		evidence: pg.jsonb("evidence").notNull().$type<{ factIds: string[]; storyIds: string[] }>(),
		jobId: pg.text("job_id").references(() => careerJob.id, { onDelete: "set null" }),
		inputVersion: pg.text("input_version").notNull(),
	},
	(t) => [pg.index().on(t.userId, t.applicationId, t.createdAt), pg.uniqueIndex().on(t.jobId)],
);
export const careerSchedule = pg.pgTable(
	"career_schedule",
	{
		...owned(),
		applicationId: applicationId(),
		interviewId: pg.text("interview_id"),
		kind: pg.text("kind").notNull(),
		query: pg.text("query").notNull().default(""),
		/** Prepare only: 24h, 2h or morning (08:00 on the interview day). */
		lead: pg.text("lead"),
		/** The interface language when it was saved, so a scheduled briefing is written in it. */
		locale: pg.text("locale").notNull().default("en-US"),
		timezone: pg.text("timezone").notNull().default("UTC"),
		enabled: pg.boolean("enabled").notNull().default(false),
		email: pg.boolean("email").notNull().default(false),
		nextRunAt: pg.timestamp("next_run_at", { withTimezone: true }).notNull(),
		lastQueuedAt: pg.timestamp("last_queued_at", { withTimezone: true }),
		intervalDays: pg.integer("interval_days"),
		aiProviderId: pg.text("ai_provider_id").references(() => aiProvider.id, { onDelete: "set null" }),
	},
	(t) => [pg.index().on(t.enabled, t.nextRunAt)],
);
export const careerJob = pg.pgTable(
	"career_job",
	{
		...owned(),
		scheduleId: pg
			.text("schedule_id")
			.notNull()
			.references(() => careerSchedule.id, { onDelete: "cascade" }),
		dueAt: pg.timestamp("due_at", { withTimezone: true }).notNull(),
		status: pg.text("status").notNull().default("queued"),
		attempts: pg.integer("attempts").notNull().default(0),
		lease: pg.text("lease"),
		leaseUntil: pg.timestamp("lease_until", { withTimezone: true }),
		error: pg.text("error"),
	},
	(t) => [pg.uniqueIndex().on(t.scheduleId, t.dueAt), pg.index().on(t.status, t.leaseUntil)],
);
export const careerNotification = pg.pgTable(
	"career_notification",
	{
		...owned(),
		applicationId: applicationId(),
		key: pg.text("key").notNull(),
		/** What happened; its words are written when it's read. */
		notice: pg.jsonb("notice").notNull().$type<CareerNotice>(),
		url: pg.text("url"),
		readAt: pg.timestamp("read_at", { withTimezone: true }),
		emailedAt: pg.timestamp("emailed_at", { withTimezone: true }),
		emailAttemptedAt: pg.timestamp("email_attempted_at", { withTimezone: true }),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.key), pg.index().on(t.userId, t.createdAt)],
);

export const careerOpportunity = pg.pgTable(
	"career_opportunity",
	{
		...owned(),
		url: pg.text("url").notNull(),
		/** Read from the posting page (its JobPosting data when it has some, else its title). */
		role: pg.text("role").notNull().default(""),
		company: pg.text("company").notNull().default(""),
		location: pg.text("location").notNull().default(""),
		snippet: pg.text("snippet").notNull(),
		/** The posting's text, saved with the application when it's tracked. */
		description: pg.text("description").notNull().default(""),
		firstSeenAt: pg.timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: pg.timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
		dismissedAt: pg.timestamp("dismissed_at", { withTimezone: true }),
		/** Set when tracked in Applications; a tracked role never returns in later runs. */
		trackedApplicationId: pg.text("tracked_application_id").references(() => application.id, { onDelete: "set null" }),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.url)],
);

/** One application's live workspace state: answers, checklist ticks, questions to ask. */
export const careerWorkspace = pg.pgTable("career_workspace", {
	applicationId: pg
		.text("application_id")
		.primaryKey()
		.references(() => application.id, { onDelete: "cascade" }),
	userId: pg
		.text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	data: pg.jsonb("data").notNull().$type<CareerWorkspace>(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const careerTranscript = pg.pgTable(
	"career_transcript",
	{
		...owned(),
		applicationId: applicationId(),
		original: pg.text("original").notNull(),
		edited: pg.text("edited").notNull(),
		model: pg.text("model").notNull(),
	},
	(t) => [pg.index().on(t.userId, t.applicationId)],
);

/** Explicitly reviewed reusable wording, independent of editable workspaces and submitted artifacts. */
export const careerAnswer = pg.pgTable(
	"career_answer",
	{
		...owned(),
		question: pg.text("question").notNull(),
		answer: pg.text("answer").notNull(),
		source: pg.text("source").$type<"manual" | "application" | "ai-assisted">().notNull(),
		scope: pg.text("scope").$type<"reusable" | "employer" | "application">().notNull(),
		employer: pg.text("employer").notNull(),
		applicationId: pg.text("application_id").references(() => application.id, { onDelete: "cascade" }),
		sourceApplicationId: pg.text("source_application_id").references(() => application.id, { onDelete: "set null" }),
		factIds: pg.jsonb("fact_ids").notNull().$type<string[]>(),
		storyIds: pg.jsonb("story_ids").notNull().$type<string[]>(),
		evidence: pg.jsonb("evidence").notNull().$type<AnswerEvidence[]>(),
		reviewedAt: pg.timestamp("reviewed_at", { withTimezone: true }).notNull(),
		revision: pg.integer("revision").notNull().default(1),
		/** Normalized question plus scope target, hashed by the owning service. */
		duplicateKey: pg.text("duplicate_key").notNull(),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.duplicateKey)],
);
