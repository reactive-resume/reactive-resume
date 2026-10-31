import type { BehaviorAnnotations } from "./annotations";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnyProcedure, InferRouterInitialContext, RouterClient } from "@orpc/server";
import type { RequestAuthentication } from "@reactive-resume/api/context";
import { call, ORPCError } from "@orpc/server";
import z from "zod";
import { requiredPermission } from "@reactive-resume/api/context";
import { restAliases } from "@reactive-resume/api/rest";
import router from "@reactive-resume/api/routers";
import { env } from "@reactive-resume/env/server";
import {
	READ_EXTERNAL,
	READ_IDEMPOTENT,
	WRITE_DESTRUCTIVE,
	WRITE_DESTRUCTIVE_EXTERNAL,
	WRITE_EXTERNAL,
	WRITE_IDEMPOTENT,
	WRITE_NON_IDEMPOTENT,
} from "./annotations";
import { fileInputSchema, toWireObjectSchema, wireJsonSchema } from "./contracts";
import { readMcpFile } from "./files";
import { getClientCall, json, withErrorHandling } from "./results";
import { PARITY_TOOL_DESCRIPTIONS } from "./tool-meta";

export const MCP_ROUTER = { ...router, rest: restAliases };

// Explicit allowlist: adding an API procedure never silently grants MCP access.
// Behavior is explicit: HTTP methods and names miss cleanup, publication and provider calls.
// Per-tool justifications: fixtures/tool-annotations.md.
const PARITY_PROCEDURES: Record<string, [AnyProcedure, BehaviorAnnotations]> = {
	"resume.listVersions": [router.resume.listVersions, READ_IDEMPOTENT],
	"resume.getVersion": [router.resume.getVersion, READ_IDEMPOTENT],
	"resume.createVersion": [router.resume.createVersion, WRITE_NON_IDEMPOTENT],
	"resume.renameVersion": [router.resume.renameVersion, WRITE_DESTRUCTIVE],
	"resume.deleteVersion": [router.resume.deleteVersion, WRITE_DESTRUCTIVE],
	"resume.restoreVersion": [router.resume.restoreVersion, WRITE_DESTRUCTIVE_EXTERNAL],
	"resume.removePassword": [router.resume.removePassword, WRITE_DESTRUCTIVE_EXTERNAL],
	"resume.getBySlug": [router.resume.getBySlug, WRITE_EXTERNAL],
	"resume.checkSlug": [router.resume.checkSlug, READ_IDEMPOTENT],
	"resume.update": [router.resume.update, WRITE_DESTRUCTIVE_EXTERNAL],
	"resume.statistics.getDailyById": [router.resume.statistics.getDailyById, READ_IDEMPOTENT],
	"resume.statistics.recordDownload": [router.resume.statistics.recordDownload, WRITE_NON_IDEMPOTENT],
	"coverLetters.listVersions": [router.coverLetters.listVersions, READ_IDEMPOTENT],
	"coverLetters.getVersion": [router.coverLetters.getVersion, READ_IDEMPOTENT],
	"coverLetters.createVersion": [router.coverLetters.createVersion, WRITE_NON_IDEMPOTENT],
	"coverLetters.renameVersion": [router.coverLetters.renameVersion, WRITE_DESTRUCTIVE],
	"coverLetters.deleteVersion": [router.coverLetters.deleteVersion, WRITE_DESTRUCTIVE],
	"coverLetters.restoreVersion": [router.coverLetters.restoreVersion, WRITE_DESTRUCTIVE],
	"coverLetters.draft": [router.coverLetters.draft, WRITE_DESTRUCTIVE_EXTERNAL],
	"documents.list": [router.documents.list, WRITE_DESTRUCTIVE],
	"documents.counts": [router.documents.counts, READ_IDEMPOTENT],
	"documents.rename": [router.documents.rename, WRITE_DESTRUCTIVE],
	"documents.setTags": [router.documents.setTags, WRITE_DESTRUCTIVE],
	"documents.setLocked": [router.documents.setLocked, WRITE_DESTRUCTIVE],
	"documents.linkApplication": [router.documents.linkApplication, WRITE_DESTRUCTIVE],
	"documents.trash": [router.documents.trash, WRITE_DESTRUCTIVE_EXTERNAL],
	"documents.restore": [router.documents.restore, WRITE_DESTRUCTIVE_EXTERNAL],
	"documents.restoreMany": [router.documents.restoreMany, WRITE_DESTRUCTIVE_EXTERNAL],
	"documents.purge": [router.documents.purge, WRITE_DESTRUCTIVE],
	"documents.purgeMany": [router.documents.purgeMany, WRITE_DESTRUCTIVE],
	"documents.emptyTrash": [router.documents.emptyTrash, WRITE_DESTRUCTIVE],
	"documents.purgeExpired": [router.documents.purgeExpired, WRITE_DESTRUCTIVE],
	"documents.copyForJob": [router.documents.copyForJob, WRITE_DESTRUCTIVE],
	"applications.lanes.get": [router.applications.lanes.get, WRITE_IDEMPOTENT],
	"applications.lanes.create": [router.applications.lanes.create, WRITE_NON_IDEMPOTENT],
	"applications.lanes.update": [router.applications.lanes.update, WRITE_DESTRUCTIVE],
	"applications.lanes.reorder": [router.applications.lanes.reorder, WRITE_DESTRUCTIVE],
	"applications.lanes.retire": [router.applications.lanes.retire, WRITE_DESTRUCTIVE],
	"applications.priorNoResponse": [router.applications.priorNoResponse, READ_IDEMPOTENT],
	"applications.ai.searchPostings": [router.applications.ai.searchPostings, WRITE_DESTRUCTIVE_EXTERNAL],
	"applications.ai.parsePosting": [router.applications.ai.parsePosting, WRITE_DESTRUCTIVE_EXTERNAL],
	"ai.parsePdf": [router.ai.parsePdf, WRITE_DESTRUCTIVE_EXTERNAL],
	"ai.parseDocx": [router.ai.parseDocx, WRITE_DESTRUCTIVE_EXTERNAL],
	"ai.atsReview": [router.ai.atsReview, WRITE_DESTRUCTIVE_EXTERNAL],
	"ai.improve": [router.ai.improve, WRITE_DESTRUCTIVE_EXTERNAL],
	"aiProviders.list": [router.aiProviders.list, WRITE_DESTRUCTIVE],
	"aiProviders.delete": [router.aiProviders.delete, WRITE_DESTRUCTIVE],
	"aiProviders.test": [router.aiProviders.test, WRITE_DESTRUCTIVE_EXTERNAL],
	"aiProviders.setDefault": [router.aiProviders.setDefault, WRITE_DESTRUCTIVE],
	"webAccess.status": [router.webAccess.status, READ_IDEMPOTENT],
	"webAccess.delete": [router.webAccess.delete, WRITE_DESTRUCTIVE],
	"webAccess.test": [router.webAccess.test, WRITE_DESTRUCTIVE_EXTERNAL],
	"agent.threads.list": [router.agent.threads.list, READ_IDEMPOTENT],
	"agent.threads.start": [router.agent.threads.start, WRITE_DESTRUCTIVE],
	"agent.threads.get": [router.agent.threads.get, WRITE_DESTRUCTIVE],
	"agent.threads.update": [router.agent.threads.update, WRITE_DESTRUCTIVE],
	"agent.threads.delete": [router.agent.threads.delete, WRITE_DESTRUCTIVE],
	"agent.messages.send": [router.agent.messages.send, WRITE_DESTRUCTIVE_EXTERNAL],
	"agent.messages.stop": [router.agent.messages.stop, WRITE_DESTRUCTIVE],
	"agent.messages.resume": [router.agent.messages.resume, READ_IDEMPOTENT],
	"agent.messages.setEditStatus": [router.agent.messages.setEditStatus, WRITE_DESTRUCTIVE],
	"agent.attachments.create": [router.agent.attachments.create, WRITE_NON_IDEMPOTENT],
	"agent.attachments.delete": [router.agent.attachments.delete, WRITE_DESTRUCTIVE],
	"career.suggestTargetRoles": [router.career.suggestTargetRoles, READ_EXTERNAL],
	"career.profile": [router.career.profile, READ_IDEMPOTENT],
	"career.saveProfile": [router.career.saveProfile, WRITE_DESTRUCTIVE],
	"career.facts": [router.career.facts, READ_IDEMPOTENT],
	"career.saveFact": [router.career.saveFact, WRITE_NON_IDEMPOTENT],
	"career.updateFact": [router.career.updateFact, WRITE_DESTRUCTIVE],
	"career.forgetFact": [router.career.forgetFact, WRITE_DESTRUCTIVE],
	"career.stories": [router.career.stories, READ_IDEMPOTENT],
	"career.saveStory": [router.career.saveStory, WRITE_DESTRUCTIVE],
	"career.deleteStory": [router.career.deleteStory, WRITE_DESTRUCTIVE],
	"career.savedItems": [router.career.savedItems, READ_IDEMPOTENT],
	"career.deleteSavedItem": [router.career.deleteSavedItem, WRITE_DESTRUCTIVE],
	"career.applyReply": [router.career.applyReply, WRITE_DESTRUCTIVE],
	"career.workspace": [router.career.workspace, READ_IDEMPOTENT],
	"career.saveWorkspace": [router.career.saveWorkspace, WRITE_DESTRUCTIVE],
	"career.schedules": [router.career.schedules, READ_IDEMPOTENT],
	"career.saveSchedule": [router.career.saveSchedule, WRITE_DESTRUCTIVE_EXTERNAL],
	"career.deleteSchedule": [router.career.deleteSchedule, WRITE_DESTRUCTIVE],
	"career.opportunities": [router.career.opportunities, READ_IDEMPOTENT],
	"career.dismissOpportunity": [router.career.dismissOpportunity, WRITE_DESTRUCTIVE],
	"career.trackOpportunity": [router.career.trackOpportunity, WRITE_IDEMPOTENT],
	"career.notifications": [router.career.notifications, READ_IDEMPOTENT],
	"career.markNotificationRead": [router.career.markNotificationRead, WRITE_DESTRUCTIVE],
	"auth.providers.list": [router.auth.providers.list, READ_IDEMPOTENT],
	"auth.exportData": [router.auth.exportData, READ_IDEMPOTENT],
	"flags.get": [router.flags.get, READ_IDEMPOTENT],
	"statistics.getTotals": [router.statistics.getTotals, READ_IDEMPOTENT],
	"statistics.github.getStarCount": [router.statistics.github.getStarCount, READ_EXTERNAL],
	"storage.deleteFile": [router.storage.deleteFile, WRITE_DESTRUCTIVE_EXTERNAL],
	"rest.documentExports.resume": [restAliases.documentExports.resume, READ_IDEMPOTENT],
	"rest.documentExports.letter": [restAliases.documentExports.letter, READ_IDEMPOTENT],
	"rest.checkResume": [restAliases.checkResume, READ_IDEMPOTENT],
	"rest.checkPdf": [restAliases.checkPdf, READ_IDEMPOTENT],
	"rest.matchResume": [restAliases.matchResume, READ_IDEMPOTENT],
	"rest.importResumeFile": [restAliases.importResumeFile, WRITE_NON_IDEMPOTENT],
	"rest.fileUpload": [restAliases.fileUpload, WRITE_EXTERNAL],
};

