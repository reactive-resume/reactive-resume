import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const service = vi.hoisted(() => ({
	getById: vi.fn(),
	getDefaultRunnable: vi.fn(),
	authorize: vi.fn(async () => undefined),
	getModel: vi.fn((_input: unknown) => ({ modelId: "mock" })),
	streamText: vi.fn(),
}));

vi.mock("../ai-providers/service", () => ({
	aiProvidersService: {
		getDefaultRunnable: service.getDefaultRunnable,
		authorize: service.authorize,
	},
}));
vi.mock("../ai/service", () => ({ getModel: service.getModel }));
vi.mock("./service", () => ({ coverLetterService: { getById: service.getById } }));
vi.mock("../resume/service", () => ({ resumeService: { getById: service.getById } }));
vi.mock("../applications/service", () => ({
	applicationService: { getById: service.getById },
	assertApplicationVersion: vi.fn(),
}));
vi.mock("../documents/ownership", () => ({ assertDocumentVersion: vi.fn() }));
vi.mock("@reactive-resume/resume/markdown", () => ({ buildMarkdown: vi.fn(() => "resume markdown") }));
vi.mock("ai", () => ({ streamText: service.streamText }));

const { draftLetterBody } = await import("./draft");

beforeEach(() => {
	vi.clearAllMocks();
	service.getById.mockImplementation(async ({ id }: { id: string }) => {
		if (id === "letter")
			return {
				id: "letter",
				sourceResumeId: "resume",
				sourceApplicationId: null,
				style: { metadata: { page: { locale: "en-US" } } },
			};
		return { id: "resume", data: {} };
	});
	service.getDefaultRunnable.mockResolvedValue({
		id: "provider-1",
		label: "OpenAI",
		provider: "openai",
		model: "main-model",
		fastModel: "fast-model",
		capableModel: "capable-model",
		apiKey: "secret",
		baseURL: "",
	});
	service.streamText.mockReturnValue({ stream: (async function* () {})() });
});

describe("letter drafts", () => {
	it("keeps legacy text streams and emits an opted-in operation before any partial text", async () => {
		service.streamText.mockImplementation(() => ({
			stream: (async function* () {
				yield { type: "text-delta", text: "Partial draft" };
			})(),
		}));
		const old = await draftLetterBody({ id: "letter", userId: "user-1", variant: "draft" });
		expect(await Array.fromAsync(old)).toEqual(["Partial draft"]);
		const next = await draftLetterBody({ id: "letter", userId: "user-1", variant: "draft", includeProvenance: true });
		const usage = service.getModel.mock.calls.at(-1)?.[0] as unknown as { usage: { operationId: string } };
		expect((await next.next()).value).toEqual({ aiOperationId: usage.usage.operationId });
		expect((await next.next()).value).toBe("Partial draft");
	});
	it("uses the capable model while the main model stays the single-model default", async () => {
		const draft = await draftLetterBody({ id: "letter", userId: "user-1", variant: "draft" });
		await draft.next();

		expect(service.getModel).toHaveBeenCalledWith(expect.objectContaining({ model: "capable-model" }));
	});

	it("falls back to the main model when no capable model is set", async () => {
		service.getDefaultRunnable.mockResolvedValue({
			id: "provider-1",
			label: "OpenAI",
			provider: "openai",
			model: "main-model",
			fastModel: null,
			capableModel: null,
			apiKey: "secret",
			baseURL: "",
		});

		const draft = await draftLetterBody({ id: "letter", userId: "user-1", variant: "draft" });
		await draft.next();

		expect(service.getModel).toHaveBeenCalledWith(expect.objectContaining({ model: "main-model" }));
	});
});
