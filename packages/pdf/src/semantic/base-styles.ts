import type { ResolvedNodeStyle, SemanticNode } from "@reactive-resume/resume/stylesheet";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { resolveBoldFontWeight } from "@reactive-resume/fonts";
import { findSection } from "../section-title";
import { getTemplatePageSize } from "../templates/shared/page-size";

export type BuildPdfBaseStylesInput = {
	data: ResumeData;
	template: Template;
	tree: SemanticNode;
};

const textKinds = new Set([
	"name",
	"headline",
	"section-heading",
	"combined-text",
	"field",
	"link",
	"rich-heading",
	"paragraph",
	"list-marker",
	"list-item-content",
	"strong",
	"emphasis",
	"underline",
	"strike",
	"code",
	"text-span",
	"mark",
	"hard-break",
]);

const headingKinds = new Set(["name", "section-heading", "rich-heading"]);

export function buildPdfBaseStyles({
	data,
	tree,
}: BuildPdfBaseStylesInput): Readonly<Record<string, ResolvedNodeStyle>> {
	const result: Record<string, ResolvedNodeStyle> = {};
	const body = data.metadata.typography.body;
	const heading = data.metadata.typography.heading;
	const bodyWeight = body.fontWeights[0] ?? "400";
	// Bold must use the family's true Bold face when one exists; the last
	// stored weight is only a fallback (#3310).
	const boldWeight = resolveBoldFontWeight(body.fontFamily, body.fontWeights) ?? body.fontWeights.at(-1) ?? "600";
	const headingWeight = heading.fontWeights.at(-1) ?? "600";

	const visit = (node: SemanticNode) => {
		const style: Record<string, string | number> = {};
		const structural: ResolvedNodeStyle["structural"] = {};

		if (node.kind === "page") {
			style.color = data.metadata.design.colors.text;
			style["background-color"] = data.metadata.design.colors.background;
			style["font-size"] = body.fontSize;
			style["font-weight"] = bodyWeight;
			style["line-height"] = body.lineHeight;
			structural.pageSize = getTemplatePageSize(data.metadata.page.format);
		}

		if (textKinds.has(node.kind)) {
			style.color = data.metadata.design.colors.text;
			style["font-size"] = headingKinds.has(node.kind) ? heading.fontSize : body.fontSize;
			style["font-weight"] = headingKinds.has(node.kind)
				? headingWeight
				: node.roles.includes("primary-text") || node.kind === "strong"
					? boldWeight
					: bodyWeight;
			style["line-height"] = headingKinds.has(node.kind) ? heading.lineHeight : body.lineHeight;
		}

		if (node.kind === "link" || (node.kind === "contact-item" && node.roles.includes("structured-link"))) {
			style["text-decoration"] = data.metadata.page.hideLinkUnderline ? "none" : "underline";
		}

		if (node.kind === "picture") {
			Object.assign(style, {
				width: data.picture.size,
				height: data.picture.size,
				"object-fit": "cover",
				"aspect-ratio": data.picture.aspectRatio,
				"border-radius": data.picture.borderRadius,
				"border-color": data.picture.borderColor,
				"border-width": data.picture.borderWidth,
				"-resume-shadow-color": data.picture.shadowColor,
				"-resume-shadow-width": data.picture.shadowWidth,
				transform: `rotate(${data.picture.rotation}deg)`,
			});
		}

		if (node.kind === "section") {
			const section = node.id ? findSection(data, node.id) : undefined;
			if (section?.keepTogether) structural.breakInside = "avoid";
			if (section?.startOnNewPage) structural.breakBefore = "page";
		}

		result[node.key] = Object.freeze({
			style: Object.freeze(style),
			structural: Object.freeze(structural),
			hidden: false,
			order: 0,
		});
		for (const child of node.children) visit(child);
	};

	visit(tree);
	return Object.freeze(result);
}
