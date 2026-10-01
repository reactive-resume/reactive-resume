import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { itemHeaderRowPart } from "../../semantic/shared-parts";

export const smeargleSemanticManifest = {
	template: "smeargle",
	regions: [
		{ name: "header", placement: "main", origins: [] },
		{ name: "featured", placement: "main", origins: [] },
		{ name: "main", placement: "main", origins: ["main", "sidebar"] },
	],
	header: { region: "header", placement: "main" },
	specialSummary: { region: "featured", placement: "main", source: "main-with-header" },
	parts: [
		itemHeaderRowPart,
		{
			name: "featured-summary",
			key: "featured-summary",
			owner: { kind: "region", key: "featured" },
			binding: { type: "primitive", primitive: "View", source: "existing" },
			route: { parent: "owner", at: "start", take: "all" },
		},
	],
} as const satisfies TemplateSemanticManifest;
