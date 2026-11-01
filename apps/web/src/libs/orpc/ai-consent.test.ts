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
