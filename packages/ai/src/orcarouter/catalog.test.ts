import { describe, expect, it } from "vitest";
import {
	filterOrcaRouterModels,
	ORCAROUTER_SEED_MODELS,
	parseOrcaRouterCatalog,
	parseOrcaRouterModel,
	reconcileSelectedModel,
	seedCatalogFor,
} from "./catalog";

const chatText = {
	id: "deepseek/deepseek-v4-pro",
	object: "model",
	supported_endpoint_types: ["openai", "openai-response"],
	context_length: 1_048_576,
	architecture: { input_modalities: ["text"], output_modalities: ["text"] },
};
const chatVision = {
	id: "deepseek/deepseek-v4.1-flash",
	object: "model",
	supported_endpoint_types: ["openai", "anthropic"],
	context_length: 1_048_576,
	architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
};
const textOnlyOrcaAlias = {
	id: "orcarouter/auto",
	supported_endpoint_types: ["openai", "openai-response", "anthropic", "gemini"],
};
const embedding = {
	id: "vendor/text-embedding-4",
	supported_endpoint_types: ["embeddings"],
	context_length: 8192,
};
const imageGeneration = {
	id: "vendor/image-5",
	supported_endpoint_types: ["image-generation"],
	architecture: { input_modalities: ["text"], output_modalities: ["image"] },
};
const video = { id: "vendor/video-2", supported_endpoint_types: ["openai-video"] };
const rerank = { id: "vendor/rerank-3", supported_endpoint_types: ["jina-rerank"] };
const malformed = { name: "no id" };

const catalog = {
	data: [chatText, chatVision, textOnlyOrcaAlias, embedding, imageGeneration, video, rerank, malformed],
};

describe("OrcaRouter catalog parsing", () => {
	it("preserves the vendor/model namespace exactly and keeps declared metadata", () => {
		const models = parseOrcaRouterCatalog(catalog);
		expect(models.map((model) => model.id)).toEqual([
			"deepseek/deepseek-v4-pro",
			"deepseek/deepseek-v4.1-flash",
			"orcarouter/auto",
			"vendor/text-embedding-4",
			"vendor/image-5",
			"vendor/video-2",
			"vendor/rerank-3",
		]);
		expect(models[0]?.contextLength).toBe(1_048_576);
		expect(models[1]?.inputModalities).toEqual(["text", "image"]);
		expect(models[2]?.inputModalities).toEqual([]);
	});

	it("drops records that advertise no endpoint type rather than guessing from the id", () => {
		expect(parseOrcaRouterModel({ id: "bogus" })).toBeNull();
		expect(parseOrcaRouterModel({ id: "" })).toBeNull();
		expect(parseOrcaRouterModel("not-an-object")).toBeNull();
		expect(parseOrcaRouterCatalog({ data: "nope" })).toEqual([]);
	});

	it("bounds the number of accepted records", () => {
		const many = {
			data: Array.from({ length: 900 }, (_, index) => ({
				id: `vendor/model-${index}`,
				supported_endpoint_types: ["openai"],
			})),
		};
		expect(parseOrcaRouterCatalog(many).length).toBe(500);
	});
});

describe("OrcaRouter capability filters", () => {
	const models = parseOrcaRouterCatalog(catalog);

	it("offers only usable text models for chat", () => {
		const ids = filterOrcaRouterModels(models, { capability: "chat" }).map((model) => model.id);
		expect(ids).toEqual(["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-flash", "orcarouter/auto"]);
		expect(ids).not.toContain("vendor/image-5");
		expect(ids).not.toContain("vendor/text-embedding-4");
	});

	it("fails closed for a multimodal entry point: only models that declare the modality", () => {
		const ids = filterOrcaRouterModels(models, { capability: "chat", requiredInputModalities: ["image"] }).map(
			(model) => model.id,
		);
		expect(ids).toEqual(["deepseek/deepseek-v4.1-flash"]);
		expect(ids).not.toContain("deepseek/deepseek-v4-pro");
	});

	it("fails closed for a file entry point: an undeclared modality is never offered", () => {
		expect(filterOrcaRouterModels(models, { capability: "chat", requiredInputModalities: ["file"] })).toEqual([]);
	});

	it("routes each capability to its own endpoint type", () => {
		expect(filterOrcaRouterModels(models, { capability: "embedding" }).map((m) => m.id)).toEqual([
			"vendor/text-embedding-4",
		]);
		expect(filterOrcaRouterModels(models, { capability: "image" }).map((m) => m.id)).toEqual(["vendor/image-5"]);
		expect(filterOrcaRouterModels(models, { capability: "video" }).map((m) => m.id)).toEqual(["vendor/video-2"]);
		expect(filterOrcaRouterModels(models, { capability: "rerank" }).map((m) => m.id)).toEqual(["vendor/rerank-3"]);
	});
});

describe("OrcaRouter verified seed", () => {
	it("covers the documented chat models with their reasoning ladder intact", () => {
		const seed = seedCatalogFor({ capability: "chat" });
		expect(seed.map((model) => model.id)).toEqual([
			"openai/gpt-5.5",
			"anthropic/claude-opus-4.8",
			"google/gemini-3.5-flash",
			"deepseek/deepseek-v4-pro",
			"orcarouter/auto",
		]);
		const gpt = seed.find((model) => model.id === "openai/gpt-5.5");
		expect(gpt?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
		expect(gpt?.inputModalities).toEqual(["text", "image", "file"]);
		expect(seed.every((model) => model.verifiedFallback)).toBe(true);
	});

	it("keeps the seed multimodal filter meaningful", () => {
		const vision = seedCatalogFor({ capability: "chat", requiredInputModalities: ["image"] }).map((model) => model.id);
		expect(vision).toContain("openai/gpt-5.5");
		expect(vision).not.toContain("deepseek/deepseek-v4-pro");
		expect(seedCatalogFor({ capability: "embedding" })).toEqual([]);
	});

	it("does not mutate the shared seed when a filtered copy is produced", () => {
		const before = ORCAROUTER_SEED_MODELS.length;
		const [firstCopy] = seedCatalogFor({ capability: "chat" });
		if (firstCopy) firstCopy.id = "mutated";
		expect(ORCAROUTER_SEED_MODELS.length).toBe(before);
		expect(ORCAROUTER_SEED_MODELS[0]?.id).toBe("openai/gpt-5.5");
	});
});

describe("selected model reconciliation", () => {
	it("clears a selection that the fresh filter no longer offers", () => {
		const options = filterOrcaRouterModels(parseOrcaRouterCatalog(catalog), {
			capability: "chat",
			requiredInputModalities: ["image"],
		});
		expect(reconcileSelectedModel("deepseek/deepseek-v4-pro", options)).toEqual({ model: null, invalidated: true });
		expect(reconcileSelectedModel("deepseek/deepseek-v4.1-flash", options)).toEqual({
			model: "deepseek/deepseek-v4.1-flash",
			invalidated: false,
		});
		expect(reconcileSelectedModel(null, options)).toEqual({ model: null, invalidated: false });
	});
});
