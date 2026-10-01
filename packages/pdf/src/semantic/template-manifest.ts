import type { PrimitiveBinding, SemanticBindingRegistry } from "./binding-inventory";
import type { SemanticNodeKind } from "@reactive-resume/resume/stylesheet/types";
import type { CustomSectionType } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { azurillSemanticManifest } from "../templates/azurill/semantic";
import { bronzorSemanticManifest } from "../templates/bronzor/semantic";
import { chikoritaSemanticManifest } from "../templates/chikorita/semantic";
import { ditgarSemanticManifest } from "../templates/ditgar/semantic";
import { dittoSemanticManifest } from "../templates/ditto/semantic";
import { gengarSemanticManifest } from "../templates/gengar/semantic";
import { glalieSemanticManifest } from "../templates/glalie/semantic";
import { kakunaSemanticManifest } from "../templates/kakuna/semantic";
import { laprasSemanticManifest } from "../templates/lapras/semantic";
import { leafishSemanticManifest } from "../templates/leafish/semantic";
import { meowthSemanticManifest } from "../templates/meowth/semantic";
import { onyxSemanticManifest } from "../templates/onyx/semantic";
import { pikachuSemanticManifest } from "../templates/pikachu/semantic";
import { porygonSemanticManifest } from "../templates/porygon/semantic";
import { rhyhornSemanticManifest } from "../templates/rhyhorn/semantic";
import { scizorSemanticManifest } from "../templates/scizor/semantic";
import { smeargleSemanticManifest } from "../templates/smeargle/semantic";
import { SHARED_BINDING_REGISTRY } from "./binding-inventory";

export type TemplateSemanticPlacement = "main" | "sidebar";
type TemplateSemanticRegionName = "header" | "main" | "sidebar" | "featured";

export type TemplateSemanticRegion = {
	name: TemplateSemanticRegionName;
	placement: TemplateSemanticPlacement;
	origins: readonly TemplateSemanticPlacement[];
	flow?: "sequential" | "interleaved";
};

type TemplateSemanticSpecialSummary = {
	region: "header" | "featured";
	placement: TemplateSemanticPlacement;
	source: "always" | "main-with-header";
};

type TemplateSemanticPartOwner =
	| { kind: "header"; key: "header" }
	| { kind: "region"; key: TemplateSemanticRegionName }
	| {
			kind: "section";
			key: "section";
			origin?: TemplateSemanticPlacement;
			placement?: TemplateSemanticPlacement;
	  }
	| {
			kind: "section-items";
			key: "section-items";
			placement?: TemplateSemanticPlacement;
			columns?: 1;
	  }
	| {
			kind: "item";
			key: "item";
			placement?: TemplateSemanticPlacement;
			columns?: 1;
	  }
	| {
			kind: "item-header";
			key: "item-header";
			sectionTypes?: readonly CustomSectionType[];
	  }
	| { kind: "contact-list"; key: "contact-list" }
	| { kind: "contact-item"; key: "contact-item"; position?: "last" };

type TemplateSemanticPartBinding =
	| {
			type: "primitive";
			primitive:
				| PrimitiveBinding["primitive"]
				| {
						ownerRole: string;
						present: PrimitiveBinding["primitive"];
						absent: PrimitiveBinding["primitive"];
				  };
			source: "existing";
	  }
	| {
			type: "alias";
			canonicalKind: Exclude<SemanticNodeKind, "template-part">;
			token: string;
	  };

export type TemplateSemanticChildSelector = {
	kind: Exclude<SemanticNodeKind, "resume" | "page">;
	name?: string;
	sectionTypes?: readonly CustomSectionType[];
};

type TemplateSemanticPartRoute = {
	parent: "owner" | string;
	at: "start" | "end" | { before: TemplateSemanticChildSelector } | { after: TemplateSemanticChildSelector };
	take?: "all" | readonly TemplateSemanticChildSelector[];
	takeFrom?: "item-header";
};

