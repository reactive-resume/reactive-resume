import type { CheckIssue } from "./issues";
import type { PageMap, PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData, SkillItem } from "@reactive-resume/schema/resume/data";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { matchJobDescription, surfaceFormsOf } from "@reactive-resume/resume/ats-pdf";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { generateId } from "@reactive-resume/utils/string";
import { buildIssues } from "./issues";

export function computeCheck(data: ResumeData, now = new Date()) {
	const report = lintResumeForAts(data, { now });
	return { report, issues: buildIssues(report, data) };
}

export function checkStateOf(draft: ResumeData) {
	draft.metadata.check ??= { ignored: [], hiddenTerms: [] };
	return draft.metadata.check;
}

/** The employer and place of a linked application: their names are never a term to add. */
type PostingOwner = { company?: string | undefined; location?: string | null | undefined };

export function matchPosting(data: ResumeData, posting: string, owner: PostingOwner = {}) {
	const hidden = new Set(data.metadata.check?.hiddenTerms ?? []);
	const terms = matchJobDescription({
		jobDescription: posting,
		resumeText: buildMarkdown(data),
		company: owner.company,
		location: owner.location ?? undefined,
	})
		.terms.filter((term) => !hidden.has(term.term))
		.map((term) => ({
			...term,
			label:
				surfaceFormsOf(term.term)
					.map((form) => posting.match(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))?.[0])
					.find(Boolean) ?? term.term,
		}));
	return {
		found: terms.filter((term) => term.resumeCount > 0),
		missing: terms.filter((term) => term.resumeCount === 0),
		total: terms.length,
	};
}

export function addSkill(draft: ResumeData, name: string) {
	const skill: SkillItem = {
		id: generateId(),
		hidden: false,
		icon: "",
		iconColor: "",
		name,
		proficiency: "",
		level: 0,
		keywords: [],
	};
	draft.sections.skills.items.push(skill);
}

export const sameTarget = (node: PageMapTarget, target: PageMapTarget) =>
	node.kind === target.kind &&
	(node.kind === "header" ||
		(target.kind !== "header" &&
			node.sectionId === target.sectionId &&
			(node.kind !== "item" || (target.kind === "item" && node.itemId === target.itemId))));

const textOf = (value: unknown): string =>
	typeof value === "string"
		? value
		: value && typeof value === "object"
			? Object.values(value).map(textOf).join(" ")
			: "";

/** The blocks whose text mentions a term; page map excludes blocks that don't print. */
export function termTargets(data: ResumeData, term: string): PageMapTarget[] {
	const forms = surfaceFormsOf(term).map((form) => form.toLowerCase());
	const mentions = (value: unknown) => forms.some((form) => textOf(value).toLowerCase().includes(form));
	const targets: PageMapTarget[] = [];
	if (mentions(data.basics)) targets.push({ kind: "header" });
	if (!data.summary.hidden && mentions(data.summary.content)) targets.push({ kind: "section", sectionId: "summary" });
	const sections = [
		...Object.entries(data.sections).map(([id, section]) => ({ id, ...section })),
		...data.customSections,
	];
	for (const section of sections) {
		if (section.hidden) continue;
		for (const item of section.items)
			if (!item.hidden && mentions(item)) targets.push({ kind: "item", sectionId: section.id, itemId: item.id });
	}
	return targets;
}

/** One pin per issue, anchored to its first printed block; page-wide checks anchor to page 1. */
export function issuePins(issues: readonly CheckIssue[], map: PageMap) {
	return issues.flatMap((issue) => {
		const target = issue.target;
		const node = target ? map.nodes.find((node) => sameTarget(node, target)) : undefined;
		if (issue.target && !node) return [];
		return [{ issue, page: node?.page ?? 0, y: node?.y ?? 0, height: node?.height ?? 0 }];
	});
}
