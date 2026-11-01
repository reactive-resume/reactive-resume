import type { ExperienceItem, ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { atsVerdict, lintResumeForAts, mergeIntoPreviousEntry } from "./index";

const NOW = new Date("2024-06-15T00:00:00Z");

const experienceItem = (overrides: Partial<ExperienceItem> = {}): ExperienceItem => ({
	id: "exp-1",
	hidden: false,
	company: "Analytical Engines",
	position: "Engineer",
	location: "London",
	period: "Jan 2020 - Present",
	website: { url: "", label: "", inlineLink: false },
	description: "<p>Designed and shipped the difference engine.</p>",
	roles: [],
	...overrides,
});

function makeResume(mutate: (data: ResumeData) => void = () => undefined): ResumeData {
	const data = structuredClone(defaultResumeData);

	data.basics.name = "Ada Lovelace";
	data.basics.email = "ada@example.com";
	data.basics.phone = "+44 20 7946 0100";
	data.basics.location = "London, UK";
	data.sections.experience.items = [experienceItem()];
	data.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: [] }];

	mutate(data);
	return data;
}

const skillItem = () => ({
	id: "s1",
	hidden: false,
	icon: "",
	iconColor: "",
	name: "Mathematics",
	proficiency: "",
	level: 0,
	keywords: [],
});

const lint = (data: ResumeData) => lintResumeForAts(data, { now: NOW });
const codesOf = (data: ResumeData) => lint(data).findings.map((item) => item.code);

describe("lintResumeForAts", () => {
	it("reports nothing on a well-formed resume", () => {
		expect(lint(makeResume()).findings).toEqual([]);
	});

	it("scores the share of rules with no open finding, and groups them by category", () => {
		const report = lint(makeResume((data) => (data.basics.phone = "")));
		expect(report.passedRules).toBe(report.totalRules - 1);
		expect(report.score).toBe(Math.round(((report.totalRules - 1) / report.totalRules) * 100));
		expect(report.categories.contact).toEqual({ total: 7, passed: 6 });
	});

	it("leaves the English heading rule out of the score for other languages", () => {
		const english = lint(makeResume());
		const german = lint(makeResume((data) => (data.metadata.page.locale = "de-DE")));
		expect(german.totalRules).toBe(english.totalRules - 1);
		expect(german.categories.headings.total).toBe(english.categories.headings.total - 1);
	});

	it("keys findings by entry id, so reordering entries keeps the key", () => {
		const second = experienceItem({ id: "exp-2", period: "a while back" });
		const before = lint(makeResume((data) => (data.sections.experience.items = [experienceItem(), second])));
		const after = lint(makeResume((data) => (data.sections.experience.items = [second, experienceItem()])));
		const keyOf = (report: typeof before) => report.findings.find((item) => item.code === "UNPARSEABLE_PERIOD")?.key;

		expect(keyOf(before)).toBe("UNPARSEABLE_PERIOD:/sections/experience/items/#exp-2/period");
		expect(keyOf(after)).toBe(keyOf(before));
	});

	it("sets ignored findings aside without counting them against the score", () => {
		const data = makeResume((resume) => {
			resume.basics.phone = "";
			resume.metadata.check = { ignored: ["MISSING_PHONE:/basics/phone"], hiddenTerms: [] };
		});
		const report = lint(data);

		expect(report.findings).toEqual([]);
		expect(report.ignored.map((item) => item.code)).toEqual(["MISSING_PHONE"]);
		expect(report.counts.warning).toBe(0);
		expect(report.score).toBe(100);
	});

	it("flags the gaps in a blank resume", () => {
		const codes = codesOf(defaultResumeData);
		expect(codes).toContain("MISSING_NAME");
		expect(codes).toContain("MISSING_EMAIL");
		expect(codes).toContain("MISSING_PHONE");
		expect(codes).toContain("NO_VISIBLE_EXPERIENCE");
	});
});