export type TemplateSemanticPrimitivePart = {
	name: string;
	key: string;
	owner: TemplateSemanticPartOwner;
	binding: Extract<TemplateSemanticPartBinding, { type: "primitive" }>;
	route: TemplateSemanticPartRoute;
};

type TemplateSemanticAliasPart = {
	name: string;
	key: string;
	owner: TemplateSemanticPartOwner;
	binding: Extract<TemplateSemanticPartBinding, { type: "alias" }>;
	route?: never;
};

export type TemplateSemanticPart = TemplateSemanticPrimitivePart | TemplateSemanticAliasPart;

type TemplateSemanticCanonicalBinding = {
	kind: Exclude<SemanticNodeKind, "template-part">;
	binding: PrimitiveBinding;
};

export type TemplateSemanticManifest = {
	template: Template;
	skillLevelAfterName?: boolean;
	regions: readonly TemplateSemanticRegion[];
	header: {
		region: "header";
		placement: TemplateSemanticPlacement;
	};
	specialSummary: TemplateSemanticSpecialSummary | null;
	parts: readonly TemplateSemanticPart[];
	canonicalBindings?: readonly TemplateSemanticCanonicalBinding[];
};

const TEMPLATE_SEMANTIC_MANIFESTS = {
	azurill: azurillSemanticManifest,
	bronzor: bronzorSemanticManifest,
	chikorita: chikoritaSemanticManifest,
	ditgar: ditgarSemanticManifest,
	ditto: dittoSemanticManifest,
	gengar: gengarSemanticManifest,
	glalie: glalieSemanticManifest,
	kakuna: kakunaSemanticManifest,
	lapras: laprasSemanticManifest,
	leafish: leafishSemanticManifest,
	meowth: meowthSemanticManifest,
	onyx: onyxSemanticManifest,
	pikachu: pikachuSemanticManifest,
	porygon: porygonSemanticManifest,
	rhyhorn: rhyhornSemanticManifest,
	scizor: scizorSemanticManifest,
	smeargle: smeargleSemanticManifest,
} as const satisfies Readonly<Record<Template, TemplateSemanticManifest>>;

export function getTemplateSemanticManifest(template: Template): TemplateSemanticManifest {
	return TEMPLATE_SEMANTIC_MANIFESTS[template];
}

export function getTemplateSemanticBindingRegistry(template: Template): SemanticBindingRegistry {
	const manifest = getTemplateSemanticManifest(template);
	const canonicalBindings = Object.fromEntries(
		(manifest.canonicalBindings ?? []).map(({ kind, binding }) => [kind, binding]),
	) as SemanticBindingRegistry;

	return {
		...SHARED_BINDING_REGISTRY,
		...canonicalBindings,
		link: (node, context) => {
			if (context.parent?.kind === "template-part") {
				const part = manifest.parts.find((candidate) => candidate.name === context.parent?.attributes.name);
				if (
					part?.binding.type === "primitive" &&
					(part.binding.primitive === "Link" ||
						(typeof part.binding.primitive === "object" && part.binding.primitive.present === "Link"))
				) {
					return {
						type: "alias",
						canonicalKind: "template-part",
						canonicalNodeKey: context.parent.key,
						token: "structured-link",
					};
				}
			}

			const shared = SHARED_BINDING_REGISTRY.link;
			return typeof shared === "function" ? shared(node, context) : shared;
		},
		"template-part": (node, { parent }) => {
			const part = manifest.parts.find((candidate) => candidate.name === node.attributes.name);
			if (part?.binding.type !== "primitive") return undefined;
			if (typeof part.binding.primitive === "string") return part.binding as PrimitiveBinding;

			return {
				type: "primitive",
				primitive: parent?.roles.includes(part.binding.primitive.ownerRole)
					? part.binding.primitive.present
					: part.binding.primitive.absent,
				source: "existing",
			};
		},
	};
}
