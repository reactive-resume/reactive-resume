import type { Application } from "./types";
import { describe, expect, it } from "vitest";
import { exportApplicationsCsv, mapCsvToApplications, parseCsv, selectApplicationsForExport } from "./csv";

const application: Application = {
	id: "application",
	company: 'Müller, "Partners"',
	role: "Engineer",
	status: "interview",
	closedReason: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: "Berlin",
	salary: "€70,000",
	source: "Referral",
	sourceUrl: "https://example.com/job",
	notes: "First line\nSecond line",
	tags: ["customer, success", "typescript|react", "remote;eu"],
	contacts: [{ name: "Ada", role: "Recruiter", type: "Referral", email: "ada@example.com", phone: "+49 30 123456" }],
	activity: [
		{ id: "interview", type: "stage", stage: "interview", at: new Date("2026-08-12T12:00:00Z") },
		{ id: "note", type: "note", text: "Called recruiter", at: new Date("2026-08-08T12:00:00Z") },
		{ id: "applied", type: "stage", stage: "applied", at: new Date("2026-08-03T12:00:00Z") },
	],
	appliedAt: new Date("2026-08-03T12:00:00Z"),
	createdAt: new Date("2026-08-01T12:00:00Z"),
	updatedAt: new Date("2026-08-12T12:00:00Z"),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
};

function exportedRecord(value: Application) {
	const [headers = [], values = []] = parseCsv(exportApplicationsCsv([value]));
	return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

describe("application CSV export", () => {
	it("round-trips saved posting text and retrieval evidence", () => {
		const source = {
			method: "tavily" as const,
			format: "markdown" as const,
			requestedUrl: "https://example.com/job",
			retrievedAt: "2026-09-30T12:00:00.000Z",
			truncated: true,
			completeness: "incomplete" as const,
		};
		const value = { ...application, jobDescription: "Job description\nRequirements", postingSource: source };
		expect(mapCsvToApplications(parseCsv(exportApplicationsCsv([value]))).rows[0]).toMatchObject({
			jobDescription: value.jobDescription,
			postingSource: source,
		});
	});
	it("round-trips quoted Unicode, commas and multiline notes through existing import fields", () => {
		const csv = exportApplicationsCsv([application]);
		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv).toContain('"Müller, ""Partners"""');
		expect(csv).toContain("\r\n");
		expect(mapCsvToApplications(parseCsv(csv)).rows).toEqual([
			{
				company: 'Müller, "Partners"',
				role: "Engineer",
				status: "interview",
				stageEnteredAt: "2026-08-12",
				location: "Berlin",
				salary: "€70,000",
				source: "Referral",
				sourceUrl: "https://example.com/job",
				notes: "First line\nSecond line",
				tags: ["customer, success", "typescript|react", "remote;eu"],
			},
		]);
	});

	it.each([
		"=1+1",
		"+1+1",
		"-1+1",
		"@SUM(A1)",
		"\t=1+1",
		"\r=1+1",
		"\n=1+1",
		"  =1+1",
		"＝1+1",
		"＋1+1",
		"－1+1",
		"＠SUM(A1)",
	])("neutralizes spreadsheet formula prefix %j without introducing another cell", (company) => {
		const value = `${company},"next"`;
		expect(exportedRecord({ ...application, company }).Company).toBe(`'${company}`);
		expect(exportedRecord({ ...application, company: value }).Company).toBe(`'${value}`);
		// The apostrophe is the export's own guard, so re-importing must not keep it.
		const csv = exportApplicationsCsv([{ ...application, company, notes: company }]);
		expect(mapCsvToApplications(parseCsv(csv)).rows[0]).toMatchObject({
			company: company.trim(),
			notes: company.trim(),
		});
	});
});

describe("application export selection", () => {
	const early = { ...application, id: "early", appliedAt: new Date("2026-08-02T23:59:59Z") };
	const late = { ...application, id: "late", status: "closed" as const, appliedAt: new Date("2026-08-03T23:59:59Z") };
	const all = [early, application, late];

	it("applies inclusive UTC date boundaries to selected scope without mutating source rows", () => {
		expect(
			selectApplicationsForExport(all, [application], { scope: "all", from: "2026-08-03", to: "2026-08-03" }),
		).toEqual([application, late]);
		expect(selectApplicationsForExport(all, [application], { scope: "all", to: "2026-08-02" })).toEqual([early]);
		expect(all).toHaveLength(3);
	});
});
