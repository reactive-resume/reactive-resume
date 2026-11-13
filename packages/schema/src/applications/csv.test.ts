import { describe, expect, it } from "vite-plus/test";
import { applyLaneMapping, collectCsvLanes, compatibleLanes, mapCsvToApplications, parseCsv, rowsToCsv } from "./csv";
import { createDefaultApplicationLanes } from "./lanes";

describe("parseCsv", () => {
	it("neutralizes formulas in skipped rows and headers, preserving quotes and newlines", () => {
		const formulas = ["=1+1", "+SUM(1,2)", "-1+1", "@SUM(1)", "\t=1+1"];
		const exported = parseCsv(rowsToCsv(formulas, [formulas, ['Say "hi"', "Line\nbreak"]]));
		expect(exported.slice(0, 2)).toEqual([formulas.map((value) => `'${value}`), formulas.map((value) => `'${value}`)]);
		expect(exported[2]).toEqual(['Say "hi"', "Line\nbreak"]);
	});
});

describe("mapCsvToApplications", () => {
	it("imports ragged rows without materializing the missing header-width cells", () => {
		const rows = mapCsvToApplications([
			["Company", "Role", ...Array.from({ length: 10_000 }, () => "Unused")],
			["Lumen", "Designer"],
		]).rows;
		expect(rows).toEqual([{ company: "Lumen", role: "Designer" }]);
	});

	it("maps aliased headers and coerces status/tags", () => {
		const csv =
			'Company,Job Title,Stage,Stage Date,Salary,Tags,Contact Name,Contact Email,Contact Phone\nStripe,Frontend,Interview,2026-07-01,$180k,"remote;react",Jane Doe,jane@example.com,+1 555 0100';
		const { rows, recognized } = mapCsvToApplications(parseCsv(csv));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			company: "Stripe",
			role: "Frontend",
			status: "interview",
			stageEnteredAt: "2026-07-01",
			salary: "$180k",
			tags: ["remote", "react"],
			contacts: [{ name: "Jane Doe", role: "", type: "", email: "jane@example.com", phone: "+1 555 0100" }],
		});
		expect(recognized).toEqual(
			expect.arrayContaining(["company", "role", "status", "stageEnteredAt", "salary", "tags", "contactEmail"]),
		);
	});

	it("reports invalid dates without silently importing different values", () => {
		const csv =
			"company,role,status,stage date\nStripe,Eng,bogus,2026-99-99\n,NoCompany,applied,2026-07-01\nAcme,,saved,2026-07-01";
		const { rows, skipped, invalidValues } = mapCsvToApplications(parseCsv(csv));
		expect(rows).toHaveLength(0);
		expect(invalidValues).toEqual([{ row: 2, field: "stageEnteredAt", value: "2026-99-99" }]);
		expect(skipped).toBe(2);
	});
	it("reads other trackers' stage names, outcomes and date formats", () => {
		const csv = [
			"Company,Job Title,Status,Date Applied",
			"A,Eng,Phone Screen,10/15/2026",
			"B,Eng,Ghosted,09/02/2026",
			"C,Eng,Rejected,2026-09-01",
			"D,Eng,Wishlist,",
		].join("\n");
		const { rows, invalidValues } = mapCsvToApplications(parseCsv(csv));
		expect(invalidValues).toEqual([]);
		expect(
			rows.map(({ company, status, closedReason, applicationDate }) => ({
				company,
				status,
				closedReason,
				applicationDate,
			})),
		).toEqual([
			{ company: "A", status: "screening", closedReason: undefined, applicationDate: "2026-10-15" },
			{ company: "B", status: "closed", closedReason: "no-response", applicationDate: "2026-09-02" },
			{ company: "C", status: "closed", closedReason: "not-selected", applicationDate: "2026-09-01" },
			{ company: "D", status: "saved", closedReason: undefined, applicationDate: undefined },
		]);
	});
	it("reads a column's slash dates day-first when one of them can only be", () => {
		const csv = "company,role,stage date\nA,Eng,15/09/2026\nB,Eng,02/10/2026\nC,Eng,15.09.2026";
		expect(mapCsvToApplications(parseCsv(csv)).rows.map((row) => row.stageEnteredAt)).toEqual([
			"2026-09-15",
			"2026-10-02",
			"2026-09-15",
		]);
	});
	it("ignores impossible day-first dates when choosing a column's order, and treats inherited object names as custom stage labels", () => {
		const csv = "company,role,stage,stage date\nA,Eng,applied,31/02/2026\nB,Eng,applied,02/10/2026\nC,Eng,constructor,";
		const { rows, invalidValues } = mapCsvToApplications(parseCsv(csv));
		expect(rows.find((row) => row.company === "B")?.stageEnteredAt).toBe("2026-02-10");
		expect(rows.find((row) => row.company === "C")).toMatchObject({
			lane: { label: "constructor", unclassified: true },
		});
		expect(invalidValues).toEqual(expect.arrayContaining([{ row: 2, field: "stageEnteredAt", value: "31/02/2026" }]));
	});
	it("keeps unknown Status values for stage mapping without changing known names", () => {
		const result = mapCsvToApplications(parseCsv("Company,Role,Status\nA,Designer,Take-home\nB,Designer,Interview"));
		expect(result.invalidValues).toEqual([]);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[1]).toEqual({ company: "B", role: "Designer", status: "interview" });
		const [lane] = collectCsvLanes(result.rows);
		expect(lane).toMatchObject({ label: "Take-home", unclassified: true });
		if (!lane) throw new Error("Unknown CSV stage was dropped");
		const existing = createDefaultApplicationLanes().filter((item) => item.id === "interview");
		expect(compatibleLanes(lane, existing)).toEqual(existing);
		expect(applyLaneMapping(result.rows, new Map([[lane.key, "interview"]]))[0]).toEqual({
			company: "A",
			role: "Designer",
			laneId: "interview",
		});
	});

	it("reports malformed posting metadata and lets an explicit column omission resolve it", () => {
		const table = parseCsv("Company,Role,Posting Source\nAcme,Engineer,not-json");
		expect(mapCsvToApplications(table).invalidValues).toEqual([{ row: 2, field: "postingSource", value: "not-json" }]);
		const corrected = mapCsvToApplications(table, ["company", "role", null]);
		expect(corrected.invalidValues).toEqual([]);
		expect(corrected.rows).toEqual([{ company: "Acme", role: "Engineer" }]);
	});

	it("keeps the application and drops only the contact when the email is malformed", () => {
		const { rows, skipped, contactsSkipped } = mapCsvToApplications(
			parseCsv("Company,Role,Contact Name,Contact Email\nStripe,Eng,Jane Doe,not-an-email"),
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.company).toBe("Stripe");
		expect(rows[0]?.contacts).toBeUndefined();
		expect(skipped).toBe(0);
		expect(contactsSkipped).toBe(1);
	});
});

describe("column matching", () => {
	const table = parseCsv(
		"Employer,Job Title,Status,Archived,Mystery\nAcme,Designer,rejected,false,x\nKiln,Engineer,applied,true,y\n,No company,saved,false,z",
	);

	it("uses the confirmed match, reads retired stages as closed, and keeps skipped rows to download", () => {
		const result = mapCsvToApplications(table, ["company", "role", "status", "archived", "notes"]);

		expect(result.rows.map((row) => [row.company, row.status, row.notes])).toEqual([
			["Acme", "closed", "x"],
			["Kiln", "closed", "y"],
		]);
		expect(result.skippedRows).toEqual([["", "No company", "saved", "false", "z"]]);
		expect(rowsToCsv(["Company", "Role"], [["", 'Say "hi"']])).toBe('"Company","Role"\r\n"","Say ""hi"""\r\n');
	});
});
