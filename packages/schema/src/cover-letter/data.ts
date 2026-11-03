import z from "zod";
import { aiOperationIdsSchema, aiUsageSummarySchema } from "../ai-usage";
import { basicsSchema, metadataSchema, pictureSchema } from "../resume/data";

export const coverLetterStyleSchema = z.object({
	basics: basicsSchema,
	picture: pictureSchema,
	metadata: metadataSchema.omit({ notes: true, layout: true }),
	sectionId: z.string().min(1),
	itemId: z.string().min(1),
});

export const coverLetterLayoutSchema = z
	.enum(["structured", "freeform"])
	.describe(
		"structured: recipient name, company and date fields, a greeting from the name, the body and a sign-off. freeform: the recipient block and body as written (letters from before structured letters).",
	);

export type CoverLetterLayout = z.infer<typeof coverLetterLayoutSchema>;

export const coverLetterContentSchema = z.object({
	name: z.string().trim().min(1).max(100),
	/** Freeform letters' recipient block, as rich text. Structured letters use the fields below instead. */
	recipient: z.string().max(20_000),
	content: z.string().max(100_000),
	greeting: z
		.string()
		.trim()
		.max(2_000)
		.nullable()
		.default(null)
		.describe("Custom greeting; null uses the document language default, empty omits it."),
	signOff: z
		.string()
		.trim()
		.max(2_000)
		.nullable()
		.default(null)
		.describe(
			"Custom signature including name and optional contact details; null uses the document language default with the sender's name, empty omits it.",
		),
	style: coverLetterStyleSchema,
	layout: coverLetterLayoutSchema.default("freeform"),
	recipientName: z.string().trim().max(200).default("").describe("Who the letter is to: a person, or a team."),
	recipientCompany: z.string().trim().max(200).default(""),
	letterDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
		.nullable()
		.default(null)
		.describe("The letter's date, as YYYY-MM-DD."),
});

export const coverLetterSchema = coverLetterContentSchema.extend({
	id: z.string(),
	aiOperationIds: aiOperationIdsSchema.optional(),
	aiUsage: aiUsageSummarySchema.nullable().optional(),
	sourceResumeId: z.string().nullable(),
	sourceApplicationId: z.string().nullable(),
	senderLinked: z
		.boolean()
		.describe("The sender's details come live from the source resume, instead of the copy in `style`."),
	designLinked: z.boolean().describe("The design comes live from the source resume, instead of the copy in `style`."),
	isLocked: z.boolean().describe("Locked letters can't be edited or moved to Trash until they're unlocked."),
	revision: z.number().int().min(1),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** Older saved drafts contain only text; their request history stays unknown. */
export const coverLetterDraftVersionSchema = z.union([
	z.string().transform((text) => ({ text, aiOperationIds: [] as string[] })),
	z.object({ text: z.string(), aiOperationIds: aiOperationIdsSchema.catch([]) }),
]);
export type CoverLetterDraftVersion = z.infer<typeof coverLetterDraftVersionSchema>;

export const coverLetterDocumentSchema = coverLetterContentSchema.extend({
	format: z.literal("reactive-resume-cover-letter"),
	version: z.literal(1),
});

export type CoverLetterStyle = z.infer<typeof coverLetterStyleSchema>;
export type CoverLetter = z.infer<typeof coverLetterSchema>;
export type CoverLetterDocument = z.infer<typeof coverLetterDocumentSchema>;
