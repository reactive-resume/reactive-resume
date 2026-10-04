/**
 * OrcaRouter model catalog.
 *
 * `GET {api}/v1/models` is the only authoritative source. The verified seed below exists so a fresh
 * installation is usable while the catalog is slow or unreachable — it is never merged into a
 * successful live response.
 *
 * Every record is parsed defensively: a catalog response must not be able to advertise a route this
 * client cannot speak, or to consume unbounded memory.
 */

export const ORCAROUTER_CATALOG_LIMITS = {
	maxModels: 500,
	maxResponseBytes: 2 * 1024 * 1024,
	timeoutMs: 10_000,
} as const;

export const ORCAROUTER_CAPABILITIES = ["chat", "embedding", "image", "video", "rerank"] as const;
export type OrcaRouterCapability = (typeof ORCAROUTER_CAPABILITIES)[number];

/** Chat models must speak at least one of these endpoint types to be usable by this app's OpenAI-compatible client. */
export const ORCAROUTER_CHAT_ENDPOINT_TYPES = ["openai", "anthropic", "gemini", "openai-response"] as const;

/** Endpoint types that prove a model is not a general text model, whatever else it advertises. */
const NON_TEXT_ENDPOINT_TYPES = new Set(["image-generation", "openai-video", "jina-rerank", "embeddings"]);

export type OrcaRouterModality = "text" | "image" | "audio" | "video" | "file";

export type OrcaRouterModel = {
	id: string;
	name: string;
	contextLength: number | null;
	supportedEndpointTypes: string[];
	inputModalities: OrcaRouterModality[];
	outputModalities: OrcaRouterModality[];
	reasoningEfforts: string[];
	/** True for the seeded/verified fallback catalog, which was not fetched from a live endpoint. */
	verifiedFallback: boolean;
};

export type OrcaRouterCatalogSource = "live" | "seed";

export type OrcaRouterCatalog = {
	source: OrcaRouterCatalogSource;
	models: OrcaRouterModel[];
	fetchedAt: string | null;
};

const REASONING_EFFORTS_BY_MODEL: Record<string, string[]> = {
	"openai/gpt-5.5": ["low", "medium", "high", "xhigh"],
};

/**
 * Small, verified cold-start catalog. Sources are the OrcaRouter model list documented at
 * https://api.orcarouter.ai/v1/models (vendor/model namespace preserved) and the OrcaRouter models
 * page. `orcarouter/auto` is the router's own auto-selecting alias.
 */
export const ORCAROUTER_SEED_MODELS: OrcaRouterModel[] = [
	{
		id: "openai/gpt-5.5",
		name: "GPT-5.5",
		contextLength: 400_000,
		supportedEndpointTypes: ["openai", "openai-response", "anthropic"],
		inputModalities: ["text", "image", "file"],
		outputModalities: ["text"],
		reasoningEfforts: REASONING_EFFORTS_BY_MODEL["openai/gpt-5.5"] ?? [],
		verifiedFallback: true,
	},
	{
		id: "anthropic/claude-opus-4.8",
		name: "Claude Opus 4.8",
		contextLength: 200_000,
		supportedEndpointTypes: ["anthropic", "openai"],
		inputModalities: ["text", "image", "file"],
		outputModalities: ["text"],
		reasoningEfforts: [],
		verifiedFallback: true,
	},
	{
		id: "google/gemini-3.5-flash",
		name: "Gemini 3.5 Flash",
		contextLength: 1_000_000,
		supportedEndpointTypes: ["gemini", "openai"],
		inputModalities: ["text", "image", "audio", "video", "file"],
		outputModalities: ["text"],
		reasoningEfforts: [],
		verifiedFallback: true,
	},
	{
		id: "deepseek/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		contextLength: 1_048_576,
		supportedEndpointTypes: ["openai", "openai-response"],
		inputModalities: ["text"],
		outputModalities: ["text"],
		reasoningEfforts: [],
		verifiedFallback: true,
	},
	{
		id: "orcarouter/auto",
		name: "OrcaRouter Auto",
		contextLength: null,
		supportedEndpointTypes: ["openai", "openai-response", "anthropic", "gemini"],
		inputModalities: ["text"],
		outputModalities: ["text"],
		reasoningEfforts: [],
		verifiedFallback: true,
	},
];

export type OrcaRouterModelFilter = {
	capability: OrcaRouterCapability;
	/** Non-text input modalities this entry point actually uploads; each must be declared by the model. */
	requiredInputModalities?: OrcaRouterModality[];
};

function toModality(value: unknown): OrcaRouterModality | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return (["text", "image", "audio", "video", "file"] as const).includes(normalized as OrcaRouterModality)
		? (normalized as OrcaRouterModality)
		: null;
}

function toModalityList(value: unknown): OrcaRouterModality[] {
	if (!Array.isArray(value)) return [];
	const modalities = value.flatMap((entry) => {
		const modality = toModality(entry);
		return modality ? [modality] : [];
	});
	return [...new Set(modalities)];
}

