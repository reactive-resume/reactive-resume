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
	addCurlSamples(spec);
	return spec;
}

type JsonSchema = OpenAPI.SchemaObject | OpenAPI.ReferenceObject;

// Mintlify's generated cURL samples use Bash `\` line continuations, which break when
// pasted into PowerShell or cmd. A custom sample labelled "cURL" replaces that tab only;
// the other generated languages stay as they are.
function addCurlSamples(spec: OpenAPI.Document) {
	const resolve = (schema: JsonSchema | undefined): OpenAPI.SchemaObject => {
		let current = schema;
		while (current && "$ref" in current) {
			const name = current.$ref.replace("#/components/schemas/", "");
			current = spec.components?.schemas?.[name];
		}
		return current ?? {};
	};
	// Placeholder body with required fields only, in the same `<string>` style Mintlify uses.
	const example = (schema: JsonSchema | undefined, parents: ReadonlySet<string> = new Set()): unknown => {
		const isRef = schema !== undefined && "$ref" in schema;
		if (isRef && parents.has(schema.$ref)) return {};
		const seen = isRef ? new Set(parents).add(schema.$ref) : parents;
		const value = resolve(schema);
		if ("const" in value) return value.const;
		if (value.enum) return value.enum[0];
		const options = value.anyOf ?? value.oneOf;
		if (options) return example(options.find((option) => resolve(option).type !== "null") ?? options[0], seen);
		if (value.allOf) return Object.assign({}, ...value.allOf.map((part) => example(part, seen)));
		const type = Array.isArray(value.type) ? value.type.find((item) => item !== "null") : value.type;
		if (type === "object" || value.properties) {
			return Object.fromEntries((value.required ?? []).map((key) => [key, example(value.properties?.[key], seen)]));
		}
		if (type === "array") return [example("items" in value ? value.items : undefined, seen)];
		if (type === "integer" || type === "number") return 123;
		if (type === "boolean") return true;
		return "<string>";
	};

	for (const [path, item] of Object.entries(spec.paths ?? {})) {
		if (!item) continue;
		for (const method of ["get", "post", "put", "patch", "delete"] as const) {
			const operation = item[method];
			if (!operation) continue;
			const query = (operation.parameters ?? [])
				.filter((parameter): parameter is OpenAPI.ParameterObject => !("$ref" in parameter))
				.filter((parameter) => parameter.in === "query" && parameter.required)
				.map((parameter) => `${parameter.name}=<${parameter.name}>`)
				.join("&");
			// `<id>` rather than `{id}`: cURL treats braces in URLs as glob patterns.
			const url = `${(operation.servers ?? spec.servers)?.[0]?.url ?? ""}${path.replace(/\{(\w+)\}/g, "<$1>")}${query ? `?${query}` : ""}`;
			// Double quotes work in POSIX shells, PowerShell and cmd alike.
			const args = method === "get" ? [`"${url}"`] : [`--request ${method.toUpperCase()}`, `"${url}"`];
			if ((operation.security ?? spec.security)?.length) args.push(`--header "x-api-key: <api-key>"`);

			const body = operation.requestBody && !("$ref" in operation.requestBody) ? operation.requestBody.content : {};
			const json = body["application/json"];
			const form = body["multipart/form-data"];
			if (json) {
				// Newlines inside a quoted argument are not line continuations, so the body stays readable.
				args.push(`--header "Content-Type: application/json"`);
				args.push(`--data '${JSON.stringify(example(json.schema), null, 2)}'`);
			} else if (form) {
				const fields = resolve(form.schema);
				for (const key of fields.required ?? []) {
					const field = resolve(fields.properties?.[key]);
					const value = "contentMediaType" in field ? "@<file>" : example(field);
					args.push(`--form "${key}=${typeof value === "string" ? value : JSON.stringify(value)}"`);
				}
			}

			Object.assign(operation, {
				"x-codeSamples": [{ lang: "bash", label: "cURL", source: `curl ${args.join(" ")}` }],
			});
		}
	}
}
