import { describe, expect, it, vi } from "vite-plus/test";
import z from "zod";
import { createResumeDataJsonSchema } from "@reactive-resume/schema/resume/json-schema";

// Spec generation reads procedure contracts without executing authentication. Keep the
// provider's resource seeding out of this unit test; real OAuth initialization is covered
// by the opt-in PostgreSQL integration suite after migrations run.
vi.mock("@reactive-resume/auth/config", () => ({ auth: {}, verifyOAuthToken: vi.fn() }));

type GeneratedSpecView = {
	components?: { schemas?: Record<string, unknown> };
	paths?: Record<
		string,
		Record<
			string,
			{
				summary?: string;
				description?: string;
				requestBody?: {
					content?: Record<string, { schema?: unknown }>;
				};
			}
		>
	>;
};

// Building the spec walks every router and resume JSON schema, which costs seconds. It is
// deterministic and every test here only reads it, so generate it once for the whole file —
// regenerating per test made the first case time out under a loaded machine.
let specPromise: ReturnType<typeof generateOnce> | undefined;

async function generateOnce() {
	const { generateOpenApiSpec } = await import("./generator");
	return generateOpenApiSpec({
		appUrl: "https://rxresu.me",
		version: "9.8.7",
	});
}

function generateSpec() {
	specPromise ??= generateOnce();
	return specPromise;
}

function getRequestSchema(spec: GeneratedSpecView, path: string, method: string) {
	return spec.paths?.[path]?.[method]?.requestBody?.content?.["application/json"]?.schema;
}

function containsImpossibleSchema(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsImpossibleSchema);
	if (typeof value !== "object" || value === null) return false;
	const object = value as Record<string, unknown>;
	const negated = object.not;
	if (typeof negated === "object" && negated !== null && Object.keys(negated).length === 0) {
		return true;
	}
	return Object.values(object).some(containsImpossibleSchema);
}

function findImpossibleRequestSchemas(spec: GeneratedSpecView) {
	const impossibleRequests: string[] = [];
	for (const [path, operations] of Object.entries(spec.paths ?? {})) {
		for (const [method, operation] of Object.entries(operations)) {
			for (const [mediaType, content] of Object.entries(operation.requestBody?.content ?? {})) {
				if (containsImpossibleSchema(content.schema)) {
					impossibleRequests.push(`${method.toUpperCase()} ${path} (${mediaType})`);
				}
			}
		}
	}
	return impossibleRequests;
}

describe("generateOpenApiSpec", () => {
	it("describes every published HTTP operation", async () => {
		const spec = (await generateSpec()) as GeneratedSpecView;
		const missing: string[] = [];
		for (const [path, operations] of Object.entries(spec.paths ?? {})) {
			for (const [method, operation] of Object.entries(operations)) {
				if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
				if (!(operation.summary?.trim() || operation.description?.trim())) missing.push(`${method} ${path}`);
			}
		}
		expect(missing).toEqual([]);
	}, 15_000);

	it("documents guaranteed profile response fields without adding request defaults", async () => {
		const spec = await generateSpec();
		for (const method of ["get", "put", "patch"] as const) {
			const response = spec.paths?.["/career/profile"]?.[method]?.responses?.["200"];
			expect(response).toHaveProperty("content.application/json.schema.properties.searchRegions");
			for (const field of ["targetRoles", "locations"]) {
				expect(response).toHaveProperty(`content.application/json.schema.properties.${field}.items.maxLength`, 200);
			}
			expect(response).toMatchObject({
				content: {
					"application/json": {
						schema: {
							required: [
								"targetRoles",
								"locations",
								"priorities",
								"minBase",
								"maxOfficeDays",
								"noticeWeeks",
								"memoryMode",
							],
						},
					},
				},
			});
		}
		const view = spec as GeneratedSpecView;
		for (const method of ["put", "patch"]) {
			const request = getRequestSchema(view, "/career/profile", method);
			expect(request).toHaveProperty("properties.searchRegions");
			expect(request).not.toHaveProperty("required");
			const validator = z.fromJSONSchema(request as Parameters<typeof z.fromJSONSchema>[0]);
			for (const field of ["targetRoles", "locations"]) {
				expect(validator.safeParse({ [field]: [` ${"x".repeat(200)} `] }).success).toBe(true);
				expect(validator.safeParse({ [field]: [" \t "] }).success).toBe(false);
				expect(request).not.toHaveProperty(`properties.${field}.items.maxLength`);
			}
		}
		const input = getRequestSchema(view, "/career/profile", "patch");
		expect(getRequestSchema(view, "/career/profile", "put")).not.toHaveProperty("properties.memoryMode.default");
		for (const field of ["targetRoles", "locations"]) {
			expect(input).toHaveProperty(
				`properties.${field}.items.description`,
				expect.stringContaining("whitespace-only values are rejected"),
			);
			expect(input).toHaveProperty(`properties.${field}.items.pattern`, "\\S");
			expect(input).toHaveProperty(
				`properties.${field}.items.description`,
				expect.stringContaining("limit applies after trimming"),
			);
			expect(input).not.toHaveProperty(`properties.${field}.default`);
		}
	});

	it("documents distinct search countries in every occurrence", async () => {
		let count = 0;
		const visit = (value: unknown) => {
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				if (key === "searchRegions") {
					const region = child as { anyOf?: Record<string, unknown>[] };
					expect(region.anyOf ?? [region]).toContainEqual(
						expect.objectContaining({ type: "array", maxItems: 3, uniqueItems: true }),
					);
					count++;
				} else visit(child);
			}
		};
		visit(await generateSpec());
		expect(count).toBeGreaterThan(0);
	}, 15_000);

	it("keeps instance homepage resolution out of the public API", async () => {
		const spec = (await generateSpec()) as GeneratedSpecView;
		expect(spec.paths).not.toHaveProperty("/resume/getRoot");
	}, 15_000);
	it("uses the canonical input-side ResumeData schema in update requests", async () => {
		const spec = (await generateSpec()) as GeneratedSpecView;
		const { $schema: _dialect, ...canonicalInputSchema } = createResumeDataJsonSchema();

		expect(spec.components?.schemas?.ResumeData).toEqual(canonicalInputSchema);
		expect(getRequestSchema(spec, "/resumes/{id}", "put")).toMatchObject({
			properties: {
				data: { $ref: "#/components/schemas/ResumeData" },
			},
		});
	}, 15_000);

	it("does not publish impossible request schemas", async () => {
		const spec = (await generateSpec()) as GeneratedSpecView;

		expect(findImpossibleRequestSchemas(spec)).toEqual([]);
	});
});

