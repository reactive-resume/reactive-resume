import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnyProcedure, InferRouterInitialContext, RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { call, ORPCError } from "@orpc/server";
import z from "zod";
import { restAliases } from "@reactive-resume/api/rest";
import router from "@reactive-resume/api/routers";
import { env } from "@reactive-resume/env/server";
import { fileInputSchema, toWireObjectSchema, wireJsonSchema } from "./contracts";
import { readMcpFile } from "./files";
import { json, withErrorHandling } from "./results";

export const MCP_ROUTER = { ...router, rest: restAliases };

// Explicit allowlist: adding an API procedure never silently grants MCP access.
export const PARITY_PROCEDURES = {
	"resume.listVersions": router.resume.listVersions,
	"resume.getVersion": router.resume.getVersion,
	"resume.createVersion": router.resume.createVersion,
	"resume.renameVersion": router.resume.renameVersion,
	"resume.deleteVersion": router.resume.deleteVersion,
	"resume.restoreVersion": router.resume.restoreVersion,
	"resume.setPassword": router.resume.setPassword,
	"resume.removePassword": router.resume.removePassword,
	"resume.verifyPassword": router.resume.verifyPassword,
	"resume.getBySlug": router.resume.getBySlug,
	"resume.checkSlug": router.resume.checkSlug,
	"resume.update": router.resume.update,
	"resume.statistics.getDailyById": router.resume.statistics.getDailyById,
	"resume.statistics.recordDownload": router.resume.statistics.recordDownload,
	"resume.updates.subscribe": router.resume.updates.subscribe,
	"coverLetters.listVersions": router.coverLetters.listVersions,
	"coverLetters.getVersion": router.coverLetters.getVersion,
	"coverLetters.createVersion": router.coverLetters.createVersion,
	"coverLetters.renameVersion": router.coverLetters.renameVersion,
	"coverLetters.deleteVersion": router.coverLetters.deleteVersion,
	"coverLetters.restoreVersion": router.coverLetters.restoreVersion,
	"coverLetters.draft": router.coverLetters.draft,
	"documents.list": router.documents.list,
	"documents.counts": router.documents.counts,
	"documents.rename": router.documents.rename,
	"documents.setTags": router.documents.setTags,
	"documents.setLocked": router.documents.setLocked,
	"documents.linkApplication": router.documents.linkApplication,
	"documents.trash": router.documents.trash,
	"documents.restore": router.documents.restore,
	"documents.purge": router.documents.purge,
	"documents.purgeExpired": router.documents.purgeExpired,
	"documents.copyForJob": router.documents.copyForJob,
	"applications.ai.searchPostings": router.applications.ai.searchPostings,
	"applications.ai.parsePosting": router.applications.ai.parsePosting,
	"ai.parsePdf": router.ai.parsePdf,
	"ai.parseDocx": router.ai.parseDocx,
	"ai.atsReview": router.ai.atsReview,
	"ai.improve": router.ai.improve,
	"aiProviders.list": router.aiProviders.list,
	"aiProviders.delete": router.aiProviders.delete,
	"aiProviders.test": router.aiProviders.test,
	"webAccess.status": router.webAccess.status,
	"webAccess.delete": router.webAccess.delete,
	"webAccess.test": router.webAccess.test,
	"agent.threads.list": router.agent.threads.list,
	"agent.threads.start": router.agent.threads.start,
	"agent.threads.get": router.agent.threads.get,
	"agent.threads.update": router.agent.threads.update,
	"agent.threads.delete": router.agent.threads.delete,
	"agent.messages.send": router.agent.messages.send,
	"agent.messages.stop": router.agent.messages.stop,
	"agent.messages.resume": router.agent.messages.resume,
	"agent.messages.setEditStatus": router.agent.messages.setEditStatus,
	"agent.attachments.create": router.agent.attachments.create,
	"agent.attachments.delete": router.agent.attachments.delete,
	"auth.providers.list": router.auth.providers.list,
	"auth.exportData": router.auth.exportData,
	"auth.deleteAccount": router.auth.deleteAccount,
	"flags.get": router.flags.get,
	"statistics.getTotals": router.statistics.getTotals,
	"statistics.github.getStarCount": router.statistics.github.getStarCount,
	"storage.deleteFile": router.storage.deleteFile,
	"rest.documentExports.resume": restAliases.documentExports.resume,
	"rest.documentExports.letter": restAliases.documentExports.letter,
	"rest.checkResume": restAliases.checkResume,
	"rest.checkPdf": restAliases.checkPdf,
	"rest.matchResume": restAliases.matchResume,
	"rest.importResumeFile": restAliases.importResumeFile,
	"rest.fileUpload": restAliases.fileUpload,
} as const;