describe("contact rules", () => {
	it("flags a malformed email instead of a missing one", () => {
		const codes = codesOf(makeResume((data) => (data.basics.email = "ada at example dot com")));
		expect(codes).toContain("MALFORMED_EMAIL");
		expect(codes).not.toContain("MISSING_EMAIL");
	});

	it("flags a link with no protocol", () => {
		const report = lint(makeResume((data) => (data.basics.website.url = "example.com/ada")));
		expect(report.findings).toContainEqual({
			code: "MALFORMED_URL",
			severity: "warning",
			pointer: "/basics/website/url",
			key: "MALFORMED_URL:/basics/website/url",
			params: { value: "example.com/ada" },
		});
	});

	it("accepts mailto and tel links in custom fields", () => {
		const data = makeResume((resume) => {
			resume.basics.customFields = [
				{ id: "a", icon: "", text: "Mail", link: "mailto:ada@example.com" },
				{ id: "b", icon: "", text: "Phone", link: "tel:+442079460100" },
			];
		});
		expect(codesOf(data)).not.toContain("MALFORMED_URL");
	});
});

describe("date rules", () => {
	it("flags an unreadable period at the offending item", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "a while back" })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "UNPARSEABLE_PERIOD",
			severity: "error",
			pointer: "/sections/experience/items/0/period",
			key: "UNPARSEABLE_PERIOD:/sections/experience/items/#exp-1/period",
			params: { value: "a while back" },
		});
	});

	it("warns about unreadable custom text without using stale dates for timeline checks", () => {
		const raw = "During university / bis heute";
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					period: raw,
					dates: { ...readLegacyDates(raw, { locale: "en-US", single: false }), raw },
				}),
			];
		});
		const dates = lint(data).findings.filter((item) =>
			["UNPARSEABLE_PERIOD", "REVERSED_PERIOD", "FUTURE_DATED_PERIOD"].includes(item.code),
		);
		expect(dates.map((item) => item.code)).toEqual(["UNPARSEABLE_PERIOD"]);
	});

	it("requires a period on experience", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "" })];
		});
		expect(codesOf(data)).toContain("EMPTY_PERIOD");
	});

	it("accepts a localized open-ended period", () => {
		const data = makeResume((resume) => {
			resume.metadata.page.locale = "de-DE";
			resume.sections.experience.items = [experienceItem({ period: "Jan 2020 - heute" })];
		});
		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});

	it("reads structured dates rather than their printed text", () => {
		const data = makeResume((resume) => {
			resume.metadata.page.locale = "ja-JP";
			resume.sections.experience.items = [
				experienceItem({ period: "2022年3月 – 現在", dates: { start: "2022-03", end: null, present: true } }),
			];
		});
		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});

	it("flags a period that runs backwards", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "Mar 2022 - Jan 2020" })];
		});
		expect(codesOf(data)).toContain("REVERSED_PERIOD");
	});

	it("flags a period starting in the future", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "Jan 2030 - Present" })];
		});
		expect(codesOf(data)).toContain("FUTURE_DATED_PERIOD");
	});

	it("checks periods on nested roles", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					roles: [{ id: "r1", position: "Junior Engineer", period: "whenever", description: "<p>Work.</p>" }],
				}),
			];
		});

		expect(lint(data).findings.map((item) => item.pointer)).toContain("/sections/experience/items/0/roles/0/period");
	});

	it("flags an unreadable single date", () => {
		const data = makeResume((resume) => {
			resume.sections.awards.items = [
				{
					id: "a1",
					hidden: false,
					title: "Turing Award",
					awarder: "ACM",
					date: "some time ago",
					website: { url: "", label: "", inlineLink: false },
					description: "",
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "awards"], sidebar: [] }];
		});

		expect(codesOf(data)).toContain("UNPARSEABLE_DATE");
	});

	it("ignores hidden items", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem(),
				experienceItem({ id: "exp-2", period: "???", hidden: true }),
			];
		});
		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});
});

