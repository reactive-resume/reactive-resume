// The open findings as numbered cards with exactly one fix each, ported from
// apps/web/src/features/resume/editor/check/issues.ts (logic and copy). The board's wording wins for the two cards it
// draws (a link that isn't a full address, tight lines); see the report.
import type { AtsCategory, AtsFinding, AtsReport } from "@reactive-resume/resume/ats";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural, t } from "@lingui/core/macro";
import { atsRuleCategory, atsVerdict, mergeIntoPreviousEntry } from "@reactive-resume/resume/ats";
import { entryTitle, findEntry, resolveSection, sectionName } from "../shared/model";

/** Where a write-fix opens: Basics, a section (B2) or an entry (B3). */
export type FixTarget =
	| { kind: "basics" }
	| { kind: "section"; sectionId: string }
	| { kind: "item"; sectionId: string; itemId: string };
export type IssueFix =
	| { kind: "apply"; label: string; done: string; apply: (draft: ResumeData) => void }
	| { kind: "write"; label: string; target: FixTarget };
export type CheckIssue = {
	key: string;
	number: number;
	finding: AtsFinding;
	category: AtsCategory;
	title: string;
	body: string;
	fix: IssueFix;
};

const decode = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");
const tokensOf = (pointer: string) => pointer.split("/").slice(1).map(decode);

function sectionIdOf(tokens: readonly string[], data: ResumeData): string | undefined {
	const [head, next] = tokens;
	if (head === "summary") return "summary";
	if (head === "sections") return next;
	if (head === "customSections") return data.customSections[Number(next)]?.id;
	return undefined;
}

function targetOf(finding: AtsFinding, data: ResumeData): FixTarget {
	const tokens = tokensOf(finding.pointer);
	if (tokens[0] === "basics" || tokens[0] === "picture") return { kind: "basics" };
	const sectionId = sectionIdOf(tokens, data);
	if (!sectionId) return { kind: "basics" };
	const at = tokens.indexOf("items");
	if (at === -1) return { kind: "section", sectionId };
	let node: unknown = data;
	for (const token of tokens.slice(0, at + 2)) node = (node as Record<string, unknown> | undefined)?.[token];
	const itemId = (node as { id?: unknown } | undefined)?.id;
	return typeof itemId === "string" ? { kind: "item", sectionId, itemId } : { kind: "section", sectionId };
}

