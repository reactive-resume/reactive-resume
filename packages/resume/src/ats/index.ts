import type { AtsRuleCode } from "./catalog";
import type { AtsRuleFinding, RuleContext } from "./rules";
import type { AtsCategory, AtsCategoryScore, AtsFinding, AtsReport, AtsSeverity } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ATS_CATEGORIES, ATS_RULE_CODES, atsRuleCategory } from "./catalog";
import { ATS_RULES, checksSectionTitles } from "./rules";
import { walkSections } from "./walk";

export type AtsLintOptions = {
	now?: Date;
};

const SEVERITY_ORDER: Readonly<Record<AtsSeverity, number>> = { error: 0, warning: 1, info: 2 };

function compareFindings(a: AtsFinding, b: AtsFinding): number {
	const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
	if (bySeverity !== 0) return bySeverity;
	if (a.pointer !== b.pointer) return a.pointer < b.pointer ? -1 : 1;
	if (a.code === b.code) return 0;
	return a.code < b.code ? -1 : 1;
}

const decodePointerToken = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");

/** The finding's key: its code and pointer, with array indexes swapped for entry ids (see {@link AtsFinding.key}). */
export function atsFindingKey(finding: Pick<AtsFinding, "code" | "pointer">, data: ResumeData): string {
	let node: unknown = data;

	const tokens = finding.pointer
		.split("/")
		.slice(1)
		.map((token) => {
			if (Array.isArray(node)) {
				const entry: unknown = node[Number(token)];
				node = entry;
				const id = (entry as { id?: unknown } | undefined)?.id;
				return typeof id === "string" ? `#${id}` : token;
			}

			node = (node as Record<string, unknown> | undefined)?.[decodePointerToken(token)];
			return token;
		});

	return `${finding.code}:/${tokens.join("/")}`;
}

export function lintResumeForAts(data: ResumeData, options: AtsLintOptions = {}): AtsReport {
	const context: RuleContext = {
		data,
		sections: walkSections(data),
		locale: data.metadata.page.locale.trim() || "en-US",
		now: options.now ?? new Date(),
	};

	const ignoredKeys = new Set(data.metadata.check?.ignored ?? []);
	const all = ATS_RULES.flatMap((rule) => rule(context))
		.map((item: AtsRuleFinding): AtsFinding => ({ ...item, key: atsFindingKey(item, data) }))
		.sort(compareFindings);
	const findings = all.filter((item) => !ignoredKeys.has(item.key));

	const counts: Record<AtsSeverity, number> = { error: 0, warning: 0, info: 0 };
	const failed = new Set<AtsRuleCode>();

	for (const item of findings) {
		counts[item.severity] += 1;
		failed.add(item.code);
	}

	const applicable = ATS_RULE_CODES.filter(
		(code) => code !== "NON_STANDARD_SECTION_TITLE" || checksSectionTitles(context.locale),
	);
	const passed = applicable.filter((code) => !failed.has(code));

	const categories = Object.fromEntries(
		ATS_CATEGORIES.map((category): [AtsCategory, AtsCategoryScore] => [
			category,
			{
				total: applicable.filter((code) => atsRuleCategory(code) === category).length,
				passed: passed.filter((code) => atsRuleCategory(code) === category).length,
			},
		]),
	) as Record<AtsCategory, AtsCategoryScore>;

	return {
		findings,
		ignored: all.filter((item) => ignoredKeys.has(item.key)),
		counts,
		totalRules: applicable.length,
		passedRules: passed.length,
		score: Math.round((passed.length / applicable.length) * 100),
		categories,
	};
}

export type { AtsRuleCode } from "./catalog";
export type { AtsCategory, AtsCategoryScore, AtsFinding, AtsFindingParams, AtsReport, AtsSeverity } from "./types";
export type { SectionPlacement, WalkedItem, WalkedSection } from "./walk";
export { ATS_CATEGORIES, ATS_RULE_CODES, atsRuleCategory } from "./catalog";
