import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { authorizeAiRequest } from "./ai-consent";
import { confirmOperation } from "@/hooks/use-confirm";

vi.mock("@/hooks/use-confirm", () => ({ confirmOperation: vi.fn() }));
const provider = {
	id: "provider-a",
	recipientVersion: "recipient-a",
	label: "Fictional local provider",
	provider: "openai-compatible",
	model: "stub",
	baseURL: "http://127.0.0.1:9000/v1",
	apiKeyFingerprint: "first-key",
	enabled: true,
	testStatus: "success",
	managed: false,
};
const api = {
	auth: { getProfile: vi.fn() },
	ai: { capabilities: vi.fn() },
	aiProviders: { list: vi.fn() },
	agent: { threads: { get: vi.fn() } },
	webAccess: { status: vi.fn() },
};
const consentApi = api as unknown as Parameters<typeof authorizeAiRequest>[2];
beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	vi.clearAllMocks();
	api.auth.getProfile.mockResolvedValue({ id: "owner" });
	api.ai.capabilities.mockResolvedValue({ explicitNoAi: true, recipientApproval: 1 });
	api.aiProviders.list.mockResolvedValue([provider]);
	api.webAccess.status.mockResolvedValue({ revision: "web-1", provider: null, searxng: false, search: true });
});
it("usage history reads do not need a provider or sharing approval", async () => {
	api.aiProviders.list.mockResolvedValue([]);
	expect(await authorizeAiRequest(["ai", "usage"], {}, consentApi)).toBeUndefined();
	expect(api.aiProviders.list).not.toHaveBeenCalled();
	expect(api.auth.getProfile).not.toHaveBeenCalled();
	expect(confirmOperation).not.toHaveBeenCalled();
});
it("does not approve a canceled operation", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(false);
	await expect(authorizeAiRequest(["ai", "improve"], { line: "Fictional text" }, consentApi)).rejects.toMatchObject({
		name: "AbortError",
	});
});
it("rejects configuration or key changes made while consent is open", async () => {
	vi.mocked(confirmOperation).mockImplementation(async () => {
		api.aiProviders.list.mockResolvedValue([
			{ ...provider, apiKeyFingerprint: "changed-key", recipientVersion: "recipient-b" },
		]);
		return true;
	});
	await expect(authorizeAiRequest(["ai", "improve"], { line: "Fictional text" }, consentApi)).rejects.toThrow(
		"settings changed",
	);
});
it("approves only the chosen thread destination and discloses history when rebinding", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	api.aiProviders.list.mockResolvedValue([{ ...provider, id: "other" }, provider]);
	const approved = await authorizeAiRequest(
		["agent", "threads", "update"],
		{ id: "thread", aiProviderId: provider.id },
		consentApi,
	);
	expect(approved?.aiDestination).toContain('"provider-a"');
	expect(confirmOperation).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining("Earlier messages and attachments") }),
	);
});
it("web search names its own destination without claiming to call an AI model", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	const approved = await authorizeAiRequest(
		["applications", "ai", "searchPostings"],
		{ query: "fictional engineering roles" },
		consentApi,
	);
	expect(approved).toEqual({ aiDestination: "none", webDestination: "web-1" });
	expect(api.aiProviders.list).not.toHaveBeenCalled();
	expect(confirmOperation).toHaveBeenCalledWith(
		"Use web access?",
		expect.objectContaining({ description: expect.stringContaining("No AI provider is used") }),
	);
});

