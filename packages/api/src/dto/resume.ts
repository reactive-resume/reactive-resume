import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import { jsonPatchOperationSchema } from "@reactive-resume/resume/patch";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";
import { paginationShape } from "../pagination";

const resumeSchema = createSelectSchema(schema.resume, {
	id: z.string().describe("The ID of the resume."),
	name: z.string().trim().min(1).describe("The name of the resume."),
	slug: z.string().trim().min(1).describe("The slug of the resume."),
	tags: z.array(z.string()).describe("The tags of the resume."),
	isPublic: z.boolean().describe("Whether the resume is public."),
	showDownloadButtons: z.boolean().describe("Whether download buttons are shown on the public resume page."),
	isLocked: z.boolean().describe("Whether the resume is locked."),
	password: z.string().trim().min(6).max(64).nullable().describe("The password of the resume, if any."),
	data: resumeDataSchema,
	userId: z.string().describe("The ID of the user who owns the resume."),
	createdAt: z.date().describe("The date and time the resume was created."),
	updatedAt: z.date().describe("The date and time the resume was last updated."),
})
	// Trash and automatic naming stay internal to the documents API. getById exposes the application link
	// explicitly because the editor uses it to select the application a tailored copy belongs to.
	.omit({ applicationId: true, trashedAt: true, autoName: true });

const versionSchema = z.object({
	id: z.string().describe("The ID of the version."),
	kind: z
		.enum(schema.RESUME_VERSION_KINDS)
		.describe(
			"What made the version: created, import, auto (an editing session's autosave), named, before-restore, restored, ai (an AI or API edit) or sent.",
		),
	name: z.string().nullable().describe("The user's name for a named version."),
	createdAt: z.date().describe("When this state was saved."),
});

export const resumeDto = {
	list: {
		input: z
			.object({
				...paginationShape,
				tags: z
					.union([z.string().transform((tag) => [tag]), z.array(z.string())])
					.optional()
					.default([]),
				sort: z.enum(["lastUpdatedAt", "createdAt", "name"]).optional().default("lastUpdatedAt"),
			})
			.optional()
			.default({ tags: [], sort: "lastUpdatedAt" }),
		output: z.array(resumeSchema.omit({ data: true, password: true, userId: true })),
	},

	getById: {
		input: resumeSchema.pick({ id: true }),
		output: resumeSchema.omit({ password: true, userId: true }).extend({
			hasPassword: z.boolean(),
			applicationId: z.string().nullable().describe("The job application this resume was made for, if any."),
		}),
	},

	getBySlug: {
		input: z.object({ username: z.string(), slug: z.string() }),
		// `name` is the owner-chosen dashboard title and is intentionally redacted
		// to an empty string for non-owner viewers (see redactResumeForViewer in
		// features/resume/access-policy.ts). Relax the `min(1)` constraint here so
		// the redacted public response passes output validation.
		output: resumeSchema
			.omit({ name: true, password: true, userId: true, createdAt: true, updatedAt: true })
			.extend({ name: z.string() }),
	},

	create: {
		input: resumeSchema.pick({ name: true, tags: true }).extend({
			autoName: z
				.boolean()
				.optional()
				.describe("While true, the resume's name follows its headline until someone renames it."),
			slug: resumeSchema.shape.slug
				.optional()
				.describe("The slug of the resume. Generated from the name, and made unique, when omitted."),
			withSampleData: z.boolean().default(false),
		}),
		output: z.string().describe("The ID of the created resume."),
	},

	import: {
		input: z.object({ data: writableResumeDataSchema }),
		output: z.string().describe("The ID of the imported resume."),
	},

	update: {
		input: resumeSchema
			.pick({ name: true, slug: true, tags: true, data: true, isPublic: true, showDownloadButtons: true })
			.partial()
			.extend({
				id: z.string(),
				data: writableResumeDataSchema.optional(),
				sessionId: z
					.string()
					.max(64)
					.optional()
					.describe(
						"Identifies one editing session. Saves that share it keep one autosave version, refreshed at most every two minutes.",
					),
			}),
		output: resumeSchema.omit({ password: true, userId: true }).extend({ hasPassword: z.boolean() }),
	},

	checkSlug: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the slug is for."),
			slug: z.string().max(64).describe("The slug to check."),
		}),
		output: z.object({
			status: z
				.enum(["available", "current", "invalid", "taken"])
				.describe(
					"available: free to use. current: this resume's slug already. invalid: not lowercase letters, numbers and single dashes. taken: another of the user's resumes uses it.",
				),
			takenBy: z.string().optional().describe("The name of the resume that uses the slug, when taken."),
			suggestion: z.string().optional().describe("A slug that would work instead."),
		}),
	},

	setLocked: {
		input: resumeSchema.pick({ id: true, isLocked: true }),
		output: z.void(),
	},

	setPassword: {
		input: resumeSchema.pick({ id: true }).extend({ password: z.string().min(6).max(64) }),
		output: z.void(),
	},

	removePassword: {
		input: resumeSchema.pick({ id: true }),
		output: z.void(),
	},

	patch: {
		input: z.object({
			id: z.string().describe("The ID of the resume to patch."),
			expectedUpdatedAt: z.coerce
				.date()
				.optional()
				.describe("If provided, the patch only applies when the resume version still matches this timestamp."),
			operations: z
				.array(jsonPatchOperationSchema)
				.min(1)
				.describe("An array of JSON Patch (RFC 6902) operations to apply to the resume data."),
		}),
		output: resumeSchema.omit({ password: true, userId: true }).extend({ hasPassword: z.boolean() }),
	},

	duplicate: {
		input: resumeSchema.pick({ id: true }).extend({
			name: resumeSchema.shape.name.optional(),
			tags: resumeSchema.shape.tags.optional(),
			slug: resumeSchema.shape.slug
				.optional()
				.describe("The slug of the copy. Generated from the name, and made unique, when omitted."),
		}),
		output: z.string().describe("The ID of the duplicated resume."),
	},

	delete: {
		input: resumeSchema.pick({ id: true }),
		output: z.void(),
	},

	listVersions: {
		input: z.object({
			...paginationShape,
			resumeId: z.string().describe("The ID of the resume whose version history to list."),
		}),
		output: z.array(versionSchema),
	},

	getVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the version."),
		}),
		output: versionSchema.extend({ data: resumeDataSchema }),
	},

	createVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume to name a version of."),
			name: z.string().trim().min(1).max(80).describe("The version's name, e.g. 'Sent to Lumen'."),
		}),
		output: versionSchema,
	},

	renameVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the named version."),
			name: z.string().trim().min(1).max(80).describe("The version's new name."),
		}),
		output: versionSchema,
	},

	deleteVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume the version belongs to."),
			versionId: z.string().describe("The ID of the named version."),
		}),
		output: z.void(),
	},

	restoreVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume to restore."),
			versionId: z.string().describe("The ID of the version snapshot to restore."),
		}),
		output: resumeSchema.omit({ password: true, userId: true }).extend({ hasPassword: z.boolean() }),
	},
};
