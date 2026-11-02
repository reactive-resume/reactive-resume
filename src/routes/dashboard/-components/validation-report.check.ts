// The printed report is what the college files, so the row-building is checked directly:
// node --import tsx --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReportDate, printLayout, sectionReportRows, summaryRows } from "./validation-report";

const student = (name: string, roll: string, reviewStatus: string | null, extra = {}) => ({
	engLabsId: roll,
	name,
	rollNumber: roll,
	sectionId: "sec-1",
	resumes: reviewStatus === null ? [] : [{ reviewStatus, ...extra }],
});

test("validation follows the reviewer whose report it is", () => {
	const students = [
		student("Verified By Faculty", "001", "FACULTY_VERIFIED"),
		student("Sent Back By Faculty", "002", "FACULTY_REVISION_REQUESTED"),
		student("Waiting On Faculty", "003", "SUBMITTED_TO_FACULTY"),
		student("Sent Back By Po", "004", "PO_REVISION_REQUESTED"),
		student("Verified By Po", "005", "PO_VERIFIED"),
		student("Never Submitted", "006", "DRAFT"),
		student("No Resume At All", "007", null),
	];

	const faculty = sectionReportRows(students, "faculty");
	// A revision request is still the faculty having validated it — the student was told what to fix.
	// Anything that has moved past faculty counts too, even though the stage no longer names them.
	assert.deepEqual(
		faculty.filter((r) => r.validated).map((r) => r.rollNumber),
		["001", "002", "004", "005"],
	);

	const po = sectionReportRows(students, "po");
	assert.deepEqual(
		po.filter((r) => r.validated).map((r) => r.rollNumber),
		["004", "005"],
		"a resume still sitting with faculty is not PO-validated",
	);
});

test("every student is listed, in roll order, submitted or not", () => {
	const rows = sectionReportRows(
		[student("Zeta", "003", "DRAFT"), student("Alpha", "001", "FACULTY_VERIFIED"), student("Mid", "002", null)],
		"faculty",
	);
	assert.deepEqual(
		rows.map((r) => [r.serial, r.rollNumber]),
		[
			[1, "001"],
			[2, "002"],
			[3, "003"],
		],
	);
	assert.equal(rows[0].name, "ALPHA", "names print in the college's upper case");
});

test("a submitted resume always shows a date, falling back when history is missing", () => {
	const withHistory = sectionReportRows(
		[student("A", "1", "SUBMITTED_TO_FACULTY", { submittedAt: new Date("2026-02-26T10:00:00Z") })],
		"faculty",
	);
	assert.equal(withHistory[0].submittedOn, "26-02-2026");

	// History only covers part of the tenant; a blank here would read as "never submitted".
	const withoutHistory = sectionReportRows(
		[student("B", "2", "SUBMITTED_TO_FACULTY", { updatedAt: new Date("2026-03-01T10:00:00Z") })],
		"faculty",
	);
	assert.equal(withoutHistory[0].submittedOn, "01-03-2026");

	const draft = sectionReportRows([student("C", "3", "DRAFT", { updatedAt: new Date() })], "faculty");
	assert.equal(draft[0].submittedOn, "", "a draft was never submitted, whenever it was last touched");
});

test("the summary groups by branch and totals the columns", () => {
	const sections = [
		{ id: "sec-1", name: "AE - A", parentName: "Automobile Engineering", unitType: "CLASS" },
		{ id: "sec-2", name: "CSE - A", parentName: "Computer Science", unitType: "CLASS" },
		{ id: "sec-3", name: "CSE - B", parentName: "Computer Science", unitType: "CLASS" },
		{ id: "dept-1", name: "Computer Science", parentName: null, unitType: "DEPARTMENT" },
	];
	const students = [
		{ ...student("A", "1", "FACULTY_VERIFIED"), sectionId: "sec-1" },
		{ ...student("B", "2", "DRAFT"), sectionId: "sec-1" },
		{ ...student("C", "3", "FACULTY_VERIFIED"), sectionId: "sec-2" },
		{ ...student("D", "4", "FACULTY_VERIFIED"), sectionId: "sec-3" },
	];

	const { rows, totals } = summaryRows(sections, students, "faculty");

	assert.equal(rows.length, 3, "a department is not a section row");
	assert.deepEqual(
		rows.map((r) => r.branch),
		["Automobile Engineering", "Computer Science", null],
		"a branch is named once and spans its sections",
	);
	assert.equal(rows[1].branchSectionCount, 2);
	assert.equal(rows[0].validatedPct, "50.00%");
	assert.equal(totals.total, 4);
	assert.equal(totals.validated, 3);
	assert.equal(totals.validatedPct, "75.00%");
	assert.equal(totals.modified, null, "Modified stays blank until RESUME_EDITED history exists");
});

test("the roster splits into two columns of equal height, not equal count", () => {
	// Long names wrap, so counting rows alone pushes one column past the page.
	const rows = sectionReportRows(
		[
			student("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "1", "DRAFT"),
			student("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "2", "DRAFT"),
			student("B", "3", "DRAFT"),
			student("C", "4", "DRAFT"),
			student("D", "5", "DRAFT"),
			student("E", "6", "DRAFT"),
		],
		"faculty",
	);
	const { left } = printLayout(rows);
	assert.equal(left, 2, "two wrapped names balance four short ones");

	// The type steps down on the height of the taller column, not the class size.
	const short = rows[2];
	assert.equal(printLayout(new Array(64).fill(short)).fontPt, 9, "32 rows a column still reads at 9pt");
	assert.equal(printLayout(new Array(72).fill(short)).fontPt, 8);
	assert.equal(printLayout(new Array(80).fill(short)).fontPt, 7.5);
	assert.equal(printLayout(new Array(120).fill(short)).fontPt, 7, "an unusually large class still fits");

	// A class of short names and one of long names are the same height at the same font only if
	// wrapping is counted, so the long one must step down first.
	const long = sectionReportRows(
		new Array(64).fill(0).map((_, i) => student("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", String(i), "DRAFT")),
		"faculty",
	);
	assert.ok(printLayout(long).fontPt < 9, "wrapped names step the type down sooner");
});

test("dates print in the college's day-month-year form", () => {
	assert.equal(formatReportDate(new Date("2026-02-26T00:00:00")), "26-02-2026");
	assert.equal(formatReportDate(null), "");
	assert.equal(formatReportDate("not a date"), "");
});
