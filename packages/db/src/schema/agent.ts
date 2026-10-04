import type { ResumeData } from "@reactive-resume/schema/resume/data";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";
import { coverLetter } from "./cover-letter";
import { resume } from "./resume";

type AgentUiMessage = Record<string, unknown>;
type StoredJsonPatchOperation =
	| { op: "add"; path: string; value: unknown }
	| { op: "remove"; path: string }
	| { op: "replace"; path: string; value: unknown }
	| { op: "move"; path: string; from: string }
	| { op: "copy"; path: string; from: string }
	| { op: "test"; path: string; value: unknown };

export const aiProvider = pg.pgTable(
	"ai_providers",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		label: pg.text("label").notNull(),
		provider: pg.text("provider").notNull(),
		model: pg.text("model").notNull(),
		baseUrl: pg.text("base_url"),
		encryptedApiKey: pg.text("encrypted_api_key").notNull(),
		apiKeySalt: pg.text("api_key_salt").notNull(),
		apiKeyHash: pg.text("api_key_hash").notNull(),
		apiKeyPreview: pg.text("api_key_preview").notNull(),
		// How the stored key was obtained: "api_key" (pasted) or "pkce" (OrcaRouter connect flow). The key
		// itself is identical either way; this only drives the account/status UI and the reauth lifecycle.
		credentialMethod: pg.text("credential_method").notNull().default("api_key"),
		// The scope OrcaRouter granted, when the connect flow reported one. Null for pasted keys.
		credentialScope: pg.text("credential_scope"),
		// Terminal reauthentication state: set when the provider rejects the credential, cleared only by a
		// successful reconnect. The rejection is attributed to the exact credential generation (apiKeyHash)
		// that made the rejected request, so a late failure cannot mark a replaced key as broken.
		needsReauth: pg.boolean("needs_reauth").notNull().default(false),
		reauthReason: pg.text("reauth_reason"),
		reauthAt: pg.timestamp("reauth_at", { withTimezone: true }),
		testStatus: pg.text("test_status").notNull().default("untested"),
		testError: pg.text("test_error"),
		lastTestedAt: pg.timestamp("last_tested_at", { withTimezone: true }),
		lastUsedAt: pg.timestamp("last_used_at", { withTimezone: true }),
		enabled: pg.boolean("enabled").notNull().default(false),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.index().on(t.userId, t.enabled),
		pg.index().on(t.userId, t.lastUsedAt.desc()),
		pg.index().on(t.userId, t.createdAt.asc()),
	],
);

export const agentThread = pg.pgTable(
	"agent_threads",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		aiProviderId: pg.text("ai_provider_id").references(() => aiProvider.id, { onDelete: "set null" }),
		sourceResumeId: pg.text("source_resume_id").references(() => resume.id, { onDelete: "set null" }),
		workingResumeId: pg.text("working_resume_id").references(() => resume.id, { onDelete: "set null" }),
		// A conversation is about one document: the resume above, or this letter.
		coverLetterId: pg.text("cover_letter_id").references(() => coverLetter.id, { onDelete: "set null" }),
		title: pg.text("title").notNull(),
		// Outcomes for past conversations: "3 of 4 edits accepted".
		editsProposed: pg.integer("edits_proposed").notNull().default(0),
		editsAccepted: pg.integer("edits_accepted").notNull().default(0),
		status: pg.text("status").notNull().default("active"),
		// Per-thread "Review edits" toggle: when true, apply_resume_patch requires user approval.
		reviewPatches: pg.boolean("review_patches").notNull().default(false),
		activeRunId: pg.text("active_run_id"),
		activeStreamId: pg.text("active_stream_id"),
		activeRunStartedAt: pg.timestamp("active_run_started_at", { withTimezone: true }),
		lastMessageAt: pg.timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: pg.timestamp("archived_at", { withTimezone: true }),
		deletedAt: pg.timestamp("deleted_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.index().on(t.userId, t.status, t.lastMessageAt.desc()),
		pg.index().on(t.workingResumeId),
		pg.index().on(t.coverLetterId),
		pg.index().on(t.aiProviderId),
	],
);

export const agentMessage = pg.pgTable(
	"agent_messages",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		threadId: pg
			.text("thread_id")
			.notNull()
			.references(() => agentThread.id, { onDelete: "cascade" }),
		role: pg.text("role").notNull(),
		status: pg.text("status").notNull().default("completed"),
		sequence: pg.integer("sequence").notNull(),
		uiMessage: pg.jsonb("ui_message").notNull().$type<AgentUiMessage>(),
		error: pg.text("error"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.uniqueIndex().on(t.threadId, t.sequence), pg.index().on(t.userId, t.createdAt.desc())],
);

export const agentAttachment = pg.pgTable(
	"agent_attachments",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		threadId: pg
			.text("thread_id")
			.notNull()
			.references(() => agentThread.id, { onDelete: "cascade" }),
		messageId: pg.text("message_id").references(() => agentMessage.id, { onDelete: "set null" }),
		storageKey: pg.text("storage_key").notNull(),
		filename: pg.text("filename").notNull(),
		mediaType: pg.text("media_type").notNull(),
		size: pg.integer("size").notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.threadId), pg.index().on(t.messageId), pg.index().on(t.userId)],
);

export const agentAction = pg.pgTable(
	"agent_actions",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		threadId: pg
			.text("thread_id")
			.notNull()
			.references(() => agentThread.id, { onDelete: "cascade" }),
		messageId: pg.text("message_id").references(() => agentMessage.id, { onDelete: "set null" }),
		resumeId: pg.text("resume_id").references(() => resume.id, { onDelete: "set null" }),
		kind: pg.text("kind").notNull(),
		status: pg.text("status").notNull().default("applied"),
		title: pg.text("title").notNull(),
		summary: pg.text("summary"),
		operations: pg.jsonb("operations").notNull().$type<StoredJsonPatchOperation[]>(),
		snapshotData: pg.jsonb("snapshot_data").$type<ResumeData | null>(),
		baseUpdatedAt: pg.timestamp("base_updated_at", { withTimezone: true }).notNull(),
		appliedUpdatedAt: pg.timestamp("applied_updated_at", { withTimezone: true }).notNull(),
		revertedAt: pg.timestamp("reverted_at", { withTimezone: true }),
		revertMessage: pg.text("revert_message"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.threadId, t.createdAt.desc()), pg.index().on(t.resumeId), pg.index().on(t.messageId)],
);
