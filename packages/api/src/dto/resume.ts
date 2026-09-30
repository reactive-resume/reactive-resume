import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import { jsonPatchOperationSchema } from "@reactive-resume/resume/patch";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";

const resumeSchema = createSelectSchema(schema.resume, {
	id: z.string().describe("The ID of the resume."),
	name: z.string().trim().min(1).describe("The name of the resume."),
	slug: z.string().trim().min(1).describe("The slug of the resume."),
	tags: z.array(z.string()).describe("The tags of the resume."),
	isPublic: z.boolean().describe("Whether the resume is public."),
	showDownloadButtons: z.boolean().describe("Whether download buttons are shown on the public resume page."),
	isLocked: z.boolean().describe("Whether the resume is locked."),
	password: z.string().trim().min(6).max(64).nullable().describe("The password of the resume, if any."),
	critiqueEnabled: z.boolean().describe("Whether feedback/critique mode is enabled."),
	critiquePassword: z
		.string()
		.trim()
		.min(6)
		.max(64)
		.nullable()
		.describe("The critique-link password of the resume, if any."),
	data: resumeDataSchema,
	userId: z.string().describe("The ID of the user who owns the resume."),
	createdAt: z.date().describe("The date and time the resume was created."),
	updatedAt: z.date().describe("The date and time the resume was last updated."),
});

export const resumeDto = {
	list: {
		input: z
			.object({
				tags: z.array(z.string()).optional().default([]),
				sort: z.enum(["lastUpdatedAt", "createdAt", "name"]).optional().default("lastUpdatedAt"),
			})
			.optional()
			.default({ tags: [], sort: "lastUpdatedAt" }),
		output: z.array(
			resumeSchema.omit({ data: true, password: true, critiqueEnabled: true, critiquePassword: true, userId: true }),
		),
	},

	getById: {
		input: resumeSchema.pick({ id: true }),
		output: resumeSchema
			.omit({ password: true, critiquePassword: true, userId: true, createdAt: true })
			.extend({ hasPassword: z.boolean(), hasCritiquePassword: z.boolean() }),
	},

	getBySlug: {
		input: z.object({ username: z.string(), slug: z.string() }),
		// `name` is the owner-chosen dashboard title and is intentionally redacted
		// to an empty string for non-owner viewers (see redactResumeForViewer in
		// features/resume/access-policy.ts). Relax the `min(1)` constraint here so
		// the redacted public response passes output validation.
		output: resumeSchema
			.omit({
				name: true,
				password: true,
				critiqueEnabled: true,
				critiquePassword: true,
				userId: true,
				createdAt: true,
				updatedAt: true,
			})
			.extend({ name: z.string() }),
	},

	create: {
		input: resumeSchema
			.pick({ name: true, slug: true, tags: true })
			.extend({ withSampleData: z.boolean().default(false) }),
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
			.extend({ id: z.string(), data: writableResumeDataSchema.optional() }),
		output: resumeSchema
			.omit({ password: true, critiquePassword: true, userId: true, createdAt: true })
			.extend({ hasPassword: z.boolean(), hasCritiquePassword: z.boolean() }),
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
		output: resumeSchema
			.omit({ password: true, critiquePassword: true, userId: true, createdAt: true })
			.extend({ hasPassword: z.boolean(), hasCritiquePassword: z.boolean() }),
	},

	duplicate: {
		input: resumeSchema.pick({ id: true, name: true, slug: true, tags: true }),
		output: z.string().describe("The ID of the duplicated resume."),
	},

	delete: {
		input: resumeSchema.pick({ id: true }),
		output: z.void(),
	},

	listVersions: {
		input: z.object({ resumeId: z.string().describe("The ID of the resume whose version history to list.") }),
		output: z.array(
			z.object({
				id: z.string().describe("The ID of the version snapshot."),
				label: z.string().describe("A short description of what triggered the snapshot."),
				createdAt: z.date().describe("The date and time the snapshot was taken."),
			}),
		),
	},

	restoreVersion: {
		input: z.object({
			resumeId: z.string().describe("The ID of the resume to restore."),
			versionId: z.string().describe("The ID of the version snapshot to restore."),
		}),
		output: resumeSchema
			.omit({ password: true, critiquePassword: true, userId: true, createdAt: true })
			.extend({ hasPassword: z.boolean(), hasCritiquePassword: z.boolean() }),
	},
};