function setAt(draft: ResumeData, pointer: string, value: unknown) {
	const tokens = tokensOf(pointer);
	const last = tokens.pop();
	let node: unknown = draft;
	for (const token of tokens) node = (node as Record<string, unknown> | undefined)?.[token];
	if (node && last !== undefined) (node as Record<string, unknown>)[last] = value;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const nameOf = (data: ResumeData, id: string) => {
	const section = resolveSection(data, id);
	return section ? sectionName(data, section) : id;
};

function describe(
	finding: AtsFinding,
	data: ResumeData,
	target: FixTarget,
): Omit<CheckIssue, "key" | "number" | "finding" | "category"> {
	const value = String(finding.params?.value ?? "");
	const section = String(finding.params?.section ?? "");
	const minimum = Number(finding.params?.minimum ?? 0);
	const write = (label: string): IssueFix => ({ kind: "write", label, target });
	const entry = (() => {
		if (target.kind !== "item") return t`This entry`;
		const s = resolveSection(data, target.sectionId);
		const e = findEntry(data, target.sectionId, target.itemId);
		const title = s && e ? entryTitle(s.type, e) : "";
		return title ? `“${title}”` : t`This entry`;
	})();
	switch (finding.code) {
		case "MISSING_NAME":
			return {
				title: t`Your name is missing`,
				body: t`Systems file you under the name at the top of the page.`,
				fix: write(t`Add your name`),
			};
		case "MISSING_EMAIL":
			return {
				title: t`No email address`,
				body: t`Most systems file candidates by email address.`,
				fix: write(t`Add an email`),
			};
		case "MALFORMED_EMAIL":
			return {
				title: t`Email address won't be recognized`,
				body: t`“${value}” isn't a plain address like name@example.com.`,
				fix: write(t`Edit the email`),
			};
		case "MISSING_PHONE":
			return {
				title: t`No phone number`,
				body: t`Some application systems ask for one before you can apply.`,
				fix: write(t`Add a phone number`),
			};
		case "MISSING_LOCATION":
			return {
				title: t`No location`,
				body: t`A city and country let roles be matched to where you are.`,
				fix: write(t`Add a location`),
			};
		case "MALFORMED_URL": {
			const url = `https://${value}`;
			return {
				title: t`A link isn't a full address`,
				body: t`“${value}” reads as plain text. Some systems only recognise links that start with https://.`,
				fix: HAS_SCHEME.test(value)
					? write(t`Edit the link`)
					: {
							kind: "apply",
							label: t`Use ${url}`,
							done: t`Link updated`,
							apply: (d) => setAt(d, finding.pointer, url),
						},
			};
		}
		case "PICTURE_PRESENT":
			return {
				title: t`Your resume has a photo`,
				body: t`Some systems mishandle images, and photos are discouraged in some countries.`,
				fix: {
					kind: "apply",
					label: t`Hide the photo`,
					done: t`Photo hidden`,
					apply: (d) => {
						d.picture.hidden = true;
					},
				},
			};
		case "EMPTY_PERIOD":
			return {
				title: t`An entry has no dates`,
				body: t`${entry} doesn't say when. Dates place it on your timeline.`,
				fix: write(t`Add dates`),
			};
		case "UNPARSEABLE_PERIOD":
			return {
				title: t`Dates won't be read`,
				body: t`“${value}” isn't a form systems recognize, such as Mar 2020 – Present.`,
				fix: write(t`Fix the dates`),
			};
		case "UNPARSEABLE_DATE":
			return {
				title: t`A date won't be read`,
				body: t`“${value}” isn't a form systems recognize, such as March 2022.`,
				fix: write(t`Fix the date`),
			};
		case "REVERSED_PERIOD":
			return {
				title: t`Dates run backwards`,
				body: t`“${value}” ends before it starts.`,
				fix: write(t`Fix the dates`),
			};
		case "FUTURE_DATED_PERIOD":
			return {
				title: t`Dates start in the future`,
				body: t`“${value}” starts after today. Check the year, or mark it as current.`,
				fix: write(t`Fix the dates`),
			};
		case "SECTION_MISSING_FROM_LAYOUT": {
			const name = nameOf(data, section);
			return {
				title: t`${name} never prints`,
				body: t`It has entries but isn't placed on a page.`,
				fix: {
					kind: "apply",
					label: t`Add it to page 1`,
					done: t`${name} added to page 1`,
					apply: (d) => {
						const [page] = d.metadata.layout.pages;
						if (page) page.main.push(section);
						else d.metadata.layout.pages.push({ fullWidth: false, main: [section], sidebar: [] });
					},
				},
			};
		}
		case "NO_VISIBLE_EXPERIENCE":
			return {
				title: t`No work experience shows`,
				body: t`Systems look for an experience section. Projects or volunteering can show the same history.`,
				fix: { kind: "write", label: t`Add experience`, target: { kind: "section", sectionId: "experience" } },
			};
		case "FRAGMENTED_ENTRY":
			return {
				title: t`Looks like part of the entry above`,
				body: t`${entry} has no dates and reads like a sentence cut off the entry above it, which happens when a PDF import splits a bullet. Adding dates would make it look like a separate job.`,
				fix: {
					kind: "apply",
					label: t`Merge into previous entry`,
					done: t`Merged into the entry above`,
					apply: (d) => {
						mergeIntoPreviousEntry(d, finding.pointer);
					},
				},
			};
		case "MISSING_EXPERIENCE_DESCRIPTION":
			return {
				title: t`A role has no description`,
				body: t`${entry} names the role but not what you did, so it adds no keywords.`,
				fix: write(t`Describe the role`),
			};
		case "NON_STANDARD_SECTION_TITLE": {
			const title = String(finding.params?.title ?? "");
			return {
				title: t`“${title}” isn't a heading systems look for`,
				body: t`They look for headings such as Experience, Education and Skills.`,
				fix: {
					kind: "apply",
					label: t`Use the standard heading`,
					done: t`Heading changed`,
					apply: (d) => setAt(d, finding.pointer, ""),
				},
			};
		}
		case "MULTI_COLUMN_PROSE_SECTION": {
			const name = nameOf(data, section);
			const columns = Number(finding.params?.columns ?? 2);
			return {
				title: t`${name} is split into ${columns} columns`,
				body: t`Columns can scramble the order text is read in.`,
				fix: {
					kind: "apply",
					label: t`Use one column`,
					done: t`${name} uses one column`,
					apply: (d) => setAt(d, finding.pointer, 1),
				},
			};
		}
		case "PROSE_SECTION_IN_SIDEBAR": {
			const name = nameOf(data, section);
			return {
				title: t`${name} sits in the sidebar`,
				body: t`Sidebars are often read last, or mixed into the main column.`,
				fix: {
					kind: "apply",
					label: t`Move it to the main column`,
					done: t`${name} moved to the main column`,
					apply: (d) => {
						for (const page of d.metadata.layout.pages) {
							if (!page.sidebar.includes(section)) continue;
							page.sidebar = page.sidebar.filter((id) => id !== section);
							page.main.push(section);
						}
					},
				},
			};
		}
		case "TWO_COLUMN_LAYOUT": {
			const names = String(finding.params?.sections ?? "")
				.split(",")
				.filter(Boolean)
				.map((id) => nameOf(data, id))
				.join(", ");
			return {
				title: t`Sidebar is read after the main column`,
				body: t`${names} come last in the text. Most systems still find them; some don't.`,
				fix: {
					kind: "apply",
					label: t`Switch to one column`,
					done: t`Switched to one column`,
					apply: (d) => {
						for (const page of d.metadata.layout.pages) {
							if (page.fullWidth || page.sidebar.length === 0) continue;
							page.main.push(...page.sidebar);
							page.sidebar = [];
							page.fullWidth = true;
						}
					},
				},
			};
		}
		case "SMALL_BODY_FONT":
			return {
				title: t`Body text is very small`,
				body: t`Text under ${minimum} pt can be misread when a system re-renders it.`,
				fix: {
					kind: "apply",
					label: t`Use ${minimum} pt`,
					done: t`Body text set to ${minimum} pt`,
					apply: (d) => setAt(d, finding.pointer, minimum),
				},
			};
		case "TIGHT_LINE_HEIGHT":
			return {
				title: t`Lines are packed tightly`,
				body: t`Lines this close can run together when read.`,
				fix: {
					kind: "apply",
					label: t`Use ${minimum} line height`,
					done: t`Line height set to ${minimum}`,
					apply: (d) => setAt(d, finding.pointer, minimum),
				},
			};
		case "TIGHT_PAGE_MARGINS":
			return {
				title: t`Margins are very narrow`,
				body: t`Text this close to the edge can be cut off. Use at least ${minimum} pt.`,
				fix: {
					kind: "apply",
					label: t`Use ${minimum} pt margins`,
					done: t`Margins set to ${minimum} pt`,
					apply: (d) => setAt(d, finding.pointer, minimum),
				},
			};
		default:
			return { title: finding.code, body: "", fix: write(t`Edit`) };
	}
}

export function buildIssues(report: AtsReport, data: ResumeData): CheckIssue[] {
	return report.findings.map((finding, index) => {
		const target = targetOf(finding, data);
		return {
			key: finding.key,
			number: index + 1,
			finding,
			category: atsRuleCategory(finding.code),
			...describe(finding, data, target),
		};
	});
}

export const verdictLabel = (report: AtsReport) =>
	({ clean: t`Reads cleanly`, mostly: t`Mostly readable`, hard: t`Hard for software to read` })[atsVerdict(report)];

export const openLine = (count: number) =>
	count === 0
		? t`Nothing to review.`
		: plural(count, {
				one: "One thing to fix.",
				2: "Two things to fix.",
				3: "Three things to fix.",
				other: "# things to fix.",
			});

export const categoryName = (category: AtsCategory) =>
	({
		contact: t`Contact details`,
		dates: t`Dates`,
		layout: t`Layout`,
		headings: t`Section headings`,
		writing: t`Writing`,
	})[category];
