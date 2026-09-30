import type {
	TemplateSemanticManifest,
	TemplateSemanticPart,
	TemplateSemanticPrimitivePart,
} from "./template-manifest";
import type { Template } from "@reactive-resume/schema/templates";

const standardRegions = [
	{ name: "header", placement: "main", origins: [] },
	{ name: "main", placement: "main", origins: ["main"] },
	{ name: "sidebar", placement: "sidebar", origins: ["sidebar"] },
] as const;

export const baseManifest = <const T extends Template, const P extends readonly TemplateSemanticPart[]>(
	template: T,
	parts: P,
	canonicalBindings?: TemplateSemanticManifest["canonicalBindings"],
) =>
	({
		template,
		regions: standardRegions,
		header: { region: "header", placement: "main" },
		specialSummary: null,
		parts,
		...(canonicalBindings ? { canonicalBindings } : {}),
	}) as const satisfies TemplateSemanticManifest;

/**
 * Sections whose item header is a single title/date row rendered by the shared split-row layout.
 *
 * Experience, education and volunteer are deliberately excluded: they render two stacked rows, and
 * on templates with the `inlineItemHeader` feature their header is owned by the
 * `inline-item-header-*` parts instead, which would compete for the same fields.
 */
const ITEM_HEADER_ROW_SECTION_TYPES = ["awards", "certifications", "projects", "publications"] as const;

/**
 * Exposes the split row inside a section item header so a stylesheet can address it.
 *
 * The row carries `flex-wrap: wrap`, so a long title pushes the trailing date onto its own line.
 * Without this part the row is anonymous — `item-header` selects the box around it, not the row —
 * leaving no way to write `flex-wrap: nowrap`. Shared by every template because the row comes from
 * the shared section components rather than from any one template.
 */
/** Part key chain passed to `SemanticTemplatePartView`; must match `itemHeaderRowPart.key`. */
export const ITEM_HEADER_ROW_PART_KEYS = ["item-header-row"] as const;

export const itemHeaderRowPart = {
	name: "item-header-row",
	key: "item-header-row",
	owner: { kind: "item-header", key: "item-header", sectionTypes: ITEM_HEADER_ROW_SECTION_TYPES },
	binding: { type: "primitive", primitive: "View", source: "existing" },
	route: {
		parent: "owner",
		at: "start",
		take: [
			{ kind: "field", name: "title", sectionTypes: ["awards", "certifications", "publications"] },
			{ kind: "field", name: "date", sectionTypes: ["awards", "certifications", "publications"] },
			{ kind: "field", name: "name", sectionTypes: ["projects"] },
			{ kind: "field", name: "period", sectionTypes: ["projects"] },
			{ kind: "link", sectionTypes: ITEM_HEADER_ROW_SECTION_TYPES },
		],
	},
} as const satisfies TemplateSemanticPrimitivePart;
