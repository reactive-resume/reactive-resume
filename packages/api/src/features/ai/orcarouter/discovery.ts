import type {
	OrcaRouterCapability,
	OrcaRouterModel,
	OrcaRouterModelFilter,
	OrcaRouterModality,
} from "@reactive-resume/ai/orcarouter/catalog";
import type { OrcaRouterOrigins } from "@reactive-resume/ai/orcarouter/origins";
import {
	fallbackCatalog,
	filterOrcaRouterModels,
	liveCatalog,
	ORCAROUTER_CATALOG_LIMITS,
	parseOrcaRouterCatalog,
	seedCatalogFor,
} from "@reactive-resume/ai/orcarouter/catalog";
import { buildOrcaRouterModelsUrl } from "@reactive-resume/ai/orcarouter/origins";

export type OrcaRouterCatalogResult = {
	source: "live" | "seed";
	models: OrcaRouterModel[];
	fetchedAt: string | null;
	/** Present only when live discovery failed and the seed was used, so the UI can say why. */
	degradedReason: string | null;
};

/** What each AI entry point needs from a model. Kept in one place so no page re-implements the rules. */
export const ORCAROUTER_ENTRY_POINT_FILTERS = {
	/** Assistant chat/stream, ATS review, line improvements, structured JSON, cover letters. */
	chat: { capability: "chat" },
	/** PDF parsing uploads the PDF itself as a chat file part. */
	pdf: { capability: "chat", requiredInputModalities: ["file"] },
	/** DOCX parsing: legacy .doc is uploaded as media, .docx is converted to text. */
	docx: { capability: "chat", requiredInputModalities: ["file"] },
	/** Images attached to an assistant thread. */
	assistant_image: { capability: "chat", requiredInputModalities: ["image"] },
} satisfies Record<string, OrcaRouterModelFilter>;

export type OrcaRouterEntryPoint = keyof typeof ORCAROUTER_ENTRY_POINT_FILTERS;

export const ORCAROUTER_ENTRY_POINTS = Object.keys(ORCAROUTER_ENTRY_POINT_FILTERS) as OrcaRouterEntryPoint[];

export function isOrcaRouterEntryPoint(value: string): value is OrcaRouterEntryPoint {
	return Object.hasOwn(ORCAROUTER_ENTRY_POINT_FILTERS, value);
}

/** Default entry point for the settings model selector: plain text chat. */
export const ORCAROUTER_DEFAULT_ENTRY_POINT: OrcaRouterEntryPoint = "chat";

export function requiredModalitiesFor(capability: OrcaRouterCapability, modalities?: OrcaRouterModality[]) {
	return { capability, requiredInputModalities: modalities ?? [] } satisfies OrcaRouterModelFilter;
}

type FetchCatalogInput = {
	origins: OrcaRouterOrigins;
	apiKey: string;
	filter: OrcaRouterModelFilter;
	fetchImpl?: typeof fetch;
};

/**
 * Live discovery is authoritative when it succeeds. `GET {api}/v1/models` is bounded in time, bytes and
 * item count, and every record is vetted before it can reach a selector.
 */
export async function fetchOrcaRouterModels(input: FetchCatalogInput): Promise<OrcaRouterCatalogResult> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const url = buildOrcaRouterModelsUrl(input.origins, input.filter.capability);

	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
			signal: AbortSignal.timeout(ORCAROUTER_CATALOG_LIMITS.timeoutMs),
		});
	} catch {
		return degraded(input.filter, "OrcaRouter's model list could not be reached, so a small verified list is shown.");
	}

	if (response.status === 401 || response.status === 403) {
		// The caller turns this into a `needsReauth` transition for the exact credential that was used.
		throw new OrcaRouterCatalogAuthError("OrcaRouter rejected this API key.");
	}
	if (!response.ok) {
		return degraded(
			input.filter,
			`OrcaRouter's model list answered ${response.status}, so a small verified list is shown.`,
		);
	}

	let payload: unknown;
	try {
		const text = await response.text();
		if (text.length > ORCAROUTER_CATALOG_LIMITS.maxResponseBytes) {
			return degraded(
				input.filter,
				"OrcaRouter's model list was too large to read, so a small verified list is shown.",
			);
		}
		payload = JSON.parse(text);
	} catch {
		return degraded(input.filter, "OrcaRouter's model list was unreadable, so a small verified list is shown.");
	}

	const parsed = parseOrcaRouterCatalog(payload);
	if (parsed.length === 0) {
		// A successful but empty response is not a catalog outage; returning the seed would invent models
		// the workspace cannot actually call.
		return { ...liveCatalog([]), degradedReason: null };
	}

	const catalog = liveCatalog(parsed);
	const filtered = filterOrcaRouterModels(catalog.models, input.filter);
	return { source: "live", models: filtered, fetchedAt: catalog.fetchedAt, degradedReason: null };
}

/** The verified cold-start catalog for one entry point, used only after a failed live discovery. */
export function degradedOrcaRouterCatalog(filter: OrcaRouterModelFilter, reason: string): OrcaRouterCatalogResult {
	return { ...fallbackCatalog(seedCatalogFor(filter)), degradedReason: reason };
}

function degraded(filter: OrcaRouterModelFilter, reason: string) {
	return degradedOrcaRouterCatalog(filter, reason);
}

export class OrcaRouterCatalogAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OrcaRouterCatalogAuthError";
	}
}
