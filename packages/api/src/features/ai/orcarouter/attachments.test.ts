import { describe, expect, it, vi } from "vitest";

vi.mock("@reactive-resume/env/server", () => ({
	env: { ORCA_BASE_URL: "", ORCA_AUTH_BASE_URL: "", ORCA_API_BASE_URL: "" },
}));

const {
	assertOrcaRouterModelAcceptsAttachments,
	OrcaRouterModelCapabilityError,
	OrcaRouterModelUnknownError,
	requiredInputModalitiesForMediaTypes,
} = await import("./attachments");

const catalog = {
	data: [
		{
			id: "deepseek/deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			supported_endpoint_types: ["openai"],
			architecture: { input_modalities: ["text"], output_modalities: ["text"] },
		},
		{
			id: "deepseek/deepseek-v4.1-flash",
			name: "DeepSeek V4.1 Flash",
			supported_endpoint_types: ["openai", "anthropic"],
			architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
		},
	],
};

function fetchReturning(payload: unknown, status = 200) {
	return vi.fn(async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;
}

describe("OrcaRouter attachment capability guard", () => {
	it("maps attachment media types onto the catalog's declared modalities", () => {
		expect(requiredInputModalitiesForMediaTypes(["text/plain"])).toEqual([]);
		expect(requiredInputModalitiesForMediaTypes(["image/png"])).toEqual(["image"]);
		expect(requiredInputModalitiesForMediaTypes(["audio/mpeg", "image/jpeg"])).toEqual(["audio", "image"]);
	});

	it("never calls the catalog for an attachment set that needs no non-text modality", async () => {
		const fetchImpl = fetchReturning(catalog);
		const result = await assertOrcaRouterModelAcceptsAttachments({
			apiKey: "sk-orca-fake",
			model: "deepseek/deepseek-v4-pro",
			mediaTypes: ["text/plain"],
			fetchImpl,
		});
		expect(result).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("accepts the stored model when the catalog declares the modality", async () => {
		const result = await assertOrcaRouterModelAcceptsAttachments({
			apiKey: "sk-orca-fake",
			model: "deepseek/deepseek-v4.1-flash",
			mediaTypes: ["image/png"],
			fetchImpl: fetchReturning(catalog),
		});
		expect(result?.id).toBe("deepseek/deepseek-v4.1-flash");
	});

	it("refuses a text-only model offered an image, fail closed", async () => {
		await expect(
			assertOrcaRouterModelAcceptsAttachments({
				apiKey: "sk-orca-fake",
				model: "deepseek/deepseek-v4-pro",
				mediaTypes: ["image/png"],
				fetchImpl: fetchReturning(catalog),
			}),
		).rejects.toBeInstanceOf(OrcaRouterModelCapabilityError);
	});

	it("refuses a model id the catalog no longer lists instead of sending it an unverified part", async () => {
		await expect(
			assertOrcaRouterModelAcceptsAttachments({
				apiKey: "sk-orca-fake",
				model: "deepseek/deepseek-v4-retired",
				mediaTypes: ["image/png"],
				fetchImpl: fetchReturning(catalog),
			}),
		).rejects.toBeInstanceOf(OrcaRouterModelUnknownError);
	});

	it("refuses when the catalog is unreachable rather than trusting the seed for a capability check", async () => {
		await expect(
			assertOrcaRouterModelAcceptsAttachments({
				apiKey: "sk-orca-fake",
				model: "deepseek/deepseek-v4.1-flash",
				mediaTypes: ["image/png"],
				fetchImpl: vi.fn(async () => {
					throw new Error("network down");
				}) as unknown as typeof fetch,
			}),
		).rejects.toBeInstanceOf(OrcaRouterModelUnknownError);
	});
});