function parityToolName(path: string): string {
	return `api_${path
		.replaceAll(".", "_")
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.toLowerCase()}`;
}

const streamingPaths = new Set(["coverLetters.draft", "agent.messages.send", "agent.messages.resume"]);
const exportPaths = new Set(["rest.documentExports.resume", "rest.documentExports.letter"]);

type Handoff = {
	title: string;
	description: string;
	inputSchema: z.ZodObject;
	url: (input: Record<string, string>) => string;
};
/** These workflows require browser interaction so secrets and security ceremonies stay with the user. */
const settingsHandoff = (title: string, page: string): Handoff => ({
	title,
	description:
		"Complete this workflow in the authenticated browser. Provider keys, passwords, passkeys and other account credentials stay out of tool arguments. No change is made by this tool.",
	inputSchema: z.object({}),
	url: () => (page ? `/dashboard/settings/${page}` : "/dashboard"),
});
const HANDOFFS: Record<string, Handoff> = {
	"aiProviders.create": settingsHandoff("Add an AI provider in the app", "ai"),
	"aiProviders.update": settingsHandoff("Edit an AI provider in the app", "ai"),
	"webAccess.save": settingsHandoff("Set up web search in the app", "ai"),
	"resume.getRoot": settingsHandoff("Open the dashboard", ""),
	"auth.createApiKey": settingsHandoff("Create an API key in the app", "api-keys"),
	"auth.deleteAccount": settingsHandoff("Delete your account in the app", "account"),
	// Resume share passwords are credentials too: owners set them and visitors enter them in the browser.
	"resume.setPassword": {
		title: "Set a resume's share password in the app",
		description:
			"Open the resume in the editor to set, change or remove its share password under Share → Link → Require a password. Passwords stay out of tool arguments. No change is made by this tool.",
		inputSchema: z.object({ id: z.string().min(1).describe("Resume ID. Use `list_resumes` to find valid IDs.") }),
		url: ({ id }) => `/builder/${encodeURIComponent(id ?? "")}`,
	},
	"resume.verifyPassword": {
		title: "Open a password-protected resume",
		description:
			"Open a password-protected public resume so the visitor can enter its password in the browser. Passwords stay out of tool arguments. No change is made by this tool.",
		inputSchema: z.object({
			username: z.string().min(1).describe("Username in the public resume address."),
			slug: z.string().min(1).describe("Slug in the public resume address."),
		}),
		url: ({ username, slug }) => `/${encodeURIComponent(username ?? "")}/${encodeURIComponent(slug ?? "")}`,
	},
};
const handoffOutputSchema = z.object({ url: z.url(), action: z.string(), requiresBrowser: z.literal(true) });
// Its output carries no `action`, so it is registered on its own.
const accountToolMeta = {
	title: "Open account settings",
	description:
		"Open profile, security, connected applications, API keys or preferences. Authentication changes require the user's browser interaction.",
	inputSchema: z.object({
		page: z.enum(["profile", "authentication", "api-keys", "preferences", "account"]).default("profile"),
	}),
	outputSchema: z.object({ url: z.url(), requiresBrowser: z.literal(true) }),
	annotations: { title: "Open account settings", ...READ_IDEMPOTENT },
};