describe("structure rules", () => {
	it("flags content that is never placed on a page", () => {
		const data = makeResume((resume) => {
			resume.sections.education.items = [
				{
					id: "e1",
					hidden: false,
					school: "University of London",
					degree: "BSc",
					area: "Mathematics",
					grade: "",
					location: "London",
					period: "2016 - 2019",
					website: { url: "", label: "", inlineLink: false },
					description: "",
				},
			];
		});

		expect(lint(data).findings).toContainEqual({
			code: "SECTION_MISSING_FROM_LAYOUT",
			severity: "error",
			pointer: "/sections/education",
			key: "SECTION_MISSING_FROM_LAYOUT:/sections/education",
			params: { section: "education" },
		});
	});

	it("flags an experience entry with no narrative", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ description: "<p></p>" })];
		});
		expect(codesOf(data)).toContain("MISSING_EXPERIENCE_DESCRIPTION");
	});

	it("accepts an experience entry whose narrative lives on its roles", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					description: "",
					roles: [{ id: "r1", position: "Engineer", period: "2020 - 2022", description: "<p>Shipped it.</p>" }],
				}),
			];
		});
		expect(codesOf(data)).not.toContain("MISSING_EXPERIENCE_DESCRIPTION");
	});

	it("counts a custom section of type experience as experience", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [];
			resume.customSections = [
				{
					id: "custom-exp",
					type: "experience",
					title: "Work Experience",
					icon: "briefcase",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [experienceItem()],
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["custom-exp"], sidebar: [] }];
		});

		expect(codesOf(data)).not.toContain("NO_VISIBLE_EXPERIENCE");
	});
});

