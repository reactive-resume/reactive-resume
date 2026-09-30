import type { StandardFieldRole } from "./binding-inventory";
import type {
	TemplateSemanticChildSelector,
	TemplateSemanticManifest,
	TemplateSemanticPart,
	TemplateSemanticPlacement,
	TemplateSemanticPrimitivePart,
	TemplateSemanticRegion,
} from "./template-manifest";
import type { SemanticNode, SemanticNodeKind } from "@reactive-resume/resume/stylesheet/types";
import type { CustomSectionType, LayoutPage, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { HTMLElement, Node } from "node-html-parser";
import { NodeType } from "node-html-parser";
import { isRTL } from "@reactive-resume/utils/locale";
import { getResumeSectionIcon } from "../section-icon";
import { shouldUseSectionTimeline } from "../templates/shared/columns";
import { getCustomFieldLinkUrl } from "../templates/shared/contact";
import { filterItems, filterSections } from "../templates/shared/filtering";
import { hasTemplatePicture } from "../templates/shared/picture";
import { parseNormalizedRichTextHtml, richTextMarkClassName } from "../templates/shared/rich-text-html";
import { STANDARD_FIELD_REGISTRY } from "./binding-inventory";
import { semanticNodeKeys } from "./node-keys";
import { getRichTextSemanticKind } from "./rich-text-keys";
import { getTemplateSemanticManifest } from "./template-manifest";

export type BuildSemanticTreeInput = {
	data: ResumeData;
	template: Template;
	page: LayoutPage;
	pageNumber: number;
	showHeader: boolean;
};

type ItemRecord = {
	id: string;
	hidden: boolean;
	[key: string]: unknown;
};

type SectionRecord = {
	title: string;
	icon: string;
	hidden: boolean;
	columns?: number;
	items: ItemRecord[];
};

type SectionDescriptor = {
	id: string;
	type: CustomSectionType;
	section: SectionRecord;
};

const ITEM_HEADER_FIELDS = {
	profiles: ["network"],
	experience: ["company", "position", "location", "period"],
	"experience-role": ["position", "period"],
	education: ["school", "area", "degree", "grade", "location", "period"],
	projects: ["name", "period"],
	skills: ["name"],
	languages: [],
	interests: ["name"],
	awards: ["title", "date", "awarder"],
	certifications: ["title", "date", "issuer"],
	publications: ["title", "date", "publisher"],
	volunteer: ["organization", "location", "period"],
	references: [],
	summary: [],
	"cover-letter": [],
} as const satisfies Readonly<Record<CustomSectionType | "experience-role", readonly string[]>>;

const RICH_TEXT_FIELDS = new Set(["content", "description", "recipient"]);
const ITEM_ICON_SECTIONS = new Set<CustomSectionType>(["profiles", "skills", "interests"]);
type RichTextDirection = "ltr" | "rtl";

const semanticNode = ({
	key,
	kind,
	id,
	attributes = {},
	roles = [],
	children = [],
}: {
	key: string;
	kind: SemanticNodeKind;
	id?: string;
	attributes?: Readonly<Record<string, string>>;
	roles?: readonly string[];
	children?: readonly SemanticNode[];
}): SemanticNode => ({
	key,
	kind,
	...(id === undefined ? {} : { id }),
	attributes,
	roles,
	children,
});

const isElement = (node: Node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE;

const buildRichTextChildren = (
	parentKey: string,
	childNodes: readonly Node[],
	direction: RichTextDirection,
): SemanticNode[] => {
	const children: SemanticNode[] = [];
	let elementIndex = 0;

	for (const child of childNodes) {
		if (!isElement(child)) continue;

		const index = elementIndex++;
		const kind = getRichTextSemanticKind(child, richTextMarkClassName);

		if (!kind) {
			const ancestryKey = semanticNodeKeys.richTextNode(parentKey, `html-${child.rawTagName.toLowerCase()}`, index);
			children.push(...buildRichTextChildren(ancestryKey, child.childNodes, direction));
			continue;
		}

		const key = semanticNodeKeys.richTextNode(parentKey, kind, index);

		if (kind === "list-item") {
			const markerKey = semanticNodeKeys.richTextNode(key, "list-marker", 0);
			const contentKey = semanticNodeKeys.richTextNode(key, "list-item-content", 0);
			const marker = semanticNode({ key: markerKey, kind: "list-marker", roles: ["decoration"] });
			const content = semanticNode({
				key: contentKey,
				kind: "list-item-content",
				attributes: { direction },
				children: buildRichTextChildren(contentKey, child.childNodes, direction),
			});
			children.push(
				semanticNode({
					key,
					kind,
					children: direction === "rtl" ? [content, marker] : [marker, content],
				}),
			);
			continue;
		}

		const attributes: Readonly<Record<string, string>> =
			kind === "rich-heading" ? { level: child.rawTagName.slice(1) } : {};
		children.push(
			semanticNode({
				key,
				kind,
				attributes,
				roles: kind === "link" ? ["structured-link"] : [],
				children: buildRichTextChildren(key, child.childNodes, direction),
			}),
		);
	}

	return children;
};

const hasValue = (value: unknown): boolean => {
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== null;
};

const getFieldRoles = (
	type: keyof typeof STANDARD_FIELD_REGISTRY,
	name: string,
	structuredLink = false,
): StandardFieldRole[] => {
	const field = STANDARD_FIELD_REGISTRY[type] as StandardFieldDefinition | undefined;
	const roles = [...(field?.[name] ?? [])];

	if (structuredLink && !roles.includes("structured-link")) roles.push("structured-link");

	return roles;
};

type StandardFieldDefinition = Readonly<Record<string, readonly StandardFieldRole[]>>;

const buildField = ({
	parentKey,
	type,
	name,
	value,
	direction,
	structuredLink,
}: {
	parentKey: string;
	type: keyof typeof STANDARD_FIELD_REGISTRY;
	name: string;
	value: unknown;
	direction: RichTextDirection;
	structuredLink?: boolean;
}): SemanticNode | undefined => {
	if (!hasValue(value)) return undefined;

	const key = semanticNodeKeys.field(parentKey, name);
	const richTextChildren =
		RICH_TEXT_FIELDS.has(name) && typeof value === "string"
			? buildRichTextChildren(
					semanticNodeKeys.richText(key, name),
					parseNormalizedRichTextHtml(value, { direction }).childNodes,
					direction,
				)
			: [];
	// Imported HTML may contain only text inside wrappers without semantic kinds (for example table cells).
	// Keep its rich-text host visible even when it has no individually addressable descendants.
	const children =
		RICH_TEXT_FIELDS.has(name) && typeof value === "string"
			? [
					semanticNode({
						key: semanticNodeKeys.richText(key, name),
						kind: "rich-text",
						children: richTextChildren,
					}),
				]
			: [];

	return semanticNode({
		key,
		kind: "field",
		attributes: { name },
		roles: getFieldRoles(type, name, structuredLink),
		children,
	});
};

const buildLevel = (itemKey: string, level: unknown, data: ResumeData): SemanticNode | undefined => {
	if (typeof level !== "number" || level <= 0) return undefined;
	if (data.metadata.design.level.type === "hidden") return undefined;
	if (data.metadata.design.level.type === "icon" && data.metadata.design.level.icon === "") return undefined;

	const key = semanticNodeKeys.level(itemKey);
	const children = Array.from({ length: 5 }, (_, index) => {
		const active = index < level;

		return semanticNode({
			key: semanticNodeKeys.icon(key, `level-${index + 1}`),
			kind: "icon",
			attributes: { type: data.metadata.design.level.type },
			roles: ["decoration", active ? "active" : "inactive"],
		});
	});

	return semanticNode({ key, kind: "level", roles: ["decoration"], children });
};

const itemWebsite = (item: ItemRecord): { url: string; inlineLink: boolean } | undefined => {
	const website = item.website;
	if (typeof website !== "object" || website === null) return undefined;
	const { url, inlineLink } = website as { url?: unknown; inlineLink?: unknown };

	return typeof url === "string" && url ? { url, inlineLink: inlineLink === true } : undefined;
};

const buildItem = ({
	item,
	type,
	parentKey,
	data,
	skillLevelAfterName = false,
	requireItemHeaderPrimitive = false,
}: {
	item: ItemRecord;
	type: keyof typeof STANDARD_FIELD_REGISTRY;
	parentKey: string;
	data: ResumeData;
	skillLevelAfterName?: boolean;
	requireItemHeaderPrimitive?: boolean;
}): SemanticNode => {
	const key = semanticNodeKeys.item(parentKey, item.id);
	const website = itemWebsite(item);
	const headerKey = semanticNodeKeys.itemHeader(key);
	const headerChildren: SemanticNode[] = [];
	const bodyChildren: SemanticNode[] = [];
	const headerFieldNames = ITEM_HEADER_FIELDS[type];
	const direction = isRTL(data.metadata.page.locale) ? "rtl" : "ltr";

	if (
		ITEM_ICON_SECTIONS.has(type as CustomSectionType) &&
		typeof item.icon === "string" &&
		item.icon &&
		!data.metadata.page.hideIcons
	) {
		headerChildren.push(
			semanticNode({
				key: semanticNodeKeys.icon(headerKey, "item"),
				kind: "icon",
				roles: ["decoration"],
			}),
		);
	}

	for (const name of Object.keys(STANDARD_FIELD_REGISTRY[type])) {
		const parent =
			headerFieldNames.includes(name as never) || (requireItemHeaderPrimitive && headerFieldNames.length === 0)
				? headerKey
				: key;
		const field = buildField({
			parentKey: parent,
			type,
			name,
			value: item[name],
			direction,
			structuredLink: type !== "profiles" && website?.inlineLink === true && name === headerFieldNames[0],
		});

		if (!field) continue;
		(parent === headerKey ? headerChildren : bodyChildren).push(field);
	}

	if (website && type !== "profiles") {
		const parent = website.inlineLink ? headerKey : key;
		(parent === headerKey ? headerChildren : bodyChildren).push(
			semanticNode({
				key: semanticNodeKeys.link(parent, website.inlineLink ? "inline-website" : "website"),
				kind: "link",
				roles: ["structured-link"],
			}),
		);
	}

	if (type === "profiles") {
		bodyChildren.push(
			semanticNode({
				key: semanticNodeKeys.link(key, "profile"),
				kind: "link",
				roles: ["structured-link"],
			}),
		);
	}

	if (type === "experience" && Array.isArray(item.roles)) {
		for (const role of item.roles) {
			if (typeof role !== "object" || role === null || typeof role.id !== "string") continue;
			const roleItem = role as ItemRecord;
			const roleNode = buildItem({
				item: roleItem,
				type: "experience-role",
				parentKey: key,
				data,
				skillLevelAfterName,
				requireItemHeaderPrimitive: false,
			});
			bodyChildren.push({
				...roleNode,
				roles: ["experience-role", "nested-role"],
			});
		}
	}

	const level = buildLevel(key, item.level, data);
	if (level && skillLevelAfterName && type === "skills") bodyChildren.unshift(level);
	else if (level) bodyChildren.push(level);

	return semanticNode({
		key,
		kind: "item",
		id: item.id,
		children: [
			...(headerChildren.length > 0 || requireItemHeaderPrimitive
				? [semanticNode({ key: headerKey, kind: "item-header", children: headerChildren })]
				: []),
			...bodyChildren,
		],
	});
};

const resolveSection = (data: ResumeData, sectionId: string): SectionDescriptor | undefined => {
	if (sectionId === "summary") {
		return {
			id: "summary",
			type: "summary",
			section: {
				title: data.summary.title,
				icon: data.summary.icon,
				hidden: data.summary.hidden,
				items: [
					{
						id: "content",
						hidden: data.summary.hidden,
						content: data.summary.content,
					},
				],
			},
		};
	}

	if (sectionId in data.sections) {
		return {
			id: sectionId,
			type: sectionId as SectionType,
			section: data.sections[sectionId as SectionType] as SectionRecord,
		};
	}

	const section = data.customSections.find((candidate) => candidate.id === sectionId);
	if (!section) return undefined;

	return {
		id: section.id,
		type: section.type,
		section: section as SectionRecord,
	};
};

const buildSection = ({
	data,
	sectionId,
	placement,
	origin,
	regionKey,
	keyIncludesOrigin,
	manifest,
	featured = false,
}: {
	data: ResumeData;
	sectionId: string;
	placement: TemplateSemanticPlacement;
	origin: TemplateSemanticPlacement;
	regionKey: string;
	keyIncludesOrigin: boolean;
	manifest: TemplateSemanticManifest;
	featured?: boolean;
}): SemanticNode | undefined => {
	const descriptor = resolveSection(data, sectionId);
	if (!descriptor) return undefined;

	const key = semanticNodeKeys.section(regionKey, keyIncludesOrigin ? `${origin}:${descriptor.id}` : descriptor.id);
	const headingKey = semanticNodeKeys.sectionHeading(key);
	const sectionIcon = getResumeSectionIcon(data, descriptor.id);
	const heading =
		descriptor.type === "cover-letter"
			? undefined
			: semanticNode({
					key: headingKey,
					kind: "section-heading",
					roles: ["section-title"],
					children:
						sectionIcon && !data.metadata.page.hideSectionIcons
							? [
									semanticNode({
										key: semanticNodeKeys.icon(headingKey, "section"),
										kind: "icon",
										roles: ["decoration"],
									}),
								]
							: [],
				});
	const itemsKey = semanticNodeKeys.sectionItems(key);
	const requireItemHeaderPrimitive = manifest.parts.some(
		(part) =>
			part.owner.kind === "item-header" &&
			(part.owner.sectionTypes === undefined || part.owner.sectionTypes.includes(descriptor.type)),
	);
	const items = filterItems(descriptor.section.items, descriptor.type).map((item) =>
		buildItem({
			item,
			type: descriptor.type,
			parentKey: itemsKey,
			data,
			skillLevelAfterName: manifest.skillLevelAfterName ?? false,
			requireItemHeaderPrimitive,
		}),
	);

	return semanticNode({
		key,
		kind: "section",
		id: descriptor.id,
		attributes: { type: descriptor.type, placement, origin },
		roles: featured ? ["featured-summary"] : [],
		children: [...(heading ? [heading] : []), semanticNode({ key: itemsKey, kind: "section-items", children: items })],
	});
};

type RegionSection = {
	id: string;
	origin: TemplateSemanticPlacement;
};

const buildRegion = ({
	data,
	pageKey,
	region,
	sectionDescriptors,
	manifest,
	featured = false,
}: {
	data: ResumeData;
	pageKey: string;
	region: TemplateSemanticRegion;
	sectionDescriptors: readonly RegionSection[];
	manifest: TemplateSemanticManifest;
	featured?: boolean;
}): SemanticNode => {
	const key = semanticNodeKeys.region(pageKey, region.name);
	const sections = sectionDescriptors.flatMap(({ id, origin }) => {
		const section = buildSection({
			data,
			sectionId: id,
			placement: region.placement,
			origin,
			regionKey: key,
			keyIncludesOrigin: region.origins.length > 1,
			manifest,
			featured,
		});
		return section ? [section] : [];
	});

	return semanticNode({
		key,
		kind: "region",
		attributes: { placement: region.placement, region: region.name },
		children: sections,
	});
};

const buildContactItem = ({
	contactListKey,
	name,
	id,
	structuredLink,
	icon,
}: {
	contactListKey: string;
	name: string;
	id?: string;
	structuredLink: boolean;
	icon: boolean;
}): SemanticNode => {
	const key = semanticNodeKeys.contactItem(contactListKey, name, id);
	const fieldKey = semanticNodeKeys.field(key, name);

	return semanticNode({
		key,
		kind: "contact-item",
		...(id === undefined ? {} : { id }),
		attributes: { name },
		roles: structuredLink ? ["structured-link"] : [],
		children: [
			...(structuredLink
				? [
						semanticNode({
							key: semanticNodeKeys.link(key, "contact"),
							kind: "link",
							roles: ["structured-link"],
						}),
					]
				: []),
			...(icon
				? [semanticNode({ key: semanticNodeKeys.icon(key, "contact"), kind: "icon", roles: ["decoration"] })]
				: []),
			semanticNode({
				key: fieldKey,
				kind: "field",
				attributes: { name },
				roles: structuredLink ? ["primary-text", "structured-link"] : ["primary-text"],
			}),
		],
	});
};

const buildHeader = (
	data: ResumeData,
	pageKey: string,
	placement: TemplateSemanticPlacement,
	summary?: SemanticNode,
): SemanticNode => {
	const regionKey = semanticNodeKeys.region(pageKey, "header");
	const headerKey = semanticNodeKeys.header(regionKey);
	const contactListKey = semanticNodeKeys.contactList(headerKey);
	const showIcons = !data.metadata.page.hideIcons;
	const contacts: SemanticNode[] = [];
	const baseContacts = [
		["email", data.basics.email, true],
		["phone", data.basics.phone, true],
		["location", data.basics.location, false],
		["website", data.basics.website.url, true],
	] as const;

	for (const [name, value, structuredLink] of baseContacts) {
		if (!value) continue;
		contacts.push(
			buildContactItem({
				contactListKey,
				name,
				structuredLink,
				icon: showIcons,
			}),
		);
	}

	for (const field of data.basics.customFields) {
		contacts.push(
			buildContactItem({
				contactListKey,
				name: "custom",
				id: field.id,
				structuredLink: Boolean(getCustomFieldLinkUrl(field)),
				icon: showIcons && Boolean(field.icon),
			}),
		);
	}

	const header = semanticNode({
		key: headerKey,
		kind: "header",
		attributes: { region: "header" },
		children: [
			...(hasTemplatePicture(data.picture)
				? [
						semanticNode({
							key: semanticNodeKeys.headerPart(headerKey, "picture"),
							kind: "picture",
							roles: ["picture"],
						}),
					]
				: []),
			semanticNode({
				key: semanticNodeKeys.headerPart(headerKey, "name"),
				kind: "name",
				roles: ["primary-text"],
			}),
			semanticNode({
				key: semanticNodeKeys.headerPart(headerKey, "headline"),
				kind: "headline",
				roles: ["secondary-text"],
			}),
			semanticNode({ key: contactListKey, kind: "contact-list", children: contacts }),
			...(summary ? [summary] : []),
		],
	});

	return semanticNode({
		key: regionKey,
		kind: "region",
		attributes: { placement, region: "header" },
		children: [header],
	});
};

const getRegionSections = (
	region: TemplateSemanticRegion,
	sectionsByOrigin: Readonly<Record<TemplateSemanticPlacement, readonly string[]>>,
): RegionSection[] => {
	if (region.flow !== "interleaved") {
		return region.origins.flatMap((origin) => sectionsByOrigin[origin].map((id) => ({ id, origin })));
	}

	const sections: RegionSection[] = [];
	const count = Math.max(...region.origins.map((origin) => sectionsByOrigin[origin].length));
	for (let index = 0; index < count; index += 1) {
		for (const origin of region.origins) {
			const id = sectionsByOrigin[origin][index];
			if (id) sections.push({ id, origin });
		}
	}

	return sections;
};

const findSectionAncestor = (ancestors: readonly SemanticNode[]): SemanticNode | undefined =>
	ancestors.findLast((node) => node.kind === "section");

const partMatchesOwner = ({
	part,
	node,
	parent,
	ancestors,
	index,
	data,
}: {
	part: TemplateSemanticPart;
	node: SemanticNode;
	parent: SemanticNode | undefined;
	ancestors: readonly SemanticNode[];
	index: number;
	data: ResumeData;
}): boolean => {
	if (node.kind !== part.owner.kind) return false;
	if (part.owner.kind === "region" && node.attributes.region !== part.owner.key) return false;

	const section = node.kind === "section" ? node : findSectionAncestor(ancestors);
	if ("placement" in part.owner && part.owner.placement && section?.attributes.placement !== part.owner.placement) {
		return false;
	}
	if ("origin" in part.owner && part.owner.origin && section?.attributes.origin !== part.owner.origin) return false;
	if ("columns" in part.owner && part.owner.columns) {
		if (!section?.id) return false;
		const descriptor = resolveSection(data, section.id);
		if (
			!shouldUseSectionTimeline({
				sectionTimeline: true,
				placement: section.attributes.placement as TemplateSemanticPlacement,
				columns: descriptor?.section.columns,
			})
		) {
			return false;
		}
	}
	if ("sectionTypes" in part.owner && part.owner.sectionTypes) {
		if (!section || !part.owner.sectionTypes.includes(section.attributes.type as CustomSectionType)) return false;
	}
	if (part.owner.kind === "item" && parent?.kind !== "section-items") return false;
	if (part.owner.kind === "item-header" && parent?.kind !== "item") return false;
	if (part.owner.kind === "item-header" && ancestors.at(-2)?.kind !== "section-items") return false;
	if ("position" in part.owner && part.owner.position === "last" && index !== (parent?.children.length ?? 0) - 1) {
		return false;
	}

	return true;
};

const selectorMatches = (
	node: SemanticNode,
	selector: TemplateSemanticChildSelector,
	sectionType: CustomSectionType | undefined,
): boolean =>
	node.kind === selector.kind &&
	(selector.name === undefined || node.attributes.name === selector.name || node.id === selector.name) &&
	(selector.sectionTypes === undefined || (sectionType !== undefined && selector.sectionTypes.includes(sectionType)));
const isPrimitivePart = (part: TemplateSemanticPart): part is TemplateSemanticPrimitivePart =>
	part.binding.type === "primitive";

const routeTemplateParts = ({
	children,
	parts,
	parentPart,
	parentKey,
	sectionType,
}: {
	children: readonly SemanticNode[];
	parts: readonly TemplateSemanticPart[];
	parentPart: "owner" | string;
	parentKey: string;
	sectionType: CustomSectionType | undefined;
}): readonly SemanticNode[] => {
	const directParts = parts.filter(
		(part): part is TemplateSemanticPrimitivePart => isPrimitivePart(part) && part.route.parent === parentPart,
	);
	let remaining = [...children];
	const routed = directParts.map((part) => {
		const take = part.route.take;
		const selected =
			take === "all"
				? [...remaining]
				: take
					? remaining.filter((child) => take.some((selector) => selectorMatches(child, selector, sectionType)))
					: [];
		const selectedKeys = new Set(selected.map((child) => child.key));
		remaining = remaining.filter((child) => !selectedKeys.has(child.key));
		const key = `${parentKey}/template-part-${part.key}`;

		return {
			part,
			node: semanticNode({
				key,
				kind: "template-part",
				attributes: { name: part.name },
				roles: ["decoration"],
				children: routeTemplateParts({
					children: selected,
					parts,
					parentPart: part.name,
					parentKey: key,
					sectionType,
				}),
			}),
		};
	});
	const start = routed.filter(({ part }) => part.route.at === "start").map(({ node }) => node);
	const end = routed.filter(({ part }) => part.route.at === "end").map(({ node }) => node);
	const around = remaining.flatMap((child) => [
		...routed
			.filter(
				({ part }) =>
					typeof part.route.at === "object" &&
					"before" in part.route.at &&
					selectorMatches(child, part.route.at.before, sectionType),
			)
			.map(({ node }) => node),
		child,
		...routed
			.filter(
				({ part }) =>
					typeof part.route.at === "object" &&
					"after" in part.route.at &&
					selectorMatches(child, part.route.at.after, sectionType),
			)
			.map(({ node }) => node),
	]);

	return [...start, ...around, ...end];
};

const applyTemplateManifest = (
	tree: SemanticNode,
	manifest: TemplateSemanticManifest,
	data: ResumeData,
	parent?: SemanticNode,
	ancestors: readonly SemanticNode[] = [],
	index = 0,
): SemanticNode => {
	let children = tree.children.map((child, childIndex) =>
		applyTemplateManifest(child, manifest, data, tree, [...ancestors, tree], childIndex),
	);
	const ownerParts = manifest.parts.filter((part) =>
		partMatchesOwner({ part, node: tree, parent, ancestors, index, data }),
	);
	const aliases = ownerParts.flatMap((part) => (part.binding.type === "alias" ? [part.binding.token] : []));
	const existingParts = tree.attributes.part?.split(" ").filter(Boolean) ?? [];
	const attributes =
		aliases.length > 0 ? { ...tree.attributes, part: [...existingParts, ...aliases].join(" ") } : tree.attributes;
	const section = tree.kind === "section" ? tree : findSectionAncestor(ancestors);
	const sectionType = section?.attributes.type as CustomSectionType | undefined;
	for (const part of ownerParts) {
		if (!isPrimitivePart(part)) continue;
		const { route } = part;
		const selectors = route.take;
		if (route.takeFrom !== "item-header" || selectors === undefined || selectors === "all") continue;
		const headerIndex = children.findIndex(({ kind }) => kind === "item-header");
		const header = children[headerIndex];
		if (!header) continue;
		const selected = header.children.filter((child) =>
			selectors.some((selector) => selectorMatches(child, selector, sectionType)),
		);
		if (selected.length === 0) continue;
		const selectedKeys = new Set(selected.map(({ key }) => key));
		children = [
			...children.slice(0, headerIndex),
			{ ...header, children: header.children.filter(({ key }) => !selectedKeys.has(key)) },
			...selected,
			...children.slice(headerIndex + 1),
		];
	}

	return {
		...tree,
		attributes,
		children: routeTemplateParts({
			children,
			parts: ownerParts,
			parentPart: "owner",
			parentKey: tree.key,
			sectionType,
		}),
	};
};

const wrapCombinedFields = (
	parentKey: string,
	children: readonly SemanticNode[],
	fieldNames: readonly string[],
	name: Parameters<typeof semanticNodeKeys.combinedText>[1],
	owner?: "parent",
): readonly SemanticNode[] => {
	const selected = children.filter(
		(child) => child.kind === "field" && fieldNames.includes(child.attributes.name ?? ""),
	);
	if (selected.length === 0) return children;

	const selectedKeys = new Set(selected.map(({ key }) => key));
	const firstIndex = children.findIndex(({ key }) => selectedKeys.has(key));
	const combinedText = semanticNode({
		key: semanticNodeKeys.combinedText(parentKey, name),
		kind: "combined-text",
		attributes: { name, ...(owner ? { owner } : {}) },
		children: selected,
	});

	return children.flatMap((child, index) => {
		if (index === firstIndex) return [combinedText];
		return selectedKeys.has(child.key) ? [] : [child];
	});
};

const addCombinedTextHosts = (
	node: SemanticNode,
	template: Template,
	sectionType?: CustomSectionType,
): SemanticNode => {
	const currentSectionType = node.kind === "section" ? (node.attributes.type as CustomSectionType) : sectionType;
	let children = node.children.map((child) => addCombinedTextHosts(child, template, currentSectionType));

	if (node.kind === "template-part" && node.attributes.name === "inline-item-header-leading") {
		if (currentSectionType === "experience") {
			children = [...wrapCombinedFields(node.key, children, ["position", "location"], "experience-position-location")];
		}
		if (currentSectionType === "education") {
			children = [...wrapCombinedFields(node.key, children, ["area", "degree"], "education-area-degree")];
		}
	}

	if (node.kind === "template-part" && node.attributes.name === "education-grade-row") {
		children = [...wrapCombinedFields(node.key, children, ["grade", "location"], "education-grade-location", "parent")];
	}

	if (node.kind === "item-header" && template !== "meowth") {
		if (currentSectionType === "experience") {
			children = [...wrapCombinedFields(node.key, children, ["location"], "experience-location")];
			children = [...wrapCombinedFields(node.key, children, ["period"], "experience-period")];
		}
		if (currentSectionType === "education") {
			children = [...wrapCombinedFields(node.key, children, ["degree", "grade"], "education-degree-grade")];
			children = [...wrapCombinedFields(node.key, children, ["location", "period"], "education-location-period")];
		}
	}

	return { ...node, children };
};

export function buildSemanticTree({
	data,
	template,
	page,
	pageNumber,
	showHeader,
}: BuildSemanticTreeInput): SemanticNode {
	const pageKey = semanticNodeKeys.page(pageNumber);
	const manifest = getTemplateSemanticManifest(template);
	const mainSections = filterSections(page.main, data);
	const sidebarSections = page.fullWidth ? [] : filterSections(page.sidebar, data);
	const featuredSummary =
		manifest.specialSummary?.source === "main-with-header" && showHeader && mainSections.includes("summary");
	const headerSummary =
		manifest.specialSummary?.source === "always" && showHeader && filterSections(["summary"], data).includes("summary");
	const removeSummary = featuredSummary || manifest.specialSummary?.source === "always";
	const sectionsByOrigin = {
		main: removeSummary ? mainSections.filter((section) => section !== "summary") : mainSections,
		sidebar: removeSummary ? sidebarSections.filter((section) => section !== "summary") : sidebarSections,
	} satisfies Readonly<Record<TemplateSemanticPlacement, readonly string[]>>;
	const regions = manifest.regions.flatMap((region) => {
		if (region.name === "header") {
			if (!showHeader) return [];
			const summary = headerSummary
				? buildSection({
						data,
						sectionId: "summary",
						placement: manifest.specialSummary?.placement ?? "main",
						origin: "main",
						regionKey: semanticNodeKeys.region(pageKey, "header"),
						keyIncludesOrigin: false,
						manifest,
						featured: true,
					})
				: undefined;
			return [buildHeader(data, pageKey, manifest.header.placement, summary)];
		}

		if (region.name === "featured") {
			if (!featuredSummary) return [];
			return [
				buildRegion({
					data,
					pageKey,
					region,
					sectionDescriptors: [{ id: "summary", origin: "main" }],
					manifest,
					featured: true,
				}),
			];
		}

		const keepEmptySidebar = region.name === "sidebar" && manifest.header.placement === "sidebar" && showHeader;
		if (region.name === "sidebar" && page.fullWidth && !keepEmptySidebar) return [];
		return [
			buildRegion({
				data,
				pageKey,
				region,
				sectionDescriptors: getRegionSections(region, sectionsByOrigin),
				manifest,
			}),
		];
	});

	const tree = semanticNode({
		key: semanticNodeKeys.resume(),
		kind: "resume",
		attributes: { template },
		children: [
			semanticNode({
				key: pageKey,
				kind: "page",
				attributes: { "page-number": String(pageNumber) },
				children: regions,
			}),
		],
	});

	return addCombinedTextHosts(applyTemplateManifest(tree, manifest, data), template);
}

export type { TemplateSemanticManifest } from "./template-manifest";
export { shouldShowResumeHeader } from "../templates/shared/cover-letter";
export { createBindingInventory, STANDARD_FIELD_REGISTRY, STANDARD_ROLE_REGISTRY } from "./binding-inventory";
export { semanticNodeKeys } from "./node-keys";
export { getTemplateSemanticBindingRegistry, getTemplateSemanticManifest } from "./template-manifest";
