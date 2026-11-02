import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { jsonrepair } from "jsonrepair";
import { flattenError, ZodError } from "zod";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { buildAiExtractionTemplate } from "./extraction-template";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const aiExtractionTemplate = buildAiExtractionTemplate();

type SectionKey = keyof typeof sectionRequiredFieldMap;

type CoercionEntry = {
	path: string;
	fromType: string;
	toType: string;
};

type DroppedSectionItemEntry = {
	section: SectionKey;
	index: number;
	reason: string;
};

type ResumeSanitizationDiagnostics = {
	coercions: CoercionEntry[];
	droppedSectionItems: DroppedSectionItemEntry[];
	salvageApplied: boolean;
};

type ResumeSanitizationResult = {
	data: ResumeData;
	diagnostics: ResumeSanitizationDiagnostics;
};

function mergeDefaultsDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const output: Record<string, unknown> = { ...target };

	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null) continue;
		const current = target[key];
		output[key] = isObject(current) && isObject(value) ? mergeDefaultsDeep(current, value) : value;
	}

	return output;
}

const sectionRequiredFieldMap = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	interests: "name",
	awards: "title",
	certifications: "title",
	publications: "title",
	volunteer: "organization",
	references: "name",
} as const;

function getValueType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function mergeDefaults<T extends Record<string, unknown>, S extends Record<string, unknown>>(
	target: T,
	source: S,
): T & S {
	if (!isObject(target) || !isObject(source)) {
		return (source !== undefined && source !== null ? source : target) as T & S;
	}

	return mergeDefaultsDeep(target, source) as T & S;
}

function coerceBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (value === 1) return true;
		if (value === 0) return false;
		return;
	}
	if (typeof value !== "string") return;

	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1") return true;
	if (normalized === "false" || normalized === "0") return false;
	return;
}

function coerceNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string") return;

	const normalized = value.trim();
	if (normalized.length === 0) return;

	const coerced = Number(normalized);
	return Number.isFinite(coerced) ? coerced : undefined;
}

function coerceValueAgainstTemplate(
	value: unknown,
	template: unknown,
	path: string,
	diagnostics: ResumeSanitizationDiagnostics,
): unknown {
	if (value === undefined || value === null) return value;
	if (template === undefined || template === null) return value;

	if (typeof template === "boolean") {
		const coerced = coerceBoolean(value);
		if (coerced === undefined) return value;
		if (coerced === value) return value;

		diagnostics.coercions.push({ path, fromType: getValueType(value), toType: "boolean" });
		return coerced;
	}

	if (typeof template === "number") {
		const coerced = coerceNumber(value);
		if (coerced === undefined) return value;
		if (coerced === value) return value;

		diagnostics.coercions.push({ path, fromType: getValueType(value), toType: "number" });
		return coerced;
	}

	if (Array.isArray(template) && Array.isArray(value)) {
		const itemTemplate = template[0];
		if (itemTemplate === undefined) return value;

		return value.map((entry, index) =>
			coerceValueAgainstTemplate(entry, itemTemplate, `${path}[${index}]`, diagnostics),
		);
	}

	if (!isObject(template) || !isObject(value)) return value;

	const output: Record<string, unknown> = { ...value };

	for (const key of Object.keys(template)) {
		if (!(key in output)) continue;

		const nextPath = path.length > 0 ? `${path}.${key}` : key;
		output[key] = coerceValueAgainstTemplate(output[key], template[key], nextPath, diagnostics);
	}

	return output;
}

function getJsonBoundaryIndices(value: string): { first: number; last: number } {
	const firstCurly = value.indexOf("{");
	const firstSquare = value.indexOf("[");
	const lastCurly = value.lastIndexOf("}");
	const lastSquare = value.lastIndexOf("]");

	let first = -1;
	if (firstCurly !== -1 && firstSquare !== -1) {
		first = Math.min(firstCurly, firstSquare);
	} else {
		first = Math.max(firstCurly, firstSquare);
	}

	return { first, last: Math.max(lastCurly, lastSquare) };
}

