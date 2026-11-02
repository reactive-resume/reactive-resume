/**
 * The CV Validation Status reports the college prints: one per section, and one summarising
 * every section.
 *
 * Validation is read from each resume's current `review_status`, never from history. Status is
 * complete and unambiguous for every resume; history only started being written partway through,
 * and until recently recorded a faculty revision request and a student edit as the same action.
 * History is used for the submitted date alone, where a gap shows as a blank cell rather than a
 * wrong count.
 */

/** A reviewer has looked at the resume once it reaches any of these, whatever they decided. */
const FACULTY_VALIDATED = [
	"FACULTY_REVISION_REQUESTED",
	"FACULTY_VERIFIED",
	"FINALIZED_BY_FACULTY",
	"SUBMITTED_TO_PO",
	"PO_REVISION_REQUESTED",
	"RESUBMITTED_TO_PO",
	"PO_VERIFIED",
	"APPROVED",
];

const PO_VALIDATED = ["PO_REVISION_REQUESTED", "PO_VERIFIED", "APPROVED"];

export type ReportScope = "faculty" | "po";

type ReportResume = {
	reviewStatus?: string | null;
	submittedAt?: Date | string | null;
	updatedAt?: Date | string | null;
	isSubmitted?: boolean;
};

type ReportStudent = {
	engLabsId: string;
	name: string;
	rollNumber: string | null;
	sectionId: string;
	sectionName?: string | null;
	resumes: ReportResume[];
};

export type StudentReportRow = {
	serial: number;
	name: string;
	rollNumber: string;
	/** Printed in the "CV submitted" column; blank when the resume was never handed over. */
	submittedOn: string;
	/** "Done" once the reviewer for this scope has acted on it. */
	validated: boolean;
};

const validatedStatuses = (scope: ReportScope) => (scope === "po" ? PO_VALIDATED : FACULTY_VALIDATED);

/** The resume a report speaks for: a student's master resume is the one the college validates. */
function reportResume(student: ReportStudent): ReportResume | undefined {
	return student.resumes[0];
}

export function isValidated(resume: ReportResume | undefined, scope: ReportScope): boolean {
	if (!resume) return false;
	return validatedStatuses(scope).includes(resume.reviewStatus ?? "DRAFT");
}

/** `26-02-2026`, the form the college's own spreadsheets use. */
export function formatReportDate(value: Date | string | null | undefined): string {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/**
 * The date to print for a submitted resume.
 *
 * History is the real answer, but it only covers part of the tenant, so `updatedAt` stands in
 * where a resume is submitted by status with no history row. A soft date on a row that is
 * genuinely submitted beats a blank one that reads as "never submitted".
 */
function submittedOn(resume: ReportResume | undefined): string {
	if (!resume) return "";
	if (resume.submittedAt) return formatReportDate(resume.submittedAt);
	const stage = resume.reviewStatus ?? "DRAFT";
	if (stage === "DRAFT") return "";
	return formatReportDate(resume.updatedAt);
}

/** Every student in the section, in roll-number order, submitted or not — the college lists all. */
export function sectionReportRows(students: ReportStudent[], scope: ReportScope): StudentReportRow[] {
	return [...students]
		.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "") || a.name.localeCompare(b.name))
		.map((student, index) => {
			const resume = reportResume(student);
			return {
				serial: index + 1,
				name: student.name.toUpperCase(),
				rollNumber: student.rollNumber ?? "",
				submittedOn: submittedOn(resume),
				validated: isValidated(resume, scope),
			};
		});
}

export type SectionSummaryRow = {
	serial: number;
	/** Only set on the first row of a branch, so the printed table can group them. */
	branch: string | null;
	branchSectionCount: number;
	section: string;
	total: number;
	validated: number;
	validatedPct: string;
	modified: number | null;
	modifiedPct: string;
};