type ParityToolContract = {
	inputJson: ReturnType<typeof wireJsonSchema>;
	inputSchema: z.ZodObject;
	outputSchema: z.ZodObject;
};
// The export's full contract repeats every document, application and career schema (~13k tokens);
// the procedure still validates it, so discovery only names its parts.
const accountExportOutputSchema = z
	.looseObject({
		exportedAt: z.string(),
		user: z.looseObject({}).describe("Profile: id, name, email, username, image and timestamps."),
		resumes: z.array(z.looseObject({})).describe("Every resume, as returned by read_resume."),
		coverLetters: z.array(z.looseObject({})).describe("Every cover letter, as returned by read_cover_letter."),
		applications: z.array(z.looseObject({})).describe("Every application, as returned by read_application."),
		applicationPipeline: z
			.looseObject({})
			.optional()
			.describe("Application stage revision and definitions, including retired stages referenced by history."),
		career: z
			.looseObject({})
			.describe(
				"Career data: profile, facts, stories, artifacts, schedules, notifications, assistant threads, messages and attachments, opportunities, jobs, transcripts and workspaces.",
			),
	})
	.describe(
		"Account backup excluding the private application profile. Export that profile in Settings → Account. Secrets such as password hashes, tokens and API keys are never included.",
	);

/** The live server and server card share static contracts, never request context or callbacks. */
function parityToolContract(path: string, procedure: AnyProcedure): ParityToolContract {
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
	const boundedInput =
		"limit" in inputSchema.shape
			? inputSchema.extend({
					limit: z.number().int().min(1).max(100).default(20),
					offset: z.number().int().nonnegative().default(0),
				})
			: inputSchema;
	const outputSchema = exportPaths.has(path)
		? z.object({ url: z.url(), requiresAuthentication: z.literal(true) })
		: path === "auth.exportData"
			? accountExportOutputSchema
			: streamingPaths.has(path)
				? z.object({ events: z.array(z.string()), truncated: z.boolean() })
				: toWireObjectSchema(requireZod(definition.outputSchema));
	return { inputJson, inputSchema: boundedInput, outputSchema };
}

