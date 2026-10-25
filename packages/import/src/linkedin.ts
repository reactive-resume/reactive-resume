import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { formatDate, toRangeDates, toSingleDates } from "./date";
import { rethrowAsImportError } from "./error";
import { toHtml } from "./html";
import { parseLevel } from "./level";
import { ZipEntryTooLargeError, unzipEntries } from "./zip";

const LINKEDIN_CSVS = new Set([
	"profile.csv",
	"positions.csv",
	"education.csv",
	"skills.csv",
	"languages.csv",
	"certifications.csv",
]);

// Real LinkedIn CSVs are kilobytes; the cap keeps a crafted archive from exhausting the tab's memory.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

// LinkedIn's five fixed proficiency options, mapped onto the 0-5 level scale.
const LANGUAGE_LEVELS: Record<string, number> = {
	"native or bilingual": 5,
	"full professional": 4,
	"professional working": 3,
	"limited working": 2,
	elementary: 1,
};

// Own keys only: a proficiency like "constructor" must not resolve to an Object member.
const knownLanguageLevel = (name: string) => (Object.hasOwn(LANGUAGE_LEVELS, name) ? LANGUAGE_LEVELS[name] : undefined);

const MONTHS: Record<string, string> = {
	jan: "01",
	feb: "02",
	mar: "03",
	apr: "04",
	may: "05",
	jun: "06",
	jul: "07",
	aug: "08",
	sep: "09",
	oct: "10",
	nov: "11",
	dec: "12",
};

// LinkedIn's "Started On" / "Finished On" cells are "Mon YYYY" (e.g. "Jan 2020") or a bare year.
// Anything else is kept verbatim rather than dropped.
// LinkedIn writes "Jan 2020" (or a bare year); anything else stays as written and asks for a review.
function toLinkedInIsoDate(value = ""): string | null {
	const trimmed = value.trim();
	if (/^\d{4}$/.test(trimmed)) return trimmed;
	const monthYear = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(trimmed);
	const month = MONTHS[monthYear?.[1]?.toLowerCase() ?? ""];
	return monthYear && month ? `${monthYear[2]}-${month}` : null;
}

function formatLinkedInDate(value = ""): string {
	const iso = toLinkedInIsoDate(value);
	return iso ? formatDate(iso) : value.trim();
}

// Only an empty end cell means the entry is ongoing; an unrecognised one must not read as "Present".
function formatLinkedInPeriod(start?: string, end?: string): string {
	const from = formatLinkedInDate(start);
	const to = formatLinkedInDate(end);
	if (!from) return to;
	return `${from} - ${to || "Present"}`;
}

// Dates only when every cell was read; otherwise the text is read (and flagged if need be) when saved.
function linkedInPeriodDates(start?: string, end?: string): ResumeDates | undefined {
	const from = toLinkedInIsoDate(start);
	const to = toLinkedInIsoDate(end);
	if (!from || (end?.trim() && !to)) return undefined;
	return toRangeDates(from, to ?? undefined);
}

function linkedInSingleDates(value?: string): ResumeDates | undefined {
	const iso = toLinkedInIsoDate(value);
	return iso ? toSingleDates(iso) : undefined;
}

const textToHtml = (text = "") => toHtml(text.split(/\r\n?|\n/));

const languageLevel = (proficiency = "") =>
	// The lookbehind starts the match only at a whitespace run's first character, keeping long runs linear.
	knownLanguageLevel(proficiency.toLowerCase().replace(/(?<!\s)\s*proficiency$/, "")) ?? parseLevel(proficiency);

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1).toLowerCase();

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""), and commas/newlines
// inside quotes. LinkedIn's export files are small, so a non-streaming parser is enough.
// No BOM handling needed: TextDecoder strips a leading UTF-8 BOM before the text gets here.
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (inQuotes) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') inQuotes = true;
		else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}

	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsToRecords(rows: string[][]): Record<string, string>[] {
	if (rows.length === 0) return [];
	const header = rows[0] ?? [];
	const body = rows.slice(1);
	return body.map((row) => Object.fromEntries(header.map((key, i) => [key.trim(), (row[i] ?? "").trim()])));
}

function findCsv(files: Record<string, Uint8Array>, fileName: string): Record<string, string>[] {
	const decoder = new TextDecoder();
	const key = Object.keys(files).find((path) => basename(path) === fileName);
	if (!key) return [];
	return rowsToRecords(parseCsv(decoder.decode(files[key])));
}

const emptyWebsite = { url: "", label: "", inlineLink: false };
const linkWebsite = (url?: string) => (url ? { url, label: url, inlineLink: false } : emptyWebsite);

/**
 * Converts LinkedIn's "Download your data" export (a ZIP of per-topic CSVs) into ResumeData.
 * Only the CSVs relevant to a resume are read; the rest of the export is ignored.
 */
