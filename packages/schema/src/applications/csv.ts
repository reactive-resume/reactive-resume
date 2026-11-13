import type { ApplicationClosedReason, ApplicationStatus, Contact, PostingSource } from "./data";
import type { ApplicationLane } from "./lanes";
import {
	applicationClosedReasonSchema,
	applicationStatusSchema,
	contactSchema,
	postingSourceSchema,
	STAGES,
} from "./data";

export const CSV_SAMPLE =
	"Company,Role,Stage,Application Date,Stage Date,Location,Salary,Source,Tags,Contact Name,Contact Email,Contact Phone\nStripe,Frontend Engineer,applied,2026-07-01,2026-07-01,Remote,$180k,LinkedIn,remote;react,Jane Doe,jane@example.com,+1 555 0100";

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

/** A lane named in a CSV, by what it counts as; another account's IDs are never trusted. */
export type CsvLane = {
	label: string;
	category: ApplicationStatus;
	closedReason: ApplicationClosedReason | null;
	unclassified?: boolean;
};

type ParsedApplication = {
	company: string;
	role: string;
	status?: ApplicationStatus;
	/** The outcome of a closed application: from a "Rejected" or "Ghosted" stage, or a Closed Reason column. */
	closedReason?: ApplicationClosedReason;
	lane?: CsvLane;
	location?: string;
	salary?: string;
	source?: string;
	notes?: string;
	sourceUrl?: string;
	jobDescription?: string;
	postingSource?: PostingSource;
	stageEnteredAt?: string;
	applicationDate?: string;
	tags?: string[];
	contacts?: Contact[];
};

type CsvApplication = ParsedApplication & {
	contactName?: string;
	contactRole?: string;
	contactType?: string;
	contactEmail?: string;
	contactPhone?: string;
	/** Exports from before the closed stage mark archived applications here. */
	archived?: string;
	laneLabel?: string;
	laneCategory?: ApplicationStatus;
	laneClosedReason?: ApplicationClosedReason;
};

/** A column's destination, or null to leave the column out. */
export type CsvField = Exclude<keyof CsvApplication, "lane">;

function dateOnly(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
	return date.toISOString().slice(0, 10) === value ? value : undefined;
}

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Whether a column's slash dates are day-first (15/09/2026). Decided once per column: any first number above 12 makes
 * the column day-first; otherwise it reads month-first (10/15/2026), as US trackers export.
 */
function slashDatesDayFirst(values: readonly string[]) {
	// Only a real day-first date votes: "31/02/2026" can't be one, so it doesn't turn the column around.
	return values.some(
		(value) => Number(SLASH_DATE.exec(value.trim())?.[1] ?? 0) > 12 && readCsvDate(value.trim(), true) !== undefined,
	);
}

/** A date as other trackers write it (2026-10-15, 10/15/2026, 15/10/2026, 15.10.2026), as `YYYY-MM-DD`. */
function readCsvDate(value: string, dayFirst = false) {
	const pad = (number: string) => number.padStart(2, "0");
	const iso = dateOnly(value);
	if (iso) return iso;
	const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
	if (dotted) return dateOnly(`${dotted[3]}-${pad(dotted[2] ?? "")}-${pad(dotted[1] ?? "")}`);
	const slashed = SLASH_DATE.exec(value);
	if (!slashed) return undefined;
	const [, first = "", second = "", year] = slashed;
	return dayFirst ? dateOnly(`${year}-${pad(second)}-${pad(first)}`) : dateOnly(`${year}-${pad(first)}-${pad(second)}`);
}

