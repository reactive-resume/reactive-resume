import z from "zod";
import { paginationShape } from "../pagination";

const documentTypeSchema = z.enum(["resume", "letter"]).describe("resume, or letter (a saved cover letter).");
const documentRefSchema = z.object({
	type: documentTypeSchema,
	id: z.string().min(1).describe("The ID of the resume or cover letter."),
});

// One request may act on a large loaded page, but the client sends every operation as one batch rather than one call
// per document. Empty Trash doesn't use this list; it is a server-side "all" operation.
const documentBatchSchema = z
	.array(documentRefSchema)
	.min(1)
	.max(5000)
	.describe("The loaded documents the user selected, not every document in Trash.");

const documentSchema = z.object({
	type: documentTypeSchema,
	id: z.string(),
	name: z.string(),
	tags: z.array(z.string()),
	isLocked: z.boolean(),
	isPublic: z.boolean().describe("Whether a resume's public link is on; always false for letters."),
	slug: z.string().nullable().describe("A resume's public address, /{username}/{slug}; null for letters."),
	trashedAt: z.date().nullable().describe("When the document moved to Trash; null while it's live."),
	createdAt: z.date(),
	updatedAt: z.date().describe("When anything about the document last changed, its details included."),
	editedAt: z
		.date()
		.describe(
			"When its content was last edited: a resume's data, or a letter's text, recipient and design. Renames, tags, sharing, locks and Trash don't move it. Library sorting by edited uses it.",
		),
	recipient: z
		.string()
		.nullable()
		.describe(
			"Who a letter is to: its recipient company, else the recipient's name. Null for resumes and blank letters.",
		),
	application: z
		.object({ id: z.string(), company: z.string(), role: z.string() })
		.nullable()
		.describe("The job application this document was made for, if any."),
});

export type DocumentSummary = z.infer<typeof documentSchema>;

const documentFiltersSchema = z.object({
	trashed: z.boolean().default(false),
	type: z.enum(["all", "resume", "letter"]).default("all"),
	q: z.string().max(500).default(""),
	tags: z.array(z.string().min(1).max(40)).max(20).default([]),
	public: z.boolean().default(false),
	sort: z.enum(["edited", "name", "created"]).default("edited"),
});
export type DocumentFilters = z.infer<typeof documentFiltersSchema>;

export const documentsDto = {
	list: {
		input: documentFiltersSchema.extend(paginationShape).prefault({}),
		output: z.array(documentSchema),
	},
	page: {
		input: documentFiltersSchema
			.extend({
				limit: z.number().int().min(1).max(100).default(100),
				offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
			})
			.prefault({}),
		output: z.object({
			items: z.array(documentSchema),
			total: z.number(),
			counts: z.object({ resume: z.number(), letter: z.number() }),
			tags: z.array(z.string()),
			hasPublic: z.boolean(),
		}),
	},
	counts: {
		input: z.void(),
		output: z.object({ resume: z.number(), letter: z.number(), trash: z.number() }),
	},
	rename: {
		input: documentRefSchema.extend({ name: z.string().trim().min(1).max(100) }),
		output: z.void(),
	},
	setTags: {
		input: documentRefSchema.extend({ tags: z.array(z.string().trim().min(1).max(40)).max(20) }),
		output: z.void(),
	},
	setLocked: {
		input: documentRefSchema.extend({ isLocked: z.boolean() }),
		output: z.void(),
	},
	linkApplication: {
		input: documentRefSchema.extend({
			applicationId: z.string().min(1).nullable().describe("The application to link, or null to unlink."),
		}),
		output: z.void(),
	},
	trash: { input: documentRefSchema, output: z.void() },
	restore: { input: documentRefSchema, output: z.void() },
	restoreMany: {
		input: z.object({ documents: documentBatchSchema }),
		output: z.object({ restored: z.number().int().nonnegative() }),
	},
	purge: { input: documentRefSchema, output: z.void() },
	purgeMany: {
		input: z.object({ documents: documentBatchSchema }),
		output: z.object({
			deleted: z.number().int().nonnegative(),
			skipped: z.number().int().nonnegative().describe("Active, already deleted, or another account's documents."),
		}),
	},
	emptyTrash: {
		input: z.object({}).optional(),
		output: z.object({ deleted: z.number().int().nonnegative() }),
	},
	copyForJob: {
		input: z.object({
			resumeId: z.string().min(1).describe("The resume to copy."),
			applicationId: z.string().min(1).optional().describe("The job the copy is for; omit for no job yet."),
			name: z.string().trim().min(1).max(100).optional().describe("Defaults to “{source} — {company}”."),
		}),
		output: z.string().describe("The ID of the copy."),
	},
};
