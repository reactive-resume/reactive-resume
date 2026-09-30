// oxlint-disable typescript/no-non-null-assertion -- These tests assert imported section lengths before inspecting the first item.
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
		expect(item.dates).toEqual({ start: "2020-01", end: "2022-12", present: false });
		expect(item.description).toBe("<p>Built stuff</p>");
	});

	it("treats an ongoing position (no Finished On) as present", () => {
		const zip = makeZip({
			"Positions.csv": "Company Name,Title,Started On,Finished On\nAcme,Engineer,Jan 2020,\n",
		});

		const result = parseLinkedInExport(zip);
		expect(result.sections.experience.items).toHaveLength(1);
		expect(result.sections.experience.items[0]!.period).toBe("January 2020 - Present");
		expect(result.sections.experience.items[0]!.dates).toEqual({ start: "2020-01", end: null, present: true });
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

	it("escapes CSV text and turns line breaks into HTML", () => {
		const zip = makeZip({
			"Profile.csv": 'First Name,Summary\nJane,"Line one\nLine <two> & more"\n',
			"Positions.csv": 'Company Name,Description\nAcme,"Led a team\n• Built <script>x</script>\n• Shipped C++ & Go"\n',
		});

		const result = parseLinkedInExport(zip);
		expect(result.summary.content).toBe("<p>Line one</p><p>Line &lt;two&gt; &amp; more</p>");
		expect(result.sections.experience.items[0]!.description).toBe(
			"<ul><li>Led a team</li><li>Built &lt;script&gt;x&lt;/script&gt;</li><li>Shipped C++ &amp; Go</li></ul>",
		);
	});

	it("keeps an unrecognised end date verbatim instead of showing the role as ongoing", () => {
		const zip = makeZip({
			"Positions.csv": "Company Name,Started On,Finished On\nAcme,Jan 2020,2021-06-30\n",
		});

		const [item] = parseLinkedInExport(zip).sections.experience.items;
		expect(item!.period).toBe("January 2020 - 2021-06-30");
		// An end cell it couldn't read leaves the text to be read, and flagged, when saved.
		expect(item!.dates).toBeUndefined();
	});

	it("reads headers behind a UTF-8 byte order mark", () => {
		const zip = makeZip({ "Positions.csv": "﻿Company Name,Title\nAcme,Engineer\n" });
		expect(parseLinkedInExport(zip).sections.experience.items[0]!.company).toBe("Acme");
	});

	it("matches CSVs by exact file name, not suffix", () => {
		const zip = makeZip({
			"Learning_Profile.csv": "First Name,Last Name\nWrong,Person\n",
			"Education.csv": "School Name\nMIT\n",
		});

		expect(parseLinkedInExport(zip).basics.name).toBe("");
	});

	it("maps LinkedIn's language proficiency options onto levels", () => {
		const zip = makeZip({
			"Education.csv": "School Name\nMIT\n",
			"Languages.csv": [
				"Name,Proficiency",
				"A,Native or bilingual proficiency",
				"B,Full professional proficiency",
				"C,Professional working proficiency",
				"D,Limited working proficiency",
				"E,Elementary proficiency",
			].join("\n"),
		});

		expect(parseLinkedInExport(zip).sections.languages.items.map((item) => item.level)).toEqual([5, 4, 3, 2, 1]);
	});

	it("rejects an oversized CSV entry", () => {
		const zip = makeZip({ "Positions.csv": `Company Name\n${"a".repeat(5 * 1024 * 1024)}\n` });
		expect(() => parseLinkedInExport(zip)).toThrow(/larger than 5 MB/);
	});
});