const PARITY_CONTRACTS = new Map(
	Object.entries(PARITY_PROCEDURES).map(([path, [procedure, annotations]]) => [
		path,
		{ procedure, annotations, ...parityToolContract(path, procedure) },
	]),
);

export const PARITY_TOOL_META: Record<
	string,
	Pick<ParityToolContract, "inputSchema" | "outputSchema"> & {
		title: string;
		description: string;
		annotations: BehaviorAnnotations;
	}
> = {
	...Object.fromEntries(
		[...PARITY_CONTRACTS].map(([path, { procedure, annotations, inputSchema, outputSchema }]) => {
			const route = procedure["~orpc"].route;
			const title = route.summary ?? path;
			return [
				parityToolName(path),
				{
					title,
					description: `${sentence(PARITY_TOOL_DESCRIPTIONS[path] ?? route.description ?? route.summary ?? path)}${path.startsWith("agent.messages.") && streamingPaths.has(path) ? " Returns collected stream chunks, at most 500,000 characters; use the thread getter to retrieve persisted assistant replies." : ""}${exportPaths.has(path) ? " Returns a download link rather than the file. Opening it requires authentication as this account, so it suits API clients; the file is rendered when the link is opened." : ""}${path === "rest.documentExports.resume" ? " For a PDF link the user can open directly, use `download_resume_pdf`." : ""}`,
					inputSchema,
					outputSchema,
					annotations: { title, ...annotations },
				},
			];
		}),
	),
	// Directories show annotations.title as the tool's name, so every tool repeats its title there.
	...Object.fromEntries(
		Object.entries(HANDOFFS).map(([path, { title, description, inputSchema }]) => [
			parityToolName(path),
			{
				title,
				description,
				inputSchema,
				outputSchema: handoffOutputSchema,
				annotations: { title, ...READ_IDEMPOTENT },
			},
		]),
	),
	open_account_settings: accountToolMeta,
};

