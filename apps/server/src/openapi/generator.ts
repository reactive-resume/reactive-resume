import type { OpenAPI } from "@orpc/openapi";
import { OpenAPIGenerator } from "@orpc/openapi";
import { JSON_SCHEMA_INPUT_REGISTRY, ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { downloadResumePdfProcedure } from "@reactive-resume/api/features/resume/export";
import { restAliases } from "@reactive-resume/api/rest";
import router from "@reactive-resume/api/routers";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { createResumeDataJsonSchema } from "@reactive-resume/schema/resume/json-schema";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";

export const openAPIRouter = {
	...router,
	rest: restAliases,
	resume: {
		...router.resume,
		downloadPdf: downloadResumePdfProcedure,
	},
};

const { $schema: _dialect, ...resumeDataInputSchema } = createResumeDataJsonSchema();
type ResumeDataInputJsonSchema = Parameters<typeof JSON_SCHEMA_INPUT_REGISTRY.add<typeof resumeDataSchema>>[1];
JSON_SCHEMA_INPUT_REGISTRY.add(resumeDataSchema, resumeDataInputSchema as unknown as ResumeDataInputJsonSchema);
JSON_SCHEMA_INPUT_REGISTRY.add(writableResumeDataSchema, resumeDataInputSchema as unknown as ResumeDataInputJsonSchema);
const importResumeInputSchema = openAPIRouter.resume.import["~orpc"].inputSchema;
if (importResumeInputSchema) {
	JSON_SCHEMA_INPUT_REGISTRY.add(importResumeInputSchema, {
		type: "object",
		properties: {
			data: { $ref: "#/components/schemas/ResumeData" },
		},
		required: ["data"],
	});
}

const openAPIGenerator = new OpenAPIGenerator({
	schemaConverters: [
		new ZodToJsonSchemaConverter({
			interceptors: [
				({ options, next }) => {
					const [required, schema] = next();
					const impossible =
						Object.keys(schema).length === 1 &&
						typeof schema.not === "object" &&
						schema.not !== null &&
						Object.keys(schema.not).length === 0;
					return options.strategy === "input" && impossible ? [required, {}] : [required, schema];
				},
			],
		}),
	],
});

type GenerateOpenApiSpecOptions = {
	appUrl: string;
	version: string;
};

const healthDependencySchema = {
	type: "object",
	properties: {
		status: { type: "string", enum: ["healthy", "unhealthy"] },
		latencyMs: { type: "number" },
		error: { type: "string", description: "Generic failure message. Detailed diagnostics are logged on the server." },
	},
	required: ["status", "latencyMs"],
	additionalProperties: true,
} satisfies OpenAPI.SchemaObject;

const healthResponseSchema = {
	type: "object",
	properties: {
		service: { type: "string", enum: ["reactive-resume"] },
		version: { type: "string", description: "The running application's build version." },
		status: { type: "string", enum: ["healthy", "unhealthy"] },
		timestamp: { type: "string", format: "date-time" },
		uptime: { type: "string" },
		database: healthDependencySchema,
		storage: healthDependencySchema,
	},
	required: ["service", "version", "status", "timestamp", "uptime", "database", "storage"],
} satisfies OpenAPI.SchemaObject;

export async function generateOpenApiSpec({ appUrl, version }: GenerateOpenApiSpecOptions) {
	const spec = await openAPIGenerator.generate(openAPIRouter, {
		info: {
			title: "Reactive Resume",
			version,
			description:
				"Reactive Resume API. Mutations do not support Idempotency-Key. Do not automatically retry POST, PUT, PATCH or DELETE requests after a timeout: first read the resource to determine whether the operation succeeded. Existing enum values and response shapes are retained for compatibility.",
			license: { name: "MIT", url: "https://github.com/reactive-resume/reactive-resume/blob/main/LICENSE" },
			contact: { name: "Amruth Pillai", email: "hello@amruthpillai.com", url: "https://amruthpillai.com" },
		},
		servers: [{ url: `${appUrl}/api/openapi` }],
		paths: {
			"/api/health": {
				get: {
					operationId: "getHealth",
					tags: ["System"],
					summary: "Get application health and version",
					description: "Checks database and storage availability. Does not require authentication.",
					servers: [{ url: appUrl }],
					security: [],
					responses: {
						"200": {
							description: "The application and its dependencies are healthy.",
							content: { "application/json": { schema: healthResponseSchema } },
						},
						"503": {
							description: "One or more application dependencies are unhealthy.",
							content: { "application/json": { schema: healthResponseSchema } },
						},
					},
				},
			},
		},
		externalDocs: { url: "https://docs.rxresu.me", description: "Reactive Resume Documentation" },
		commonSchemas: {
			ResumeData: { schema: writableResumeDataSchema, strategy: "input" },
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "JWT",
					description: "An OAuth access token issued by this instance for its API/MCP resource.",
				},
				cookieAuth: {
					type: "apiKey",
					in: "cookie",
					name: "better-auth.session_token",
					description:
						"Browser session (secure deployments use the __Secure- prefix). Cookie requests must originate from this instance.",
				},
				apiKey: {
					type: "apiKey",
					name: "x-api-key",
					in: "header",
					description: "The API key to authenticate requests.",
				},
			},
		},
		security: [{ apiKey: [] }, { bearerAuth: [] }, { cookieAuth: [] }],
		filter: ({ contract }) => !contract["~orpc"].route.tags?.includes("Internal"),
	});
	// Void results have no HTTP body; Zod's impossible JSON schema is not a response payload.
	const isVoid = (schema: unknown): boolean => {
		if (!schema || typeof schema !== "object") return false;
		const value = schema as { not?: object; anyOf?: unknown[] };
		return (
			(value.not !== undefined && Object.keys(value.not).length === 0) ||
			(Array.isArray(value.anyOf) && value.anyOf.every(isVoid))
		);
	};
	for (const [path, item] of Object.entries(spec.paths ?? {})) {
		if (!item || path === "/api/health") continue;
		for (const method of ["get", "post", "put", "patch", "delete"] as const) {
			const operation = item[method];
			if (!operation) continue;
			const body = operation.requestBody;
			if (body && !("$ref" in body) && body.content["multipart/form-data"]) {
				const json = body.content["application/json"]?.schema;
				// Application files are optional; existing JSON clients keep sending record fields only.
				if ((path === "/applications" || path === "/applications/{id}") && json && "properties" in json) {
					delete json.properties?.resumeFile;
					delete json.properties?.coverLetterFile;
				} else delete body.content["application/json"];
			}
			operation.responses ??= {};
			operation.responses.default = {
				description: "Structured API error. See status and code; do not branch on message text.",
				content: {
					"application/json": {
						schema: {
							type: "object",
							required: ["defined", "code", "status", "message"],
							properties: {
								defined: { type: "boolean" },
								code: { type: "string" },
								status: { type: "integer" },
								message: { type: "string" },
								data: {},
							},
						},
					},
				},
			};
			for (const response of Object.values(operation.responses)) {
				if ("$ref" in response) continue;
				const schema = response.content?.["application/json"]?.schema;
				if (isVoid(schema)) delete response.content;
				if (
					schema &&
					"type" in schema &&
					schema.type === "array" &&
					operation.parameters?.some((parameter) => "name" in parameter && parameter.name === "limit")
				) {
					response.headers = {
						...response.headers,
						"X-Total-Count": { description: "Total matching results before pagination.", schema: { type: "integer" } },
						"X-Limit": { description: "Page size, when pagination is requested.", schema: { type: "integer" } },
						"X-Offset": {
							description: "Zero-based offset, when pagination is requested.",
							schema: { type: "integer" },
						},
					};
				}
			}
		}
	}
	return spec;
}