/** Stage names other trackers use, as a stage and, for a closed one, its outcome. */
const STAGE_ALIASES: Record<string, { status: ApplicationStatus; closedReason?: ApplicationClosedReason }> = {
	wishlist: { status: "saved" },
	wishlisted: { status: "saved" },
	bookmarked: { status: "saved" },
	"to apply": { status: "saved" },
	"phone screen": { status: "screening" },
	"recruiter screen": { status: "screening" },
	"recruiter call": { status: "screening" },
	screen: { status: "screening" },
	interviewing: { status: "interview" },
	"offer received": { status: "offer" },
	rejected: { status: "closed", closedReason: "not-selected" },
	declined: { status: "closed", closedReason: "not-selected" },
	"not selected": { status: "closed", closedReason: "not-selected" },
	ghosted: { status: "closed", closedReason: "no-response" },
	"no response": { status: "closed", closedReason: "no-response" },
	withdrawn: { status: "closed", closedReason: "withdrew" },
	withdrew: { status: "closed", closedReason: "withdrew" },
	hired: { status: "closed", closedReason: "accepted" },
	accepted: { status: "closed", closedReason: "accepted" },
};

// Header aliases → canonical field. Matched case-insensitively after trimming.
const HEADER_ALIASES: Record<string, CsvField> = {
	company: "company",
	employer: "company",
	organization: "company",
	role: "role",
	title: "role",
	position: "role",
	"job title": "role",
	status: "status",
	stage: "status",
	"applied date": "applicationDate",
	"application date": "applicationDate",
	"date applied": "applicationDate",
	"applied on": "applicationDate",
	"closed reason": "closedReason",
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
	"job description": "jobDescription",
	"posting source": "postingSource",
	tags: "tags",
	"contact name": "contactName",
	"contact role": "contactRole",
	"contact type": "contactType",
	"contact email": "contactEmail",
	"contact phone": "contactPhone",
	archived: "archived",
	lane: "laneLabel",
	"lane category": "laneCategory",
	"lane closed reason": "laneClosedReason",
};

/** The fields a column can be matched to, in the order the match list offers them. */
export const CSV_FIELDS: readonly CsvField[] = [
	"company",
	"role",
	"status",
	"laneLabel",
	"laneCategory",
	"laneClosedReason",
	"closedReason",
	"stageEnteredAt",
	"applicationDate",
	"location",
	"salary",
	"source",
	"sourceUrl",
	"jobDescription",
	"postingSource",
	"notes",
	"tags",
	"contactName",
	"contactRole",
	"contactType",
	"contactEmail",
	"contactPhone",
	"archived",
];

/** Each header's field by name (case and spacing ignored), or null when nothing matches. */
export const autoMapHeaders = (headers: readonly string[]): (CsvField | null)[] =>
	headers.map((header) => HEADER_ALIASES[header.trim().toLowerCase()] ?? null);

const csvLine = (cells: readonly string[]) => cells.map(csvCell).join(",");

/** Rows back to CSV text (for downloading the rows an import skipped), header first. */
export const rowsToCsv = (headers: readonly string[], rows: readonly string[][]) =>
	`${[headers, ...rows].map(csvLine).join("\r\n")}\r\n`;

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
	/** The source rows left out (no company or role), to download and fix. */
	skippedRows: string[][];
	contactsSkipped: number;
	invalidValues: {
		row: number;
		field:
			| "status"
			| "stageEnteredAt"
			| "applicationDate"
			| "postingSource"
			| "laneCategory"
			| "laneClosedReason"
			| "closedReason";
		value: string;
	}[];
	headers: string[];
	recognized: string[];
};

