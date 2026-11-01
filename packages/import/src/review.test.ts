import { describe, expect, it } from "vite-plus/test";
import { zipSync } from "fflate";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { extractDocxText } from "./docx-text";
import { notImportedLines, reviewImport, withLeftoverSection, withLinkTargets } from "./review";

const resume = () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Priya Raman";
	data.summary.content = "<p>Product designer focused on accessible checkout flows.</p>";
	data.sections.experience.items = [
		{
			id: "1",
			hidden: false,
			company: "Northwind Labs",
			position: "Senior Designer",
			location: "Berlin",
			period: "2021 – Present",
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li><p>Improved checkout-flow accessibility.</p></li></ul>",
			roles: [],
		} as never,
	];
	return data;
};

describe("notImportedLines", () => {
	it("lists a line whose number didn't come through, even when its words did", () => {
		expect(notImportedLines(resume(), ["Improved checkout-flow accessibility by 18%."])).toEqual([
			"Improved checkout-flow accessibility by 18%.",
		]);
	});

	it("lists source lines the resume doesn't hold, skipping headings and tidied lines", () => {
		const lines = [
			"PRIYA RAMAN",
			"Patents",
			"US 11,234,567 · Accessible payment form validation, 2023",
			"Improved checkout-flow accessability.",
			"Senior Designer, Northwind Labs, Berlin",
			"References",
			"Dana Lee, Head of Design at Northwind, dana@example.com",
		];
		expect(notImportedLines(resume(), lines)).toEqual([
			"US 11,234,567 · Accessible payment form validation, 2023",
			"Dana Lee, Head of Design at Northwind, dana@example.com",
		]);
	});
});

describe("notImportedLines across entries", () => {
	it("lists a date range or number line the resume lacks", () => {
		expect(notImportedLines(resume(), ["2016 – 2019", "2021 – Present"])).toEqual(["2016 – 2019"]);
	});

	it("doesn't count a bullet as imported because its words are scattered over other entries", () => {
		const data = resume();
		data.sections.projects.items = [
			{
				id: "2",
				hidden: false,
				name: "Team of 18",
				period: "",
				website: { url: "", label: "", inlineLink: false },
				description: "<p>Managed designers across Berlin teams.</p>",
			} as never,
		];
		expect(notImportedLines(data, ["Managed 18 designers across Berlin teams"])).toEqual([]);
		data.sections.projects.items = [
			{
				id: "2",
				hidden: false,
				name: "Team of 18",
				period: "",
				website: { url: "", label: "", inlineLink: false },
				description: "",
			} as never,
		];
		data.sections.awards.items = [
			{ id: "3", hidden: false, title: "Managed designers across teams", awarder: "", date: "" } as never,
		];
		expect(notImportedLines(data, ["Managed 18 designers across Berlin teams"])).toEqual([
			"Managed 18 designers across Berlin teams",
		]);
	});
});

describe("reviewImport", () => {
	it("counts sections with content and notices missing contact details", () => {
		const data = resume();
		expect(reviewImport(data).sections.map(({ key, entries }) => [key, entries])).toEqual([
			["summary", 1],
			["experience", 1],
		]);
		expect(reviewImport(data).missingContact).toBe(false);
		data.basics.name = "";
		expect(reviewImport(data).missingContact).toBe(true);
	});
});

describe("withLeftoverSection", () => {
	it("keeps leftovers as a placed section of their own", () => {
		const data = withLeftoverSection(resume(), ["US 11,234,567 · Payment validation"], "More from your file");
		const section = data.customSections.at(-1);
		expect(section).toMatchObject({ type: "summary", title: "More from your file" });
		expect(data.metadata.layout.pages.at(-1)?.main.at(-1)).toBe(section?.id);
		expect(JSON.stringify(section?.items)).toContain("US 11,234,567");
	});
});

