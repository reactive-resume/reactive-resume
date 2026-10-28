import { describe, expect, it } from "vite-plus/test";
import { mapCsvToApplications, parseCsv, rowsToCsv } from "./csv";

describe("parseCsv", () => {
	it("neutralizes formulas in skipped rows and headers, preserving quotes and newlines", () => {
		const formulas = ["=1+1", "+SUM(1,2)", "-1+1", "@SUM(1)", "\t=1+1"];
		const exported = parseCsv(rowsToCsv(formulas, [formulas, ['Say "hi"', "Line\nbreak"]]));
		expect(exported.slice(0, 2)).toEqual([formulas.map((value) => `'${value}`), formulas.map((value) => `'${value}`)]);
		expect(exported[2]).toEqual(['Say "hi"', "Line\nbreak"]);
	});

	it("parses quoted fields with commas and newlines", () => {
		const table = parseCsv('Company,Role\n"Acme, Inc.","Eng, Sr"\nBeta,"Line1\nLine2"');
		expect(table[1]).toEqual(["Acme, Inc.", "Eng, Sr"]);
		expect(table[2]).toEqual(["Beta", "Line1\nLine2"]);
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

	it("reports invalid stages and dates without silently importing different values", () => {
		const csv =
			"company,role,status,stage date\nStripe,Eng,bogus,2026-99-99\n,NoCompany,applied,2026-07-01\nAcme,,saved,2026-07-01";
		const { rows, skipped, invalidValues } = mapCsvToApplications(parseCsv(csv));
		expect(rows).toHaveLength(0);
		expect(invalidValues).toEqual([
			{ row: 2, field: "status", value: "bogus" },
			{ row: 2, field: "stageEnteredAt", value: "2026-99-99" },
		]);
		expect(skipped).toBe(2);
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
