import z from "zod";
import { applicationTimelineEntrySchema, postingSourceSchema } from "@reactive-resume/schema/applications/data";
import { coverLetterStyleSchema } from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";

export const fileInputSchema = z.union([
	z.object({
		name: z.string().min(1).max(255),
		contentType: z.string().min(1),
		dataBase64: z.base64().max(3 * 1024 * 1024),
	}),
	z.object({
		name: z.string().min(1).max(255),
		contentType: z.string().min(1),
		storagePath: z
			.string()
			.min(1)
			.describe(
				"Owned storage key returned by POST /api/openapi/files or /api/openapi/agent/attachments; the destination operation's file size limit applies.",
			),
	}),
]);

const fileOutputSchema = z.object({
	url: z.url(),
	name: z.string(),
	contentType: z.string(),
	size: z.number().int().nonnegative(),
});

// The full resume schema (~28k tokens) is published once as the resume://_meta/schema resource.
// Inlining it, and a letter's style (built from the same parts), made tools/list ~1.9 MB;
// the API procedures still validate both in full.
type JsonSchemaReference = { type: "object"; additionalProperties: true; description: string };
const resumeDataReference: JsonSchemaReference = {
	type: "object",
	additionalProperties: true,
	description:
		"Reactive Resume data (basics, summary, sections, customSections, metadata). Full JSON Schema: the resume://_meta/schema MCP resource, also served at /schema.json on this server.",
};
const coverLetterStyleReference: JsonSchemaReference = {
	type: "object",
	additionalProperties: true,
	description:
		"The letter's sender details and design: basics, picture and metadata (resume metadata without notes or layout) in the resume data shapes from the resume://_meta/schema MCP resource or /schema.json on this server, plus sectionId and itemId.",
};
const schemaReferences = new Map<unknown, JsonSchemaReference>([
	[resumeDataSchema, resumeDataReference],
	[coverLetterStyleSchema, coverLetterStyleReference],
]);
// Applications repeat their timeline and posting-source shapes in every application tool's output;
// inputs keep them, because tools that write those fields need the full shape.
const outputSchemaReferences = new Map<unknown, JsonSchemaReference>([
	[
		applicationTimelineEntrySchema,
		{
			type: "object",
			additionalProperties: true,
			description:
				"A timeline entry: a stage change, note or interview, with id, type and at plus the fields of its type. Full schema: the application responses in this server's OpenAPI document at /api/openapi/spec.json.",
		},
	],
	[
		postingSourceSchema,
		{
			type: "object",
			additionalProperties: true,
			description:
				"How the job description was read: method, format, URLs, retrieval times and completeness. Full schema: the application responses in this server's OpenAPI document at /api/openapi/spec.json.",
		},
	],
]);

// Directories reject input parameters without a type, so free-form JSON inputs list every JSON type.
const anyJsonTypes = (["string", "number", "boolean", "object", "array", "null"] as const).map((type) => ({ type }));

/** MCP JSON values retain the API's native dates and files through explicit wire forms. */
export function wireJsonSchema(schema: z.ZodType, io: "input" | "output" = "output") {
	return z.toJSONSchema(schema, {
		io,
		reused: "inline",
		unrepresentable: ({ zodSchema }) => {
			if (zodSchema === writableResumeDataSchema) return { ...resumeDataReference };
			if (zodSchema._zod.def.type === "transform") return "any";
			if (zodSchema._zod.def.type === "date") return { type: "string", format: "date-time", "x-mcp-native": "date" };
			if (zodSchema._zod.def.type === "void" || zodSchema._zod.def.type === "undefined") return { type: "null" };
			// oRPC event iterators have a custom Standard Schema. Streaming tools supply
			// their own bounded result contract instead of pretending it is JSON.
			throw new Error(`Unsupported MCP schema: ${zodSchema._zod.def.type}`);
		},
		override: ({ zodSchema, jsonSchema }) => {
			const type = zodSchema._zod.def.type;
			if (io === "input" && (type === "unknown" || type === "any")) jsonSchema.anyOf = anyJsonTypes;
			const reference =
				schemaReferences.get(zodSchema) ?? (io === "output" ? outputSchemaReferences.get(zodSchema) : undefined);
			if (reference) {
				for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
				Object.assign(jsonSchema, reference);
			}
			if (zodSchema._zod.def.type === "pipe") {
				const definition = zodSchema._zod.def;
				const represented = definition.in._zod.def.type === "transform" ? definition.out : definition.in;
				for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
				Object.assign(jsonSchema, wireJsonSchema(represented as z.ZodType, io));
			}
			if (zodSchema._zod.def.type === "file") {
				for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
				Object.assign(jsonSchema, z.toJSONSchema(io === "input" ? fileInputSchema : fileOutputSchema), {
					"x-mcp-native": "file",
				});
			}
		},
	});
}

export function toWireSchema(schema: z.ZodType, io: "input" | "output" = "output"): z.ZodType {
	return z.fromJSONSchema(wireJsonSchema(schema, io));
}

export function toWireObjectSchema(schema: z.ZodType): z.ZodObject {
	let wire = toWireSchema(schema);
	while (
		wire instanceof z.ZodDefault ||
		wire instanceof z.ZodOptional ||
		wire instanceof z.ZodCatch ||
		wire instanceof z.ZodReadonly
	)
		wire = wire.unwrap() as z.ZodType;
	if (wire instanceof z.ZodObject) return wire;
	return wire instanceof z.ZodArray ? z.object({ items: wire }) : z.object({ result: wire });
}