describe("withLinkTargets", () => {
	const profile = (username = "") =>
		({
			id: "p",
			hidden: false,
			icon: "",
			network: "LinkedIn",
			username,
			website: { url: "", label: "", inlineLink: false },
		}) as never;

	it("fills an empty profile address from the one link behind it, and never the email", () => {
		const data = resume();
		data.basics.email = "";
		data.sections.profiles.items = [profile()];
		const linked = withLinkTargets(data, [
			"https://www.linkedin.com/in/priya-raman-example",
			"mailto:dana@example.com",
		]);
		expect(linked.sections.profiles.items[0]?.website.url).toBe("https://www.linkedin.com/in/priya-raman-example");
		expect(linked.basics.email).toBe("");
	});

	it("leaves a profile alone when several links could be it, unless one names its username", () => {
		const data = resume();
		const links = ["https://linkedin.com/in/dana-lee", "https://linkedin.com/in/priya-raman"];
		data.sections.profiles.items = [profile()];
		expect(withLinkTargets(data, links).sections.profiles.items[0]?.website.url).toBe("");
		data.sections.profiles.items = [profile("priya-raman")];
		expect(withLinkTargets(data, links).sections.profiles.items[0]?.website.url).toBe(links[1]);
	});

	it("matches the username as the account's own path segment, not part of another address", () => {
		const data = resume();
		const links = ["https://github.com/priya-fan-club", "https://github.com/priya"];
		data.sections.profiles.items = [{ ...(profile("priya") as object), network: "GitHub" } as never];
		expect(withLinkTargets(data, links).sections.profiles.items[0]?.website.url).toBe(links[1]);
		expect(withLinkTargets(data, [links[0] as string]).sections.profiles.items[0]?.website.url).toBe("");
	});
});

describe("extractDocxText", () => {
	it("reads headers before the body", () => {
		const part = (root: string, text: string) =>
			new TextEncoder().encode(`<w:${root}><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${root}>`);
		expect(
			extractDocxText(
				zipSync({ "word/document.xml": part("document", "Body"), "word/header1.xml": part("hdr", "Name") }),
			),
		).toBe("Name\n\nBody");
	});

	const encode = (text: string) => new TextEncoder().encode(text);
	const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;
	const run = (text: string, properties = "") => `<w:r>${properties}<w:t>${text}</w:t></w:r>`;

	it("reads only the headers a section uses", () => {
		const body = `<w:document><w:body>${paragraph(run("Body"))}<w:sectPr><w:headerReference w:type="default" r:id="rId8"/></w:sectPr></w:body></w:document>`;
		const rels =
			'<Relationships><Relationship Id="rId8" Type="http://schemas/header" Target="header2.xml"/><Relationship Id="rId9" Type="http://schemas/header" Target="header1.xml"/></Relationships>';
		expect(
			extractDocxText(
				zipSync({
					"word/document.xml": encode(body),
					"word/_rels/document.xml.rels": encode(rels),
					"word/header1.xml": encode(`<w:hdr>${paragraph(run("Old address"))}</w:hdr>`),
					"word/header2.xml": encode(`<w:hdr>${paragraph(run("Priya Raman"))}</w:hdr>`),
				}),
			),
		).toBe("Priya Raman\n\nBody");
	});

	it("leaves out tracked deletions and hidden text, keeping a paragraph whose mark was deleted", () => {
		const body = `<w:document><w:body>${[
			paragraph(
				`${run("Led ")}<w:del w:id="1"><w:r><w:delText>twelve </w:delText></w:r></w:del>${run("eight designers")}`,
			),
			paragraph(run("Secret note", "<w:rPr><w:vanish/></w:rPr>") + run("Shown")),
			`<w:p><w:pPr><w:rPr><w:del w:id="2" w:author="A"/></w:rPr></w:pPr>${run("Kept line")}</w:p>`,
			paragraph(run("Also kept", '<w:rPr><w:vanish w:val="0"/></w:rPr>')),
		].join("")}</w:body></w:document>`;
		expect(extractDocxText(zipSync({ "word/document.xml": encode(body) }))).toBe(
			"Led eight designers\nShown\nKept line\nAlso kept",
		);
	});
});
