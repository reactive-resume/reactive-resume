import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { unzipSync } from "fflate";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { formatPeriod, formatSingleDate } from "./date";
import { rethrowAsImportError } from "./error";
import { toHtmlDescription } from "./html";
import { parseLevel } from "./level";

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
// Converts them to the partial-ISO strings formatPeriod/formatSingleDate expect ("YYYY-MM"/"YYYY").
function parseLinkedInDate(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	const monthYear = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(trimmed);
	if (monthYear) {
		const month = MONTHS[(monthYear[1] ?? "").toLowerCase()];
		if (month) return `${monthYear[2]}-${month}`;
	}

	if (/^\d{4}$/.test(trimmed)) return trimmed;

	return undefined;
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""), and commas/newlines
// inside quotes. LinkedIn's export files are small, so a non-streaming parser is enough.
function parseCsv(input: string): string[][] {
	const text = input.replace(/^﻿/, "");
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
	const key = Object.keys(files).find((path) => path.toLowerCase().endsWith(fileName));
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

	try {
		files = unzipSync(zipBytes);
	} catch {
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
			"This ZIP doesn't look like a LinkedIn data export. Expected a Profile.csv, Positions.csv, or Education.csv inside it.",
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
			result.summary = { ...defaultResumeData.summary, content: `<p>${profile.Summary}</p>`, hidden: false };
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
				period: formatPeriod(parseLinkedInDate(position["Started On"]), parseLinkedInDate(position["Finished On"])),
				website: emptyWebsite,
				roles: [],
				description: toHtmlDescription(position.Description),
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
				period: formatPeriod(parseLinkedInDate(edu["Start Date"]), parseLinkedInDate(edu["End Date"])),
				website: emptyWebsite,
				description: edu.Notes ? `<p>${edu.Notes}</p>` : "",
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
				level: parseLevel(lang.Proficiency),
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
				date: formatSingleDate(parseLinkedInDate(cert["Started On"])),
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
