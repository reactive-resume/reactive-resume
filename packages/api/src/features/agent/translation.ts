import type { ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { parseDocument } from "htmlparser2";
import { applyResumePatches } from "@reactive-resume/resume/patch";
import { resumeStructureSnapshot, unverifiedClaims } from "@reactive-resume/resume/proposals";
import { assertRichTextComplexity } from "@reactive-resume/schema/resume/limits";
import { escapeHtml, generateId } from "@reactive-resume/utils/string";

// Positive list: identifiers, destinations, structured dates, IDs and private metadata cannot become translation targets.
const TEXT_FIELDS = new Set([
	"headline",
	"location",
	"text",
	"title",
	"content",
	"description",
	"position",
	"degree",
	"area",
	"grade",
	"fluency",
	"proficiency",
	"language",
	"keywords",
	"label",
	"name",
	"company",
	"school",
	"organization",
	"awarder",
	"issuer",
	"publisher",
	"network",
	"raw",
]);
const RICH_FIELDS = new Set(["content", "description"]);
const NAME_FIELDS = new Set(["name", "company", "school", "organization", "awarder", "issuer", "publisher", "network"]);
type TranslationField = { id: string; text: string; path: string; start?: number; end?: number };
type TranslationData = Pick<ResumeData, "basics" | "customSections"> & {
	summary?: ResumeData["summary"] | undefined;
	sections: Partial<ResumeData["sections"]>;
};
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
const tooLarge = (fields: readonly { text: string }[]) =>
	fields.length > 500 || fields.reduce((size, field) => size + field.text.length, 0) > 100_000;

/** Rebuild a bounded model view instead of forwarding historical translation-field lists. */
export function translationView(data: TranslationData, locale: string) {
	const fields = translationFields(data);
	return tooLarge(fields)
		? { translationUnavailable: "This resume is too large for one translation review. Use a smaller copy." }
		: { pageLocale: locale, translationFields: fields.map(({ id, text }) => ({ id, text })) };
}

function locationOf(path: string) {
	return path
		.slice(1)
		.split("/")
		.filter((part) => part !== "sections")
		.map((part) => {
			if (/^\d+$/.test(part)) return String(Number(part) + 1);
			return (
				(
					{ items: "Entry", roles: "Role", customFields: "Custom field", customSections: "Custom section" } as Record<
						string,
						string
					>
				)[part] ?? part.charAt(0).toUpperCase() + part.slice(1)
			);
		})
		.join(" · ");
}

const translationSnapshot = (data: ResumeData) =>
	JSON.stringify({ ...JSON.parse(resumeStructureSnapshot(data)), locale: data.metadata.page.locale });

/** Every nonempty visible text field, including nested roles, keywords, custom fields and link labels. */
export function translationFields(data: TranslationData): TranslationField[] {
	const fields: TranslationField[] = [];
	const visit = (value: unknown, path: string, key = "", identity = path) => {
		if (typeof value === "string") {
			if (!value.trim() || !TEXT_FIELDS.has(key)) return;
			if (!RICH_FIELDS.has(key)) {
				fields.push({ id: identity, path, text: value });
				return;
			}
			assertRichTextComplexity(value);
			const nodes = [...parseDocument(value, { withStartIndices: true, withEndIndices: true }).children];
			while (nodes.length) {
				const node = nodes.shift();
				if (!node) continue;
				if (node.type === "text" && node.data.trim() && node.startIndex !== null && node.endIndex !== null) {
					const start = node.startIndex;
					const end = node.endIndex + 1;
					fields.push({ id: `${identity}@${start}:${end}`, path, text: node.data, start, end });
				} else if ("children" in node && node.type !== "script" && node.type !== "style")
					nodes.unshift(...node.children);
			}
			return;
		}
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			value.forEach((item, index) =>
				visit(
					item,
					`${path}/${index}`,
					key,
					`${identity}/${pointer(item && typeof item === "object" && typeof item.id === "string" ? item.id : String(index))}`,
				),
			);
			return;
		}
		if ("hidden" in value && value.hidden === true) return;
		for (const [childKey, child] of Object.entries(value)) {
			if (TEXT_FIELDS.has(childKey) || ["items", "roles", "website", "customFields", "dates"].includes(childKey))
				visit(child, `${path}/${pointer(childKey)}`, childKey, `${identity}/${pointer(childKey)}`);
		}
	};
	visit(data.basics, "/basics");
	visit(data.summary, "/summary");
	for (const [key, section] of Object.entries(data.sections)) visit(section, `/sections/${pointer(key)}`);
	data.customSections.forEach((section, index) => {
		if (section.type !== "cover-letter")
			visit(section, `/customSections/${index}`, "", `/customSections/${pointer(section.id)}`);
	});
	return fields;
}

