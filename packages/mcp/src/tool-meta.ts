/**
 * Canonical tool metadata (title, description, inputSchema, annotations) declared once.
 * Consumed by both `registerTools` (raw Zod) and `buildMcpServerCard` (toJsonSchemaCompat).
 */
import type { BehaviorAnnotations } from "./annotations";
import z from "zod";
import { resumePatchOperationsSchema } from "@reactive-resume/ai/tools/resume-tool-contracts";
import { applicationDto } from "@reactive-resume/api/dto/application";
import { coverLetterDto } from "@reactive-resume/api/dto/cover-letter";
import { resumeDto } from "@reactive-resume/api/dto/resume";
import {
	applicationStatusSchema,
	interviewDetailsSchema,
	interviewKindSchema,
} from "@reactive-resume/schema/applications/data";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { READ_IDEMPOTENT, WRITE_DESTRUCTIVE_EXTERNAL, WRITE_NON_IDEMPOTENT, WRITE_DESTRUCTIVE } from "./annotations";
import { toWireObjectSchema, toWireSchema } from "./contracts";
import { MCP_TOOL_NAME as T } from "./mcp-tool-names";

// Contracts remain derived from the allowlisted API procedures in parity.ts.
export const PARITY_TOOL_DESCRIPTIONS: Record<string, string> = {
	"auth.exportData":
		"Export account documents and Career data. Private application profile is excluded from MCP results; export it in Settings → Profile.",
	"applications.lanes.get":
		"Read the account's ordered application stages and settings revision, including retired stages for history. Initializes missing default stages idempotently. Use returned lane IDs to select custom stages when creating or moving applications; category retains canonical workflow meaning.",
	"applications.lanes.create":
		"Add an owned application stage with a label, hex color and immutable canonical category. A Closed stage may preset its closure reason, for example no-response for Ghosted. Read stages first and send expectedRevision; stale changes return CONFLICT. Does not move or submit applications.",
	"applications.lanes.update":
		"Rename or recolor an owned application stage. Category and closure preset stay fixed; history keeps its semantic meaning. Read stages first and send expectedRevision; stale changes return CONFLICT.",
	"applications.lanes.reorder":
		"Replace the display order of all active owned application stages. Supply every active ID exactly once with expectedRevision. Reordering does not change application workflow milestones, submission dates or outcomes.",
	"applications.lanes.retire":
		"Retire a custom stage and move its current applications to an explicit active replacement with the same category and closure preset. Default system stages cannot be retired. Preserves applications, submitted documents and historical stage identities. Read stages first and send expectedRevision.",
	"applications.priorNoResponse":
		"Read at most ten owned applications with a current or recorded historical no-response outcome at the given company, matched conservatively by case and whitespace. Advisory evidence only: does not block, close or submit an application. Cleared outcomes from before outcome history was recorded cannot be reconstructed.",
	"documents.list":
		"List owned resumes and cover letters, optionally from Trash. Listing Trash also permanently purges documents older than 30 days and their owned files.",
	"aiProviders.list":
		"List saved AI providers with redacted credentials. When AI is server-managed, synchronize the account's managed provider record with server configuration. Does not contact an AI provider.",
	"aiProviders.test":
		"Test the saved provider/model connection server-side, then replace its saved test status and timestamp and enable or disable the connection based on the result.",
	"agent.threads.get":
		"Read an owned conversation, messages and attachments. If its active run is stale, clear the dead run claim and settle its streaming message state before returning. Does not start generation or call an AI provider.",
	"agent.threads.start":
		"Start a document, application, or general career conversation using a tested saved AI provider. For scope=document, choose exactly one resumeId or coverLetterId. For scope=application, provide applicationId. For scope=career, omit document and application IDs.",
	"career.suggestTargetRoles":
		"Requires recipientVersion from aiProviders.list, disclosed with provider/model/origin before explicit user approval. Changed configuration returns CONFLICT without transmission; refresh and reconfirm. Send explicitly selected resume and opted-in shared Knowledge to the named AI connection for unsaved editable target roles. Requires user context consent. Never uses suggestions in searches or schedules before review and save.",
	"career.profile":
		"Read the user's career preferences: target roles, locations, what matters, minimum base salary, office days, notice period, timezone and memory mode (ask, auto or off).",
	"career.saveProfile":
		"Replace the user's career profile. Read the existing profile first and provide all fields to preserve them; omitted fields reset to their defaults.",
	"career.facts":
		"List career facts with their source and status. A null applicationId selects shared career memory; an applicationId selects that application's available memory. Optionally filter by query.",
	"career.saveFact":
		"Save an evidence-backed career fact with its original source and quote. Use applicationId for application-specific memory or null for shared career memory. Source ownership and scope are validated by the service.",
	"career.updateFact":
		"Correct a saved fact's text (the original is kept in its revisions), switch whether the coach uses it, or explicitly share it across the user's applications.",
	"career.forgetFact":
		"Erase a saved fact's text, source quotation and correction history, and unlink it from stories and saved items. A suppression marker prevents automatic recreation from the same source.",
	"career.stories":
		"List saved STARR stories and their supporting fact IDs for shared career context or an owned application.",
	"career.saveStory":
		"Create a STARR story, or replace an existing story by providing its id. Provide situation, task, action, result, reflection, and supporting fact IDs. Shared stories can only reference shared facts; the service validates ownership and scope.",
	"career.deleteStory": "Delete an owned STARR story. Its supporting facts remain available.",
	"career.savedItems":
		"Read what the coach saved for an application (fit checks, briefings, practice feedback, debriefs, answers, employer replies and offers), or one kind across applications. Outdated items were written before Knowledge or the application changed.",
	"career.deleteSavedItem": "Delete an owned saved item.",
	"career.applyReply":
		"Apply the chosen changes (by index) of a read employer message to its application: stage, follow-up, next-step note, or saving offer terms. This changes the application; it does not send an email.",
	"career.workspace":
		"Read an application's workspace: form answers, the submit checklist, questions to ask, evidence added from Fit, ticked plan rows and the pasted employer message.",
	"coverLetters.draft":
		"Write a draft of a cover letter's body with the user's AI provider, from the letter's linked resume and its application's job posting, using only facts from them. Returns the draft text as chunks in `events` to join in order; `truncated` is true past 500,000 characters. No letter content is saved; server-managed AI can synchronize its account provider record. Write the draft into the letter with `update_cover_letter`. Use variant `shorter` or `personal` with `previous` to revise an earlier draft.",
	"career.saveWorkspace":
		"Save parts of an application's workspace. Each key given replaces that whole key; keys left out keep their values.",
	"career.trackOpportunity":
		"Create an application at Saved from a discovered role, with its posting link and text and the preferences it matched.",
	"career.schedules": "List the user's career discovery, interview preparation, and follow-up schedules.",
	"career.saveSchedule":
		"Create a career schedule, or replace one by providing its id. Explicitly choose enabled and email preferences, nextRunAt, timezone, optional repeat interval, and any application, interview, or saved AI provider. Enabled schedules may later perform research or coaching and send configured notifications; saving does not run a job immediately.",
	"career.deleteSchedule": "Delete an owned career schedule and prevent its future scheduled runs.",
	"career.opportunities":
		"List discovered opportunities for review. Discovery results are suggestions; create a tracked application only when the user chooses one.",
	"career.dismissOpportunity": "Dismiss an owned discovered opportunity from the review queue.",
	"career.notifications": "Read the user's career notifications and their read status.",
	"career.markNotificationRead": "Mark an owned career notification as read.",
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
const timelineDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD.");
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
const interviewParticipantsSchema = interviewDetailsSchema.shape.participants
	.unwrap()
	.describe("Interview participants with names, roles and optional public HTTPS profile URLs.");
const interviewAudienceSchema = interviewDetailsSchema.shape.audience
	.unwrap()
	.describe("Interview audience: recruiter, hiring-manager, practitioner, panel or other.");
const interviewTimezoneSchema = interviewDetailsSchema.shape.timezone
	.unwrap()
	.describe("IANA timezone for the interview, e.g. Europe/Berlin.");
const pdfBase64Schema = z
	.base64()
	.max(3 * 1024 * 1024)
	.describe(
		"Base64 PDF, maximum 3 MiB encoded (about 2.25 MiB decoded). For larger PDFs, supply an owned storagePath.",
	);

// SDK discovery requires pure JSON schemas; API handlers still validate native DTOs.
function wireInput<T extends z.ZodObject>(schema: T): T {
	const wire = toWireSchema(schema, "input");
	if (!(wire instanceof z.ZodObject)) throw new Error("MCP tool input must be an object.");
	return wire as T;
}

const messageOutput = z.object({ message: z.string() });
const idOutput = z.object({ id: z.string() });

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
// Directories show annotations.title as the tool's name, so every tool repeats its title there.
function withAnnotationTitles<T extends Record<string, { title: string; annotations: BehaviorAnnotations }>>(
	meta: T,
): T {
	return Object.fromEntries(
		Object.entries(meta).map(([name, tool]) => [
			name,
			{ ...tool, annotations: { title: tool.title, ...tool.annotations } },
		]),
	) as T;
}

export const TOOL_META = withAnnotationTitles({
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
		outputSchema: toWireObjectSchema(
			z.object({
				items: resumeDto.list.output,
				limit: z.number(),
				offset: z.number(),
				nextOffset: z.number().nullable(),
			}),
		),
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
				...pagination,
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
		description:
			[
				"Get the full data of a specific resume by its ID.",
				"",
				"Returns the complete resume data as JSON, including: basics (name, headline, email, phone,",
				"location, website), summary, picture settings, all sections (experience, education, skills,",
				"projects, etc.), custom sections, and metadata (template, layout, typography, colors).",
				"",
				`Use \`${T.listResumes}\` first to find valid IDs.`,
				"The `resume://_meta/schema` resource describes the full data structure for JSON Patch paths.",
			].join("\n") + " Structured output also includes record metadata and updatedAt for expectedUpdatedAt.",
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
		annotations: READ_IDEMPOTENT,
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
			resumeDto.create.input.extend({ tags: resumeDto.create.input.shape.tags.default([]) }).strict(),
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
					.looseObject({})
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
		inputSchema: wireInput(resumeDto.duplicate.input.strict()),
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
		// Converted twice: the published schema lists every JSON type for nested patch values too.
		inputSchema: wireInput(
			wireInput(z.strictObject({ id: resumeIdSchema, operations: resumePatchOperationsSchema })).extend({
				expectedUpdatedAt: z.iso
					.datetime({ offset: true })
					.optional()
					.describe(
						"updatedAt from the latest read_resume. Rejects changes when document has changed since that read.",
					),
				proposalApplications: resumeDto.patch.input.shape.proposalApplications,
				proposalSafety: resumeDto.patch.input.shape.proposalSafety,
			}),
		),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true, openWorldHint: true },
	},
	[T.updateResume]: {
		title: "Update Resume",
		description: [
			"Update a resume's settings (display name, URL slug, tags, public visibility, download buttons), its web page's Share settings (showInSearchEngines, hideContactDetails, isPrimary), or replace its whole content with `data`.",
			"Ask the user before turning on showInSearchEngines or turning off hideContactDetails: both make personal details easier for strangers to find.",
			`For content edits prefer \`${T.patchResume}\` with expectedUpdatedAt, which changes only what it targets and avoids overwriting concurrent changes.`,
			`Locked resumes cannot be updated. Ask the user before unlocking with \`${T.unlockResume}\`.`,
			"To set a share password, `api_resume_set_password` opens the resume in the app.",
			"",
			"Always returns your canonical share URL (`{app}/{username}/{slug}`). Anonymous viewers can use it only when `isPublic` is true; password protection from the web app still applies.",
		].join("\n"),
		outputSchema: toWireObjectSchema(
			resumeDto.update.output
				.pick({ id: true, name: true, slug: true, tags: true, isPublic: true, hasPassword: true })
				.extend({ shareUrl: z.string() }),
		),
		inputSchema: wireInput(resumeDto.update.input.strict()),
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
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.unlockResume]: {
		title: "Unlock Resume",
		description: "Unlock a previously locked resume, re-enabling edits, patches, and deletion.",
		outputSchema: messageOutput,
		inputSchema: wireInput(z.strictObject({ id: resumeIdSchema })),
		annotations: WRITE_DESTRUCTIVE,
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
		inputSchema: wireInput(coverLetterDto.create.input.strict()),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.updateCoverLetter]: {
		title: "Update Cover Letter",
		description: [
			"Update an independent cover letter's name, recipient, content, template, or its links to a resume and application.",
			"Pass the latest `revision` as `expectedRevision`; stale writes are rejected instead of overwriting newer edits.",
		].join("\n"),
		outputSchema: toWireObjectSchema(coverLetterDto.update.output),
		inputSchema: wireInput(coverLetterDto.update.input.strict()),
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
		annotations: WRITE_DESTRUCTIVE,
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
			"List job applications for the authenticated account, including contacts, notes, document URLs, lane IDs, and timeline. Filter by canonical status or laneId. Discover custom stages with api_applications_lanes_get. Use this before reading or updating existing applications.",
		outputSchema: toWireObjectSchema(
			z.object({
				items: applicationDto.list.output,
				limit: z.number(),
				offset: z.number(),
				nextOffset: z.number().nullable(),
			}),
		),
		inputSchema: wireInput(
			z.strictObject({
				status: applicationStatusSchema.optional(),
				laneId: z.string().min(1).optional().describe("Owned application lane ID from api_applications_lanes_get."),
				tags: z.array(z.string()).optional().default([]),
				...pagination,
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
		description:
			"Create a tracked job application. Company and role are required. Set laneId from api_applications_lanes_get to select a custom stage; its category determines canonical status and any closure preset. This does not submit to an employer.",
		outputSchema: idOutput,
		inputSchema: wireInput(applicationDto.create.input.extend(applicationDateFields).strict()),
		annotations: WRITE_NON_IDEMPOTENT,
	},
	[T.updateApplication]: {
		title: "Update Application",
		description:
			"Update application fields, move stages with laneId from api_applications_lanes_get (or canonical status), edit contacts, follow-up, tags, or the linked resume and letter. A custom Closed lane can preset its outcome; canonical Closed also accepts legacy reasonless writes. Same-category lane moves record lane history without resetting submission dates. Provided fields replace existing values, including contact and tag lists. Once an application with a linked resume reaches Applied, the resume is saved as a sent version.",
		outputSchema: toWireObjectSchema(applicationDto.update.output),
		inputSchema: wireInput(applicationDto.update.input.extend(applicationDateFields).strict()),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
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
				participants: interviewParticipantsSchema
					.optional()
					.describe("Interview participants. Defaults to an empty list."),
				audience: interviewAudienceSchema.optional().describe("Interview audience. Defaults to other."),
				timezone: interviewTimezoneSchema.optional().describe("Interview IANA timezone. Defaults to UTC."),
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
				participants: interviewParticipantsSchema.optional(),
				audience: interviewAudienceSchema.optional(),
				timezone: interviewTimezoneSchema.optional(),
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
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.bulkUpdateApplications]: {
		title: "Bulk Update Applications",
		description:
			"Move multiple applications to laneId from api_applications_lanes_get or a canonical status, or add tags. Lane category and closure presets apply to every application; existing submission snapshots remain intact. An outcome-only closedReason update requires every selected application to be Closed; otherwise include a Closed status/laneId. Contradictions fail atomically.",
		outputSchema: toWireObjectSchema(applicationDto.bulkUpdate.output),
		inputSchema: wireInput(applicationDto.bulkUpdate.input.strict()),
		annotations: { ...WRITE_NON_IDEMPOTENT, destructiveHint: true },
	},
	[T.bulkDeleteApplications]: {
		title: "Bulk Delete Applications",
		description:
			"Permanently delete multiple applications and their owned uploaded documents that no remaining application references, removing those authenticated file URLs.",
		outputSchema: toWireObjectSchema(applicationDto.bulkDelete.output),
		inputSchema: wireInput(applicationDto.bulkDelete.input.strict()),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.importApplications]: {
		title: "Import Applications",
		description: "Bulk-create application rows parsed from CSV or another source. Maximum 500 items.",
		outputSchema: toWireObjectSchema(applicationDto.import.output),
		inputSchema: wireInput(
			z.strictObject({
				items: z.array(applicationDto.create.input.extend(applicationDateFields).strict()).min(1).max(500),
			}),
		),
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
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.removeApplicationDocument]: {
		title: "Remove Application Document",
		description:
			"Clear a resume or cover-letter attachment and delete its owned uploaded file if no other application references it, removing access through its authenticated file URL.",
		outputSchema: toWireObjectSchema(applicationDto.removeDocument.output),
		inputSchema: wireInput(z.strictObject({ id: applicationIdSchema, kind: applicationDocumentKindSchema })),
		annotations: WRITE_DESTRUCTIVE,
	},
	[T.autofillApplicationFromJob]: {
		title: "Autofill Application From Job",
		description:
			"Send a pasted job posting to your configured AI provider to extract company, role, location, and salary. Requires an enabled, tested default AI provider. Returns suggestions without saving an application or fetching a job URL. Server-managed AI can synchronize its account provider record.",
		outputSchema: z.object({ company: z.string(), role: z.string(), location: z.string(), salary: z.string() }),
		inputSchema: wireInput(z.strictObject({ jobDescription: z.string().trim().min(1).max(20_000) })),
		annotations: WRITE_DESTRUCTIVE_EXTERNAL,
	},
	[T.scoreApplicationMatch]: {
		title: "Score Application Match",
		description:
			"Send the full linked resume and job description to your configured AI provider to score their match. The score is an AI editing aid for finding gaps, not a hiring probability or a guarantee that an applicant tracking system accepts the resume. Requires an enabled, tested default AI provider, a linked resume, and a job description. Overwrites the application's saved match score and AI metadata.",
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
			"Send the full linked resume and job description to your configured AI provider to rewrite the summary in a new private resume copy. Requires an enabled, tested default AI provider, a linked resume, and a job description. Replaces the application's resume link with the new copy and adds a timeline note; the original resume is unchanged. Summary only, applied without review. For reviewable edits across the whole resume, copy it for the job with api_documents_copy_for_job, start an assistant conversation on the copy with api_agent_threads_start, and ask it to tailor with api_agent_messages_send; its propose_edits result lists each pending edit with the posting requirement it addresses, unverified citations, flagged claims and the requirements it found, gaps included, and names the application whose copy it's for (tailoredFor; null when no posting was shared). Nothing changes until the user accepts: apply an accepted edit with apply_resume_patch on that copy, passing proposalApplications { editId: true } and proposalSafety v1, so the edit is recorded in the same write and nothing is written if its current wording isn't what the patch puts there or tailoring doesn't allow it. An edit with a snapshot (target resume/data) is a structural set: the patch has to make the resume's content match snapshot.after as a whole. Record rejections with api_agent_messages_set_edit_status.",
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
} as const);
