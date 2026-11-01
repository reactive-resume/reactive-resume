import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ORPCError, createRouterClient } from "@orpc/server";
import { transcribe } from "ai";
import { careerVoiceRouter } from "./voice";

const mocks = vi.hoisted(() => ({
	provider: vi.fn(),
	requireApplication: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
}));

vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string } }>() };
});
vi.mock("../../middleware/rate-limit", () => ({
	aiVoiceRateLimit: ({ next }: { next: () => unknown }) => next(),
}));
vi.mock("@reactive-resume/db/client", () => ({ db: { insert: mocks.insert } }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: { getRunnableById: mocks.provider, authorize: async () => {} },
}));
vi.mock("./service", () => ({ requireCareerApplication: mocks.requireApplication }));
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	transcribe: vi.fn(),
	generateSpeech: vi.fn(),
}));

const client = createRouterClient(careerVoiceRouter, {
	context: { user: { id: "owner" }, reqHeaders: new Headers() } as never,
});
const provider = {
	id: "chosen-provider",
	provider: "openai",
	baseURL: "https://api.openai.com/v1",
	apiKey: "test-only-key",
	enabled: true,
	testStatus: "success",
};
const audioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 255]);
const input = () => ({
	providerId: provider.id,
	model: "whisper-1",
	applicationId: "owned-application",
	audio: new File([audioBytes], "answer.wav", { type: "audio/wav" }),
});

beforeEach(() => {
	vi.resetAllMocks();
	mocks.provider.mockResolvedValue(provider);
	mocks.requireApplication.mockResolvedValue({ id: "owned-application" });
	mocks.insert.mockReturnValue({ values: mocks.values });
	mocks.values.mockReturnValue({ returning: async () => [{ id: "saved-transcript" }] });
	vi.mocked(transcribe).mockResolvedValue({ text: "I led the warehouse migration." } as Awaited<
		ReturnType<typeof transcribe>
	>);
});

describe("career voice transcription", () => {
	it("rejects audio over 2 MiB before resolving a provider or sending audio", async () => {
		await expect(
			client.transcribe({
				...input(),
				audio: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "long.wav", { type: "audio/wav" }),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(mocks.provider).not.toHaveBeenCalled();
		expect(transcribe).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it.each(["untested", "compatible", "unoffered model", "substituted", "foreign application"])(
		"rejects %s context without sending audio or saving a transcript",
		async (kind) => {
			if (kind === "untested")
				mocks.provider.mockRejectedValue(
					new ORPCError("BAD_REQUEST", { message: "Test and turn on this AI provider before using it." }),
				);
			if (kind === "compatible") mocks.provider.mockResolvedValue({ ...provider, provider: "openai-compatible" });
			if (kind === "unoffered model") mocks.provider.mockResolvedValue({ ...provider, provider: "groq" });
			if (kind === "substituted") mocks.provider.mockResolvedValue({ ...provider, id: "server-default-provider" });
			if (kind === "foreign application") mocks.requireApplication.mockRejectedValue(new ORPCError("NOT_FOUND"));

			await expect(client.transcribe(input())).rejects.toMatchObject({
				code: kind === "foreign application" ? "NOT_FOUND" : "BAD_REQUEST",
			});
			expect(mocks.requireApplication).toHaveBeenCalledExactlyOnceWith({
				userId: "owner",
				applicationId: "owned-application",
			});
			if (kind === "foreign application") expect(mocks.provider).not.toHaveBeenCalled();
			else
				expect(mocks.provider).toHaveBeenCalledExactlyOnceWith({
					userId: "owner",
					id: provider.id,
					voice: { kind: "transcription", model: "whisper-1" },
				});
			expect(transcribe).not.toHaveBeenCalled();
			expect(mocks.insert).not.toHaveBeenCalled();
		},
	);

	it.each([
		["openai", "whisper-1"],
		["groq", "whisper-large-v3-turbo"],
		["gemini", "gemini-3.5-transcribe"],
		["mistral", "voxtral-mini-latest"],
		["xai", "grok-voice-transcribe-2.0"],
		["vercel-ai-gateway", "openai/whisper-1"],
	])("transcribes with a %s connection's own model", async (kind, model) => {
		mocks.provider.mockResolvedValue({ ...provider, provider: kind, baseURL: "" });
		await client.transcribe({ ...input(), model });
		expect(transcribe).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ model: expect.objectContaining({ modelId: model }) }),
		);
	});

	it("uses the selected audio model and persists only its owned transcript text", async () => {
		await expect(client.transcribe(input())).resolves.toEqual({
			id: "saved-transcript",
			text: "I led the warehouse migration.",
		});
		expect(transcribe).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				model: expect.objectContaining({ modelId: "whisper-1" }),
				audio: audioBytes,
				maxRetries: 0,
				telemetry: { recordInputs: false, recordOutputs: false },
			}),
		);
		expect(mocks.values).toHaveBeenCalledExactlyOnceWith({
			userId: "owner",
			applicationId: "owned-application",
			original: "I led the warehouse migration.",
			edited: "I led the warehouse migration.",
			model: "whisper-1",
		});
	});

	it("returns retry guidance without exposing provider error content or saving failed audio", async () => {
		vi.mocked(transcribe).mockRejectedValue(new Error("private-audio-fixture and test-only-key in provider response"));
		const response = client.transcribe(input());
		await expect(response).rejects.toMatchObject({
			code: "BAD_GATEWAY",
			message: expect.stringContaining("try again or type your answer"),
		});
		await expect(response).rejects.not.toThrow("private-audio-fixture");
		await expect(response).rejects.not.toThrow("test-only-key");
		expect(transcribe).toHaveBeenCalledTimes(1);
		expect(mocks.insert).not.toHaveBeenCalled();
	});
});