function toStringList(value: unknown, max: number): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, max);
}

/**
 * Parses one raw catalog record. Returns null for anything that is not a usable model: a missing or
 * oversized id, or a record that does not declare at least one supported endpoint type.
 */
export function parseOrcaRouterModel(raw: unknown): OrcaRouterModel | null {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id || id.length > 200) return null;

	const supportedEndpointTypes = toStringList(record.supported_endpoint_types, 16);
	if (supportedEndpointTypes.length === 0) return null;

	const architecture = (
		typeof record.architecture === "object" && record.architecture !== null ? record.architecture : {}
	) as Record<string, unknown>;
	const contextLength =
		typeof record.context_length === "number" && Number.isFinite(record.context_length) ? record.context_length : null;
	const reasoning = (
		typeof record.reasoning === "object" && record.reasoning !== null ? record.reasoning : null
	) as Record<string, unknown> | null;

	return {
		id,
		name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
		contextLength,
		supportedEndpointTypes,
		inputModalities: toModalityList(architecture.input_modalities),
		outputModalities: toModalityList(architecture.output_modalities),
		reasoningEfforts: reasoning
			? toStringList(reasoning.efforts ?? reasoning.supported_efforts, 8)
			: (REASONING_EFFORTS_BY_MODEL[id] ?? []),
		verifiedFallback: false,
	};
}

/** Parses an OpenAI-style `{ data: [...] }` body (a bare array is accepted too), bounded and item-vetted. */
export function parseOrcaRouterCatalog(payload: unknown): OrcaRouterModel[] {
	const rows = Array.isArray(payload)
		? payload
		: typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data ?? [])
			: [];

	const models: OrcaRouterModel[] = [];
	const seen = new Set<string>();
	for (const row of rows.slice(0, ORCAROUTER_CATALOG_LIMITS.maxModels)) {
		const model = parseOrcaRouterModel(row);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models;
}

function isChatModel(model: OrcaRouterModel) {
	if (
		!model.supportedEndpointTypes.some((type) => (ORCAROUTER_CHAT_ENDPOINT_TYPES as readonly string[]).includes(type))
	) {
		return false;
	}
	// A record that only advertises image/video/rerank/embedding endpoints is not a text model, even if
	// one of the generic endpoint types is also present.
	const textEndpoints = model.supportedEndpointTypes.filter((type) => !NON_TEXT_ENDPOINT_TYPES.has(type));
	if (textEndpoints.length === 0) return false;
	return model.inputModalities.length === 0 || model.inputModalities.includes("text");
}

function acceptsAllRequiredInputs(model: OrcaRouterModel, required: OrcaRouterModality[]) {
	if (required.length === 0) return true;
	// Fail closed: a model that does not declare the modality is not offered for that entry point.
	return required.every((modality) => model.inputModalities.includes(modality));
}

/**
 * Applies one entry point's capability filter. Each AI entry point passes its own filter so a text
 * chat selector never offers an image-generation model and a multimodal selector never offers a
 * text-only one.
 */
export function filterOrcaRouterModels(
	models: readonly OrcaRouterModel[],
	filter: OrcaRouterModelFilter,
): OrcaRouterModel[] {
	switch (filter.capability) {
		case "chat":
			return models.filter(
				(model) => isChatModel(model) && acceptsAllRequiredInputs(model, filter.requiredInputModalities ?? []),
			);
		case "embedding":
			return models.filter((model) => model.supportedEndpointTypes.includes("embeddings"));
		case "image":
			return models.filter((model) => model.supportedEndpointTypes.includes("image-generation"));
		case "video":
			return models.filter((model) => model.supportedEndpointTypes.includes("openai-video"));
		case "rerank":
			return models.filter((model) => model.supportedEndpointTypes.includes("jina-rerank"));
		default:
			return [];
	}
}

/** The seed catalog, already filtered for one entry point. Used only when live discovery fails. */
export function seedCatalogFor(filter: OrcaRouterModelFilter): OrcaRouterModel[] {
	return filterOrcaRouterModels(ORCAROUTER_SEED_MODELS, filter).map((model) => ({ ...model, verifiedFallback: true }));
}

export function liveCatalog(models: readonly OrcaRouterModel[]): OrcaRouterCatalog {
	return { source: "live", models: [...models], fetchedAt: new Date().toISOString() };
}

export function fallbackCatalog(models: readonly OrcaRouterModel[]): OrcaRouterCatalog {
	return { source: "seed", models: [...models], fetchedAt: null };
}

/**
 * Keeps a previously discovered model selected only while it is still offered by the fresh filter;
 * otherwise the caller must clear it and ask the user to choose again.
 */
export function reconcileSelectedModel(selected: string | null | undefined, options: readonly OrcaRouterModel[]) {
	const trimmed = selected?.trim() ?? "";
	if (!trimmed) return { model: null, invalidated: false };
	const match = options.find((model) => model.id === trimmed);
	return match ? { model: match.id, invalidated: false } : { model: null, invalidated: true };
}
