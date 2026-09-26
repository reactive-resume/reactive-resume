import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import {
	aiMetadataSchema,
	applicationStatusSchema,
	applicationTimelineEntrySchema,
	contactSchema,
	interviewDetailsSchema,
	interviewKindSchema,
} from "@reactive-resume/schema/applications/data";

const MAX_APPLICATION_JOB_DESCRIPTION_CHARS = 20_000;
const MAX_APPLICATION_DOCUMENT_BYTES = 10 * 1024 * 1024;

const applicationDocumentKindSchema = z.enum(["resume", "cover-letter"]);
const timelineDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.");
// Interviews carry a full timestamp (with offset) so the scheduled time survives timezones.
const interviewAtSchema = z.iso.datetime({ offset: true }).describe("Scheduled start, as an ISO 8601 date-time.");

const applicationDocumentFileSchema = z
	.file()
	.max(MAX_APPLICATION_DOCUMENT_BYTES, "File size must be less than 10MB")
	.mime(["application/pdf"], "Application documents must be PDF files.");

const httpUrlSchema = z
	.string()
	.trim()
	.pipe(z.url({ protocol: /^https?$/, error: "URL must use http or https." }));

const applicationSchema = createSelectSchema(schema.application, {
	id: z.string().describe("The ID of the application."),
	company: z.string().trim().min(1).describe("The company applied to."),
	role: z.string().trim().min(1).describe("The role / job title."),
	location: z.string().trim().nullable(),
	salary: z.string().trim().nullable(),
	status: applicationStatusSchema.describe("The current pipeline stage."),
	archived: z.boolean(),
	resumeId: z.string().nullable().describe("The linked Reactive Resume, if any."),
	source: z.string().trim().nullable(),
	sourceUrl: httpUrlSchema.nullable(),
	jobDescription: z.string().max(MAX_APPLICATION_JOB_DESCRIPTION_CHARS).nullable(),
	matchScore: z.number().int().min(0).max(100).nullable(),
	aiMetadata: aiMetadataSchema.nullable(),
	notes: z.string().nullable(),
	// Rendered as an <a href>; only same-origin storage URLs are ever stored. Constrain to
	// http(s)/relative so a hand-crafted `update` can't smuggle a `javascript:` href.
	resumeFileUrl: z
		.string()
		.refine((value) => /^(https?:\/\/|\/)/.test(value), "Resume file URL must be http(s) or a relative path.")
		.nullable(),
	resumeFileName: z.string().nullable(),
	coverLetterUrl: z
		.string()
		.refine((value) => /^(https?:\/\/|\/)/.test(value), "Cover letter URL must be http(s) or a relative path.")
		.nullable(),
	coverLetterName: z.string().nullable(),
	followUpAt: z.date().nullable(),
	followUpNote: z.string().trim().nullable(),
	tags: z.array(z.string()),
	contacts: z.array(contactSchema),
	activity: z.array(applicationTimelineEntrySchema),
	appliedAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

// Fields a client is allowed to set/change. `status`, `activity` and AI-owned fields are
// excluded here — status changes go through the auto-logging update path, activity through
// addNote, and AI fields are written only by the (reserved) AI procedures.
const editableSchema = applicationSchema.pick({
	company: true,
	role: true,
	location: true,
	salary: true,
	source: true,
	sourceUrl: true,
	jobDescription: true,
	notes: true,
	resumeFileUrl: true,
	resumeFileName: true,
	coverLetterUrl: true,
	coverLetterName: true,
	followUpAt: true,
	followUpNote: true,
	contacts: true,
	resumeId: true,
	tags: true,
});

const createInputSchema = editableSchema.partial().extend({
	company: applicationSchema.shape.company,
	role: applicationSchema.shape.role,
	status: applicationStatusSchema.optional(),
	stageEnteredAt: timelineDateSchema.optional(),
});

export const applicationDto = {
	list: {
		input: z
			.object({
				status: applicationStatusSchema.optional(),
				tags: z.array(z.string()).optional(),
				includeArchived: z.boolean().optional().default(false),
			})
			.optional()
			.default({ includeArchived: false }),
		output: z.array(applicationSchema.omit({ userId: true })),
	},

	getById: {
		input: applicationSchema.pick({ id: true }),
		output: applicationSchema.omit({ userId: true }),
	},

	create: {
		input: createInputSchema,
		output: z.string().describe("The ID of the created application."),
	},

	// Bulk create from a CSV import. Each item is a create input; company/role required per item.
	import: {
		input: z.object({ items: z.array(createInputSchema).min(1).max(500) }),
		output: z.object({ imported: z.number() }),
	},

	update: {
		input: editableSchema
			.partial()
			.extend({ id: z.string(), status: applicationStatusSchema.optional(), archived: z.boolean().optional() }),
		output: applicationSchema.omit({ userId: true }),
	},

	attachDocument: {
		input: z.object({
			id: z.string(),
			kind: applicationDocumentKindSchema,
			file: applicationDocumentFileSchema,
		}),
		output: applicationSchema.omit({ userId: true }),
	},

	removeDocument: {
		input: z.object({
			id: z.string(),
			kind: applicationDocumentKindSchema,
		}),
		output: applicationSchema.omit({ userId: true }),
	},

	addNote: {
		input: z.object({ id: z.string(), text: z.string().trim().min(1), date: timelineDateSchema.optional() }),
		output: applicationSchema.omit({ userId: true }),
	},

	updateTimelineEntry: {
		input: z
			.object({
				id: z.string(),
				entryId: z.string(),
				date: timelineDateSchema.optional(),
				text: z.string().trim().min(1).optional(),
			})
			.refine((value) => value.date !== undefined || value.text !== undefined, "Provide date or text to update."),
		output: applicationSchema.omit({ userId: true }),
	},

	// Interviews live on the activity timeline (type "interview") so they show up there and on
	// the calendar view without a separate table. Deleting goes through deleteTimelineEntry.
	addInterview: {
		input: interviewDetailsSchema.extend({
			id: z.string(),
			at: interviewAtSchema,
		}),
		output: applicationSchema.omit({ userId: true }),
	},

	updateInterview: {
		// Explicit optional fields (not interviewDetailsSchema.partial()) so the schema defaults
		// never overwrite stored values on a partial update.
		input: z.object({
			id: z.string(),
			entryId: z.string(),
			at: interviewAtSchema.optional(),
			kind: interviewKindSchema.optional(),
			durationMinutes: interviewDetailsSchema.shape.durationMinutes.unwrap().optional(),
			location: interviewDetailsSchema.shape.location.unwrap().optional(),
			notes: interviewDetailsSchema.shape.notes.unwrap().optional(),
		}),
		output: applicationSchema.omit({ userId: true }),
	},

	deleteTimelineEntry: {
		input: z.object({ id: z.string(), entryId: z.string() }),
		output: applicationSchema.omit({ userId: true }),
	},

	delete: {
		input: applicationSchema.pick({ id: true }),
		output: z.void(),
	},

	// Table bulk actions: move stage, archive/unarchive, add tags across a selection.
	bulkUpdate: {
		input: z.object({
			ids: z.array(z.string()).min(1).max(200, "Too many items in a single bulk operation"),
			status: applicationStatusSchema.optional(),
			archived: z.boolean().optional(),
			addTags: z.array(z.string()).optional(),
		}),
		output: z.object({ updated: z.number() }),
	},

	bulkDelete: {
		input: z.object({ ids: z.array(z.string()).min(1).max(200, "Too many items in a single bulk operation") }),
		output: z.object({ deleted: z.number() }),
	},

	// Aggregates for the Insights view. Everything else (funnel, sankey, tiles) is derived
	// client-side from these raw counts via computeInsights().
	stats: {
		input: z.object({}).optional().default({}),
		output: z.object({
			total: z.number(),
			byStage: z.array(z.object({ status: applicationStatusSchema, count: z.number() })),
			bySource: z.array(z.object({ source: z.string(), count: z.number() })),
		}),
	},

	tags: {
		input: z.object({}).optional().default({}),
		output: z.array(z.string()),
	},
};

export type ApplicationDocumentKind = z.infer<typeof applicationDocumentKindSchema>;