export function parityToolName(path: string): string {
	return `api_${path
		.replaceAll(".", "_")
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.toLowerCase()}`;
}

const streamingPaths = new Set(["coverLetters.draft", "agent.messages.send", "agent.messages.resume"]);
const readOnlyPosts = new Set([
	"ai.parsePdf",
	"ai.parseDocx",
	"ai.atsReview",
	"ai.improve",
	"applications.ai.searchPostings",
	"applications.ai.parsePosting",
	"rest.checkResume",
	"rest.checkPdf",
	"rest.matchResume",
	"coverLetters.draft",
	"webAccess.test",
]);
const exportPaths = new Set(["rest.documentExports.resume", "rest.documentExports.letter"]);

/** These workflows require browser interaction so secrets and security ceremonies stay with the user. */
export const BROWSER_HANDOFFS = {
	"aiProviders.create": "ai",
	"aiProviders.update": "ai",
	"webAccess.save": "ai",
	"resume.getRoot": "",
	"auth.createApiKey": "api-keys",
} as const;

const handoffAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const browserToolMeta = Object.fromEntries(
	Object.keys(BROWSER_HANDOFFS).map((path) => [
		parityToolName(path),
		{
			title: `Open ${path} in the app`,
			description:
				"Complete this workflow in the authenticated browser. Provider keys, passwords, passkeys and other account credentials stay out of tool arguments. No change is made by this tool.",
			inputSchema: z.object({}),
			outputSchema: z.object({ url: z.url(), action: z.string(), requiresBrowser: z.literal(true) }),
			annotations: handoffAnnotations,
		},
	]),
);
const accountToolMeta = {
	title: "Open account settings",
	description:
		"Open profile, security, connected applications, API keys or preferences. Authentication changes require the user's browser interaction.",
	inputSchema: z.object({
		page: z.enum(["profile", "authentication", "api-keys", "preferences", "account"]).default("profile"),
	}),
	outputSchema: z.object({ url: z.url(), requiresBrowser: z.literal(true) }),
	annotations: handoffAnnotations,
};

/** The live server and server card derive the same contracts from the API DTOs. */
export function parityToolContract(path: string, procedure: AnyProcedure) {
	const definition = procedure["~orpc"];
	const inputJson = definition.inputSchema
		? wireJsonSchema(requireZod(definition.inputSchema), "input")
		: z.toJSONSchema(z.object({}));
	if (path === "ai.parsePdf" || path === "ai.parseDocx" || path === "agent.attachments.create") {
		const properties = inputJson.properties as Record<string, unknown>;
		properties[path === "agent.attachments.create" ? "data" : "file"] = z.toJSONSchema(fileInputSchema);
	}
	// MCP requires object inputs; optional/default API inputs become ordinary objects.
	delete inputJson.default;
	const inputSchema = z.fromJSONSchema(inputJson);
	if (!(inputSchema instanceof z.ZodObject)) throw new Error(`MCP input must be an object: ${path}`);
	const expandedInput =
		path === "resume.getBySlug"
			? inputSchema.extend({
					resourceCookie: z
						.string()
						.regex(/^resume_access_[A-Za-z0-9_-]+=[A-Za-z0-9_.-]+$/)
						.optional()
						.describe("Resource capability returned by api_resume_verify_password. Account cookies are not accepted."),
				})
			: inputSchema;
	const properties = expandedInput.shape;
	const boundedInput =
		"limit" in properties
			? expandedInput.extend({
					limit: z.number().int().min(1).max(100).default(20),
					offset: z.number().int().nonnegative().default(0),
				})
			: expandedInput;
	const outputSchema = exportPaths.has(path)
		? z.object({ url: z.url(), requiresAuthentication: z.literal(true) })
		: path === "resume.verifyPassword"
			? z.object({ result: z.boolean(), resourceCookie: z.string().optional() })
			: streamingPaths.has(path)
				? z.object({ events: z.array(z.string()), truncated: z.boolean() })
				: path === "resume.updates.subscribe"
					? toWireObjectSchema(requireZod(router.resume.getById["~orpc"].outputSchema))
					: toWireObjectSchema(requireZod(definition.outputSchema));
	return { inputJson, inputSchema: boundedInput, outputSchema };
}