function normalizeResumeDataForSchema(data: Record<string, unknown>, diagnostics: ResumeSanitizationDiagnostics) {
	if (!isObject(data)) return data;
	if (!isObject(data.sections)) return data;

	const normalizedSections: Record<string, unknown> = { ...data.sections };

	for (const sectionKey of Object.keys(sectionRequiredFieldMap) as SectionKey[]) {
		const section = normalizedSections[sectionKey];
		if (!isObject(section)) continue;
		if (!Array.isArray(section.items)) continue;

		const itemTemplate = aiExtractionTemplate.sections[sectionKey].items[0] as Record<string, unknown>;
		const requiredField = sectionRequiredFieldMap[sectionKey];

		const normalizedItems = section.items
			.filter((item): item is Record<string, unknown> => isObject(item))
			.map((item) => {
				const mergedItem = mergeDefaults(itemTemplate, item);
				return coerceValueAgainstTemplate(
					mergedItem,
					itemTemplate,
					`sections.${sectionKey}.items`,
					diagnostics,
				) as Record<string, unknown>;
			})
			.filter((item, index) => {
				const requiredValue = item[requiredField];
				if (typeof requiredValue !== "string" || requiredValue.trim().length === 0) {
					diagnostics.salvageApplied = true;
					diagnostics.droppedSectionItems.push({
						section: sectionKey,
						index,
						reason: `missing required "${requiredField}"`,
					});
					return false;
				}

				return true;
			})
			.map((item) => {
				const normalizedItem = { ...item };
				if (typeof normalizedItem.id !== "string" || normalizedItem.id.trim().length === 0) {
					diagnostics.salvageApplied = true;
					normalizedItem.id = generateId();
				}
				if (typeof normalizedItem.hidden !== "boolean") {
					diagnostics.salvageApplied = true;
					normalizedItem.hidden = false;
				}

				return normalizedItem;
			});

		normalizedSections[sectionKey] = { ...section, items: normalizedItems };
	}

	return { ...data, sections: normalizedSections };
}

// The usual English heading of each section; a heading that says only this leaves the title to the template.
const usualSectionTitles: Record<string, string> = {
	summary: "summary",
	profiles: "profiles",
	experience: "experience",
	education: "education",
	projects: "projects",
	skills: "skills",
	languages: "languages",
	interests: "interests",
	awards: "awards",
	certifications: "certifications",
	publications: "publications",
	volunteer: "volunteer",
	references: "references",
};

const isAllCaps = (value: string) => value !== value.toLowerCase() && value === value.toUpperCase();

/**
 * Imported headings keep the template's case: one that only names its section ("EXPERIENCE") shows the localized
 * default, and other wording styled in capitals becomes sentence case ("SELECTED PROJECTS" → "Selected projects").
 */
export function normalizeImportedSectionTitle(sectionId: string, title: string) {
	const trimmed = title.trim();
	if (!trimmed) return "";
	if (trimmed.toLowerCase() === usualSectionTitles[sectionId]) return "";
	if (!isAllCaps(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeSectionTitles(data: ResumeData): ResumeData {
	const sections = Object.fromEntries(
		Object.entries(data.sections).map(([id, section]) => [
			id,
			{ ...section, title: normalizeImportedSectionTitle(id, section.title) },
		]),
	) as ResumeData["sections"];
	return {
		...data,
		summary: { ...data.summary, title: normalizeImportedSectionTitle("summary", data.summary.title) },
		sections,
	};
}

export function sanitizeAndParseResumeJson(resultText: string): ResumeSanitizationResult {
	let jsonString = resultText;
	const { first, last } = getJsonBoundaryIndices(jsonString);
	if (first !== -1 && last !== -1 && last >= first) {
		jsonString = jsonString.substring(first, last + 1);
	}

	try {
		const diagnostics: ResumeSanitizationDiagnostics = {
			coercions: [],
			droppedSectionItems: [],
			salvageApplied: false,
		};

		const repairedJson = jsonrepair(jsonString);
		const parsedJson = JSON.parse(repairedJson);
		const mergedData = mergeDefaults(defaultResumeData, parsedJson);
		const coercedData = coerceValueAgainstTemplate(mergedData, defaultResumeData, "", diagnostics);
		const normalizedData = normalizeResumeDataForSchema(coercedData as Record<string, unknown>, diagnostics);

		const data = resumeDataSchema.parse({
			...normalizedData,
			customSections: [],
			picture: defaultResumeData.picture,
			metadata: defaultResumeData.metadata,
		});

		return { data: normalizeSectionTitles(data), diagnostics };
	} catch (error: unknown) {
		if (error instanceof ZodError) {
			console.error("Zod validation failed during resume parsing:", flattenError(error));
			throw error;
		}

		console.error("Unknown error during resume data validation:", error);
		throw new Error("An unknown error occurred while validating the merged resume data.");
	}
}