// Maps parsed CSV rows to application inputs using the header row. Rows missing company or role
// are skipped (and counted). Invalid stages, dates and metadata require correction before import. A contact that fails
// validation (bad email, or contact columns with no name) is dropped on its own — the application
// still imports, since losing the whole row would silently discard company/role/salary/tags too.
export function mapCsvToApplications(
	table: string[][],
	mapping?: readonly (CsvField | null)[],
	preserveStageNames = false,
): CsvMapResult {
	const [headerRow, ...dataRows] = table;
	if (!headerRow)
		return {
			rows: [],
			skipped: 0,
			skippedRows: [],
			contactsSkipped: 0,
			invalidValues: [],
			headers: [],
			recognized: [],
		};

	const headers = headerRow.map((h) => h.trim());
	// The confirmed match, else the automatic one.
	const fieldFor = mapping ?? autoMapHeaders(headers);
	const recognized = [...new Set(fieldFor.filter((f): f is CsvField => !!f))];
	// Older exports also carry an Archived column.
	const isReactiveResumeExport = ["Stage History", "Timeline", "Created At", "Updated At"].every((header) =>
		headers.includes(header),
	);

	const rows: ParsedApplication[] = [];
	const skippedRows: string[][] = [];
	let contactsSkipped = 0;
	const invalidValues: CsvMapResult["invalidValues"] = [];

	// Slash dates are read the same way down each column: day-first when any of them can only be.
	const dayFirst = new Map(
		fieldFor.flatMap((field, column) =>
			field === "stageEnteredAt" || field === "applicationDate"
				? [[column, slashDatesDayFirst(dataRows.map((row) => row[column] ?? ""))] as const]
				: [],
		),
	);

	for (const [index, raw] of dataRows.entries()) {
		const record: Partial<CsvApplication> = {};
		const invalid: CsvMapResult["invalidValues"] = [];
		raw.forEach((rawValue, i) => {
			const field = fieldFor[i];
			if (!field) return;
			const value = (isReactiveResumeExport ? stripFormulaGuard(rawValue) : rawValue).trim();
			if (!value) return;
			if (field === "tags") record.tags = parseTags(value);
			else if (field === "status") {
				if (preserveStageNames) record.laneLabel ??= value.slice(0, 80);
				// Other trackers' names ("Phone Screen", "Ghosted", "Rejected") read as a stage and outcome.
				const stage = value
					.toLowerCase()
					.replace(/[\s_-]+/g, " ")
					.trim();
				// Own entries only: "constructor" isn't a stage name.
				const alias = Object.hasOwn(STAGE_ALIASES, stage) ? STAGE_ALIASES[stage] : undefined;
				const parsed = applicationStatusSchema.safeParse(stage);
				if (alias) {
					record.status = alias.status;
					if (alias.closedReason) record.closedReason ??= alias.closedReason;
				} else if (parsed.success) record.status = parsed.data;
				else record.laneLabel ??= value.slice(0, 80);
			} else if (field === "closedReason") {
				const parsed = applicationClosedReasonSchema.safeParse(value.toLowerCase().replace(/\s+/g, "-"));
				if (parsed.success) record.closedReason = parsed.data;
				else invalid.push({ row: index + 2, field, value });
			} else if (field === "laneCategory") {
				const parsed = applicationStatusSchema.safeParse(value.toLowerCase());
				if (parsed.success) record.laneCategory = parsed.data;
				else invalid.push({ row: index + 2, field, value });
			} else if (field === "laneClosedReason") {
				const parsed = applicationClosedReasonSchema.safeParse(value.toLowerCase());
				if (parsed.success) record.laneClosedReason = parsed.data;
				else invalid.push({ row: index + 2, field, value });
			} else if (field === "laneLabel") record.laneLabel = value.slice(0, 80);
			else if (field === "stageEnteredAt" || field === "applicationDate") {
				const date = readCsvDate(value, dayFirst.get(i) ?? false);
				if (date !== undefined) record[field] = date;
				else invalid.push({ row: index + 2, field, value });
			} else if (field === "postingSource") {
				try {
					const source = postingSourceSchema.safeParse(JSON.parse(value));
					if (source.success) record.postingSource = source.data;
					else invalid.push({ row: index + 2, field, value });
				} catch {
					invalid.push({ row: index + 2, field, value });
				}
			} else if (field === "jobDescription") record.jobDescription = value.slice(0, 20_000);
			else record[field] = value as never;
		});

		if (!record.company || !record.role) {
			skippedRows.push(raw);
			continue;
		}
		if (record.applicationDate && record.stageEnteredAt && record.stageEnteredAt < record.applicationDate)
			invalid.push({ row: index + 2, field: "stageEnteredAt", value: record.stageEnteredAt });
		if (invalid.length > 0) {
			invalidValues.push(...invalid);
			continue;
		}

		const {
			contactName,
			contactRole,
			contactType,
			contactEmail,
			contactPhone,
			archived,
			laneLabel,
			laneCategory,
			laneClosedReason,
			...application
		} = record;
		// Archived applications from older exports are closed ones.
		if (archived?.toLowerCase() === "true") application.status = "closed";
		if (laneLabel) {
			const category = laneCategory ?? application.status ?? "saved";
			// A lane must count as the row's stage; a preset outcome only belongs to a Closed lane.
			if ((application.status && application.status !== category) || (laneClosedReason && category !== "closed")) {
				invalidValues.push({ row: index + 2, field: "laneCategory", value: laneCategory ?? category });
				continue;
			}
			const unclassified = !laneCategory && !application.status;
			if (!unclassified) application.status = category;
			application.lane = {
				label: laneLabel,
				category,
				closedReason: laneClosedReason ?? (preserveStageNames ? application.closedReason : null) ?? null,
				...(unclassified ? { unclassified: true } : {}),
			};
		}
		// An outcome belongs only to a closed application (a lane may have just made it one).
		if (application.closedReason && application.status !== "closed") delete application.closedReason;
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

	return { rows, skipped: skippedRows.length, skippedRows, contactsSkipped, invalidValues, headers, recognized };
}

const laneKey = (lane: CsvLane) => `${lane.category}|${lane.closedReason ?? ""}|${lane.label.trim().toLowerCase()}`;

/** The distinct lanes the rows name, each to be matched to one of this account's lanes or created. */
export function collectCsvLanes(rows: readonly { lane?: CsvLane }[]): (CsvLane & { key: string })[] {
	const found = new Map<string, CsvLane & { key: string }>();
	for (const { lane } of rows)
		if (lane && !found.has(laneKey(lane))) found.set(laneKey(lane), { ...lane, key: laneKey(lane) });
	return [...found.values()];
}

/** This account's lanes a CSV lane may go to: active, counting the same, with the same preset outcome. */
export const compatibleLanes = (csvLane: CsvLane, lanes: readonly ApplicationLane[]) =>
	lanes.filter(
		(lane) =>
			!lane.retiredAt &&
			(csvLane.unclassified || (lane.category === csvLane.category && lane.closedReason === csvLane.closedReason)),
	);

/** A suggested match: a compatible lane with the same name (default lanes by their standard name), else none. */
export function suggestLane(csvLane: CsvLane, lanes: readonly ApplicationLane[]): string | null {
	const name = csvLane.label.trim().toLowerCase();
	return (
		compatibleLanes(csvLane, lanes).find((lane) => (lane.label ?? stageName(lane.category)).toLowerCase() === name)
			?.id ?? null
	);
}

const stageName = (stage: ApplicationStatus) => STAGES.find((item) => item.value === stage)?.label ?? stage;

/** The row's lane by the confirmed match; rows without a lane keep their stage. */
export function applyLaneMapping<T extends { lane?: CsvLane }>(
	rows: readonly T[],
	laneIds: ReadonlyMap<string, string>,
): (Omit<T, "lane"> & { laneId?: string; closedReason?: ApplicationClosedReason })[] {
	return rows.map(({ lane, ...row }) => {
		const laneId = lane ? laneIds.get(laneKey(lane)) : undefined;
		return {
			...row,
			...(laneId ? { laneId } : {}),
			...(lane?.closedReason ? { closedReason: lane.closedReason } : {}),
		};
	});
}

export function csvCell(value: string): string {
	// Quote every cell to contain separators/newlines. Prefix formula-triggering values,
	// including whitespace-obscured and full-width variants, so spreadsheets read text.
	const safe = isFormulaLike(value) ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}