export const PARITY_TOOL_META: Record<
	string,
	Pick<ReturnType<typeof parityToolContract>, "inputSchema" | "outputSchema"> & {
		title: string;
		description: string;
		annotations: typeof handoffAnnotations;
	}
> = {
	...Object.fromEntries(
		Object.entries(PARITY_PROCEDURES).map(([path, procedure]) => {
			const route = procedure["~orpc"].route;
			const readOnly =
				(route.method === "GET" || readOnlyPosts.has(path)) &&
				!["resume.getBySlug", "resume.verifyPassword", "aiProviders.list"].includes(path);
			const contract = parityToolContract(path, procedure);
			return [
				parityToolName(path),
				{
					title: route.summary ?? path,
					description: `${route.description ?? route.summary ?? path}${path === "resume.updates.subscribe" ? " Returns an owned snapshot; poll updatedAt for changes over stateless MCP." : ""}${streamingPaths.has(path) ? " Returns collected stream chunks, at most 500,000 characters; use the thread getter to retrieve persisted assistant replies." : ""}${exportPaths.has(path) ? " Returns an authenticated REST download URL; send the same bearer token or API key to download. Rendering occurs when downloaded." : ""}`,
					inputSchema: contract.inputSchema,
					outputSchema: contract.outputSchema,
					annotations: {
						readOnlyHint: readOnly,
						destructiveHint: !readOnly && /update|delete|purge|remove|restore|password|trash|set/i.test(path),
						idempotentHint: readOnly && !/draft|parse|test|search|improve|review/i.test(path),
						openWorldHint:
							path === "statistics.github.getStarCount" ||
							/ai|webAccess|storage|attachments|Exports|importResumeFile/i.test(path),
					},
				},
			];
		}),
	),
	...browserToolMeta,
	open_account_settings: accountToolMeta,
};

function requireZod(schema: unknown): z.ZodType {
	if (!(schema instanceof z.ZodType)) throw new Error("MCP procedure requires a Zod contract.");
	return schema;
}

async function decodeInput(
	value: unknown,
	schema: Record<string, unknown>,
	userId: string,
	maxBytes = 10 * 1024 * 1024,
): Promise<unknown> {
	if (value === null || value === undefined) return value;
	if (schema["x-mcp-native"] === "date") return new Date(String(value));
	if (schema["x-mcp-native"] === "file") return readMcpFile(value, userId, maxBytes);
	const variants = schema.anyOf ?? schema.oneOf;
	if (Array.isArray(variants)) {
		for (const variant of variants) {
			if (variant && typeof variant === "object" && z.fromJSONSchema(variant).safeParse(value).success) {
				return decodeInput(value, variant as Record<string, unknown>, userId, maxBytes);
			}
		}
	}
	if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
		return Promise.all(
			value.map((item) => decodeInput(item, schema.items as Record<string, unknown>, userId, maxBytes)),
		);
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
		return Object.fromEntries(
			await Promise.all(
				Object.entries(value).map(async ([key, item]) => [
					key,
					properties?.[key] ? await decodeInput(item, properties[key], userId, maxBytes) : item,
				]),
			),
		);
	}
	return value;
}

async function encodeOutput(value: unknown): Promise<unknown> {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return Promise.all(value.map((item) => encodeOutput(item)));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			await Promise.all(
				Object.entries(value)
					.filter(([, item]) => item !== undefined)
					.map(async ([key, item]) => [key, await encodeOutput(item)]),
			),
		);
	}
	return value ?? null;
}

type DynamicClient = { [key: string]: DynamicClient | ((input: unknown) => Promise<unknown>) };
function getClientCall(client: RouterClient<typeof MCP_ROUTER>, path: string) {
	let value: DynamicClient | ((input: unknown) => Promise<unknown>) = client as unknown as DynamicClient;
	for (const part of path.split(".")) {
		if (typeof value === "function" || !value[part]) throw new Error(`Missing MCP client procedure: ${path}`);
		value = value[part];
	}
	if (typeof value !== "function") throw new Error(`Invalid MCP client procedure: ${path}`);
	return value;
}

