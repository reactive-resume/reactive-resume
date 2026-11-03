import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const service = vi.hoisted(() => ({
	getRunnableById: vi.fn(),
	getDefaultRunnable: vi.fn(),
	authorize: vi.fn(async () => undefined),
	parsePdf: vi.fn(),
	parseDocx: vi.fn(),
	improveLine: vi.fn(),
}));

vi.mock("../../middleware/rate-limit", async () => {
	const { os } = await import("@orpc/server");
	const passThrough = os.middleware(({ next }) => next());
	return { aiRequestRateLimit: passThrough, storageUploadRateLimit: passThrough };
});
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: {
		getRunnableById: service.getRunnableById,
		getDefaultRunnable: service.getDefaultRunnable,
		authorize: service.authorize,
	},
}));
vi.mock("./service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./service")>();
	return {
		...actual,
		aiService: { ...actual.aiService, parsePdf: service.parsePdf, parseDocx: service.parseDocx },
	};
});
vi.mock("./improve", async (importOriginal) => ({
	...(await importOriginal<typeof import("./improve")>()),
	improveLine: service.improveLine,
}));

const { aiRouter } = await import("./router");

const provider = {
	managed: false,
	id: "provider-1",
	label: "OpenAI",
	provider: "openai" as const,
	model: "main-model",
	fastModel: "fast-model",
	capableModel: "capable-model",
	baseURL: "",
	enabled: true,
	isDefault: true,
	testStatus: "success",
	testError: null,
	testErrorKind: null,
	apiKeyPreview: "",
	apiKeyFingerprint: "",
	recipientVersion: "a".repeat(64),
	lastTestedAt: null,
	lastUsedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	apiKey: "secret",
};

const user = {
	id: "owner",
	name: "Synthetic Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const client = () =>
	createRouterClient(aiRouter, {
		context: {
			locale: "en-US",
			reqHeaders: new Headers(),
			authentication: { user, method: "apiKey", permissions: ["read", "write", "delete"] },
		},
	});

beforeEach(() => {
	vi.clearAllMocks();
	service.getRunnableById.mockImplementation(async ({ id }: { id: string }) => ({ ...provider, id }));
	service.getDefaultRunnable.mockResolvedValue(provider);
	service.parsePdf.mockResolvedValue(defaultResumeData);
	service.parseDocx.mockResolvedValue(defaultResumeData);
	service.improveLine.mockResolvedValue({ text: "Better line", why: "", addsFacts: false });
});

describe("AI task routing", () => {
	it("sends parsing and Improve to the connection's fast model", async () => {
		const api = client();
		await api.parsePdf({
			aiProviderId: "provider-1",
			file: { name: "resume.pdf", data: Buffer.from("not really a pdf").toString("base64") },
		});
		await api.improve({ aiProviderId: "provider-1", line: "Did the thing", action: "verb" });

		expect(service.parsePdf).toHaveBeenCalledWith(expect.objectContaining({ model: "fast-model" }));
		expect(service.improveLine).toHaveBeenCalledWith(expect.objectContaining({ model: "fast-model" }));
	});

	it("keeps a single-model account on its one model", async () => {
		service.getRunnableById.mockResolvedValue({ ...provider, fastModel: null, capableModel: null });
		await client().improve({ aiProviderId: "provider-1", line: "Did the thing", action: "verb" });

		expect(service.improveLine).toHaveBeenCalledWith(expect.objectContaining({ model: "main-model" }));
	});

	it("does not swap in another provider's model", async () => {
		service.getRunnableById.mockRejectedValue(new Error("not owned"));
		await expect(
			client().improve({ aiProviderId: "someone-else", line: "Did the thing", action: "verb" }),
		).rejects.toThrow("not owned");
		expect(service.improveLine).not.toHaveBeenCalled();
	});
});