describe("layout rules", () => {
	it("flags a prose section split into columns", () => {
		const data = makeResume((resume) => (resume.sections.experience.columns = 2));
		expect(codesOf(data)).toContain("MULTI_COLUMN_PROSE_SECTION");
	});

	it("flags a prose section parked in the sidebar", () => {
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: false, main: [], sidebar: ["experience"] }];
		});
		expect(codesOf(data)).toContain("PROSE_SECTION_IN_SIDEBAR");
	});

	it("knows a full-width page prints no sidebar", () => {
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: ["experience"] }];
		});
		expect(codesOf(data)).not.toContain("PROSE_SECTION_IN_SIDEBAR");
		expect(codesOf(data)).toContain("SECTION_MISSING_FROM_LAYOUT");
	});

	it("flags a two-column template printing a sidebar, naming its sections", () => {
		const data = makeResume((resume) => {
			resume.sections.skills.items = [skillItem()];
			resume.metadata.template = "azurill";
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(lint(data).findings).toContainEqual(
			expect.objectContaining({ code: "TWO_COLUMN_LAYOUT", params: { sections: "skills" } }),
		);
	});

	it("leaves one-column templates, full-width pages and empty sidebars out of the two-column rule", () => {
		const withSidebar = (template: ResumeData["metadata"]["template"], fullWidth: boolean, withSkills = true) =>
			makeResume((resume) => {
				resume.sections.skills.items = withSkills ? [skillItem()] : [];
				resume.metadata.template = template;
				resume.metadata.layout.pages = [{ fullWidth, main: ["experience"], sidebar: ["skills"] }];
			});

		expect(codesOf(withSidebar("onyx", false))).not.toContain("TWO_COLUMN_LAYOUT");
		expect(codesOf(withSidebar("azurill", true))).not.toContain("TWO_COLUMN_LAYOUT");
		expect(codesOf(withSidebar("azurill", false, false))).not.toContain("TWO_COLUMN_LAYOUT");
	});

	it("leaves short-list sections in the sidebar alone", () => {
		const data = makeResume((resume) => {
			resume.sections.skills.items = [
				{
					id: "s1",
					hidden: false,
					icon: "",
					iconColor: "",
					name: "Mathematics",
					proficiency: "",
					level: 0,
					keywords: [],
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(codesOf(data)).not.toContain("PROSE_SECTION_IN_SIDEBAR");
	});
});

describe("title rules", () => {
	it("flags an unconventional heading", () => {
		const data = makeResume((resume) => (resume.sections.experience.title = "Where I've Been"));
		expect(codesOf(data)).toContain("NON_STANDARD_SECTION_TITLE");
	});

	it("accepts a conventional heading regardless of case", () => {
		const data = makeResume((resume) => (resume.sections.experience.title = "Work Experience"));
		expect(codesOf(data)).not.toContain("NON_STANDARD_SECTION_TITLE");
	});

	it("stays quiet on a localized resume", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.title = "Berufserfahrung";
			resume.metadata.page.locale = "de-DE";
		});
		expect(codesOf(data)).not.toContain("NON_STANDARD_SECTION_TITLE");
	});
});

describe("typography rules", () => {
	it("flags each tight margin axis", () => {
		const data = makeResume((resume) => {
			resume.metadata.page.marginX = 4;
			resume.metadata.page.marginY = 4;
			resume.metadata.typography.body.fontSize = 8;
			resume.metadata.typography.body.lineHeight = 1;
		});

		expect(codesOf(data)).toContain("SMALL_BODY_FONT");
		expect(codesOf(data)).toContain("TIGHT_LINE_HEIGHT");
		expect(
			lint(data)
				.findings.filter((item) => item.code === "TIGHT_PAGE_MARGINS")
				.map((item) => item.pointer),
		).toEqual(["/metadata/page/marginX", "/metadata/page/marginY"]);
	});
});

describe("sample resume", () => {
	it("raises no errors on the resume the product ships as its example", () => {
		expect(lint(sampleResumeData).findings.filter((item) => item.severity === "error")).toEqual([]);
	});
});

describe("entries that are part of the one above (J2-02)", () => {
	const fragment = (id: string, company: string, description = "") =>
		experienceItem({ id, company, position: "", location: "", period: "", description });

	const imported = () =>
		makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "studio", company: "Synthetic Studio 1", period: "2020 - Present" }),
				fragment(
					"f1",
					"Project 1.3: Built accessible services for global customers, mentored four engineers, and reduced processing time by",
					"<p>25%. Tracked reliability and customer feedback.</p>",
				),
				fragment("f2", "and kept the on-call rotation healthy,", "<p>Cut pages by half.</p>"),
			];
		});

	it("reports a sentence split off a dated entry as part of it, not as an entry missing dates", () => {
		const findings = lint(imported()).findings;

		expect(findings.filter((item) => item.code === "FRAGMENTED_ENTRY").map((item) => item.pointer)).toEqual([
			"/sections/experience/items/1",
			"/sections/experience/items/2",
		]);
		expect(findings.map((item) => item.code)).not.toContain("EMPTY_PERIOD");
	});

	it("still asks for dates on a real entry that has none", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a" }),
				experienceItem({ id: "b", company: "Freelance", position: "Consultant", period: "" }),
			];
		});

		expect(codesOf(data)).toContain("EMPTY_PERIOD");
		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
	});

	it("never calls the resume clean while a fragment is open", () => {
		const report = lint(imported());

		expect(report.score).toBeGreaterThanOrEqual(80);
		expect(atsVerdict(report)).toBe("mostly");
		expect(atsVerdict(lint(makeResume()))).toBe("clean");
	});

	it("merges a fragment into the entry above, keeping its words in order", () => {
		const data = imported();
		mergeIntoPreviousEntry(data, "/sections/experience/items/1");

		expect(data.sections.experience.items.map((item) => item.id)).toEqual(["studio", "f2"]);
		expect(data.sections.experience.items[0]?.description).toBe(
			"<p>Designed and shipped the difference engine.</p><p>Project 1.3: Built accessible services for global customers, mentored four engineers, and reduced processing time by 25%. Tracked reliability and customer feedback.</p>",
		);
	});

	it("escapes the heading text it moves into the description", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a", description: "" }),
				fragment("b", "Shipped <script> & more to customers in twelve markets across the region by"),
			];
		});
		mergeIntoPreviousEntry(data, "/sections/experience/items/1");

		expect(data.sections.experience.items[0]?.description).toBe(
			"<p>Shipped &lt;script&gt; &amp; more to customers in twelve markets across the region by</p>",
		);
	});

	it.each([
		["eBay", { company: "eBay", position: "Senior Product Manager", location: "" }],
		[
			"a long senior title",
			{
				company: "Contoso",
				position: "Senior Vice President of Global Engineering Operations",
				location: "New York, NY",
			},
		],
		[
			"a board seat",
			{
				company: "Northwind Children's Hospital Foundation",
				position: "Advisory Board Member and Treasurer",
				location: "Seattle, WA",
			},
		],
	])("treats %s without dates as a real entry that needs dates", (_name, heading) => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a" }),
				experienceItem({ id: "b", ...heading, period: "", description: "<p>Ran the marketplace roadmap</p>" }),
			];
		});

		expect(codesOf(data)).toContain("EMPTY_PERIOD");
		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
	});

	it("treats an undated degree as a real entry that needs dates", () => {
		const data = makeResume((resume) => {
			const school = { hidden: false, website: { url: "", label: "", inlineLink: false }, description: "", grade: "" };
			resume.sections.education.items = [
				{
					...school,
					id: "e1",
					school: "Stanford University",
					degree: "Executive Program",
					area: "Leadership",
					location: "",
					period: "2021",
				},
				{
					...school,
					id: "e2",
					school: "Massachusetts Institute of Technology",
					degree: "Master of Science",
					area: "Electrical Engineering and Computer Science",
					location: "Cambridge, MA",
					period: "",
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "education"], sidebar: [] }];
		});

		expect(lint(data).findings.map((item) => `${item.code} ${item.pointer}`)).toContain(
			"EMPTY_PERIOD /sections/education/items/1/period",
		);
		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
	});

	it("reads a long heading as the rest of a sentence when the entry above stops mid-sentence", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a", description: "<p>Reduced processing time by 25% while keeping</p>" }),
				fragment("b", "uptime above target for every regional customer team across the whole platform group"),
			];
		});

		expect(codesOf(data)).toContain("FRAGMENTED_ENTRY");
	});

	const unpunctuatedBullets =
		"<ul><li>Led the platform migration to Kubernetes</li><li>Grew the team from 8 to 40 engineers</li></ul>";
	const elevenWordTitle = "Senior Vice President of Global Engineering and Product Operations for EMEA";

	it.each([
		["an 11-word title", { company: "Contoso", position: elevenWordTitle }],
		["a lower-case brand", { company: "eBay Marketplace Platform Group", position: "Senior Product Manager" }],
		["a lower-case title", { company: "Contoso", position: "iOS platform engineering lead" }],
	])("treats %s after bullets without full stops as a real entry that needs dates", (_name, heading) => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a", description: unpunctuatedBullets }),
				experienceItem({ id: "b", ...heading, location: "", period: "", description: "<p>Ran the roadmap</p>" }),
			];
		});

		expect(codesOf(data)).toContain("EMPTY_PERIOD");
		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
		expect(atsVerdict(lint(data))).toBe("clean");
	});

	it.each([
		["a dangling word", "<ul><li>Led the migration</li><li>Reduced processing time by</li></ul>"],
		["a comma", "<ul><li>Led the migration</li><li>Cut costs, grew the team,</li></ul>"],
		["a dash", "<p>Rebuilt the billing platform \u2014</p>"],
	])("still reads a long or lower-case heading as the rest of a bullet that stops on %s", (_name, description) => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a", description }),
				fragment("b", "uptime above target for every regional customer team"),
			];
		});

		expect(codesOf(data)).toContain("FRAGMENTED_ENTRY");
		expect(codesOf(data)).not.toContain("EMPTY_PERIOD");
	});

	it("keeps a title of up to 10 words after a cut bullet, and reads 11 as the rest of it", () => {
		const after = (position: string) =>
			makeResume((resume) => {
				resume.sections.experience.items = [
					experienceItem({ id: "a", description: "<ul><li>Reduced processing time by</li></ul>" }),
					experienceItem({ id: "b", company: "Contoso", position, location: "", period: "", description: "" }),
				];
			});

		expect(codesOf(after(elevenWordTitle.replace(" for EMEA", " EMEA")))).not.toContain("FRAGMENTED_ENTRY");
		expect(codesOf(after(elevenWordTitle))).toContain("FRAGMENTED_ENTRY");
		expect(codesOf(after("Senior Platform Engineer"))).not.toContain("FRAGMENTED_ENTRY");
		expect(codesOf(after("platform engineer for payments"))).toContain("FRAGMENTED_ENTRY");
	});

	it.each([
		["a link", { website: { url: "https://example.com/case-study", label: "Case study", inlineLink: false } }],
		["an end date", { dates: { start: null, end: "2019-05", present: false } }],
		["date text", { dates: { start: null, end: null, present: false, raw: "Summer" } }],
	])("never offers to merge a fragment carrying %s, and merging it changes nothing", (_name, extra) => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a" }),
				{ ...fragment("b", "and kept the on-call rotation healthy,", "<p>Cut pages.</p>"), ...extra },
			];
		});
		const before = structuredClone(data);

		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
		expect(mergeIntoPreviousEntry(data, "/sections/experience/items/1")).toBe(false);
		expect(data).toEqual(before);
	});
});

