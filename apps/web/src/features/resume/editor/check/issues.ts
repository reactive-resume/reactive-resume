import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { AtsCategory, AtsFinding, AtsReport } from "@reactive-resume/resume/ats";
import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { atsRuleCategory } from "@reactive-resume/resume/ats";
import { describeEntry, findEntry, getSectionObject, resolveSection } from "../write/model";
import { getSectionTitle } from "@/libs/resume/section";

/** How a card fixes its issue: in one step on the resume (with undo), or by opening the entry in Write. */
type IssueFix =
	| { kind: "apply"; label: string; icon: IconName; done: string; apply: (draft: ResumeData) => void }
	| { kind: "write"; label: string; target: PageMapTarget };

export type CheckIssue = {
	key: string;
	/** 1-based, in the order the cards list them; the pin on the page carries the same number. */
	number: number;
	finding: AtsFinding;
	category: AtsCategory;
	title: string;
	body: string;
	fix: IssueFix;
	/** "Keep" instead of "Ignore": the issue follows from a design choice that is the author's to make. */
	keepLabel: boolean;
	/** The block on the page the issue is about, for its pin; null for page-wide settings. */
	target: PageMapTarget | null;
};

export const getCategoryName = (category: AtsCategory) =>
	({
		contact: t`Contact details`,
		dates: t`Dates`,
		layout: t`Layout`,
		headings: t`Section headings`,
		writing: t`Writing`,
	})[category];

export const getCategoryDescription = (category: AtsCategory) =>
	({
		contact: t`Name, email, phone and location are found, and links are full addresses.`,
		dates: t`Every entry has dates in a form systems read, in order, and none in the future.`,
		layout: t`Text comes out in the order a person reads it, at a size and spacing that survive.`,
		headings: t`Sections use headings systems recognise, and work experience shows.`,
		writing: t`Every role says what you did. Opinions on wording live in the Writing tab.`,
	})[category];

const decodeToken = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");

const tokensOf = (pointer: string) => pointer.split("/").slice(1).map(decodeToken);

/** The section a pointer is in: the summary, a built-in section's key or a custom section's id. */
function sectionIdOf(tokens: readonly string[], data: ResumeData): string | undefined {
	const [head, next] = tokens;
	if (head === "summary") return "summary";
	if (head === "sections") return next;
	if (head === "customSections") return data.customSections[Number(next)]?.id;
	return undefined;
}

function itemIdOf(tokens: readonly string[], data: ResumeData): string | undefined {
	const itemsIndex = tokens.indexOf("items");
	if (itemsIndex === -1) return undefined;

	let node: unknown = data;
	for (const token of tokens.slice(0, itemsIndex + 2)) node = (node as Record<string, unknown> | undefined)?.[token];

	const id = (node as { id?: unknown } | undefined)?.id;
	return typeof id === "string" ? id : undefined;
}

/** The block a finding is about: the header for contact details, else its section or entry. */
function getFindingTarget(finding: AtsFinding, data: ResumeData): PageMapTarget | null {
	const tokens = tokensOf(finding.pointer);
	if (tokens[0] === "basics" || tokens[0] === "picture") return { kind: "header" };

	const sectionId = sectionIdOf(tokens, data);
	if (!sectionId) return null;

	const itemId = itemIdOf(tokens, data);
	return itemId ? { kind: "item", sectionId, itemId } : { kind: "section", sectionId };
}

/** The printed name of a section: the title the author gave it, else its type's name. */
export function getSectionName(data: ResumeData, sectionId: string): string {
	const section = resolveSection(data, sectionId);
	if (!section) return sectionId;

	const title = getSectionObject(data, section)?.title.trim();
	return title || getSectionTitle(section.kind === "custom" ? section.type : (section.id as SectionType | "summary"));
}

function getEntryName(data: ResumeData, target: PageMapTarget | null): string {
	if (target?.kind !== "item") return t`This entry`;

	const section = resolveSection(data, target.sectionId);
	const entry = findEntry(data, target.sectionId, target.itemId);
	const title = section && entry ? describeEntry(section.type, entry).title : "";
	return title ? `“${title}”` : t`This entry`;
}