export function registerParityTools(
	server: McpServer,
	client: RouterClient<typeof MCP_ROUTER>,
	headers: Headers,
	context: {
		authentication: RequestAuthentication;
		resHeaders: Headers;
		locale: InferRouterInitialContext<typeof MCP_ROUTER>["locale"];
		trustedClient: string;
		signal?: AbortSignal;
	},
) {
	for (const [path, procedure] of Object.entries(PARITY_PROCEDURES)) {
		const definition = (procedure as AnyProcedure)["~orpc"];
		const { inputJson } = parityToolContract(path, procedure);
		const name = parityToolName(path);
		const meta = PARITY_TOOL_META[name];
		if (!meta) throw new Error(`Missing MCP tool contract: ${path}`);
		server.registerTool(
			name,
			meta,
			withErrorHandling(path, async (params) => {
				const userId = context.authentication.user.id;
				const route = definition.route;
				const permission =
					route.method === "GET" || path === "resume.verifyPassword"
						? "read"
						: route.method === "DELETE" || /^(delete|bulkDelete|purge)/i.test(route.operationId ?? "")
							? "delete"
							: "write";
				if (!context.authentication.permissions.includes(permission))
					throw new ORPCError("FORBIDDEN", { message: `This credential requires api:${permission} permission.` });
				const maxBytes =
					path === "rest.checkPdf"
						? 25_000_000
						: path === "agent.attachments.create"
							? 25 * 1024 * 1024
							: 10 * 1024 * 1024;
				let input = await decodeInput(params, inputJson as Record<string, unknown>, userId, maxBytes);
				if (path === "ai.parsePdf" || path === "ai.parseDocx" || path === "agent.attachments.create") {
					const record = input as Record<string, unknown>;
					const field = path === "agent.attachments.create" ? "data" : "file";
					const file = await readMcpFile(record[field], userId, maxBytes);
					input = { ...record, [field]: Buffer.from(await file.arrayBuffer()).toString("base64") };
				}
				context.resHeaders.delete("set-cookie");
				let result: unknown;
				if (exportPaths.has(path)) {
					const { id, format, words } = input as { id: string; format: string; words?: Record<string, string> };
					await (path.endsWith(".resume") ? client.resume.getById({ id }) : client.coverLetters.getById({ id }));
					const collection = path.endsWith(".resume") ? "resumes" : "cover-letters";
					const url = new URL(
						`/api/openapi/${collection}/${encodeURIComponent(id)}/exports/${encodeURIComponent(format)}`,
						env.APP_URL,
					);
					if (words) for (const [key, value] of Object.entries(words)) url.searchParams.set(`words[${key}]`, value);
					return json({ url: url.toString(), requiresAuthentication: true });
				}
				if (path === "resume.getBySlug") {
					const { resourceCookie, ...resourceInput } = input as {
						username: string;
						slug: string;
						resourceCookie?: string;
					};
					const reqHeaders = new Headers(headers);
					reqHeaders.delete("cookie");
					if (resourceCookie) reqHeaders.set("cookie", resourceCookie);
					context.signal?.throwIfAborted();
					result = await call(router.resume.getBySlug, resourceInput, {
						context: { ...context, reqHeaders },
						...(context.signal && { signal: context.signal }),
					});
				} else {
					result = await getClientCall(client, path === "resume.updates.subscribe" ? "resume.getById" : path)(input);
				}
				if (streamingPaths.has(path)) {
					const events: string[] = [];
					let length = 0;
					let truncated = false;
					for await (const event of result as AsyncIterable<string>) {
						if (length + event.length > 500_000) {
							truncated = true;
							break;
						}
						events.push(event);
						length += event.length;
					}
					result = { events, truncated };
				}
				const wire = await encodeOutput(result);
				const response = json(wire);
				if (path === "resume.verifyPassword") {
					// Password verification mints a resource cookie. Expose it explicitly for
					// the next public-read call, never as an ambient account session cookie.
					const cookie = context.resHeaders.get("set-cookie")?.split(";")[0];
					if (cookie) response.structuredContent = { ...response.structuredContent, resourceCookie: cookie };
					context.resHeaders.delete("set-cookie");
				}
				return response;
			}),
		);
	}
	for (const [path, destination] of Object.entries(BROWSER_HANDOFFS)) {
		const meta = browserToolMeta[parityToolName(path)];
		if (!meta) throw new Error(`Missing browser workflow contract: ${path}`);
		server.registerTool(parityToolName(path), meta, () =>
			json({
				url: new URL(destination ? `/dashboard/settings/${destination}` : "/dashboard", env.APP_URL).toString(),
				action: path,
				requiresBrowser: true,
			}),
		);
	}
	server.registerTool("open_account_settings", accountToolMeta, ({ page }) =>
		json({ url: new URL(`/dashboard/settings/${page}`, env.APP_URL).toString(), requiresBrowser: true }),
	);
}