describe("split entries are read by grammar, not by a list of company or title words (J2-02)", () => {
	const entryAfter = (above: string, heading: Partial<ExperienceItem>) =>
		makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ id: "a", description: above }),
				experienceItem({ id: "b", company: "", position: "", location: "", period: "", description: "", ...heading }),
			];
		});
	const elevenWordTitle = "Senior Vice President of Global Engineering and Product Operations for EMEA";

	it.each([
		[
			"a sign-on bullet",
			"<ul><li>Shipped SAML single sign-on</li></ul>",
			{ company: "Contoso", position: elevenWordTitle },
		],
		[
			"a logged-in bullet",
			"<ul><li>Cut the time it took users to get logged in</li></ul>",
			{ company: "Contoso", position: elevenWordTitle },
		],
		[
			"a Series A bullet",
			"<ul><li>Helped raise a Series A</li></ul>",
			{ company: "Contoso", position: elevenWordTitle },
		],
		[
			"a walk-through bullet",
			"<ul><li>Led the quarterly security walk-through</li></ul>",
			{ company: "Contoso", position: elevenWordTitle },
		],
		["a closed line", "<p>Shipped the app.</p>", { company: "Vipps AS", position: "Senior Engineer" }],
		["a closed line", "<p>Shipped the app.</p>", { company: "Via", position: "Senior Engineer" }],
		[
			"a closed line",
			"<p>Shipped the app.</p>",
			{ company: "Fabrikam Ventures", position: "Investment Analyst, Series A" },
		],
		[
			"an open line",
			"<ul><li>Shipped SAML single sign-on</li></ul>",
			{ company: "Contoso", position: "iOS platform engineering lead" },
		],
		[
			"bullets that never close",
			"<ul><li>Led the platform migration</li><li>Grew the team from 8 to 40</li></ul>",
			{ company: "Contoso", position: "senior platform engineering lead" },
		],
	])("treats a real undated entry after %s as one that needs dates", (_name, above, heading) => {
		const data = entryAfter(above, heading);

		expect(codesOf(data)).toContain("EMPTY_PERIOD");
		expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
		expect(atsVerdict(lint(data))).toBe("clean");
	});

	it.each([
		[
			"through",
			"<ul><li>Reduced processing time 40% through</li></ul>",
			"automated reconciliation for every regional desk",
		],
		["using", "<ul><li>Rebuilt the billing pipeline using</li></ul>", "event sourcing and idempotent consumers"],
		["including", "<ul><li>Hired 12 engineers including</li></ul>", "two staff engineers and a manager"],
		["a noun phrase", "<ul><li>Reduced processing time for the payments</li></ul>", "team by 40% across all regions"],
		[
			"an open last bullet among closed ones",
			"<ul><li>Led the platform migration.</li><li>Grew the team from 8 to 40 while keeping</li></ul>",
			"senior engineers on call across every region",
		],
		[
			"during",
			"<ul><li>Kept checkout up during</li></ul>",
			"Black Friday Cyber Monday Peak Season Traffic Across All Twelve Regional Markets",
		],
	])("reads the rest of a sentence cut at %s as part of the entry above", (_name, above, company) => {
		const data = entryAfter(above, { company });

		expect(codesOf(data)).toContain("FRAGMENTED_ENTRY");
		expect(codesOf(data)).not.toContain("EMPTY_PERIOD");
		expect(atsVerdict(lint(data))).toBe("mostly");
	});
});

it("rejoins a cut sentence in its original paragraph", () => {
	const data = makeResume((resume) => {
		resume.sections.experience.items = [
			experienceItem({ id: "a", description: "<p>Reduced processing time by</p>" }),
			experienceItem({
				id: "b",
				company: "25% across the region",
				position: "",
				location: "",
				period: "",
				description: "",
			}),
		];
	});
	expect(mergeIntoPreviousEntry(data, "/sections/experience/items/1")).toBe(true);
	expect(data.sections.experience.items[0]?.description).toBe(
		"<p>Reduced processing time by 25% across the region</p>",
	);
});
it("keeps an undated company ending in a dangling word after a closed sentence", () => {
	const data = makeResume((resume) => {
		resume.sections.experience.items = [
			experienceItem({ id: "a", description: "<p>Delivered reliable services.</p>" }),
			experienceItem({
				id: "b",
				company: "Design With",
				position: "Director",
				location: "",
				period: "",
				description: "<p>Led design.</p>",
			}),
		];
	});
	expect(codesOf(data)).not.toContain("FRAGMENTED_ENTRY");
	expect(codesOf(data)).toContain("EMPTY_PERIOD");
});
