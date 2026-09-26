// biome-ignore-all lint/style/noNonNullAssertion: These tests assert imported section lengths before inspecting the first item.
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { parseLinkedInExport } from "./linkedin";

function makeZip(files: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	const entries: Record<string, Uint8Array> = {};
	for (const [name, content] of Object.entries(files)) entries[name] = encoder.encode(content);
	return zipSync(entries);
}

describe("parseLinkedInExport", () => {
	it("throws when the file is not a valid ZIP", () => {
		expect(() => parseLinkedInExport(new Uint8Array([1, 2, 3]))).toThrow(/ZIP archive/);
	});

	it("throws when the ZIP has none of the expected LinkedIn CSVs", () => {
		const zip = makeZip({ "Random.csv": "a,b\n1,2\n" });
		expect(() => parseLinkedInExport(zip)).toThrow(/doesn't look like a LinkedIn data export/);
	});

	it("imports basics and summary from Profile.csv", () => {
		const zip = makeZip({
			"Profile.csv":
				'First Name,Last Name,Headline,Summary,Geo Location\nJane,Doe,Engineer,Builds things,"Berlin, Germany"\n',
		});

		const result = parseLinkedInExport(zip);
		expect(result.basics.name).toBe("Jane Doe");
		expect(result.basics.headline).toBe("Engineer");
		expect(result.summary.content).toBe("<p>Builds things</p>");
		expect(result.summary.hidden).toBe(false);
	});

	it("imports work history from Positions.csv with LinkedIn-style dates", () => {
		const zip = makeZip({
			"Positions.csv":
				"Company Name,Title,Description,Location,Started On,Finished On\nAcme,Engineer,Built stuff,Remote,Jan 2020,Dec 2022\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.experience.items).toHaveLength(1);
		const item = result.sections.experience.items[0]!;
		expect(item.company).toBe("Acme");
		expect(item.position).toBe("Engineer");
		expect(item.period).toBe("January 2020 - December 2022");
		expect(item.description).toBe("<p>Built stuff</p>");
	});

	it("treats an ongoing position (no Finished On) as present", () => {
		const zip = makeZip({
			"Positions.csv": "Company Name,Title,Started On,Finished On\nAcme,Engineer,Jan 2020,\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.experience.items).toHaveLength(1);
		expect(result.sections.experience.items[0]!.period).toBe("January 2020 - Present");
	});

	it("skips positions without a company name", () => {
		const zip = makeZip({
			"Positions.csv": "Company Name,Title\n,Freelancer\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.experience.items).toHaveLength(0);
	});

	it("imports education from Education.csv", () => {
		const zip = makeZip({
			"Education.csv": "School Name,Degree Name,Start Date,End Date\nMIT,BSc Computer Science,2016,2020\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.education.items).toHaveLength(1);
		const item = result.sections.education.items[0]!;
		expect(item.school).toBe("MIT");
		expect(item.degree).toBe("BSc Computer Science");
		expect(item.period).toBe("2016 - 2020");
	});

	it("imports skills, languages, and certifications", () => {
		const zip = makeZip({
			"Education.csv": "School Name\nMIT\n",
			"Skills.csv": "Name\nTypeScript\n",
			"Languages.csv": "Name,Proficiency\nSpanish,Native or bilingual\n",
			"Certifications.csv": "Name,Authority,Url,Started On\nAWS Certified,Amazon,https://aws.amazon.com,Jun 2021\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.skills.items[0]!.name).toBe("TypeScript");
		expect(result.sections.languages.items[0]!.language).toBe("Spanish");
		expect(result.sections.languages.items[0]!.level).toBe(5);
		expect(result.sections.certifications.items[0]!.title).toBe("AWS Certified");
		expect(result.sections.certifications.items[0]!.website.url).toBe("https://aws.amazon.com");
	});

	it("finds CSVs nested inside a folder in the ZIP", () => {
		const zip = makeZip({
			"Basic_LinkedInDataExport/Education.csv": "School Name\nMIT\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.education.items[0]!.school).toBe("MIT");
	});
});
