import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { createResumePdfFile } from "@reactive-resume/pdf/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";
import { generateId } from "@reactive-resume/utils/string";
const create = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ resumeService: { create } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({
			from: () => ({
				// The owner lookup takes one row; the import's name lookup finds no other resume named the same.
				where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "owner", banned: false }] }),
			}),
		}),
	},
}));
const { importResumeFile } = await import("./imports");

it.each([
	{
		name: "senior.pdf",
		roles: 10,
		position: (role: number) => `Engineering Role ${role}`,
		person: "Morgan Chen",
		period: (index: number) => (index === 0 ? "2020 – Present" : `${2020 - index - 1} – ${2020 - index}`),
	},
	{
		name: "freelancer-azurill.pdf",
		roles: 4,
		position: () => "Consultant",
		person: "Sam Taylor",
		period: () => "2020 – Present",
	},
])(
	"imports $name through extraction, validation and authenticated creation",
	async ({ name, roles, position, person, period }) => {
		create.mockClear();
		const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
		await call(
			importResumeFile,
			{ file: new File([bytes], name), format: "PDF" },
			{
				context: { locale: "en-US", reqHeaders: new Headers() },
			},
		);
		const saved = create.mock.calls[0]?.[0] as { userId: string; data: ResumeData };
		expect(create).toHaveBeenCalledTimes(1);
		expect(saved.userId).toBe("owner");
		expect(saved.data.basics.name).toBe(person);
		expect(saved.data.sections.experience.items).toHaveLength(roles);
		for (const [index, entry] of saved.data.sections.experience.items.entries()) {
			const role = index + 1;
			expect(entry).toMatchObject({
				company: `Synthetic Studio ${role}`,
				position: position(role),
				location: "Remote",
				period: period(index),
			});
			expect(entry.description).toBe(
				`<ul>${[1, 2, 3].map((bullet) => `<li>Project ${role}.${bullet}: Built accessible services for global customers, mentored four engineers, and reduced processing time by 25%. Tracked reliability and customer feedback.</li>`).join("")}</ul>`,
			);
		}
		expect(saved.data.sections.skills.items.map((item) => item.name)).toEqual([
			"Engineering",
			"Advanced",
			"TypeScript",
			"Accessibility",
			"Product strategy",
			"Research",
		]);
		expect(saved.data.sections.skills.items.some((item) => item.name.includes("Synthetic Studio"))).toBe(false);
		expect(saved.data.summary.content).toContain("Experienced professional");
		expect(saved.data.sections.education.items[0]?.school).toBe("Synthetic University");
	},
);