it("rejects an absent-provider transition while manual posting approval is open", async () => {
	api.aiProviders.list.mockResolvedValue([]);
	vi.mocked(confirmOperation).mockImplementation(async () => {
		api.aiProviders.list.mockResolvedValue([provider]);
		return true;
	});
	await expect(
		authorizeAiRequest(["applications", "ai", "parsePosting"], { input: "Fictional posting" }, consentApi),
	).rejects.toThrow(/changed/);
});
it("binds a manual posting approval to no AI and refuses AI-only actions without a recipient", async () => {
	api.aiProviders.list.mockResolvedValue([]);
	vi.mocked(confirmOperation).mockResolvedValue(true);
	expect(
		await authorizeAiRequest(["applications", "ai", "parsePosting"], { input: "Fictional posting" }, consentApi),
	).toEqual({ aiDestination: "none", webDestination: "web-1" });
	await expect(
		authorizeAiRequest(["applications", "ai", "autofill"], { jobDescription: "Fictional" }, consentApi),
	).rejects.toThrow();
});
it.each([
	["speak", "tts-1", "text to read aloud"],
	["transcribe", "whisper-1", "your recording"],
])("discloses and binds actual voice operation %s", async (operation, model, scope) => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	const approval = await authorizeAiRequest(
		["career", "voice", operation as string],
		{ providerId: provider.id, model, text: "Fictional" },
		consentApi,
	);
	expect(confirmOperation).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining(model as string) }),
	);
	expect(confirmOperation).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining(scope as string) }),
	);
	expect(JSON.parse(approval?.aiDestination ?? "null").at(-1)).toEqual({
		kind: operation === "speak" ? "speech" : "transcription",
		model,
	});
});

it("discloses the task model that receives the data", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	api.aiProviders.list.mockResolvedValue([{ ...provider, fastModel: "fast-model", capableModel: "capable-model" }]);

	await authorizeAiRequest(["ai", "improve"], { line: "Fictional text" }, consentApi);
	expect(confirmOperation).toHaveBeenLastCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining("fast-model") }),
	);

	await authorizeAiRequest(["coverLetters", "draft"], { id: "letter" }, consentApi);
	expect(confirmOperation).toHaveBeenLastCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining("capable-model") }),
	);
});

it("retains approved default A while default B becomes first during the dialog", async () => {
	vi.mocked(confirmOperation).mockImplementation(async () => {
		api.aiProviders.list.mockResolvedValue([
			{ ...provider, id: "provider-b", recipientVersion: "recipient-b" },
			provider,
		]);
		return true;
	});
	const approval = await authorizeAiRequest(["ai", "improve"], { line: "Synthetic" }, consentApi);
	expect(JSON.parse(approval?.aiDestination ?? "null")).toEqual([provider.id, provider.recipientVersion]);
});
it("refuses unconfirmed legacy manual mode and account changes without transmission", async () => {
	api.aiProviders.list.mockResolvedValue([]);
	api.ai.capabilities.mockRejectedValue(new Error("old self-host"));
	await expect(
		authorizeAiRequest(["applications", "ai", "parsePosting"], { input: "Private" }, consentApi),
	).rejects.toThrow(/cannot confirm/);
	expect(confirmOperation).not.toHaveBeenCalled();
	api.aiProviders.list.mockResolvedValue([provider]);
	vi.mocked(confirmOperation).mockImplementation(async () => {
		api.auth.getProfile.mockResolvedValue({ id: "other" });
		return true;
	});
	await expect(authorizeAiRequest(["ai", "improve"], { line: "Private" }, consentApi)).rejects.toThrow(
		/account changed/,
	);
});

it("cancels queued voice approval before dispatch", async () => {
	const controller = new AbortController();
	vi.mocked(confirmOperation).mockImplementation(async () => {
		controller.abort();
		return true;
	});
	await expect(
		authorizeAiRequest(
			["career", "voice", "transcribe"],
			{ providerId: provider.id, model: "whisper-1" },
			consentApi,
			controller.signal,
		),
	).rejects.toMatchObject({ name: "AbortError" });
});

