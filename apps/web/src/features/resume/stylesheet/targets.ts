import type { EditorSelection } from "../editor/store";
import type { SemanticNode } from "@reactive-resume/resume/stylesheet/registry";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { escapeCssString } from "@reactive-resume/resume/stylesheet/registry";
import { describeEntry, findEntry, getSectionObject, resolveSection } from "../editor/write/model";
import { getSectionTitle } from "@/libs/resume/section";

/** One element a stylesheet can aim at: its selector, and a name a person recognises. */
export type StyleTarget = { selector: string; label: string };

function sectionLabel(data: ResumeData, sectionId: string): string {
	const section = resolveSection(data, sectionId);
	if (!section) return sectionId;
	return getSectionObject(data, section)?.title || getSectionTitle(section.type);
}

/** The header, a section or one entry, as picked on the page, as a selector plus "Experience › Senior Developer". */
export function styleTargetFor(data: ResumeData, selection: EditorSelection): StyleTarget {
	if (selection.kind === "header") return { selector: "header", label: t`Header` };

	const section = `section[id=${escapeCssString(selection.sectionId)}]`;
	const label = sectionLabel(data, selection.sectionId);
	if (selection.kind === "section") return { selector: section, label };

	const type = resolveSection(data, selection.sectionId)?.type;
	const entry = findEntry(data, selection.sectionId, selection.itemId);
	// The summary's text is an item of its own, but there's only one: aim at the section.
	if (!type || !entry) return { selector: section, label };
	const title = describeEntry(type, entry).title || t`Untitled`;
	return { selector: `${section} item[id=${escapeCssString(selection.itemId)}]`, label: `${label} › ${title}` };
}

/** Every section and entry on the page, for autocomplete: find "Senior Developer" by name, insert its selector. */
export function listStyleTargets(data: ResumeData, tree: SemanticNode): StyleTarget[] {
	const targets = new Map<string, StyleTarget>();
	const visit = (node: SemanticNode, sectionId: string | undefined) => {
		if (node.kind === "header") targets.set("header", styleTargetFor(data, { kind: "header" }));
		const ownSection = node.kind === "section" ? node.id : sectionId;
		if (node.kind === "section" && node.id) {
			const target = styleTargetFor(data, { kind: "section", sectionId: node.id });
			targets.set(target.selector, target);
		}
		if (node.kind === "item" && node.id && ownSection) {
			const target = styleTargetFor(data, { kind: "item", sectionId: ownSection, itemId: node.id });
			targets.set(target.selector, target);
		}
		for (const child of node.children) visit(child, ownSection);
	};
	visit(tree, undefined);
	return [...targets.values()];
}