/** Sets the value a finding's pointer names (the pointer still has array indexes, which match `draft`). */
function setAt(draft: ResumeData, pointer: string, value: unknown) {
	const tokens = tokensOf(pointer);
	const last = tokens.pop();
	let node: unknown = draft;
	for (const token of tokens) node = (node as Record<string, unknown> | undefined)?.[token];
	if (node && last !== undefined) (node as Record<string, unknown>)[last] = value;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type Message = { title: string; body: string; fix: IssueFix; keepLabel?: boolean };

function describeFinding(finding: AtsFinding, data: ResumeData, target: PageMapTarget | null): Message {
	const value = String(finding.params?.value ?? "");
	const section = String(finding.params?.section ?? "");
	const minimum = Number(finding.params?.minimum ?? 0);
	const write = (label: string): IssueFix => ({ kind: "write", label, target: target ?? { kind: "header" } });
	const entry = getEntryName(data, target);

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
				title: t`Email address won't be recognised`,
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
				body: t`Some systems only recognise links that start with https://. This one reads as plain text: “${value}”.`,
				fix: HAS_SCHEME.test(value)
					? write(t`Edit the link`)
					: {
							kind: "apply",
							label: t`Use ${url}`,
							icon: "link",
							done: t`Link updated`,
							apply: (draft) => setAt(draft, finding.pointer, url),
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
					icon: "visibility_off",
					done: t`Photo hidden`,
					apply: (draft) => {
						draft.picture.hidden = true;
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
				body: t`“${value}” isn't a form systems recognise, such as Mar 2020 – Present.`,
				fix: write(t`Fix the dates`),
			};
		case "UNPARSEABLE_DATE":
			return {
				title: t`A date won't be read`,
				body: t`“${value}” isn't a form systems recognise, such as March 2022.`,
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
			const name = getSectionName(data, section);
			return {
				title: t`${name} never prints`,
				body: t`It has entries but isn't placed on a page.`,
				fix: {
					kind: "apply",
					label: t`Add it to page 1`,
					icon: "add",
					done: t`${name} added to page 1`,
					apply: (draft) => {
						const [page] = draft.metadata.layout.pages;
						if (page) page.main.push(section);
						else draft.metadata.layout.pages.push({ fullWidth: false, main: [section], sidebar: [] });
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
					icon: "title",
					done: t`Heading changed`,
					// An empty title prints the section type's name in the resume's language.
					apply: (draft) => setAt(draft, finding.pointer, ""),
				},
			};
		}
		case "MULTI_COLUMN_PROSE_SECTION": {
			const name = getSectionName(data, section);
			const columns = Number(finding.params?.columns ?? 2);
			return {
				title: t`${name} is split into ${columns} columns`,
				body: t`Columns can scramble the order text is read in.`,
				fix: {
					kind: "apply",
					label: t`Use one column`,
					icon: "view_list",
					done: t`${name} uses one column`,
					apply: (draft) => setAt(draft, finding.pointer, 1),
				},
			};
		}
		case "PROSE_SECTION_IN_SIDEBAR": {
			const name = getSectionName(data, section);
			return {
				title: t`${name} sits in the sidebar`,
				body: t`Sidebars are often read last, or mixed into the main column.`,
				fix: {
					kind: "apply",
					label: t`Move it to the main column`,
					icon: "arrow_forward",
					done: t`${name} moved to the main column`,
					apply: (draft) => {
						for (const page of draft.metadata.layout.pages) {
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
				.map((id) => getSectionName(data, id))
				.join(", ");
			return {
				title: t`Sidebar is read after the main column`,
				body: t`${names} come last in the text. Most systems still find them; some don't.`,
				keepLabel: true,
				fix: {
					kind: "apply",
					label: t`Switch to one column`,
					icon: "view_list",
					done: t`Switched to one column`,
					// Full-width pages print no sidebar, so its sections move into the main column first.
					apply: (draft) => {
						for (const page of draft.metadata.layout.pages) {
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
					icon: "format_size",
					done: t`Body text set to ${minimum} pt`,
					apply: (draft) => setAt(draft, finding.pointer, minimum),
				},
			};
		case "TIGHT_LINE_HEIGHT":
			return {
				title: t`Lines are packed tightly`,
				body: t`Lines this close can run together when read. Use at least ${minimum}.`,
				fix: {
					kind: "apply",
					label: t`Use ${minimum}`,
					icon: "tune",
					done: t`Line height set to ${minimum}`,
					apply: (draft) => setAt(draft, finding.pointer, minimum),
				},
			};
		case "TIGHT_PAGE_MARGINS":
			return {
				title: t`Margins are very narrow`,
				body: t`Text this close to the edge can be cut off. Use at least ${minimum} pt.`,
				fix: {
					kind: "apply",
					label: t`Use ${minimum} pt margins`,
					icon: "tune",
					done: t`Margins set to ${minimum} pt`,
					apply: (draft) => setAt(draft, finding.pointer, minimum),
				},
			};
	}
}

/** The open findings as numbered cards, in the report's order (most severe first). */
export function buildIssues(report: AtsReport, data: ResumeData): CheckIssue[] {
	return report.findings.map((finding, index) => {
		const target = getFindingTarget(finding, data);
		const message = describeFinding(finding, data, target);

		return {
			key: finding.key,
			number: index + 1,
			finding,
			category: atsRuleCategory(finding.code),
			title: message.title,
			body: message.body,
			fix: message.fix,
			keepLabel: message.keepLabel ?? false,
			target,
		};
	});
}
