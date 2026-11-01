import type { AtsReport } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { escapeHtml, stripHtml } from "@reactive-resume/utils/string";

/** The fields an import can push a sentence into, in reading order. */
const HEADING_FIELDS = ["company", "position", "school", "degree", "area", "grade", "location"] as const;

const decodeToken = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * Fields a merge has nowhere to put: dates of any kind, a link, roles. An entry carrying one is never merged, so
 * nothing the user wrote is silently dropped.
 */
export function carriesUnmergedFields(entry: Readonly<Record<string, unknown>>): boolean {
	const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
	const website = entry.website as { url?: unknown; label?: unknown } | undefined;
	const dates = entry.dates as { start?: unknown; end?: unknown; present?: unknown; raw?: unknown } | undefined;

	return (
		filled(website?.url) ||
		filled(website?.label) ||
		filled(entry.period) ||
		Boolean(dates?.start || dates?.end || dates?.present === true || filled(dates?.raw)) ||
		(Array.isArray(entry.roles) && entry.roles.length > 0)
	);
}

/**
 * Folds an entry the import split off back into the visible entry above it: its heading text and description are
 * appended to that entry's description as one paragraph, and the entry is removed. `pointer` names the entry
 * (`/sections/experience/items/3`), as a FRAGMENTED_ENTRY finding does. Returns false, changing nothing, when there
 * is nothing above or the entry carries a field the merge would lose.
 */
export function mergeIntoPreviousEntry(data: ResumeData, pointer: string): boolean {
	const tokens = pointer.split("/").slice(1).map(decodeToken);
	const index = Number(tokens.pop());
	if (tokens.pop() !== "items" || !Number.isInteger(index)) return false;

	let node: unknown = data;
	for (const token of tokens) node = (node as Record<string, unknown> | undefined)?.[token];
	const items = (node as { items?: unknown } | undefined)?.items;
	if (!Array.isArray(items)) return false;

	const entry = items[index] as Record<string, unknown> | undefined;
	let previousIndex = index - 1;
	while (previousIndex >= 0 && (items[previousIndex] as { hidden?: unknown }).hidden === true) previousIndex -= 1;
	const previous = items[previousIndex] as Record<string, unknown> | undefined;
	if (!entry || !previous || carriesUnmergedFields(entry)) return false;

	const heading = escapeHtml(
		HEADING_FIELDS.map((field) => entry[field])
			.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
			.map((value) => value.trim())
			.join(" "),
	);
	const description = typeof entry.description === "string" ? entry.description.trim() : "";
	const hasText = stripHtml(description).trim().length > 0;
	const moved = !heading
		? hasText
			? description
			: ""
		: !hasText
			? `<p>${heading}</p>`
			: description.startsWith("<p>")
				? `<p>${heading} ${description.slice(3)}`
				: `<p>${heading}</p>${description}`;

	const before = typeof previous.description === "string" ? previous.description : "";
	// Rejoin a split sentence inside its final paragraph/bullet, rather than adding a new block.
	const tail = before.match(/^(.*?)(<\/(?:p|li)>)(\s*(?:<\/(?:ul|ol)>)?\s*)$/s);
	const lastText = stripHtml(before).trim();
	const continuation = lastText.length > 0 && !/[.!?…"”)]$/.test(lastText);
	const firstParagraph = moved.match(/^<p>(.*?)<\/p>(.*)$/s);
	previous.description =
		tail && continuation && firstParagraph
			? `${tail[1]?.trimEnd()} ${firstParagraph[1]}${tail[2]}${tail[3]}${firstParagraph[2]}`
			: `${before}${moved}`;
	items.splice(index, 1);
	return true;
}

export type AtsVerdict = "clean" | "mostly" | "hard";

/**
 * The headline over Check's score. A resume with entries split off by an import is never "Reads cleanly", however few
 * rules that costs: the split itself is what a reader and a parser both trip on.
 */
export function atsVerdict(report: Pick<AtsReport, "score" | "findings">): AtsVerdict {
	if (report.score >= 80 && !report.findings.some((finding) => finding.code === "FRAGMENTED_ENTRY")) return "clean";
	return report.score >= 50 ? "mostly" : "hard";
}
