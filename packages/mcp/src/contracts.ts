import z from "zod";
import { createResumeDataJsonSchema } from "@reactive-resume/schema/resume/json-schema";
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

/** MCP JSON values retain the API's native dates and files through explicit wire forms. */
export function wireJsonSchema(schema: z.ZodType, io: "input" | "output" = "output") {
	return z.toJSONSchema(schema, {
		io,
		reused: "inline",
		unrepresentable: ({ zodSchema }) => {
			if (zodSchema === writableResumeDataSchema) return createResumeDataJsonSchema();
			if (zodSchema._zod.def.type === "transform") return "any";
			if (zodSchema._zod.def.type === "date") return { type: "string", format: "date-time", "x-mcp-native": "date" };
			if (zodSchema._zod.def.type === "void" || zodSchema._zod.def.type === "undefined") return { type: "null" };
			// oRPC event iterators have a custom Standard Schema. Streaming tools supply
			// their own bounded result contract instead of pretending it is JSON.
			throw new Error(`Unsupported MCP schema: ${zodSchema._zod.def.type}`);
		},
		override: ({ zodSchema, jsonSchema }) => {
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