/** Only complete, current text mappings produce a proposal; markup, links and all other data stay byte-for-byte. */
export function proposeTranslation(
	data: ResumeData,
	input: { locale: string; fields: { id: string; before: string; text: string }[]; why: string },
	title: string,
): ProposeEditsOutput {
	if (input.locale !== data.metadata.page.locale)
		throw new Error("Choose Translate into… to create a copy in that language first.");
	const fields = translationFields(data);
	if (tooLarge(fields) || tooLarge(input.fields))
		throw new Error("This resume is too large to translate in one review. Translate a smaller copy instead.");
	const supplied = new Map(input.fields.map((field) => [field.id, field]));
	if (
		supplied.size !== input.fields.length ||
		supplied.size !== fields.length ||
		fields.some((field) => supplied.get(field.id)?.before !== field.text)
	)
		throw new Error(
			"Translation is incomplete or the resume changed. Read it again and include every translation field, keeping unchanged names too.",
		);
	const grouped = new Map<string, TranslationField[]>();
	for (const field of fields) grouped.set(field.path, [...(grouped.get(field.path) ?? []), field]);
	const before: string[] = [];
	const after: string[] = [];
	const operations: Parameters<typeof applyResumePatches>[1] = [];
	const unsupported: NonNullable<ProposeEditsOutput["edits"][number]["unsupported"]> = [];
	for (const [path, targets] of grouped) {
		let original: unknown = data;
		for (const segment of path.slice(1).split("/"))
			original = (original as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
		if (typeof original !== "string") throw new Error("This translation field changed. Read the resume again.");
		let next = original;
		for (const field of [...targets].reverse()) {
			const translated = supplied.get(field.id)?.text;
			if (translated === undefined) throw new Error("Missing translation field.");
			if (translated === field.text) continue;
			// Translated labels may also be proper names; the reviewer confirms those changes explicitly.
			if (NAME_FIELDS.has(path.split("/").at(-1) ?? "")) unsupported.push({ kind: "term", text: translated });
			before.push(`${locationOf(path)}\n${field.text}`);
			after.push(`${locationOf(path)}\n${translated}`);
			unsupported.push(
				...unverifiedClaims(translated, { entry: field.text, document: field.text }).filter(
					(claim) => claim.kind === "figure",
				),
			);
			next =
				field.start === undefined
					? translated
					: next.slice(0, field.start) + escapeHtml(translated) + next.slice(field.end);
		}
		if (next !== original) operations.push({ op: "replace", path, value: next });
	}
	const next = applyResumePatches(data, operations);
	return {
		title,
		skipped: [],
		edits: operations.length
			? [
					{
						id: generateId(),
						target: { sectionId: "resume", field: "data" },
						location: "Resume",
						before: before.join("\n\n"),
						after: after.join("\n\n"),
						why: input.why,
						status: "pending",
						snapshot: { before: translationSnapshot(data), after: translationSnapshot(next) },
						...(unsupported.length ? { unsupported, addsClaims: true } : {}),
					},
				]
			: [],
	};
}