export function parseLinkedInExport(zipBytes: Uint8Array): ResumeData {
	let files: Record<string, Uint8Array>;
	const selected = new Set<string>();

	try {
		// Only inflate the first copy of each CSV we read; the rest of the export (messages, media, ...) can be large.
		files = unzipEntries(
			zipBytes,
			(name) => {
				const file = basename(name);
				if (!LINKEDIN_CSVS.has(file) || selected.has(file)) return false;
				selected.add(file);
				return true;
			},
			MAX_CSV_BYTES,
		);
	} catch (error) {
		if (error instanceof ZipEntryTooLargeError) {
			throw new Error(
				`"${error.entry}" in this ZIP is larger than 5 MB, which is too large for a LinkedIn data export. Upload the ZIP exactly as LinkedIn provided it.`,
			);
		}
		throw new Error(
			'This file could not be read as a ZIP archive. Export your data from LinkedIn\'s "Get a copy of your data" page and upload the ZIP as-is.',
		);
	}

	const profile = findCsv(files, "profile.csv")[0];
	const positions = findCsv(files, "positions.csv");
	const education = findCsv(files, "education.csv");
	const skills = findCsv(files, "skills.csv");
	const languages = findCsv(files, "languages.csv");
	const certifications = findCsv(files, "certifications.csv");

	if (!profile && positions.length === 0 && education.length === 0) {
		throw new Error(
			"This ZIP isn't a LinkedIn data export. Upload the ZIP from LinkedIn's \"Get a copy of your data\" page; it includes Profile.csv, Positions.csv or Education.csv.",
		);
	}

	// structuredClone, not a shallow spread: `result.sections.x = ...` below would otherwise
	// mutate defaultResumeData's shared nested objects and leak into the next import call.
	const result: ResumeData = structuredClone(defaultResumeData);

	if (profile) {
		result.basics = {
			...defaultResumeData.basics,
			name: [profile["First Name"], profile["Last Name"]].filter(Boolean).join(" "),
			headline: profile.Headline || "",
			location: profile["Geo Location"] || "",
			website: { url: "", label: "" },
		};

		if (profile.Summary) {
			result.summary = { ...defaultResumeData.summary, content: textToHtml(profile.Summary), hidden: false };
		}
	}

	const companies = positions.filter((position) => position["Company Name"]);
	if (companies.length > 0) {
		result.sections.experience = {
			...defaultResumeData.sections.experience,
			items: companies.map((position) => ({
				id: generateId(),
				hidden: false,
				company: position["Company Name"] ?? "",
				position: position.Title || "",
				location: position.Location || "",
				period: formatLinkedInPeriod(position["Started On"], position["Finished On"]),
				dates: linkedInPeriodDates(position["Started On"], position["Finished On"]),
				website: emptyWebsite,
				roles: [],
				description: textToHtml(position.Description),
			})),
		};
	}

	const schools = education.filter((edu) => edu["School Name"]);
	if (schools.length > 0) {
		result.sections.education = {
			...defaultResumeData.sections.education,
			items: schools.map((edu) => ({
				id: generateId(),
				hidden: false,
				school: edu["School Name"] ?? "",
				degree: edu["Degree Name"] || "",
				area: "",
				grade: "",
				location: "",
				period: formatLinkedInPeriod(edu["Start Date"], edu["End Date"]),
				dates: linkedInPeriodDates(edu["Start Date"], edu["End Date"]),
				website: emptyWebsite,
				description: textToHtml(edu.Notes),
			})),
		};
	}

	const namedSkills = skills.filter((skill) => skill.Name);
	if (namedSkills.length > 0) {
		result.sections.skills = {
			...defaultResumeData.sections.skills,
			items: namedSkills.map((skill) => ({
				id: generateId(),
				hidden: false,
				icon: "star",
				iconColor: "",
				name: skill.Name ?? "",
				proficiency: "",
				level: 0,
				keywords: [],
			})),
		};
	}

	const namedLanguages = languages.filter((lang) => lang.Name);
	if (namedLanguages.length > 0) {
		result.sections.languages = {
			...defaultResumeData.sections.languages,
			items: namedLanguages.map((lang) => ({
				id: generateId(),
				hidden: false,
				language: lang.Name ?? "",
				fluency: lang.Proficiency || "",
				level: languageLevel(lang.Proficiency),
			})),
		};
	}

	const namedCertifications = certifications.filter((cert) => cert.Name);
	if (namedCertifications.length > 0) {
		result.sections.certifications = {
			...defaultResumeData.sections.certifications,
			items: namedCertifications.map((cert) => ({
				id: generateId(),
				hidden: false,
				title: cert.Name ?? "",
				issuer: cert.Authority || "",
				date: formatLinkedInDate(cert["Started On"]),
				dates: linkedInSingleDates(cert["Started On"]),
				website: linkWebsite(cert.Url),
				description: "",
			})),
		};
	}

	try {
		return resumeDataSchema.parse(result);
	} catch (error) {
		rethrowAsImportError(error);
	}
}
