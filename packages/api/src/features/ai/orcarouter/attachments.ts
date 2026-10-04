import type { OrcaRouterModality } from "@reactive-resume/ai/orcarouter/catalog";
import { fetchOrcaRouterModels, ORCAROUTER_ENTRY_POINT_FILTERS } from "./discovery";
import { resolveOrcaRouterOrigins } from "./origins";

/**
 * Second line of defence for OrcaRouter's own entry points.
 *
 * The provider row stores one model id and one chat, and the assistant can attach images, audio and
 * files to that same chat. A model is only offered in the settings selector for the capabilities it
 * declares, but the stored id can outlive the catalog that produced it — or be written by an older
 * client. Before an attachment that needs a non-text input reaches the model, the id is re-checked
 * against what the catalog says today; a model that does not declare the modality is refused instead
 * of being sent a part it never advertised.
 */

/** Attachment media types that need a matching declared input modality from the catalog. */
const MODALITY_FOR_MEDIA_TYPE: Array<{ test: (mediaType: string) => boolean; modality: OrcaRouterModality }> = [
	{ test: (mediaType) => mediaType.startsWith("image/"), modality: "image" },
	{ test: (mediaType) => mediaType.startsWith("audio/"), modality: "audio" },
	{ test: (mediaType) => mediaType.startsWith("video/"), modality: "video" },
];

export function requiredInputModalitiesForMediaTypes(mediaTypes: readonly string[]): OrcaRouterModality[] {
	const required = new Set<OrcaRouterModality>();
	for (const mediaType of mediaTypes) {
		const match = MODALITY_FOR_MEDIA_TYPE.find((entry) => entry.test(mediaType));
		if (match) required.add(match.modality);
	}
	return [...required];
}

export type OrcaRouterAttachmentGuardInput = {
	apiKey: string;
	model: string;
	/** Media types of the attachments about to be sent with this message. */
	mediaTypes: readonly string[];
	fetchImpl?: typeof fetch;
};

export class OrcaRouterModelCapabilityError extends Error {
	constructor(
		readonly modality: OrcaRouterModality,
		readonly model: string,
	) {
		super(`OrcaRouter model "${model}" does not accept ${modality} input. Pick a model that does.`);
		this.name = "OrcaRouterModelCapabilityError";
	}
}

export class OrcaRouterModelUnknownError extends Error {
	constructor(
		readonly model: string,
		readonly reason: string,
	) {
		super(`OrcaRouter could not confirm that "${model}" accepts this attachment (${reason}). Choose another model.`);
		this.name = "OrcaRouterModelUnknownError";
	}
}

/**
 * Resolves to the catalog record when it proves the stored model accepts every modality the message
 * needs. Throws otherwise: an undeclared modality, an id the catalog no longer lists, and a catalog
 * that cannot be read all end the request rather than sending a part the model never advertised.
 */
export async function assertOrcaRouterModelAcceptsAttachments(input: OrcaRouterAttachmentGuardInput) {
	const required = requiredInputModalitiesForMediaTypes(input.mediaTypes);
	if (required.length === 0) return null;

	const origins = resolveOrcaRouterOrigins();
	// The plain chat filter lists every chat model whatever it declares, so a model that exists but
	// lacks the modality can be told apart from an id the catalog no longer serves.
	const result = await fetchOrcaRouterModels({
		origins,
		apiKey: input.apiKey,
		filter: ORCAROUTER_ENTRY_POINT_FILTERS.chat,
		...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
	});

	const known = result.models.find((entry) => entry.id === input.model);
	if (known) {
		if (!required.every((modality) => known.inputModalities.includes(modality))) {
			const missing = required.find((modality) => !known.inputModalities.includes(modality)) ?? required[0] ?? "text";
			throw new OrcaRouterModelCapabilityError(missing, input.model);
		}
		return known;
	}

	throw new OrcaRouterModelUnknownError(
		input.model,
		result.source === "live" ? "not in the catalog" : "catalog unreachable",
	);
}
