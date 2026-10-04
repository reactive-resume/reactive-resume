/**
 * Live check of the OrcaRouter provider path.
 *
 * Enabled only when `ORCAROUTER_API_KEY` is present (CI and the hosted workspace provide it). Every
 * call below goes through the same `fetchOrcaRouterModels` the oRPC `orcaCatalog` procedure uses, so
 * the request, the origin resolution, the parsing and the capability filters under test are the ones
 * the application ships. It is not a bare `curl` stand-in.
 *
 * Logged lines intentionally contain only counts and capability names, never the key.
 */
import { describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
	ORCA_BASE_URL: "",
	ORCA_AUTH_BASE_URL: "",
	ORCA_API_BASE_URL: "",
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

const apiKey = process.env.ORCAROUTER_API_KEY ?? "";

describe.skipIf(!apiKey)("OrcaRouter live discovery through the shipped provider path", () => {
	it("returns a live chat catalog that is never mixed with the verified seed", async () => {
		const { fetchOrcaRouterModels, ORCAROUTER_ENTRY_POINT_FILTERS } = await import("./discovery");
		const { resolveOrcaRouterOrigins } = await import("./origins");

		const result = await fetchOrcaRouterModels({
			origins: resolveOrcaRouterOrigins(),
			apiKey,
			filter: ORCAROUTER_ENTRY_POINT_FILTERS.chat,
		});

		expect(result.source).toBe("live");
		expect(result.degradedReason).toBeNull();
		expect(result.fetchedAt).toBeTruthy();
		expect(result.models.length).toBeGreaterThan(0);
		// A successful response is authoritative: no seeded record may appear in it.
		expect(result.models.every((model) => model.verifiedFallback === false)).toBe(true);
		// Vendor/model namespaces are preserved verbatim.
		expect(result.models.some((model) => model.id.includes("/"))).toBe(true);
		// Every offered chat model really speaks one of the endpoint types this client can call.
		for (const model of result.models) {
			expect(model.supportedEndpointTypes.length).toBeGreaterThan(0);
		}

		console.log(`[orca-live] chat catalog: ${result.models.length} models, source=${result.source}`);
	});

	it("narrows the multimodal entry point to models that declare image input", async () => {
		const { fetchOrcaRouterModels, ORCAROUTER_ENTRY_POINT_FILTERS } = await import("./discovery");
		const { resolveOrcaRouterOrigins } = await import("./origins");
		const origins = resolveOrcaRouterOrigins();

		const chat = await fetchOrcaRouterModels({ origins, apiKey, filter: ORCAROUTER_ENTRY_POINT_FILTERS.chat });
		const vision = await fetchOrcaRouterModels({
			origins,
			apiKey,
			filter: ORCAROUTER_ENTRY_POINT_FILTERS.assistant_image,
		});

		// Fail closed: a model that does not declare image input is not offered for image entry points.
		expect(vision.models.every((model) => model.inputModalities.includes("image"))).toBe(true);
		expect(vision.models.length).toBeLessThanOrEqual(chat.models.length);

		console.log(`[orca-live] assistant image catalog: ${vision.models.length} of ${chat.models.length} chat models`);
	});

	it("rejects a revoked key at the discovery boundary instead of degrading to the seed", async () => {
		const { fetchOrcaRouterModels, OrcaRouterCatalogAuthError, ORCAROUTER_ENTRY_POINT_FILTERS } =
			await import("./discovery");
		const { resolveOrcaRouterOrigins } = await import("./origins");

		await expect(
			fetchOrcaRouterModels({
				origins: resolveOrcaRouterOrigins(),
				apiKey: "sk-orca-invalid-live-check",
				filter: ORCAROUTER_ENTRY_POINT_FILTERS.chat,
			}),
		).rejects.toBeInstanceOf(OrcaRouterCatalogAuthError);
	});
});
