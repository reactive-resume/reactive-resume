import type { ApplicationStatus, Contact } from "@reactive-resume/schema/applications/data";
import type { Application } from "./types";
import {
	applicationStatusSchema,
	contactSchema,
	INTERVIEW_KINDS,
	STAGES,
} from "@reactive-resume/schema/applications/data";

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""), commas and
// newlines inside quotes, and \r\n. Enough for spreadsheet exports; not a full streaming parser.
export function parseCsv(input: string): string[][] {
	// Strip a UTF-8 BOM (Excel prepends one) — trim() doesn't remove ﻿, so the first header
	// would otherwise become "﻿company" and never match an alias.
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
	// Flush the trailing field/row if the file didn't end in a newline.
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

type ParsedApplication = {
	company: string;
	role: string;
	status?: ApplicationStatus;
	location?: string;
	salary?: string;
	source?: string;
	notes?: string;
	sourceUrl?: string;
	stageEnteredAt?: string;
	tags?: string[];
	contacts?: Contact[];
};

type CsvApplication = ParsedApplication & {
	contactName?: string;
	contactRole?: string;
	contactType?: string;
	contactEmail?: string;
	contactPhone?: string;
};

function dateOnly(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
	return date.toISOString().slice(0, 10) === value ? value : undefined;
}

// Header aliases → canonical field. Matched case-insensitively after trimming.
const HEADER_ALIASES: Record<string, keyof CsvApplication> = {
	company: "company",
	employer: "company",
	organization: "company",
	role: "role",
	title: "role",
	position: "role",
	"job title": "role",
	status: "status",
	stage: "status",
	"applied date": "stageEnteredAt",
	"stage date": "stageEnteredAt",
	"stage entered at": "stageEnteredAt",
	location: "location",
	salary: "salary",
	"salary range": "salary",
	compensation: "salary",
	source: "source",
	notes: "notes",
	note: "notes",
	url: "sourceUrl",
	link: "sourceUrl",
	"job url": "sourceUrl",
	"job posting": "sourceUrl",
	tags: "tags",
	"contact name": "contactName",
	"contact role": "contactRole",
	"contact type": "contactType",
	"contact email": "contactEmail",
	"contact phone": "contactPhone",
};

// Values a spreadsheet would evaluate as a formula: leading =, +, -, @ (and full-width variants),
// possibly hidden behind whitespace/control characters, or a leading tab/newline.
function isFormulaLike(value: string) {
	return /^[\s\p{Cc}]*[=+@\-＝＋－＠]/u.test(value) || /^[\t\r\n]/.test(value);
}

// Drops the apostrophe the export adds as a CSV-injection guard, so a re-imported cell reads back
// as the value that was exported. A user value that genuinely starts with an apostrophe is only
// touched when the rest would also have been guarded — the same ambiguity spreadsheets have.
function stripFormulaGuard(value: string) {
	return value.startsWith("'") && isFormulaLike(value.slice(1)) ? value.slice(1) : value;
}

function parseTags(value: string) {
	try {
		const parsed: unknown = JSON.parse(value);
		if (Array.isArray(parsed) && parsed.every((tag): tag is string => typeof tag === "string")) {
			return parsed.map((tag) => tag.trim()).filter(Boolean);
		}
	} catch {
		// Preserve support for existing comma, semicolon, and pipe-delimited imports.
	}

	return value
		.split(/[;,|]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
}

export type CsvMapResult = {
	rows: ParsedApplication[];
	skipped: number;
	contactsSkipped: number;
	headers: string[];
	recognized: string[];
};

// Maps parsed CSV rows to application inputs using the header row. Rows missing company or role
// are skipped (and counted). Status is coerced to a valid stage or dropped. A contact that fails
// validation (bad email, or contact columns with no name) is dropped on its own — the application
// still imports, since losing the whole row would silently discard company/role/salary/tags too.
export function mapCsvToApplications(table: string[][]): CsvMapResult {
	const [headerRow, ...dataRows] = table;
	if (!headerRow) return { rows: [], skipped: 0, contactsSkipped: 0, headers: [], recognized: [] };

	const headers = headerRow.map((h) => h.trim());
	const fieldFor = headers.map((h) => HEADER_ALIASES[h.toLowerCase()]);
	const recognized = [...new Set(fieldFor.filter((f): f is keyof CsvApplication => !!f))];
	const isReactiveResumeExport = ["Stage History", "Timeline", "Archived", "Created At", "Updated At"].every((header) =>
		headers.includes(header),
	);

	const rows: ParsedApplication[] = [];
	let skipped = 0;
	let contactsSkipped = 0;

	for (const raw of dataRows) {
		const record: Partial<CsvApplication> = {};
		fieldFor.forEach((field, i) => {
			if (!field) return;
			const rawValue = raw[i] ?? "";
			const value = (isReactiveResumeExport ? stripFormulaGuard(rawValue) : rawValue).trim();
			if (!value) return;
			if (field === "tags") record.tags = parseTags(value);
			else if (field === "status") {
				const parsed = applicationStatusSchema.safeParse(value.toLowerCase());
				if (parsed.success) record.status = parsed.data;
			} else if (field === "stageEnteredAt") {
				record.stageEnteredAt = dateOnly(value);
			} else record[field] = value as never;
		});

		if (!record.company || !record.role) {
			skipped++;
			continue;
		}

		const { contactName, contactRole, contactType, contactEmail, contactPhone, ...application } = record;
		if (contactName || contactRole || contactType || contactEmail || contactPhone) {
			const contact = contactSchema.safeParse({
				name: contactName,
				role: contactRole ?? "",
				type: contactType ?? "",
				email: contactEmail ?? "",
				phone: contactPhone ?? "",
			});
			if (contact.success) application.contacts = [contact.data];
			else contactsSkipped++;
		}
		rows.push(application as ParsedApplication);
	}

	return { rows, skipped, contactsSkipped, headers, recognized };
}

export type ApplicationExportOptions = {
	scope: "filtered" | "all";
	from?: string;
	to?: string;
};

export function selectApplicationsForExport(
	applications: readonly Application[],
	filtered: readonly Application[],
	{ scope, from, to }: ApplicationExportOptions,
): Application[] {
	return (scope === "all" ? applications : filtered).filter((application) => {
		const date = new Date(application.appliedAt).toISOString().slice(0, 10);
		return (!from || date >= from) && (!to || date <= to);
	});
}

function csvCell(value: string): string {
	// Quote every cell to contain separators/newlines. Prefix formula-triggering values,
	// including whitespace-obscured and full-width variants, so spreadsheets read text.
	const safe = isFormulaLike(value) ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function exportApplicationsCsv(applications: readonly Application[]): string {
	const headers = [
		"Company",
		"Role",
		"Stage",
		"Stage Date",
		"Application Date",
		"Location",
		"Salary",
		"Source",
		"URL",
		"Tags",
		"Contacts",
		"Notes",
		"Stage History",
		"Timeline",
		"Archived",
		"Created At",
		"Updated At",
	];
	const dateOnly = (date: Date) => new Date(date).toISOString().slice(0, 10);
	const stageLabel = (stage: ApplicationStatus) => STAGES.find((item) => item.value === stage)?.label ?? stage;
	const timelineText = (entry: Application["activity"][number]) => {
		if (entry.type === "stage") return stageLabel(entry.stage);
		if (entry.type === "note") return entry.text;
		const kind = INTERVIEW_KINDS.find((item) => item.value === entry.kind)?.label ?? entry.kind;
		return `${kind} interview (${new Date(entry.at).toISOString()})`;
	};
	const rows = applications.map((application) => {
		const timeline = [...application.activity].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
		const stages = timeline.filter((entry) => entry.type === "stage");
		const currentStage = stages.findLast((entry) => entry.stage === application.status);
		return [
			application.company,
			application.role,
			application.status,
			currentStage ? dateOnly(currentStage.at) : "",
			dateOnly(application.appliedAt),
			application.location ?? "",
			application.salary ?? "",
			application.source ?? "",
			application.sourceUrl ?? "",
			application.tags.length > 0 ? JSON.stringify(application.tags) : "",
			application.contacts
				.map(({ name, role, type }) => {
					const details = [role, type].filter(Boolean).join(", ");
					return details ? `${name} (${details})` : name;
				})
				.join("\n"),
			application.notes ?? "",
			stages.map((entry) => `${stageLabel(entry.stage)} (${dateOnly(entry.at)})`).join(" → "),
			timeline.map((entry) => `${dateOnly(entry.at)}: ${timelineText(entry)}`).join("\n"),
			String(application.archived),
			new Date(application.createdAt).toISOString(),
			new Date(application.updatedAt).toISOString(),
		];
	});
	// UTF-8 BOM lets spreadsheet apps recognize international names without an import wizard.
	return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