export type SummaryTotals = {
	total: number;
	validated: number;
	validatedPct: string;
	modified: number | null;
	modifiedPct: string;
};

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(2)}%` : "");

/**
 * One row per section, grouped by branch, matching the college's summary sheet.
 *
 * `modified` — students who edited after a reviewer sent the resume back — is left null until
 * RESUME_EDITED history accumulates. A zero would read as "nobody fixed anything", which is a
 * claim the data cannot yet support; the college's own sheet leaves most of this column blank too.
 */
/**
 * The branch label as the department writes it: "Automobile Engineering", not
 * "Automobile Engineering 2024".
 *
 * The batch is already named in the report title, and the branch column is the one cell allowed to
 * wrap — every extra line it takes is a line every row pays for, which is what pushes a full batch
 * of thirty sections onto a second page.
 */
export function branchLabel(parentName: string | null | undefined): string {
	return (parentName ?? "—").replace(/\s+\d{4}$/, "").trim() || "—";
}

export function summaryRows(
	sections: { id: string; name: string; parentName?: string | null; unitType: string }[],
	students: ReportStudent[],
	scope: ReportScope,
	modifiedBySection?: Map<string, number>,
): { rows: SectionSummaryRow[]; totals: SummaryTotals } {
	const studentsBySection = new Map<string, ReportStudent[]>();
	for (const student of students) {
		const list = studentsBySection.get(student.sectionId);
		if (list) list.push(student);
		else studentsBySection.set(student.sectionId, [student]);
	}

	const classes = sections
		.filter((s) => s.unitType === "CLASS" && (studentsBySection.get(s.id)?.length ?? 0) > 0)
		.sort((a, b) => (a.parentName ?? "").localeCompare(b.parentName ?? "") || a.name.localeCompare(b.name));

	const countByBranch = new Map<string, number>();
	for (const section of classes) {
		const branch = branchLabel(section.parentName);
		countByBranch.set(branch, (countByBranch.get(branch) ?? 0) + 1);
	}

	let seenBranch: string | null = null;
	const rows = classes.map((section, index) => {
		const branch = branchLabel(section.parentName);
		const inSection = studentsBySection.get(section.id) ?? [];
		const validated = inSection.filter((s) => isValidated(reportResume(s), scope)).length;
		const modified = modifiedBySection?.get(section.id) ?? null;
		const row: SectionSummaryRow = {
			serial: index + 1,
			branch: branch === seenBranch ? null : branch,
			branchSectionCount: countByBranch.get(branch) ?? 1,
			section: section.name,
			total: inSection.length,
			validated,
			validatedPct: pct(validated, inSection.length),
			modified,
			modifiedPct: modified === null ? "" : pct(modified, validated),
		};
		seenBranch = branch;
		return row;
	});

	const total = rows.reduce((n, r) => n + r.total, 0);
	const validated = rows.reduce((n, r) => n + r.validated, 0);
	const modifiedRows = rows.filter((r) => r.modified !== null);
	const modified = modifiedRows.length > 0 ? modifiedRows.reduce((n, r) => n + (r.modified ?? 0), 0) : null;

	return {
		rows,
		totals: {
			total,
			validated,
			validatedPct: pct(validated, total),
			modified,
			modifiedPct: modified === null ? "" : pct(modified, validated),
		},
	};
}

/**
 * How to split a roster across two printed columns so it stays on one page.
 *
 * A single column of 67 names needs more height than A4 leaves once the header block is in, and
 * shrinking the type to fit makes it unreadable. Two columns of 34 fit at a readable size, and the
 * font steps down only for the rare section too large for even that.
 */
export function printLayout(rows: StudentReportRow[]): { left: number; fontPt: number } {
	// Split so the two columns come out the same HEIGHT, not the same row count. A long name wraps
	// to a second line, and splitting down the middle by count leaves one column running past the
	// page while the other ends short.
	const CHARS_PER_LINE = 26;
	const linesFor = (row: StudentReportRow) => Math.max(1, Math.ceil(row.name.length / CHARS_PER_LINE));
	const total = rows.reduce((n, row) => n + linesFor(row), 0);

	let running = 0;
	let left = rows.length;
	for (let i = 0; i < rows.length; i++) {
		running += linesFor(rows[i]);
		if (running >= total / 2) {
			left = i + 1;
			break;
		}
	}
	// What drives the page is the taller column, not the class size, and a wrapped name costs a
	// line like any other. Measured on A4: a 9pt row is ~25px and the letterhead leaves ~800px, so
	// the type steps down as the tallest column grows rather than at a round number of students.
	const tallestColumnLines = Math.max(
		rows.slice(0, left).reduce((n, row) => n + linesFor(row), 0),
		rows.slice(left).reduce((n, row) => n + linesFor(row), 0),
	);
	const fontPt = tallestColumnLines <= 32 ? 9 : tallestColumnLines <= 36 ? 8 : tallestColumnLines <= 40 ? 7.5 : 7;

	return { left, fontPt };
}