const nativeProvider = { ...provider, provider: "openai", baseURL: "https://api.openai.com/v1" };
it("grants paid native search only after naming its query-only destination and charges", async () => {
	api.aiProviders.list.mockResolvedValue([nativeProvider]);
	api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
	vi.mocked(confirmOperation).mockResolvedValue(true);
	const approval = await authorizeAiRequest(
		["applications", "ai", "searchPostings"],
		{ query: "Fictional engineer", aiProviderId: provider.id },
		consentApi,
	);
	expect(approval).toEqual({
		aiDestination: JSON.stringify([provider.id, provider.recipientVersion]),
		webDestination: "web-1",
		nativeSearchFallback: true,
	});
	const description = vi.mocked(confirmOperation).mock.calls[0]?.[1]?.description;
	expect(description).toContain("Only your search query and search countries");
	expect(description).toContain("No document, Knowledge or application context");
	expect(description).toContain("may charge");
	expect(description).toContain(nativeProvider.baseURL);
});
it.each(["old-server", "custom-endpoint"])("refuses native retry for %s before asking approval", async (kind) => {
	api.aiProviders.list.mockResolvedValue([kind === "custom-endpoint" ? provider : nativeProvider]);
	api.ai.capabilities.mockResolvedValue(kind === "old-server" ? {} : { nativeWebSearch: 1 });
	await expect(
		authorizeAiRequest(
			["applications", "ai", "searchPostings"],
			{ query: "Fictional", aiProviderId: provider.id },
			consentApi,
		),
	).rejects.toThrow(/doesn't support native/);
	expect(confirmOperation).not.toHaveBeenCalled();
});
it.each(["decline", "account", "provider", "web", "abort"])(
	"does not return native permission after %s",
	async (change) => {
		api.aiProviders.list.mockResolvedValue([nativeProvider]);
		api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
		const abort = new AbortController();
		vi.mocked(confirmOperation).mockImplementation(async () => {
			if (change === "account") api.auth.getProfile.mockResolvedValue({ id: "other" });
			if (change === "provider")
				api.aiProviders.list.mockResolvedValue([{ ...nativeProvider, recipientVersion: "replacement" }]);
			if (change === "web") api.webAccess.status.mockResolvedValue({ revision: "web-2" });
			if (change === "abort") abort.abort();
			return change !== "decline";
		});
		await expect(
			authorizeAiRequest(
				["applications", "ai", "searchPostings"],
				{ query: "Fictional", aiProviderId: provider.id },
				consentApi,
				abort.signal,
			),
		).rejects.toThrow();
	},
);
it.each([true, false, undefined])(
	"chat native permission respects web context %s and discloses additional requests",
	async (web) => {
		api.aiProviders.list.mockResolvedValue([nativeProvider]);
		api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
		api.agent.threads.get.mockResolvedValue({ thread: { aiProviderId: provider.id } });
		vi.mocked(confirmOperation).mockResolvedValue(true);
		const approval = await authorizeAiRequest(
			["agent", "messages", "send"],
			{ threadId: "thread", context: web === undefined ? {} : { web } },
			consentApi,
		);
		expect(approval?.nativeSearchFallback).toBe(web === false ? undefined : true);
		const description = vi.mocked(confirmOperation).mock.calls[0]?.[1]?.description ?? "";
		expect(description.includes("This can add AI requests and charges")).toBe(web !== false);
	},
);

it("discloses Prepare's complete context and both actual task models once, with no web destination", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	api.aiProviders.list.mockResolvedValue([{ ...provider, fastModel: "unused-fast", capableModel: "capable-model" }]);
	const approval = await authorizeAiRequest(
		["applications", "ai", "prepare"],
		{ id: "job", questions: ["Why?"] },
		consentApi,
	);
	expect(confirmOperation).toHaveBeenCalledTimes(1);
	const description = vi.mocked(confirmOperation).mock.calls[0]?.[1]?.description ?? "";
	expect(description).toContain("stub, capable-model");
	expect(description).toContain("application notes and contacts");
	expect(description).toContain("enabled Knowledge facts and stories");
	expect(description).toContain("Web access is off");
	expect(description).not.toContain("unused-fast");
	expect(api.webAccess.status).not.toHaveBeenCalled();
	expect(approval?.webDestination).toBeUndefined();
});
it("Fit evidence disclosure does not authorize all Knowledge or private notes", async () => {
	vi.mocked(confirmOperation).mockResolvedValue(true);
	await authorizeAiRequest(["applications", "ai", "proposeEvidence"], { id: "job", factId: "selected" }, consentApi);
	const description = vi.mocked(confirmOperation).mock.calls[0]?.[1]?.description ?? "";
	expect(description).toContain("Shares only the selected Knowledge statement");
	expect(description).toContain("Other Knowledge, private notes and web access are excluded");
	expect(api.webAccess.status).not.toHaveBeenCalled();
});
