/**
 * Canonical tool metadata (title, description, inputSchema, annotations) declared once.
 * Consumed by both `registerTools` (raw Zod) and `buildMcpServerCard` (toJsonSchemaCompat).
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import z from "zod";
import { resumePatchOperationsSchema } from "@reactive-resume/ai/tools/resume-tool-contracts";
import { applicationDto } from "@reactive-resume/api/dto/application";
import { coverLetterDto } from "@reactive-resume/api/dto/cover-letter";
import { resumeDto } from "@reactive-resume/api/dto/resume";
import {
	applicationClosedReasonSchema,
	applicationStatusSchema,
	contactSchema,
	interviewDetailsSchema,
	interviewKindSchema,
} from "@reactive-resume/schema/applications/data";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { toWireObjectSchema, toWireSchema } from "./contracts";
import { MCP_TOOL_NAME as T } from "./mcp-tool-names";

const READ_IDEMPOTENT: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
const READ_NON_IDEMPOTENT: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
const WRITE_NON_IDEMPOTENT: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
const WRITE_DESTRUCTIVE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};
const WRITE_IDEMPOTENT: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

// ponytail: shared schema fragment; exported so server-card can re-use without re-importing
const resumeIdSchema = z.string().min(1).describe(`Resume ID. Use \`${T.listResumes}\` to find valid IDs.`);
const applicationIdSchema = z
	.string()
	.min(1)
	.describe(`Application ID. Use \`${T.listApplications}\` to find valid IDs.`);
const applicationTimelineEntryIdSchema = z.string().min(1).describe("Timeline entry ID from an application response.");
const applicationDocumentKindSchema = z.enum(["resume", "cover-letter"]);
const coverLetterIdSchema = z
	.string()
	.min(1)
	.describe(`Cover letter ID. Use \`${T.listCoverLetters}\` to find valid IDs.`);
const expectedRevisionSchema = z
	.number()
	.int()
	.min(1)
	.describe("Revision returned by the latest cover-letter response.");
const coverLetterEditableFieldsSchema = {
	name: z.string().min(1).max(100).describe("Cover-letter name."),
	recipient: z
		.string()
		.max(20_000)
		.optional()
		.describe("Freeform letters only: the recipient block as HTML. Structured letters use the fields below."),
	content: z
		.string()
		.max(100_000)
		.optional()
		.describe("Body HTML. Structured letters add the greeting and sign-off around it, so leave those out."),
	recipientName: z
		.string()
		.max(200)
		.optional()
		.describe('Structured letters: who it\'s to, a person or a team. The greeting follows it ("Dear Dana,").'),
	recipientCompany: z.string().max(200).optional().describe("Structured letters: the recipient's company."),
	letterDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.")
		.nullable()
		.optional()
		.describe("Structured letters: the letter's date."),
};
const timelineDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.");
const interviewAtSchema = z.iso
	.datetime({ offset: true })
	.describe("Scheduled start as an ISO 8601 date-time with offset, e.g. 2026-10-01T10:30:00-04:00.");
const interviewKindFieldSchema = interviewKindSchema.describe(
	"Interview type: screening, technical, behavioral, onsite, or other.",
);
const interviewDurationSchema = interviewDetailsSchema.shape.durationMinutes
	.unwrap()
	.describe("Length in minutes (5–1440).");
const interviewLocationSchema = interviewDetailsSchema.shape.location
	.unwrap()
	.describe("Meeting link, address, or phone number.");
const interviewNotesSchema = interviewDetailsSchema.shape.notes
	.unwrap()
	.describe("Interviewers, topics to prepare, or other details.");
const httpUrlSchema = z
	.string()
	.trim()
	.pipe(z.url({ protocol: /^https?$/, error: "URL must use http or https." }));
const pdfBase64Schema = z
	.base64()
	.max(3 * 1024 * 1024)
	.describe(
		"Base64 PDF, maximum 3 MiB encoded (about 2.25 MiB decoded). For larger PDFs, supply an owned storagePath.",
	);

const applicationMutableFieldsSchema = {
	company: z.string().min(1).optional().describe("Company name."),
	role: z.string().min(1).optional().describe("Role or job title."),
	status: applicationStatusSchema
		.optional()
		.describe("Pipeline stage. `closed` ends the application; say why in `closedReason`."),
	closedReason: applicationClosedReasonSchema
		.nullable()
		.optional()
		.describe("Why a closed application ended: not-selected, withdrew, accepted-other or no-response."),
	location: z.string().nullable().optional(),
	salary: z.string().nullable().optional(),
	source: z.string().nullable().optional(),
	sourceUrl: httpUrlSchema.nullable().optional(),
	jobDescription: z.string().max(20_000).nullable().optional(),
	notes: z.string().nullable().optional(),
	resumeId: z.string().nullable().optional(),
	coverLetterId: z.string().nullable().optional().describe("The saved cover letter sent with the application."),
	resumeFileUrl: z.string().nullable().optional(),
	resumeFileName: z.string().nullable().optional(),
	coverLetterUrl: z.string().nullable().optional(),
	coverLetterName: z.string().nullable().optional(),
	followUpAt: z
		.string()
		.datetime({ offset: true })
		.nullable()
		.optional()
		.describe("Follow-up timestamp in ISO 8601 format."),
	followUpNote: z.string().nullable().optional(),
	contacts: z.array(contactSchema).optional(),
	tags: z.array(z.string()).optional(),
} as const;

const createApplicationSchema = z
	.object({
		...applicationMutableFieldsSchema,
		company: z.string().min(1).describe("Company name."),
		role: z.string().min(1).describe("Role or job title."),
		stageEnteredAt: timelineDateSchema.optional().describe("Initial stage date in YYYY-MM-DD format."),
	})
	.strict();

// SDK discovery requires pure JSON schemas; API handlers still validate native DTOs.
function wireInput<T extends z.ZodObject>(schema: T): T {
	const wire = toWireSchema(schema, "input");
	if (!(wire instanceof z.ZodObject)) throw new Error("MCP tool input must be an object.");
	return wire as T;
}

const messageOutput = z.object({ message: z.string() });
const idOutput = z.object({ id: z.string() });

const BASE_TOOL_META = {
	[T.listResumes]: {
		title: "List Resumes",
		description: [
			"Primary way to discover resume IDs for this account. Resumes are not listed as MCP resources;",
			"use this tool (not `resources/list`) to enumerate IDs.",
			"",
			"Returns an array of resume objects (without full resume data) containing:",
			"id, name, slug, tags, isPublic, isLocked, createdAt, updatedAt.",
			"",
			`Call this before \`${T.getResume}\`, \`${T.patchResume}\`, prompts, or \`resources/read\` with \`resume://{id}\`.`,
			"Results can be filtered by tags and sorted by last updated date, creation date, or name.",
		].join("\n"),
		outputSchema: toWireObjectSchema(resumeDto.list.output),
		inputSchema: wireInput(
			z.strictObject({
				tags: z
					.array(z.string())
					.optional()
					.default([])
					.describe(
						"Filter resumes by tags. Only resumes matching ALL specified tags are returned. Default: no filter.",
					),
				sort: z
					.enum(["lastUpdatedAt", "createdAt", "name"])
					.optional()
					.default("lastUpdatedAt")
					.describe("Sort order for results. Default: lastUpdatedAt."),
			}),
		),
		annotations: READ_IDEMPOTENT,
	},
	[T.listResumeTags]: {
		title: "List Resume Tags",
		description: [
			"Returns a sorted list of every distinct tag used across your resumes.",
			"Useful for choosing tag filters when calling list tools or keeping naming consistent.",
		].join("\n"),
		outputSchema: z.object({ items: z.array(z.string()) }),
		inputSchema: wireInput(z.strictObject({})),
		annotations: READ_IDEMPOTENT,
	},
	[T.getResume]: {
		title: "Read Resume",
		description: [
			"Get the full data of a specific resume by its ID.",
			"",
			"Returns the complete resume data as JSON, including: basics (name, headline, email, phone,",
			"location, website), summary, picture settings, all sections (experience, education, skills,",
			"projects, etc.), custom sections, and metadata (template, layout, typography, colors).",
			"",
			`Use \`${T.listResumes}\` first to find valid IDs.`,
			"The `resume://_meta/schema` resource describes the full data structure for JSON Patch paths.",
		].join("\n"),
		outputSchema: toWireObjectSchema(resumeDto.getById.output),
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: READ_IDEMPOTENT,
	},
	[T.downloadResumePdf]: {
		title: "Download Resume PDF",
		description: [
			"Create a short-lived authenticated URL for downloading a resume as a PDF.",
			"The URL expires in 10 minutes. Anyone holding this URL can download the PDF until expiry; keep it private.",
			"Cover letters are documents of their own: use the cover-letter tools for them.",
			"Returns JSON containing: resumeId, name, downloadUrl, expiresAt, expiresInSeconds, contentType.",
			`Use \`${T.listResumes}\` first to find valid IDs.`,
		].join("\n"),
		outputSchema: z.object({
			resumeId: z.string(),
			name: z.string(),
			downloadUrl: z.url(),
			expiresAt: z.iso.datetime({ offset: true }),
			expiresInSeconds: z.number().int().positive(),
			contentType: z.literal("application/pdf"),
		}),
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: READ_NON_IDEMPOTENT,
	},
	[T.createResume]: {
		title: "Create Resume",
		description: [
			"Create a new, empty resume with a name. Its URL-friendly slug is generated when omitted.",
			"",
			"Returns the ID of the newly created resume.",
			"Set `withSampleData` to true to pre-fill with example content (useful for testing).",
			`After creating, use \`${T.getResume}\` to view or \`${T.patchResume}\` to populate it.`,
		].join("\n"),
		outputSchema: idOutput,
		inputSchema: wireInput(
			z.strictObject({
				name: z.string().min(1).max(64).describe("Display name for the resume (e.g. 'Software Engineer 2026')"),
				slug: z
					.string()
					.min(1)
					.max(64)
					.optional()
					.describe("Optional URL-friendly slug; generated from the name when omitted."),
				tags: z
					.array(z.string())
					.optional()
					.default([])
					.describe("Tags to categorize the resume (e.g. ['tech', 'senior'])"),
				withSampleData: z.boolean().optional().default(false).describe("Pre-fill with sample data. Default: false."),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.importResume]: {
		title: "Import Resume",
		description: [
			"Create a new resume from a full ResumeData JSON object (e.g. an exported file from Reactive Resume).",
			"A random name and slug are assigned automatically, like the web importer.",
			`For small edits to an existing resume, prefer \`${T.patchResume}\` instead of re-importing.`,
			"Large payloads may exceed MCP client message limits; in that case, use the web UI or the HTTP API.",
		].join("\n"),
		outputSchema: idOutput,
		inputSchema: wireInput(
			z.strictObject({
				data: z
					.unknown()
					.describe("Complete ResumeData JSON (same shape as `read_resume` body or `resume://_meta/schema`)."),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.duplicateResume]: {
		title: "Duplicate Resume",
		description: [
			"Create a copy of an existing resume with all its data.",
			"",
			"Returns the ID of the newly duplicated resume.",
			"Name and tags default to the original; a unique slug is generated when omitted.",
			"Useful for creating job-specific variants of a base resume.",
		].join("\n"),
		outputSchema: idOutput,
		inputSchema: wireInput(
			z.strictObject({
				id: resumeIdSchema.describe("ID of the resume to duplicate"),
				name: z.string().min(1).max(64).optional().describe("Name for the duplicate; defaults to the original"),
				slug: z.string().min(1).max(64).optional().describe("Optional unique slug; generated when omitted"),
				tags: z.array(z.string()).optional().describe("Tags for the duplicate; defaults to the original"),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.patchResume]: {
		title: "Apply Resume Patch",
		description: [
			"Apply JSON Patch (RFC 6902) operations to partially update a resume's data.",
			"",
			`This is the primary way to edit resume content. Use \`${T.getResume}\` first to inspect the`,
			"current structure, and `resume://_meta/schema` to understand valid paths and types.",
			"",
			"Supported operations: add, remove, replace, move, copy, test.",
			"Can remove or overwrite existing content; edits to a public resume change its published content.",
			"",
			"Common path examples:",
			"  /basics/name                          — Change the name",
			"  /basics/headline                      — Change the headline",
			"  /summary/content                      — Replace summary (HTML string)",
			"  /sections/experience/items/-           — Append a new experience item",
			"  /sections/experience/items/0/company   — Update first experience's company",
			"  /sections/skills/items/-               — Append a new skill",
			"  /metadata/template                     — Change the template (e.g. 'azurill', 'bronzor', 'onyx')",
			"  /metadata/design/colors/primary        — Change the primary color (rgba string)",
			"  /sections/interests/hidden              — Hide/show a section",
			"  /sections/experience/items/0/dates      — Set dates: { start, end, present } with years or",
			"                                            year-months ('2022' or '2022-03')",
			"",
			"Dates: write `dates`; the text in `period` (or `date` for awards, certifications and",
			"publications) is rewritten from it in the resume's locale, so an edit to the text alone is lost.",
			"Important: HTML content fields (description, summary.content) must use valid HTML.",
			"New items must include a valid UUID as `id` and `hidden: false`.",
			`Locked resumes cannot be patched. Ask the user before unlocking with \`${T.unlockResume}\`.`,
		].join("\n"),
		outputSchema: toWireObjectSchema(resumeDto.patch.output),
		inputSchema: wireInput(
			z.strictObject({
				id: resumeIdSchema,
				operations: resumePatchOperationsSchema,
			}),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.updateResume]: {
		title: "Update Resume (metadata)",
		description: [
			"Update resume display name, URL slug, tags, visibility, download settings, or full document data.",
			"Prefer JSON Patch with expectedUpdatedAt for content edits to avoid overwriting concurrent changes.",
			`Locked resumes cannot be updated. Ask the user before unlocking with \`${T.unlockResume}\`.`,
			"Use the account security workflow to manage password protection.",
			"",
			"Always returns your canonical share URL (`{app}/{username}/{slug}`). Anonymous viewers can use it only when `isPublic` is true; password protection from the web app still applies.",
		].join("\n"),
		outputSchema: toWireObjectSchema(
			resumeDto.update.output
				.pick({ id: true, name: true, slug: true, tags: true, isPublic: true, hasPassword: true })
				.extend({ shareUrl: z.string() }),
		),
		inputSchema: wireInput(
			z.strictObject({
				id: resumeIdSchema,
				name: z.string().min(1).max(64).optional().describe("Display name for the resume."),
				slug: z
					.string()
					.min(1)
					.max(64)
					.optional()
					.describe(
						"New URL slug: lowercase letters and numbers joined by single dashes (e.g. 'product-designer'), unique among your resumes. The old address keeps redirecting for 30 days.",
					),
				tags: z.array(z.string()).optional().describe("Replace the resume's tags (omit to leave unchanged)."),
				isPublic: z
					.boolean()
					.optional()
					.describe(
						"When true, anyone with the link can view the public resume (subject to password if set in the app).",
					),
			}),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.deleteResume]: {
		title: "Delete Resume",
		description: [
			"Move a resume to Trash, removing public access if published.",
			"",
			"It stays in Trash for 30 days, where the user can restore it from the app; then it and its files are deleted.",
			`Locked resumes cannot be moved; use \`${T.unlockResume}\` first.`,
		].join("\n"),
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: { ...WRITE_DESTRUCTIVE, openWorldHint: true },
	},
	[T.lockResume]: {
		title: "Lock Resume",
		description: [
			"Lock a resume to prevent any modifications.",
			"",
			`When locked, a resume cannot be edited (${T.patchResume}, ${T.updateResume}) or deleted.`,
			"Useful for protecting finalized resumes from accidental changes.",
			`Use \`${T.unlockResume}\` to re-enable editing.`,
		].join("\n"),
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: WRITE_IDEMPOTENT,
	},
	[T.unlockResume]: {
		title: "Unlock Resume",
		description: "Unlock a previously locked resume, re-enabling edits, patches, and deletion.",
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: WRITE_IDEMPOTENT,
	},
	[T.getResumeStatistics]: {
		title: "Get Resume Statistics",
		description: [
			"Get view and download statistics for a resume.",
			"",
			"Returns: isPublic (boolean), views (count), downloads (count),",
			"lastViewedAt (timestamp or null), lastDownloadedAt (timestamp or null).",
		].join("\n"),
		outputSchema: toWireObjectSchema(
			z.object({
				isPublic: z.boolean(),
				views: z.number(),
				downloads: z.number(),
				lastViewedAt: z.date().nullable(),
				lastDownloadedAt: z.date().nullable(),
			}),
		),
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: READ_IDEMPOTENT,
	},
	[T.listCoverLetters]: {
		title: "List Cover Letters",
		description: [
			"List independent cover letters in the account's cover-letter library.",
			"Letters are documents of their own, never part of a resume; attach one to an application with `coverLetterId`.",
			"Use this before other independent cover-letter tools to discover IDs.",
		].join("\n"),
		outputSchema: toWireObjectSchema(
			coverLetterDto.list.output.extend({ limit: z.number(), offset: z.number(), nextOffset: z.number().nullable() }),
		),
		inputSchema: wireInput(
			z.strictObject({
				search: z.string().max(100).optional().describe("Filter by cover-letter name."),
				resumeId: z.string().min(1).optional().describe("Filter by source resume ID."),
				applicationId: z.string().min(1).optional().describe("Filter by source application ID."),
				limit: z.number().int().min(1).max(100).optional().default(20).describe("Maximum results. Default: 20."),
				offset: z.number().int().min(0).optional().default(0).describe("Number of results to skip. Default: 0."),
			}),
		),
		annotations: READ_IDEMPOTENT,
	},
	[T.readCoverLetter]: {
		title: "Read Cover Letter",
		description: [
			"Read one independent cover letter from the cover-letter library.",
			`Use \`${T.listCoverLetters}\` first to find valid IDs.`,
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.getById.output),
		inputSchema: wireInput(z.strictObject({ id: coverLetterIdSchema })),
		annotations: READ_IDEMPOTENT,
	},
	[T.createCoverLetter]: {
		title: "Create Cover Letter",
		description: [
			"Create an independent cover letter in the cover-letter library.",
			"Optionally link it to a resume (for its sender details and design) or an application.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.create.output),
		inputSchema: wireInput(
			z.strictObject({
				...coverLetterEditableFieldsSchema,
				recipient: z.string().max(20_000).optional().default(""),
				content: z.string().max(100_000).optional().default(""),
				resumeId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional resume the letter goes with; its sender details and design are linked live."),
				applicationId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional application the letter is for; it fills the recipient and becomes its letter."),
				template: templateSchema.optional().describe("Optional template of the letter's own (unlinks the design)."),
				layout: z
					.enum(["structured", "freeform"])
					.optional()
					.describe("Defaults to structured, or freeform when a recipient block is given."),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.updateCoverLetter]: {
		title: "Update Cover Letter",
		description: [
			"Update an independent cover letter's name, recipient, content, template, or its links to a resume and application.",
			"Pass the latest `revision` as `expectedRevision`; stale writes are rejected instead of overwriting newer edits.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.update.output),
		inputSchema: wireInput(
			z.strictObject({
				id: coverLetterIdSchema,
				expectedRevision: expectedRevisionSchema,
				...coverLetterEditableFieldsSchema,
				name: coverLetterEditableFieldsSchema.name.optional(),
				template: templateSchema
					.optional()
					.describe("Replacement template, which unlinks the design. Omit to keep the current template."),
				resumeId: z.string().min(1).nullable().optional().describe("The resume the letter goes with."),
				applicationId: z.string().min(1).nullable().optional().describe("The application the letter is for."),
				senderLinked: z.boolean().optional().describe("Take the sender's details live from the resume."),
				designLinked: z.boolean().optional().describe("Take the design live from the resume."),
			}),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
	},
	[T.refreshCoverLetterStyle]: {
		title: "Refresh Cover Letter Style",
		description: [
			"Refresh an independent cover letter's sender styling from a resume while preserving its content and template.",
			"Pass the latest `revision` as `expectedRevision` to prevent stale concurrent writes.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.refreshStyle.output),
		inputSchema: wireInput(
			z.strictObject({
				id: coverLetterIdSchema,
				expectedRevision: expectedRevisionSchema,
				resumeId: z.string().min(1).describe("Resume ID to copy sender styling from."),
			}),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
	},
	[T.duplicateCoverLetter]: {
		title: "Duplicate Cover Letter",
		description: [
			"Create an independent copy of a cover letter in the library.",
			"The copy is separate from the original.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.duplicate.output),
		inputSchema: wireInput(z.strictObject({ id: coverLetterIdSchema, name: z.string().min(1).max(100).optional() })),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.deleteCoverLetter]: {
		title: "Delete Cover Letter",
		description: [
			"Move an independent cover letter to Trash, where it stays for 30 days before it's deleted.",
			"Pass the latest `revision` as `expectedRevision`.",
		].join("\n"),
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: coverLetterIdSchema, expectedRevision: expectedRevisionSchema })),
		annotations: { ...WRITE_DESTRUCTIVE, openWorldHint: true },
	},
	[T.exportCoverLetter]: {
		title: "Export Cover Letter",
		description: ["Export an independent library cover letter as versioned Reactive Resume cover-letter JSON."].join(
			"\n",
		),
		outputSchema: toWireObjectSchema(coverLetterDto.export.output),
		inputSchema: wireInput(z.strictObject({ id: coverLetterIdSchema })),
		annotations: READ_IDEMPOTENT,
	},
	[T.importCoverLetter]: {
		title: "Import Cover Letter",
		description: [
			"Import a versioned Reactive Resume cover-letter JSON document as a new independent library letter.",
			"Use `export_cover_letter` to obtain the accepted document format.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.import.output),
		inputSchema: wireInput(
			z.strictObject({
				document: coverLetterDocumentSchema.describe("Versioned independent cover-letter JSON document."),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.listApplications]: {
		title: "List Applications",
		description:
			"List job applications for the authenticated account, including contacts, notes, document URLs, and timeline. Use this before reading or updating existing applications.",
		outputSchema: toWireObjectSchema(applicationDto.list.output),
		inputSchema: wireInput(
			z.strictObject({
				status: applicationStatusSchema.optional(),
				tags: z.array(z.string()).optional().default([]),
			}),
		),
		annotations: READ_IDEMPOTENT,
	},
	[T.readApplication]: {
		title: "Read Application",
		description: "Read one full job application, including contacts, document URLs, follow-up details, and timeline.",
		outputSchema: toWireObjectSchema(applicationDto.getById.output),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema })),
		annotations: READ_IDEMPOTENT,
	},
	[T.listApplicationTags]: {
		title: "List Application Tags",
		description: "Return every distinct tag used across job applications.",
		outputSchema: z.object({ items: z.array(z.string()) }),
		inputSchema: wireInput(z.strictObject({})),
		annotations: READ_IDEMPOTENT,
	},
	[T.getApplicationStats]: {
		title: "Get Application Stats",
		description: "Return aggregate application counts by pipeline stage and source.",
		outputSchema: toWireObjectSchema(applicationDto.stats.output),
		inputSchema: wireInput(z.strictObject({})),
		annotations: READ_IDEMPOTENT,
	},
	[T.createApplication]: {
		title: "Create Application",
		description: "Create a tracked job application. Company and role are required.",
		outputSchema: idOutput,
		inputSchema: wireInput(createApplicationSchema),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.updateApplication]: {
		title: "Update Application",
		description:
			"Update application fields, move stages (closing takes a reason), edit contacts, follow-up, tags, or the linked resume and letter. Provided fields replace existing values, including contact and tag lists. Once an application with a linked resume reaches Applied, the resume is saved as a sent version.",
		outputSchema: toWireObjectSchema(applicationDto.update.output),
		inputSchema: wireInput(
			z.strictObject({
				id: applicationIdSchema,
				...applicationMutableFieldsSchema,
			}),
		),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.addApplicationNote]: {
		title: "Add Application Note",
		description: "Append a free-text note to an application's timeline.",
		outputSchema: toWireObjectSchema(applicationDto.addNote.output),
		inputSchema: wireInput(
			z.strictObject({
				id: applicationIdSchema,
				text: z.string().min(1),
				date: timelineDateSchema.optional().describe("Optional note date in YYYY-MM-DD format."),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.addApplicationInterview]: {
		title: "Add Application Interview",
		description: `Schedule an interview on an application. Interviews appear on the application's activity timeline and the Applications calendar; an application can have any number of them. Delete one with \`${T.deleteApplicationTimelineEntry}\`.`,
		outputSchema: toWireObjectSchema(applicationDto.addInterview.output),
		inputSchema: wireInput(
			z.strictObject({
				id: applicationIdSchema,
				at: interviewAtSchema,
				kind: interviewKindFieldSchema,
				durationMinutes: interviewDurationSchema.optional().describe("Length in minutes (5–1440). Defaults to 60."),
				location: interviewLocationSchema.optional(),
				notes: interviewNotesSchema.optional(),
			}),
		),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.updateApplicationInterview]: {
		title: "Update Application Interview",
		description:
			'Reschedule or edit an interview timeline entry. Only provided fields change. The entry must have type "interview".',
		outputSchema: toWireObjectSchema(applicationDto.updateInterview.output),
		inputSchema: wireInput(
			z.strictObject({
				id: applicationIdSchema,
				entryId: applicationTimelineEntryIdSchema,
				at: interviewAtSchema.optional(),
				kind: interviewKindFieldSchema.optional(),
				durationMinutes: interviewDurationSchema.optional(),
				location: interviewLocationSchema.optional(),
				notes: interviewNotesSchema.optional(),
			}),
		),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.updateApplicationTimelineEntry]: {
		title: "Update Application Timeline Entry",
		description: `Update a stage or note timeline entry date, or note text for note entries. Interview entries are rejected; use \`${T.updateApplicationInterview}\` for them.`,
		outputSchema: toWireObjectSchema(applicationDto.updateTimelineEntry.output),
		inputSchema: wireInput(
			z
				.object({
					id: applicationIdSchema,
					entryId: applicationTimelineEntryIdSchema,
					date: timelineDateSchema.optional().describe("Replacement row date in YYYY-MM-DD format."),
					text: z.string().min(1).optional().describe("Replacement note text. Only note entries can change text."),
				})
				.refine((value) => value.date !== undefined || value.text !== undefined, "Provide date or text to update."),
		),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.deleteApplicationTimelineEntry]: {
		title: "Delete Application Timeline Entry",
		description: "Delete a note, interview, or older stage entry. The current stage entry cannot be deleted.",
		outputSchema: toWireObjectSchema(applicationDto.deleteTimelineEntry.output),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema, entryId: applicationTimelineEntryIdSchema })),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.deleteApplication]: {
		title: "Delete Application",
		description:
			"Permanently delete one job application and its owned uploaded documents that no remaining application references, removing those authenticated file URLs.",
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema })),
		annotations: { ...WRITE_DESTRUCTIVE, openWorldHint: true },
	},
	[T.bulkUpdateApplications]: {
		title: "Bulk Update Applications",
		description: "Move (closing takes a reason) or add tags to multiple applications.",
		outputSchema: toWireObjectSchema(applicationDto.bulkUpdate.output),
		inputSchema: wireInput(
			z.strictObject({
				ids: z.array(z.string()).min(1),
				status: applicationStatusSchema.optional(),
				closedReason: applicationClosedReasonSchema.nullable().optional(),
				addTags: z.array(z.string()).optional(),
			}),
		),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.bulkDeleteApplications]: {
		title: "Bulk Delete Applications",
		description:
			"Permanently delete multiple applications and their owned uploaded documents that no remaining application references, removing those authenticated file URLs.",
		outputSchema: toWireObjectSchema(applicationDto.bulkDelete.output),
		inputSchema: wireInput(z.strictObject({ ids: z.array(z.string()).min(1) })),
		annotations: { ...WRITE_DESTRUCTIVE, openWorldHint: true },
	},
	[T.importApplications]: {
		title: "Import Applications",
		description: "Bulk-create application rows parsed from CSV or another source. Maximum 500 items.",
		outputSchema: toWireObjectSchema(applicationDto.import.output),
		inputSchema: wireInput(z.strictObject({ items: z.array(createApplicationSchema).min(1).max(500) })),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.attachApplicationDocument]: {
		title: "Attach Application Document",
		description:
			"Upload and attach a resume or cover-letter PDF, maximum 10 MiB. Inline base64 is limited to 3 MiB encoded; larger files require an owned storagePath from POST /api/files. The resulting file URL requires authentication as the owner. Replaces the existing attachment of that kind and deletes its owned file if no other application references it. Does not send the document to an employer.",
		outputSchema: toWireObjectSchema(applicationDto.attachDocument.output),
		inputSchema: wireInput(
			z
				.strictObject({
					id: applicationIdSchema,
					kind: applicationDocumentKindSchema,
					fileName: z.string().min(1),
					contentType: z.literal("application/pdf"),
					dataBase64: pdfBase64Schema.optional(),
					storagePath: z
						.string()
						.min(1)
						.optional()
						.describe("Owned storage key from POST /api/files, for files up to 10 MiB."),
				})
				.refine(
					(value) => (value.dataBase64 === undefined) !== (value.storagePath === undefined),
					"Supply exactly one of dataBase64 or storagePath.",
				),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.removeApplicationDocument]: {
		title: "Remove Application Document",
		description:
			"Clear a resume or cover-letter attachment and delete its owned uploaded file if no other application references it, removing access through its authenticated file URL.",
		outputSchema: toWireObjectSchema(applicationDto.removeDocument.output),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema, kind: applicationDocumentKindSchema })),
		annotations: { ...WRITE_DESTRUCTIVE, openWorldHint: true },
	},
	[T.autofillApplicationFromJob]: {
		title: "Autofill Application From Job",
		description:
			"Send a pasted job posting to your configured AI provider to extract company, role, location, and salary. Requires an enabled, tested default AI provider. Returns suggestions without saving an application or fetching a job URL.",
		outputSchema: z.object({ company: z.string(), role: z.string(), location: z.string(), salary: z.string() }),
		inputSchema: wireInput(z.strictObject({ jobDescription: z.string().trim().min(1).max(20_000) })),
		annotations: { ...READ_NON_IDEMPOTENT, openWorldHint: true },
	},
	[T.scoreApplicationMatch]: {
		title: "Score Application Match",
		description:
			"Send the full linked resume and job description to your configured AI provider to score their match. Requires an enabled, tested default AI provider, a linked resume, and a job description. Overwrites the application's saved match score and AI metadata.",
		outputSchema: z.object({
			score: z.number().int().min(0).max(100),
			gaps: z.array(z.string()).max(8),
			strengths: z.array(z.string()).max(8),
		}),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema })),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.tailorResumeForApplication]: {
		title: "Tailor Resume For Application",
		description:
			"Send the full linked resume and job description to your configured AI provider to rewrite the summary in a new private resume copy. Requires an enabled, tested default AI provider, a linked resume, and a job description. Replaces the application's resume link with the new copy and adds a timeline note; the original resume is unchanged.",
		outputSchema: z.object({ resumeId: z.string(), name: z.string() }),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema })),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.draftApplicationMessage]: {
		title: "Draft Application Message",
		description:
			"Send application context and the full linked resume, when available, to your configured AI provider to draft a cover letter or recruiter follow-up. Requires an enabled, tested default AI provider. Cover-letter mode saves a new cover letter and returns text plus coverLetterId; follow-up mode returns text without saving it. Neither mode sends a message to a recruiter.",
		outputSchema: z.object({ text: z.string(), coverLetterId: z.string().optional() }),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema, kind: z.enum(["cover-letter", "follow-up"]) })),
		annotations: { ...WRITE_NON_IDEMPOTENT, openWorldHint: true },
	},
} as const;

const pagination = {
	limit: z.number().int().min(1).max(100).default(20).describe("Maximum rows per page; default 20."),
	offset: z.number().int().min(0).default(0).describe("Rows to skip; default 0."),
};
const applicationDateFields = {
	followUpAt: z.iso
		.datetime({ offset: true })
		.nullable()
		.optional()
		.describe("Follow-up timestamp with timezone offset."),
};
// Shared DTOs keep fields, validation and limits aligned with API contracts.
export const TOOL_META = {
	...BASE_TOOL_META,
	[T.listResumes]: {
		...BASE_TOOL_META[T.listResumes],
		inputSchema: wireInput(BASE_TOOL_META[T.listResumes].inputSchema.extend(pagination)),
		outputSchema: toWireObjectSchema(
			z.object({
				items: resumeDto.list.output,
				limit: z.number(),
				offset: z.number(),
				nextOffset: z.number().nullable(),
			}),
		),
	},
	[T.getResume]: {
		...BASE_TOOL_META[T.getResume],
		description:
			BASE_TOOL_META[T.getResume].description +
			" Structured output also includes record metadata and updatedAt for expectedUpdatedAt.",
		outputSchema: toWireObjectSchema(resumeDto.getById.output),
	},
	[T.createResume]: {
		...BASE_TOOL_META[T.createResume],
		inputSchema: wireInput(
			resumeDto.create.input.extend({ tags: resumeDto.create.input.shape.tags.default([]) }).strict(),
		),
		outputSchema: idOutput,
	},
	[T.duplicateResume]: {
		...BASE_TOOL_META[T.duplicateResume],
		inputSchema: wireInput(resumeDto.duplicate.input.strict()),
		outputSchema: idOutput,
	},
	[T.importResume]: { ...BASE_TOOL_META[T.importResume], outputSchema: idOutput },
	[T.patchResume]: {
		...BASE_TOOL_META[T.patchResume],
		inputSchema: wireInput(
			BASE_TOOL_META[T.patchResume].inputSchema
				.extend({
					expectedUpdatedAt: z.iso
						.datetime({ offset: true })
						.optional()
						.describe(
							"updatedAt from the latest read_resume. Rejects changes when document has changed since that read.",
						),
				})
				.strict(),
		),
		outputSchema: toWireObjectSchema(resumeDto.patch.output),
	},
	[T.updateResume]: {
		...BASE_TOOL_META[T.updateResume],
		inputSchema: wireInput(resumeDto.update.input.strict()),
		outputSchema: toWireObjectSchema(
			resumeDto.update.output
				.pick({ id: true, name: true, slug: true, tags: true, isPublic: true, hasPassword: true })
				.extend({ shareUrl: z.string() }),
		),
	},
	[T.createCoverLetter]: {
		...BASE_TOOL_META[T.createCoverLetter],
		inputSchema: wireInput(coverLetterDto.create.input.strict()),
		outputSchema: toWireObjectSchema(coverLetterDto.create.output),
	},
	[T.updateCoverLetter]: {
		...BASE_TOOL_META[T.updateCoverLetter],
		inputSchema: wireInput(coverLetterDto.update.input.strict()),
		outputSchema: toWireObjectSchema(coverLetterDto.update.output),
	},
	[T.listApplications]: {
		...BASE_TOOL_META[T.listApplications],
		inputSchema: wireInput(BASE_TOOL_META[T.listApplications].inputSchema.extend(pagination).strict()),
		outputSchema: toWireObjectSchema(
			z.object({
				items: applicationDto.list.output,
				limit: z.number(),
				offset: z.number(),
				nextOffset: z.number().nullable(),
			}),
		),
	},
	[T.createApplication]: {
		...BASE_TOOL_META[T.createApplication],
		inputSchema: wireInput(applicationDto.create.input.extend(applicationDateFields).strict()),
		outputSchema: idOutput,
	},
	[T.updateApplication]: {
		...BASE_TOOL_META[T.updateApplication],
		inputSchema: wireInput(applicationDto.update.input.extend(applicationDateFields).strict()),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
		outputSchema: toWireObjectSchema(applicationDto.update.output),
	},
	[T.importApplications]: {
		...BASE_TOOL_META[T.importApplications],
		inputSchema: wireInput(
			z
				.strictObject({
					items: z.array(applicationDto.create.input.extend(applicationDateFields).strict()).min(1).max(500),
				})
				.strict(),
		),
		outputSchema: toWireObjectSchema(applicationDto.import.output),
	},
	[T.bulkUpdateApplications]: {
		...BASE_TOOL_META[T.bulkUpdateApplications],
		inputSchema: wireInput(applicationDto.bulkUpdate.input.strict()),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
		outputSchema: toWireObjectSchema(applicationDto.bulkUpdate.output),
	},
	[T.bulkDeleteApplications]: {
		...BASE_TOOL_META[T.bulkDeleteApplications],
		inputSchema: wireInput(applicationDto.bulkDelete.input.strict()),
		outputSchema: toWireObjectSchema(applicationDto.bulkDelete.output),
	},
} as const;
