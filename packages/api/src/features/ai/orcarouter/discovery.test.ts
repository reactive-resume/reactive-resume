import { describe, expect, it, vi } from "vitest";
import { resolveOrcaRouterOrigins } from "@reactive-resume/ai/orcarouter/origins";
import {
	degradedOrcaRouterCatalog,
	fetchOrcaRouterModels,
	isOrcaRouterEntryPoint,
	OrcaRouterCatalogAuthError,
	ORCAROUTER_ENTRY_POINT_FILTERS,
} from "./discovery";

const origins = resolveOrcaRouterOrigins();

const liveBody = {
	data: [
		{
			id: "deepseek/deepseek-v4-pro",
			supported_endpoint_types: ["openai", "openai-response"],
			context_length: 1_048_576,
			architecture: { input_modalities: ["text"], output_modalities: ["text"] },
		},
		{
			id: "deepseek/deepseek-v4.1-flash",
			supported_endpoint_types: ["openai", "anthropic"],
			context_length: 1_048_576,
			architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
		},
		{ id: "vendor/image-5", supported_endpoint_types: ["image-generation"] },
	],
};

function fetchReturning(body: unknown, status = 200) {
	return (async () => Response.json(body, { status })) as unknown as typeof fetch;
}

describe("OrcaRouter model discovery", () => {
	it("calls the documented models endpoint with the capability filter and the operator's Bearer key", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return Response.json(liveBody);
		}) as unknown as typeof fetch;

		await fetchOrcaRouterModels({ origins, apiKey: "sk-orca-test", filter: { capability: "chat" }, fetchImpl });

		expect(calls[0]?.url).toBe("https://api.orcarouter.ai/v1/models?capability=chat");
		expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer sk-orca-test");
	});

	it("never sends the key to the auth origin or into the URL", async () => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string | URL | Request) => {
			calls.push(String(url));
			return Response.json(liveBody);
		}) as unknown as typeof fetch;

		await fetchOrcaRouterModels({ origins, apiKey: "sk-orca-test", filter: { capability: "chat" }, fetchImpl });
		expect(calls[0]?.startsWith("https://api.orcarouter.ai/")).toBe(true);
		expect(calls[0]).not.toContain("www.orcarouter.ai");
		expect(calls[0]).not.toContain("sk-orca-test");
	});

	it("returns the filtered live catalog and never mixes the seed into a successful response", async () => {
		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "chat" },
			fetchImpl: fetchReturning(liveBody),
		});

		expect(result.source).toBe("live");
		expect(result.degradedReason).toBeNull();
		expect(result.models.map((model) => model.id)).toEqual([
			"deepseek/deepseek-v4-pro",
			"deepseek/deepseek-v4.1-flash",
		]);
		expect(result.models.some((model) => model.verifiedFallback)).toBe(false);
		expect(result.models.some((model) => model.id === "openai/gpt-5.5")).toBe(false);
	});

	it("fails closed for an image entry point: a text-only model is not offered", async () => {
		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: ORCAROUTER_ENTRY_POINT_FILTERS.assistant_image,
			fetchImpl: fetchReturning(liveBody),
		});
		expect(result.models.map((model) => model.id)).toEqual(["deepseek/deepseek-v4.1-flash"]);
	});

	it("keeps a pdf entry point empty when no model declares file input", async () => {
		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: ORCAROUTER_ENTRY_POINT_FILTERS.pdf,
			fetchImpl: fetchReturning(liveBody),
		});
		expect(result.models).toEqual([]);
		expect(result.source).toBe("live");
	});

	it("returns an empty live catalog rather than inventing models for a successful empty response", async () => {
		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "embedding" },
			fetchImpl: fetchReturning({ data: [] }),
		});
		expect(result).toMatchObject({ source: "live", models: [], degradedReason: null });
	});

	it("signals an authentication rejection so the caller can mark the credential for reauthentication", async () => {
		const rejected = fetchReturning({ error: "unauthorized" }, 401);
		await expect(
			fetchOrcaRouterModels({
				origins,
				apiKey: "sk-orca-revoked",
				filter: { capability: "chat" },
				fetchImpl: rejected,
			}),
		).rejects.toBeInstanceOf(OrcaRouterCatalogAuthError);
	});

	it("falls back to the verified seed when the endpoint is unreachable", async () => {
		const failing = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "chat" },
			fetchImpl: failing,
		});

		expect(result.source).toBe("seed");
		expect(result.degradedReason).toBeTruthy();
		expect(result.models.map((model) => model.id)).toContain("openai/gpt-5.5");
		expect(result.models.every((model) => model.verifiedFallback)).toBe(true);
		expect(result.models.find((model) => model.id === "openai/gpt-5.5")?.reasoningEfforts).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
		]);
	});

	it("falls back on a server error and on an unreadable body, each with a reason", async () => {
		const serverError = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "chat" },
			fetchImpl: fetchReturning({}, 503),
		});
		expect(serverError).toMatchObject({ source: "seed" });
		expect(serverError.degradedReason).toContain("503");

		const unreadable = (async () => new Response("<html>nope</html>")) as unknown as typeof fetch;
		const broken = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "chat" },
			fetchImpl: unreadable,
		});
		expect(broken.source).toBe("seed");
		expect(broken.degradedReason).toBeTruthy();
	});

	it("bounds an oversized response instead of reading it into memory", async () => {
		const huge = (async () =>
			new Response(JSON.stringify({ data: [] }).padEnd(3 * 1024 * 1024, " "))) as unknown as typeof fetch;
		const result = await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-test",
			filter: { capability: "chat" },
			fetchImpl: huge,
		});
		expect(result.source).toBe("seed");
		expect(result.degradedReason).toContain("too large");
	});

	it("exposes the verified fallback for any entry point without a live call", () => {
		const result = degradedOrcaRouterCatalog({ capability: "chat" }, "offline");
		expect(result.source).toBe("seed");
		expect(result.fetchedAt).toBeNull();
		expect(result.models.length).toBeGreaterThan(0);
	});

	it("rejects an unknown entry point name", () => {
		expect(isOrcaRouterEntryPoint("chat")).toBe(true);
		expect(isOrcaRouterEntryPoint("image")).toBe(false);
	});

	it("does not log the API key while discovering models", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const failing = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		await fetchOrcaRouterModels({
			origins,
			apiKey: "sk-orca-secret-value",
			filter: { capability: "chat" },
			fetchImpl: failing,
		});
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