/** Route summaries have no full stop; descriptions append further sentences. */
function sentence(text: string) {
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

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

function encodeOutput(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(encodeOutput);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.map(([key, item]) => [key, encodeOutput(item)]),
		);
	}
	return value ?? null;
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
	for (const [path, { procedure, inputJson }] of PARITY_CONTRACTS) {
		const definition = procedure["~orpc"];
		const name = parityToolName(path);
		const meta = PARITY_TOOL_META[name];
		if (!meta) throw new Error(`Missing MCP tool contract: ${path}`);
		server.registerTool(
			name,
			meta,
			withErrorHandling(path, async (params) => {
				const userId = context.authentication.user.id;
				const permission = requiredPermission(definition.route);
				if (!context.authentication.permissions.includes(permission))
					throw new ORPCError("FORBIDDEN", {
						message: `This credential needs the api:${permission} permission. Use a credential that includes it.`,
					});
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
					// Public reads never borrow the caller's browser cookies.
					const reqHeaders = new Headers(headers);
					reqHeaders.delete("cookie");
					context.signal?.throwIfAborted();
					result = await call(router.resume.getBySlug, input as { username: string; slug: string }, {
						context: { ...context, reqHeaders },
						...(context.signal && { signal: context.signal }),
					});
				} else {
					result = await getClientCall(client, path)(input);
					// Application-only data stays out of model tool results, including account backups.
					if (path === "auth.exportData" && result && typeof result === "object") {
						const { applicationProfile: _privateProfile, ...backup } = result as Record<string, unknown>;
						result = backup;
					}
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
				return json(encodeOutput(result));
			}),
		);
	}
	for (const [path, { url }] of Object.entries(HANDOFFS)) {
		const name = parityToolName(path);
		const meta = PARITY_TOOL_META[name];
		if (!meta) throw new Error(`Missing browser workflow contract: ${path}`);
		server.registerTool(name, meta, (input) =>
			json({
				url: new URL(url(input as Record<string, string>), env.APP_URL).toString(),
				action: path,
				requiresBrowser: true,
			}),
		);
	}
	server.registerTool("open_account_settings", accountToolMeta, ({ page }) =>
		json({ url: new URL(`/dashboard/settings/${page}`, env.APP_URL).toString(), requiresBrowser: true }),
	);
}