it("documents anonymous routes, all supported credentials, and additive PATCH routes", async () => {
	const spec = await generateSpec();
	expect(spec.paths?.["/flags"]?.get?.security).toEqual([]);
	expect(spec.paths?.["/resumes/{username}/{slug}"]?.get?.security).toEqual([]);
	expect(spec.paths?.["/resumes"]?.get?.security).toEqual([{ apiKey: [] }, { bearerAuth: [] }, { cookieAuth: [] }]);
	expect(spec.paths?.["/auth/account"]?.delete?.security).toEqual([{ cookieAuth: [] }]);
	expect(spec.paths?.["/auth/account"]?.delete).toHaveProperty(
		"x-codeSamples.0.source",
		expect.stringContaining('--cookie "<session-cookie>"'),
	);
	for (const path of ["/applications/{id}", "/cover-letters/{id}", "/career/profile"]) {
		expect(spec.paths?.[path]?.put?.requestBody).toBeDefined();
		expect(spec.paths?.[path]?.patch?.requestBody).toBeDefined();
	}
	expect(spec.paths?.["/files"]?.post?.requestBody).toHaveProperty("content.multipart/form-data");
	expect(spec.paths?.["/files"]?.post?.requestBody).not.toHaveProperty("content.application/json");
	expect(spec.paths?.["/resumes"]?.get?.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "limit", in: "query" }),
			expect.objectContaining({ name: "offset", in: "query" }),
		]),
	);
});

it("gives every published app operation an explicit route and input/output contracts", async () => {
	const { openAPIRouter } = await import("./generator");
	const visit = (node: unknown, path: string) => {
		if (!node || typeof node !== "object") return;
		if ("~orpc" in node) {
			const definition = node["~orpc"] as {
				route: { tags?: string[]; method?: string; path?: string };
				inputSchema?: unknown;
				outputSchema?: unknown;
			};
			if (definition.route.tags?.includes("Internal")) return;
			expect(definition.route.method, path).toBeDefined();
			expect(definition.route.path, path).toBeDefined();
			expect(definition.inputSchema, path).toBeDefined();
			expect(definition.outputSchema, path).toBeDefined();
			return;
		}
		for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`);
	};
	visit(openAPIRouter, "api");
});

it("describes empty responses and common errors without impossible payloads", async () => {
	const spec = await generateSpec();
	const deleted = spec.paths?.["/files"]?.delete?.responses?.["200"];
	expect(deleted).toBeDefined();
	expect(deleted).not.toHaveProperty("content");
	expect(spec.paths?.["/resumes"]?.get?.responses?.default).toHaveProperty(
		"content.application/json.schema.properties.code",
	);
	expect(spec.paths?.["/resumes"]?.get?.responses?.["200"]).toHaveProperty("headers.X-Total-Count");
});

it("keeps JSON application writes and documents optional multipart attachments", async () => {
	const spec = await generateSpec();
	for (const [path, method] of [
		["/applications", "post"],
		["/applications/{id}", "put"],
		["/applications/{id}", "patch"],
	] as const) {
		const body = spec.paths?.[path]?.[method]?.requestBody;
		if (!body || "$ref" in body) throw new Error("Missing application request body");
		const json = body.content["application/json"]?.schema;
		expect(json).toHaveProperty("properties.company");
		expect(json).not.toHaveProperty("properties.resumeFile");
		expect(json).not.toHaveProperty("properties.coverLetterFile");
		expect(body.content["multipart/form-data"]?.schema).toHaveProperty(
			"properties.resumeFile.contentMediaType",
			"application/pdf",
		);
	}
});

it("overrides every generated cURL sample with one that has no shell line continuations", async () => {
	const spec = await generateSpec();
	const samples = Object.values(spec.paths ?? {}).flatMap((item) =>
		(["get", "post", "put", "patch", "delete"] as const).flatMap((method) => {
			const operation = item?.[method] as { "x-codeSamples"?: { label: string; source: string }[] } | undefined;
			return operation ? [operation["x-codeSamples"]?.find((sample) => sample.label === "cURL")?.source] : [];
		}),
	);
	expect(samples.length).toBeGreaterThan(0);
	for (const source of samples) expect(source).toMatch(/^curl [^\\]*$/);
	expect(spec.paths?.["/api/health"]?.get).toHaveProperty(
		"x-codeSamples.0.source",
		'curl "https://rxresu.me/api/health"',
	);
});
