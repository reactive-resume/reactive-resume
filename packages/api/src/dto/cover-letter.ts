import z from "zod";
import { COVER_LETTER_VERSION_KINDS } from "@reactive-resume/db/schema";
import {
	coverLetterContentSchema,
	coverLetterDocumentSchema,
	coverLetterLayoutSchema,
	coverLetterSchema,
	coverLetterStyleSchema,
} from "@reactive-resume/schema/cover-letter/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { paginationShape } from "../pagination";

const idSchema = z.object({ id: z.string().min(1) });
const revisionSchema = idSchema.extend({ expectedRevision: z.number().int().min(1) });
const editableSchema = coverLetterContentSchema.pick({ name: true, recipient: true, content: true });
const recipientFieldsSchema = coverLetterContentSchema.pick({
	recipientName: true,
	recipientCompany: true,
	letterDate: true,
});

const letterVersionSummarySchema = z.object({
	id: z.string(),
	kind: z
		.enum(COVER_LETTER_VERSION_KINDS)
		.describe("What made the version: created, auto (an editing session), named, before-restore, restored or sent."),
	name: z.string().nullable().describe("A named version's name, or the company a sent one went to."),
	createdAt: z.date(),
});

const letterVersionSchema = letterVersionSummarySchema.extend({
	data: z.object({
		name: z.string(),
		recipient: z.string(),
		content: z.string(),
		style: coverLetterStyleSchema,
		layout: coverLetterLayoutSchema,
		recipientName: z.string(),
		recipientCompany: z.string(),
		letterDate: z.string().nullable(),
	}),
});
const versionRefSchema = idSchema.extend({ versionId: z.string().min(1) });
const versionNameSchema = z.string().trim().min(1).max(100);

export const coverLetterDto = {
	list: {
		input: z
			.object({
				search: z.string().max(100).optional(),
				resumeId: z.string().min(1).optional(),
				applicationId: z.string().min(1).optional(),
				limit: z.number().int().min(1).max(100).default(20),
				offset: z.number().int().min(0).default(0),
			})
			.default({ limit: 20, offset: 0 }),
		output: z.object({ items: z.array(coverLetterSchema), total: z.number() }),
	},
	getById: { input: idSchema, output: coverLetterSchema },
	create: {
		input: editableSchema.extend({
			recipient: editableSchema.shape.recipient.default(""),
			content: editableSchema.shape.content.default(""),
			resumeId: z.string().min(1).optional().describe("The resume it goes with; its details and design are linked."),
			applicationId: z.string().min(1).optional().describe("The job it's for; it fills the recipient."),
			template: templateSchema.optional(),
			layout: coverLetterLayoutSchema
				.optional()
				.describe("Defaults to structured, or freeform when a recipient block is given."),
			recipientName: recipientFieldsSchema.shape.recipientName.unwrap().optional(),
			recipientCompany: recipientFieldsSchema.shape.recipientCompany.unwrap().optional(),
			letterDate: recipientFieldsSchema.shape.letterDate.unwrap().optional().describe("YYYY-MM-DD; defaults to today."),
		}),
		output: coverLetterSchema,
	},
	update: {
		input: revisionSchema.extend(editableSchema.partial().shape).extend({
			template: templateSchema.optional().describe("Sets the letter's own template, which unlinks its design."),
			metadata: coverLetterStyleSchema.shape.metadata
				.pick({ typography: true, design: true, page: true })
				.partial()
				.optional()
				.describe("Sets the letter's own type, colors and page settings, which unlinks its design."),
			recipientName: recipientFieldsSchema.shape.recipientName.unwrap().optional(),
			recipientCompany: recipientFieldsSchema.shape.recipientCompany.unwrap().optional(),
			letterDate: recipientFieldsSchema.shape.letterDate.unwrap().optional(),
			resumeId: z.string().min(1).nullable().optional().describe("The resume the letter goes with."),
			applicationId: z.string().min(1).nullable().optional().describe("The job the letter is for."),
			senderLinked: z.boolean().optional().describe("Take the sender's details live from the resume."),
			designLinked: z.boolean().optional().describe("Take the design live from the resume."),
			sessionId: z
				.string()
				.min(1)
				.max(64)
				.optional()
				.describe("The editing session; its saves share one History version, refreshed every two minutes."),
		}),
		output: coverLetterSchema,
	},
	listVersions: { input: idSchema.extend(paginationShape), output: z.array(letterVersionSummarySchema) },
	getVersion: { input: versionRefSchema, output: letterVersionSchema },
	createVersion: { input: idSchema.extend({ name: versionNameSchema }), output: letterVersionSummarySchema },
	renameVersion: { input: versionRefSchema.extend({ name: versionNameSchema }), output: letterVersionSummarySchema },
	deleteVersion: { input: versionRefSchema, output: z.void() },
	restoreVersion: { input: versionRefSchema, output: coverLetterSchema },
	draft: {
		input: idSchema.extend({
			variant: z
				.enum(["draft", "shorter", "personal"])
				.default("draft")
				.describe("draft writes the body; shorter and personal revise `previous`."),
			previous: z.string().max(20_000).optional().describe("The draft being revised."),
		}),
	},
	refreshStyle: { input: revisionSchema.extend({ resumeId: z.string().min(1) }), output: coverLetterSchema },
	duplicate: { input: idSchema.extend({ name: editableSchema.shape.name.optional() }), output: coverLetterSchema },
	delete: { input: revisionSchema, output: z.void() },
	export: { input: idSchema, output: coverLetterDocumentSchema },
	import: { input: z.object({ document: coverLetterDocumentSchema }), output: coverLetterSchema },
};

export type CoverLetterListInput = z.infer<typeof coverLetterDto.list.input>;
export type CoverLetterUpdateInput = z.infer<typeof coverLetterDto.update.input>;
export type CoverLetterDraftInput = z.infer<typeof coverLetterDto.draft.input>;
