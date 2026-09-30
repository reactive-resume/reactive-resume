import { beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "@orpc/server";
import { APICallError, generateText, RetryError } from "ai";
import { z } from "zod";

vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	generateText: vi.fn(),
}));
vi.mock("../../context", async () => ({ protectedProcedure: (await import("@orpc/server")).os }));
vi.mock("../../middleware/rate-limit", () => ({ aiRequestRateLimit: ({ next }: { next: () => unknown }) => next() }));
vi.mock("../ai/service", () => ({ getModel: vi.fn() }));
vi.mock("../ai-providers/service", () => ({ aiProvidersService: { getDefaultRunnable: vi.fn() } }));
vi.mock("../resume/service", () => ({ resumeService: { getById: vi.fn(), create: vi.fn() } }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { create: vi.fn() } }));
vi.mock("../web-access/credentials", () => ({ webAccessService: { resolve: vi.fn().mockResolvedValue(null) } }));
vi.mock("./posting", async (importOriginal) => ({
	...(await importOriginal<typeof import("./posting")>()),
	fetchJobPosting: vi.fn(),
}));
vi.mock("./service", () => ({
	applicationService: { getById: vi.fn(), setAiResult: vi.fn(), update: vi.fn(), addNote: vi.fn() },
}));

const { aiRouter, generateJson, generatePlainText } = await import("./ai");
const { aiProvidersService } = await import("../ai-providers/service");
const { fetchJobPosting } = await import("./posting");

describe("copilot provider-failure translation", () => {
	const schema = z.object({ summary: z.string() });

	beforeEach(() => {
		vi.mocked(generateText).mockReset();
	});

	it("translates APICallError provider failures to BAD_GATEWAY in generateJson", async () => {
		vi.mocked(generateText).mockRejectedValue(
			new APICallError({
				message: "Model not found",
				url: "https://api.openai.com/v1/chat/completions",
				requestBodyValues: undefined,
				statusCode: 404,
			}),
		);

		await expect(generateJson({} as never, { prompt: "prompt" }, schema)).rejects.toMatchObject({
			code: "BAD_GATEWAY",
		});
	});

	it("translates RetryError with maxRetriesExceeded to BAD_GATEWAY", async () => {
		const providerError = new APICallError({
			message: "Provider returned 500",
			url: "https://api.openai.com/v1/chat/completions",
			requestBodyValues: undefined,
			statusCode: 500,
		});
		vi.mocked(generateText).mockRejectedValue(
			new RetryError({
				message: "Failed to generate text after 3 attempts",
				reason: "maxRetriesExceeded",
				errors: [providerError],
			}),
		);

		await expect(generatePlainText({} as never, "prompt")).rejects.toMatchObject({ code: "BAD_GATEWAY" });
	});

	it("preserves the provider error as the BAD_GATEWAY cause", async () => {
		const providerError = new APICallError({
			message: "quota exceeded",
			url: "https://api.openai.com/v1/chat/completions",
			requestBodyValues: undefined,
			statusCode: 429,
		});
		vi.mocked(generateText).mockRejectedValue(providerError);

		const error: { code?: string; cause?: unknown } = await generatePlainText({} as never, "prompt").catch(
			(thrown) => thrown,
		);
		expect(error.code).toBe("BAD_GATEWAY");
		expect(error.cause).toBe(providerError);
	});
});

describe("posting import", () => {
	const context = {
		user: {
			id: "u1",
			name: "Test",
			email: "test@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		locale: "en-US" as const,
		reqHeaders: new Headers(),
	};
	beforeEach(() => {
		vi.mocked(generateText).mockReset();
		vi.mocked(aiProvidersService.getDefaultRunnable).mockReset();
	});
	it("retains fetched evidence and page fields when optional AI enrichment fails", async () => {
		const source = {
			method: "builtin" as const,
			format: "text" as const,
			requestedUrl: "https://example.com/job",
			retrievedAt: "2026-09-30T12:00:00.000Z",
			truncated: false,
			completeness: "unknown" as const,
		};
		vi.mocked(fetchJobPosting).mockResolvedValue({
			page: { role: "Engineer", company: "Example", location: "Berlin", description: "Actual posting" },
			text: "Actual posting",
			source,
		});
		vi.mocked(aiProvidersService.getDefaultRunnable).mockResolvedValue({
			provider: "openai",
			model: "gpt-5",
			apiKey: "test",
		} as never);
		vi.mocked(generateText).mockRejectedValue(new Error("quota reached"));
		await expect(call(aiRouter.parsePosting, { input: source.requestedUrl }, { context })).resolves.toMatchObject({
			role: "Engineer",
			company: "Example",
			location: "Berlin",
			jobDescription: "Actual posting",
			sourceUrl: source.requestedUrl,
			postingSource: source,
			filledBy: "page",
			enrichmentWarning: "ai-unavailable",
		});
	});
	it("bounds pasted text and declares truncation without needing any provider", async () => {
		vi.mocked(aiProvidersService.getDefaultRunnable).mockResolvedValue(null);
		const text = "description ".repeat(2000);
		const result = await call(aiRouter.parsePosting, { input: text }, { context });
		expect(result.jobDescription).toBe(text.trim().slice(0, 20_000));
		expect(result.postingSource).toMatchObject({ method: "paste", truncated: true, completeness: "incomplete" });
		expect(generateText).not.toHaveBeenCalled();
	});
});
