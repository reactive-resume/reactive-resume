import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { itemHeaderRowPart } from "../../semantic/shared-parts";

export const persianSemanticManifest = {
	template: "persian",
	regions: [
		{ name: "header", placement: "main", origins: [] },
		{ name: "main", placement: "main", origins: ["main", "sidebar"] },
	],
	header: { region: "header", placement: "main" },
	specialSummary: null,
	parts: [itemHeaderRowPart],
} as const satisfies TemplateSemanticManifest;
