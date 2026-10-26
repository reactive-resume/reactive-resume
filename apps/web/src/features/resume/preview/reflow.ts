import type { SemanticNode } from "@reactive-resume/resume/stylesheet/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { buildSemanticTree, shouldShowResumeHeader } from "@reactive-resume/pdf/semantic-tree";

/** One section as the phone reflow shows it: its id and the ids of the entries the page prints. */
export type ReflowSection = { sectionId: string; itemIds: string[] };

function collect(node: SemanticNode, into: ReflowSection[]) {
	if (node.kind === "section" && node.id) {
		const itemIds: string[] = [];
		const findItems = (child: SemanticNode) => {
			if (child.kind === "item" && child.id) itemIds.push(child.id);
			else for (const grandchild of child.children) findItems(grandchild);
		};
		for (const child of node.children) findItems(child);
		into.push({ sectionId: node.id, itemIds });
		return;
	}
	for (const child of node.children) collect(child, into);
}

/**
 * The sections and entries in the order the PDF prints them, page by page, with hidden and empty ones left out. The
 * semantic tree already applies the template's region order and the shared filtering, so the reflow reads it rather
 * than repeating those rules.
 */
export function reflowOrder(data: ResumeData): ReflowSection[] {
	const sections: ReflowSection[] = [];
	data.metadata.layout.pages.forEach((page, index) => {
		const tree = buildSemanticTree({
			data,
			template: data.metadata.template,
			page,
			pageNumber: index + 1,
			showHeader: shouldShowResumeHeader(data, index),
		});
		collect(tree, sections);
	});
	return sections;
}
