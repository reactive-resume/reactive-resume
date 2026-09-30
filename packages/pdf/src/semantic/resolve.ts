import type { ResolvedResumePresentation } from "./context";
import type { ResolveStylesheetResult, SemanticCssDiagnostic, SemanticNode } from "@reactive-resume/resume/stylesheet";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { StylesheetSource } from "@reactive-resume/schema/resume/stylesheet";
import type { Template } from "@reactive-resume/schema/templates";
import { compileStylesheet, isFatalStylesheetDiagnostic, resolveStylesheet } from "@reactive-resume/resume/stylesheet";
import { EMPTY_SEMANTIC_CSS_SOURCE } from "@reactive-resume/schema/resume/stylesheet";
import { shouldShowResumeHeader } from "../templates/shared/cover-letter";
import { getTemplatePageSize } from "../templates/shared/page-size";
import { adaptResolvedPdfNode } from "./adapter";
import { buildPdfBaseStyles } from "./base-styles";
import { createBindingInventory } from "./binding-inventory";
import { semanticNodeKeys } from "./node-keys";
import { getTemplateSemanticBindingRegistry } from "./template-manifest";
import { buildSemanticTree } from "./tree";

export type ResolveResumePresentationInput = {
	data: ResumeData;
	template: Template;
	source?: StylesheetSource;
};

export type ResolvedResumeRuntime = {
	presentation: ResolvedResumePresentation;
	sourceTree: SemanticNode;
	renderTree: SemanticNode;
	diagnostics: readonly SemanticCssDiagnostic[];
};

const EMPTY_PRESENTATION = Object.freeze({}) satisfies ResolvedResumePresentation;

const mergeAuthoredPageTrees = (data: ResumeData, template: Template): SemanticNode => {
	const pageTrees = data.metadata.layout.pages.map((page, index) =>
		buildSemanticTree({
			data,
			template,
			page,
			pageNumber: index + 1,
			showHeader: shouldShowResumeHeader(data, index),
		}),
	);
	const root = pageTrees[0];

	return {
		key: semanticNodeKeys.resume(),
		kind: "resume",
		attributes: { template },
		roles: [],
		children: pageTrees.flatMap((tree) => tree.children),
		...(root?.id === undefined ? {} : { id: root.id }),
	};
};

const authoredPageDimensions = (data: ResumeData) => {
	const size = getTemplatePageSize(data.metadata.page.format);
	const dimensions =
		size === "LETTER"
			? { width: 612, height: 792 }
			: typeof size === "object"
				? { width: size.width, height: 841.89 }
				: { width: 595.28, height: 841.89 };

	return data.metadata.layout.pages.map((_page, index) => ({
		pageKey: semanticNodeKeys.page(index + 1),
		...dimensions,
	}));
};

const toPresentation = (
	resolved: ResolveStylesheetResult["nodes"],
	base: ReturnType<typeof buildPdfBaseStyles>,
): ResolvedResumePresentation => {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(resolved).map(([nodeKey, node]) => [nodeKey, adaptResolvedPdfNode(node, base[nodeKey])]),
		),
	) as ResolvedResumePresentation;
};

export function resolveResumeRuntime({
	data,
	template,
	source,
}: ResolveResumePresentationInput): ResolvedResumeRuntime {
	const sourceTree = mergeAuthoredPageTrees(data, template);

	const stylesheetSource = source ??
		data.metadata.stylesheet?.source ?? {
			languageVersion: 1,
			text: EMPTY_SEMANTIC_CSS_SOURCE,
		};
	const compiled = compileStylesheet(stylesheetSource);
	if (!compiled.program) {
		return { presentation: EMPTY_PRESENTATION, sourceTree, renderTree: sourceTree, diagnostics: compiled.diagnostics };
	}

	const baseStyles = buildPdfBaseStyles({ data, template, tree: sourceTree });
	const inventory = createBindingInventory(sourceTree, getTemplateSemanticBindingRegistry(template));
	const aliases: Record<string, string[]> = {};
	for (const [aliasKey, binding] of Object.entries(inventory.bindings)) {
		if (binding.type !== "alias") continue;
		aliases[binding.canonicalNodeKey] = [...(aliases[binding.canonicalNodeKey] ?? []), aliasKey];
	}
	const resolved = resolveStylesheet(compiled.program, sourceTree, {
		baseStyles,
		baseSettings: {
			picture: data.picture,
			template,
			design: data.metadata.design,
			typography: data.metadata.typography,
			page: data.metadata.page,
			layout: { sidebarWidth: data.metadata.layout.sidebarWidth },
		},
		pages: authoredPageDimensions(data),
		aliases,
	});
	if (resolved.diagnostics.some(isFatalStylesheetDiagnostic)) {
		return {
			presentation: EMPTY_PRESENTATION,
			sourceTree,
			renderTree: sourceTree,
			diagnostics: [...compiled.diagnostics, ...resolved.diagnostics],
		};
	}

	return {
		presentation: toPresentation(resolved.nodes, baseStyles),
		sourceTree,
		renderTree: resolved.renderTree,
		diagnostics: [...compiled.diagnostics, ...resolved.diagnostics],
	};
}

export function resolveResumePresentation(input: ResolveResumePresentationInput): ResolvedResumePresentation {
	return resolveResumeRuntime(input).presentation;
}