it("imports JSON Resume into the authenticated account and rejects invalid files before writing", async () => {
	const context = { locale: "en-US" as const, reqHeaders: new Headers() };
	const id = await call(
		importResumeFile,
		{ file: new File([JSON.stringify({ basics: { name: "Ada Lovelace" } })], "resume.json"), format: "JSON_RESUME" },
		{ context },
	);
	expect(create).toHaveBeenCalledWith(
		expect.objectContaining({
			id,
			userId: "owner",
			name: "Ada Lovelace",
			data: expect.objectContaining({ basics: expect.objectContaining({ name: "Ada Lovelace" }) }),
		}),
	);
	create.mockClear();
	await expect(
		call(importResumeFile, { file: new File(["bad json"], "resume.json"), format: "JSON_RESUME" }, { context }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(create).not.toHaveBeenCalled();
});

const diverseRoles = [
	["eBay", "Senior Engineer", "Remote"],
	["3M", "Engineer, Platform", "Mountain View, CA"],
	["iRobot", "Staff Engineer", "Boston, MA"],
	["1Password", "Director, Product", "Singapore"],
	["Globex", "Engineering Manager", "Berlin, Germany"],
	["Initech", "Developer", "Austin, TX"],
	["Umbrella", "Analyst", "Hybrid"],
	["Hooli", "Engineer", "Palo Alto, CA"],
	["Stark Industries", "Consultant", "New York, NY"],
	["Wayne Enterprises", "Intern", "Gotham, NJ"],
] as const;
const bulletText = (role: number, bullet: number) =>
	[
		`Shipped ${role}.${bullet} the Analytics Platform for Global Enterprise Customers Across Europe And North America With Stronger Reliability`,
		`Reduced costs ${role}.${bullet} for the data pipeline used by the finance and operations organisation by 35`,
		`Mentored engineers ${role}.${bullet} through design reviews and pairing sessions and ownership of production services`,
	][bullet - 1] ?? "";

it.each(templateSchema.options)(
	"exports and imports complete role headers and bullets through %s",
	async (template) => {
		const source = structuredClone(sampleResumeData);
		source.picture.hidden = true;
		const sampleRole = source.sections.experience.items[0];
		if (!sampleRole) throw new Error("Sample resume must include an experience fixture.");
		source.sections.experience.items = diverseRoles.map(([company, position, location], index) => ({
			...sampleRole,
			id: generateId(),
			company,
			position,
			location,
			period: `${2020 - index} – ${2021 - index}`,
			dates: { start: String(2020 - index), end: String(2021 - index), present: false },
			description: `<ul>${[1, 2, 3].map((bullet) => `<li>${bulletText(index + 1, bullet)}</li>`).join("")}</ul>`,
		}));
		const file = await createResumePdfFile({ data: source, template, filename: `${template}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { userId: string; data: ResumeData };
		expect(saved.userId).toBe("owner");
		expect(saved.data.sections.experience.items).toHaveLength(diverseRoles.length);
		for (const [index, original] of source.sections.experience.items.entries()) {
			expect(saved.data.sections.experience.items[index]).toMatchObject({
				company: original.company,
				position: original.position,
				location: original.location,
				period: original.period,
				description: original.description,
			});
		}
	},
	60000,
);

it.each(templateSchema.options)("imports the shipped %s PDF without losing its work history", async (template) => {
	const file = new File(
		[readFileSync(new URL(`../../../../../apps/web/public/templates/pdf/${template}.pdf`, import.meta.url))],
		`${template}.pdf`,
	);
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
	const threeRoles = ["azurill", "chikorita", "ditgar", "ditto", "gengar", "glalie", "leafish", "persian", "pikachu"];
	expect(saved.data.sections.experience.items).toHaveLength(threeRoles.includes(template) ? 3 : 2);
	for (const role of saved.data.sections.experience.items) {
		expect(role.company).not.toBe("");
		expect(role.position).not.toBe("");
		expect(role.period).not.toBe("");
		expect(role.description).toContain("<li>");
	}
});

const flowCases = [
	"singleton",
	"custom",
	"flat-custom",
	"spacing-2",
	"spacing-2.5",
	"page-split",
	"column-page",
	"long-a4",
] as const;
const flowTemplates = templateSchema.options.flatMap((template) => flowCases.map((kind) => ({ template, kind })));
const flowingBullet = "TARGET " + "Built useful systems for Global Customers. ".repeat(15).trim() + " END";
const spacedBullet =
	"Built useful systems for Global Customers With Careful Accessibility Reviews Across Every Product Surface And Deployment And Better Reliability Across All Supported Devices";
const talkId = "019bef5a-93e4-7746-ad39-111111111111";

it.each(flowTemplates)(
	"preserves $kind sections and complete saved bullets in $template",
	async ({ template, kind }) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Fictional Reviewer";
		source.picture.hidden = true;
		source.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
		const text =
			kind === "page-split" || kind === "column-page"
				? flowingBullet
				: kind === "long-a4"
					? "TARGET " +
						"Built accessible systems for global customers with careful reliability reviews. ".repeat(160).trim() +
						" END"
					: kind.startsWith("spacing")
						? spacedBullet
						: "Built useful tools";
		if (kind === "singleton" || kind === "flat-custom") {
			source.metadata.typography.body = {
				...source.metadata.typography.body,
				fontFamily: "Helvetica",
				fontSize: 10,
				fontWeights: ["400"],
			};
			source.metadata.typography.heading = { ...source.metadata.typography.body };
		}
		if (kind.startsWith("spacing")) source.metadata.typography.body.lineHeight = kind === "spacing-2" ? 2 : 2.5;
		if (kind === "page-split" || kind === "column-page" || kind === "long-a4") {
			source.metadata.typography.body.fontFamily = "Helvetica";
			source.metadata.typography.heading.fontFamily = "Helvetica";
			if (kind !== "long-a4")
				source.metadata.stylesheet = {
					mode: "semantic",
					source: { languageVersion: 1, text: "@version 1; page { size: 300pt 300pt; }" },
				};
			if (kind === "column-page") {
				source.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
				source.sections.skills = structuredClone(sampleResumeData.sections.skills);
			}
		}
		const original = sampleResumeData.sections.experience.items[0];
		if (!original) throw new Error("Sample must include an experience fixture.");
		source.sections.experience.items = [
			{
				...original,
				company: "Example Labs",
				position: "Engineer",
				location: "Remote",
				period: "2020 – 2021",
				dates: { start: "2020", end: "2021", present: false },
				description: `<ul><li>${text}</li><li>Second complete bullet</li></ul>`,
			},
		];
		if (kind === "custom" || kind === "flat-custom") {
			source.customSections = [
				{
					id: talkId,
					type: "summary",
					title: "SELECTED TALKS",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [{ id: generateId(), hidden: false, content: "<p>Spoke at Fictional Conference.</p>" }],
				},
			];
			source.metadata.layout.pages[0]?.main.push(talkId);
		}
		const file = await createResumePdfFile({ data: source, template, filename: `${kind}-${template}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { userId: string; data: ResumeData };
		expect(saved.userId).toBe("owner");
		expect(saved.data.sections.experience.items).toHaveLength(1);
		expect(saved.data.sections.experience.items[0]).toMatchObject({
			company: "Example Labs",
			position: "Engineer",
			location: "Remote",
			period: "2020 – 2021",
			description: source.sections.experience.items[0]?.description,
		});
		expect(saved.data.customSections).toHaveLength(kind === "custom" || kind === "flat-custom" ? 1 : 0);
		if (kind === "custom" || kind === "flat-custom") {
			expect(saved.data.customSections[0]?.title.replace(/\s/g, "")).toBe("SELECTEDTALKS");
			expect(saved.data.customSections[0]?.items).toMatchObject([{ content: "<p>Spoke at Fictional Conference.</p>" }]);
		}
	},
	60000,
);

const boundaryCases = ["custom-only", "custom-localized", "short", "empty", "paragraph-a4", "paragraph-small"] as const;
const boundaryTemplates = templateSchema.options.flatMap((template) =>
	boundaryCases.map((kind) => ({ template, kind })),
);
it.each(boundaryTemplates)(
	"preserves role/custom content and block association for $template / $kind",
	async ({ template, kind }) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Fictional Reviewer";
		source.basics.email = "reviewer@example.invalid";
		source.picture.hidden = true;
		source.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
		const original = sampleResumeData.sections.experience.items[0];
		if (!original) throw new Error("Missing role fixture");
		let description = kind === "empty" ? "" : "<ul><li>Built useful tools</li></ul>";
		if (kind.startsWith("paragraph")) {
			source.metadata.typography.body.fontFamily = "Helvetica";
			source.metadata.typography.heading.fontFamily = "Helvetica";
			const repeats = kind === "paragraph-a4" ? 113 : 6;
			description = `<ul><li>${"Delivered Global Products For Every Customer. ".repeat(repeats).trim()}</li></ul><p>References available on request.</p>`;
			if (kind === "paragraph-small")
				source.metadata.stylesheet = {
					mode: "semantic",
					source: { languageVersion: 1, text: "@version 1; page { size: 300pt 250pt; }" },
				};
		}
		source.sections.experience.items = [
			{
				...original,
				company: "eBay",
				position: "Engineer, Platform",
				location: "Remote",
				period: "2020 – 2021",
				dates: { start: "2020", end: "2021", present: false },
				website: { url: "", label: "", inlineLink: false },
				description,
			},
		];
		if (kind.startsWith("custom")) {
			source.sections.experience.items = [];
			source.customSections = [
				{
					id: talkId,
					type: "summary",
					title: kind === "custom-only" ? "SELECTED TALKS" : "AUSGEWÄHLTE VORTRÄGE",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [
						{ id: generateId(), hidden: false, content: "<p>Spoke at Fictional Conference about useful systems.</p>" },
					],
				},
			];
			source.metadata.layout.pages = [{ fullWidth: true, main: [talkId], sidebar: [] }];
		}
		const file = await createResumePdfFile({ data: source, template, filename: `${template}-${kind}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
		const data = saved.data;
		// Exact identity check targets the introduced centered-header regression. Wrapped names are a separate mapper limit.
		if (template === "ditto" && kind !== "paragraph-small")
			expect(data.basics).toMatchObject({ name: source.basics.name, email: source.basics.email });
		expect(data.sections.experience.items).toHaveLength(source.sections.experience.items.length);
		if (kind.startsWith("custom")) {
			expect(data.customSections).toHaveLength(1);
			expect(data.customSections[0]?.items).toMatchObject([
				{ content: "<p>Spoke at Fictional Conference about useful systems.</p>" },
			]);
			expect(data.customSections[0]?.title.replace(/\s/g, "")).toBe(source.customSections[0]?.title.replace(/\s/g, ""));
		} else
			expect(data.sections.experience.items[0]).toMatchObject({
				company: "eBay",
				position: "Engineer, Platform",
				location: "Remote",
				period: "2020 – 2021",
				description,
			});
	},
	60000,
);

it.each(["custom-only.pdf", "ditto-short.pdf", "bullet-prose-page.pdf"])(
	"preserves the frozen real regression %s",
	async (name) => {
		create.mockClear();
		const file = new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name);
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
		const data = saved.data;
		if (name === "custom-only.pdf")
			expect(data.customSections[0]?.items).toMatchObject([
				{ content: "<p>Spoke at Fictional Conference about useful systems.</p>" },
			]);
		else if (name === "ditto-short.pdf") {
			expect(data.basics).toMatchObject({ name: "Fictional Reviewer", email: "reviewer@example.invalid" });
			expect(data.sections.experience.items).toHaveLength(1);
			expect(data.sections.experience.items[0]).toMatchObject({
				company: "eBay",
				position: "Engineer, Platform",
				location: "Remote",
				period: "2020 – 2021",
				description: "<ul><li>Built useful tools</li></ul>",
			});
		} else
			expect(data.sections.experience.items[0]?.description).toBe(
				`<ul><li>${"Delivered Global Products For Every Customer. ".repeat(113).trim()}</li></ul><p>References available on request.</p>`,
			);
	},
);

const geometryCases = [
	"custom-flat",
	"custom-no-name",
	"custom-flat-no-name",
	"custom-flat-no-identity",
	"custom-title-flat",
	"custom-localized-flat",
	"prose-1.5",
	"prose-2",
	"prose-2.5",
	"wrapped-prose",
] as const;
it.each(templateSchema.options.flatMap((template) => geometryCases.map((kind) => ({ template, kind }))))(
	"preserves geometry boundaries in $template / $kind",
	async ({ template, kind }) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Morgan Fiction";
		source.basics.email = "morgan@example.invalid";
		source.picture.hidden = true;
		source.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
		if (kind.includes("flat")) {
			source.metadata.typography.body = {
				...source.metadata.typography.body,
				fontFamily: "Helvetica",
				fontSize: 10,
				fontWeights: ["400"],
			};
			source.metadata.typography.heading = { ...source.metadata.typography.body };
		}
		const custom = kind.startsWith("custom");
		if (custom) {
			if (kind.includes("no-name") || kind.includes("no-identity")) source.basics.name = "";
			if (kind.includes("no-identity")) source.basics.email = "";
			source.customSections = [
				{
					id: talkId,
					type: "summary",
					title:
						kind === "custom-title-flat"
							? "Selected conversations"
							: kind === "custom-localized-flat"
								? "AUSGEWÄHLTE VORTRÄGE"
								: "SELECTED TALKS",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [
						{ id: generateId(), hidden: false, content: "<p>Spoke at Fictional Conference about useful systems.</p>" },
					],
				},
			];
			source.metadata.layout.pages = [{ fullWidth: true, main: [talkId], sidebar: [] }];
		} else {
			const original = sampleResumeData.sections.experience.items[0];
			if (!original) throw new Error("Missing role");
			source.metadata.typography.body.lineHeight = kind === "prose-2" ? 2 : kind === "prose-2.5" ? 2.5 : 1.5;
			const text =
				kind === "wrapped-prose"
					? "Built reliable tools for Global Customers Across Every Supported Platform. ".repeat(8).trim()
					: "Built useful tools";
			source.sections.experience.items = [
				{
					...original,
					company: "eBay",
					position: "Engineer, Platform",
					location: "Remote",
					period: "2020 – 2021",
					dates: { start: "2020", end: "2021", present: false },
					website: { url: "", label: "", inlineLink: false },
					description: `<ul><li>${text}</li></ul><p style="margin-left: 12pt">References available on request.</p>`,
				},
			];
		}
		const file = await createResumePdfFile({ data: source, template, filename: `geometry-${template}-${kind}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
		const data = saved.data;
		expect(data.sections.experience.items).toHaveLength(custom ? 0 : 1);
		if (custom) {
			expect(data.customSections).toHaveLength(1);
			expect(data.customSections[0]?.title.replace(/\s/g, "").toUpperCase()).toBe(
				source.customSections[0]?.title.replace(/\s/g, "").toUpperCase(),
			);
			expect(data.customSections[0]?.items).toMatchObject([
				{ content: "<p>Spoke at Fictional Conference about useful systems.</p>" },
			]);
		} else {
			const expected = source.sections.experience.items[0];
			expect(data.sections.experience.items[0]).toMatchObject({
				company: expected?.company,
				position: expected?.position,
				location: expected?.location,
				period: expected?.period,
				description: expected?.description.replace(' style="margin-left: 12pt"', ""),
			});
		}
	},
	60000,
);

it.each(["custom-flat.pdf", "custom-no-name.pdf", "indented-prose.pdf", "glalie-rail.pdf"])(
	"preserves frozen v4 review content / %s",
	async (name) => {
		create.mockClear();
		await call(
			importResumeFile,
			{ file: new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name), format: "PDF" },
			{ context: { locale: "en-US", reqHeaders: new Headers() } },
		);
		const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
		const data = saved.data;
		if (name.startsWith("custom")) {
			expect(data.customSections).toHaveLength(1);
			expect(data.customSections[0]).toMatchObject({
				title: "SELECTED TALKS",
				items: [{ content: "<p>Spoke at Fictional Conference about useful systems.</p>" }],
			});
		} else if (name === "indented-prose.pdf")
			expect(data.sections.experience.items[0]).toMatchObject({
				company: "eBay",
				position: "Engineer, Platform",
				location: "Remote",
				period: "2020 – 2021",
				description: "<ul><li>Built useful tools</li></ul><p>References available on request.</p>",
			});
		else {
			expect(data.sections.experience.items).toHaveLength(4);
			const companies = ["eBay", "3M", "iRobot", "eBay"];
			const positions = ["Engineer, Platform", "Director, Product", "Staff Engineer", "Engineer, Platform"];
			const locations = ["Remote", "Berlin, Germany", "Mountain View, CA", "Remote"];
			const text =
				"Start " +
				"Built Global Products For All Customers Across Every Single Supported Platform. ".repeat(4).trim() +
				" END";
			for (const [i, entry] of data.sections.experience.items.entries())
				expect(entry).toMatchObject({
					company: companies[i],
					position: positions[i],
					location: locations[i],
					period: `${2020 - i} – ${2021 - i}`,
					description: `<ul><li>${text}</li><li>Last complete bullet</li></ul>`,
				});
		}
	},
);

const recordCases = [
	"inline",
	"compact",
	"date-column",
	"eyebrow",
	"role-first",
	"item-columns",
	"three-columns",
	"four-records",
	"inline-no-place",
	"compact-no-place",
	"local-leading",
	"local-leading-2.5",
	"local-size",
	"rich",
	"custom-date",
	"custom-second",
	"custom-bodylarge",
	"custom-digit",
	"custom-url",
	"custom-links",
	"custom-sentence",
] as const;
it.each(templateSchema.options.flatMap((template) => recordCases.map((kind) => ({ template, kind }))))(
	"imports structured records and complete wording in $template / $kind",
	async ({ template, kind }) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Jordan Sample";
		source.basics.email = "jordan@example.invalid";
		source.picture.hidden = true;
		source.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
		const original = sampleResumeData.sections.experience.items[0];
		if (!original) throw new Error("Missing role fixture");
		const words =
			"Delivered reliable tools Across Every Platform For Every Customer With Precise Content And Ownership. "
				.repeat(5)
				.trim();
		source.sections.experience.items = [
			{
				...original,
				company: "Orbital Labs",
				position: "Engineer, Platform",
				location: "HQ",
				period: "2020 – 2021",
				dates: { start: "2020", end: "2021", present: false },
				website: { url: "", label: "", inlineLink: false },
				description: `<ul><li>${words}</li><li>Final item</li></ul>`,
			},
		];
		const firstRecord = source.sections.experience.items[0];
		if (!firstRecord) throw new Error("Missing source record");
		if (kind === "item-columns" || kind === "three-columns" || kind === "four-records") {
			source.sections.experience.columns = kind === "three-columns" ? 3 : 2;
			source.sections.experience.items.push({
				...firstRecord,
				id: generateId(),
				company: "eBay",
				position: "Director, Product",
				location: "Berlin, Germany",
				period: "2019 – 2020",
				dates: { start: "2019", end: "2020", present: false },
				description: "<ul><li>Second employer complete achievement</li></ul>",
			});
			if (kind === "three-columns" || kind === "four-records")
				source.sections.experience.items.push({
					...firstRecord,
					id: generateId(),
					company: "3M",
					position: "Staff Engineer",
					location: "Remote",
					period: "2018 – 2019",
					dates: { start: "2018", end: "2019", present: false },
				});
			if (kind === "four-records")
				source.sections.experience.items.push({
					...firstRecord,
					id: generateId(),
					company: "iRobot",
					position: "Analyst",
					location: "Boston",
					period: "2017 – 2018",
					dates: { start: "2017", end: "2018", present: false },
				});
		} else if (kind === "local-leading") firstRecord.description = `<ul><li style="line-height: 2">${words}</li></ul>`;
		else if (kind === "local-leading-2.5")
			firstRecord.description = `<ul><li style="line-height: 2.5">${words}</li></ul>`;
		else if (kind === "local-size")
			firstRecord.description = `<ul><li><span style="font-size: 14pt">${words}</span></li></ul>`;
		else if (kind === "rich")
			firstRecord.description =
				"<ul><li>Built <strong>Important Systems</strong> for <em>Customers Worldwide</em> With Reliable Tools Across Every Supported Platform</li></ul>";
		else if (
			kind === "custom-date" ||
			kind === "custom-url" ||
			kind === "custom-links" ||
			kind === "custom-sentence" ||
			kind === "custom-second" ||
			kind === "custom-bodylarge" ||
			kind === "custom-digit"
		) {
			if (kind !== "custom-second") source.sections.experience.items = [];
			source.basics.name = "";
			source.metadata.typography.body = {
				...source.metadata.typography.body,
				fontFamily: "Helvetica",
				fontSize: 11,
				fontWeights: ["400"],
			};
			source.metadata.typography.heading = { ...source.metadata.typography.body };
			if (kind === "custom-bodylarge") source.metadata.typography.body.fontSize = 15;
			source.customSections = [
				{
					id: talkId,
					type: "summary",
					title:
						kind === "custom-digit"
							? "TALKS 2026"
							: kind === "custom-sentence"
								? "A place for things."
								: "Chosen conversations",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [
						{
							id: generateId(),
							hidden: false,
							content:
								kind === "custom-date"
									? "<p>Presented 2020 – 2021 research</p>"
									: kind === "custom-links"
										? "<p>Discussed https://one.invalid and https://two.invalid systems</p>"
										: "<p>Discussed https://example.invalid systems with colleagues</p>",
						},
					],
				},
			];
			source.metadata.layout.pages = [
				{ fullWidth: true, main: kind === "custom-second" ? ["experience", talkId] : [talkId], sidebar: [] },
			];
		} else
			source.metadata.design.entry = {
				layout:
					kind === "role-first"
						? "stacked"
						: kind === "inline-no-place"
							? "inline"
							: kind === "compact-no-place"
								? "compact"
								: kind,
				lead: kind === "role-first" ? "role" : "organization",
				accent: "none",
			};
		if (kind === "inline-no-place" || kind === "compact-no-place") firstRecord.location = "";
		const file = await createResumePdfFile({ data: source, template, filename: `records-${template}-${kind}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { userId: string; data: ResumeData };
		expect(saved.userId).toBe("owner");
		expect(saved.data.sections.experience.items).toHaveLength(source.sections.experience.items.length);
		for (const [i, record] of source.sections.experience.items.entries()) {
			expect(saved.data.sections.experience.items[i]).toMatchObject({
				company: record.company,
				position: kind === "eyebrow" ? record.position.toUpperCase() : record.position,
				location: kind === "eyebrow" ? record.location.toUpperCase() : record.location,
				period: record.period,
				description: record.description.replace(/ style="[^"]*"/g, "").replace(/<\/?(?:strong|em|span)[^>]*>/g, ""),
			});
		}
		if (kind.startsWith("custom")) {
			expect(saved.data.customSections).toHaveLength(1);
			expect(saved.data.customSections[0]?.items[0]?.content).toBe(source.customSections[0]?.items[0]?.content);
			expect(saved.data.basics.email).toBe(source.basics.email);
		}
	},
	60000,
);

it("preserves external PDF word separators and adjacent split words", async () => {
	const file = new File(
		[readFileSync(new URL("./fixtures/external-word-runs.pdf", import.meta.url))],
		"external-word-runs.pdf",
	);
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
	expect(saved.data.sections.experience.items).toHaveLength(1);
	expect(saved.data.sections.experience.items[0]).toMatchObject({
		company: "External Labs",
		position: "Engineer",
		location: "Remote",
		period: "2020 – 2021",
		description: "<ul><li>Built Important Systems for customers.</li></ul><p>Interoperable tools.</p>",
	});
});
