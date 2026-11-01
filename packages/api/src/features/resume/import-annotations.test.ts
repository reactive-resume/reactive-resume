import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { createResumePdfFile } from "@reactive-resume/pdf/server";
import { templateSchema } from "@reactive-resume/schema/templates";
import { ownershipSource } from "./fixtures/pdf-ownership";

const create = vi.hoisted(() => vi.fn().mockResolvedValue("imported"));
vi.mock("./service", () => ({ resumeService: { create } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({
			from: () => ({
				// Auth selects one owner; import naming awaits the query for existing resume names.
				where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "owner", banned: false }] }),
			}),
		}),
	},
}));
const { importResumeFile } = await import("./imports");

const keys = ["education", "projects", "experience"] as const;
const linkText = "Read the thesis";
const longText =
	"Read the complete published thesis about distributed accessible scheduling systems and their careful evaluation across many fictional institutions";
const paragraph = "Studied systems.";
const linkedParagraph = (text: string) => `<p><a href="https://desc.example/thesis">${text}</a></p>`;
const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const cases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		[
			"leading-link",
			"bare-url",
			"uppercase-body",
			"uppercase-sublabels-short",
			"wrapped-link",
			"no-website",
			"no-website-leading-link",
			"no-website-wrapped-link",
			"references-first",
		].map((kind) => ({ template, layout, kind })),
	),
);

/** Keep only Summary, Experience and Education, as in a short resume. */
function keepShortResume(source: ResumeData) {
	for (const key of Object.keys(source.sections) as (keyof typeof source.sections)[])
		if (key !== "experience" && key !== "education") source.sections[key].items = [];
	source.customSections = [];
	for (const page of source.metadata.layout.pages) {
		page.main = page.main.filter((id) => ["summary", "experience", "education"].includes(id));
		page.sidebar = [];
	}
}

async function save(data: ResumeData, template: (typeof templateSchema.options)[number]) {
	const file = await createResumePdfFile({ data, template, filename: "annotations.pdf" });
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	expect(create).toHaveBeenCalledTimes(1);
	const saved = create.mock.calls[0]?.[0] as { userId: string; data: ResumeData } | undefined;
	if (!saved) throw new Error("Import did not save a resume");
	expect(saved.userId).toBe("owner");
	return saved.data;
}

it.each(cases)(
	"keeps annotation and body ownership / $template / $layout / $kind",
	async ({ template, layout, kind }) => {
		const source = ownershipSource({ template, kind: layout });
		for (const key of keys) {
			const item = source.sections[key].items[0];
			if (!item) throw new Error("Missing source record");
			if (kind === "bare-url") item.website.label = "";
			if (kind === "leading-link") item.description = linkedParagraph(linkText) + `<p>${paragraph}</p>`;
			if (kind === "wrapped-link") item.description = `<p>${paragraph}</p>` + linkedParagraph(longText);
			if (kind === "no-website" || kind === "no-website-wrapped-link") {
				item.website = { url: "", label: "", inlineLink: false };
				item.description = `<p>${paragraph}</p>` + linkedParagraph(kind === "no-website" ? linkText : longText);
			}
			if (kind === "no-website-leading-link") {
				item.website = { url: "", label: "", inlineLink: false };
				item.description = linkedParagraph(linkText) + `<p>${paragraph}</p>`;
			}
		}
		const experience = source.sections.experience.items[0];
		if (!experience) throw new Error("Missing experience");
		if (kind === "uppercase-body")
			experience.description = "<ul><li>Built reliable tools.</li></ul><p>REFERENCES</p><p>Mentored engineers.</p>";
		if (kind === "uppercase-sublabels-short") {
			// A short resume: role sub-labels in the body style must not outnumber its few real headings.
			experience.description =
				"<p>ACHIEVEMENTS</p><ul><li>Cut costs by a fifth.</li></ul><p>PROJECTS</p><ul><li>Built Atlas tooling.</li></ul><p>SKILLS</p><ul><li>Led platform reviews.</li></ul>";
			keepShortResume(source);
		}
		if (kind === "references-first")
			for (const page of source.metadata.layout.pages) {
				// A reference's phone and link sit where identity contacts often do: just below Summary or atop the sidebar.
				page.main = page.main.filter((id) => id !== "references");
				if (page.fullWidth) page.main.splice(1, 0, "references");
				else page.sidebar.unshift("references");
			}
		const data = await save(source, template);
		if (kind === "references-first") {
			expect(data.basics.website).toEqual(source.basics.website);
			expect(data.basics.customFields).toEqual([]);
			expect(data.sections.references.items).toHaveLength(1);
			expect(data.sections.references.items[0]?.name).toBe("Pat Example");
			expect(data.sections.references.items[0]?.website).toEqual(source.sections.references.items[0]?.website);
		} else if (kind === "uppercase-sublabels-short") {
			expect(plain(data.summary.content)).toBe(plain(source.summary.content));
			expect(data.sections.experience.items).toHaveLength(1);
			expect(data.sections.experience.items[0]?.website).toEqual(experience.website);
			expect(plain(data.sections.experience.items[0]?.description ?? "")).toBe(
				"ACHIEVEMENTS Cut costs by a fifth. PROJECTS Built Atlas tooling. SKILLS Led platform reviews.",
			);
			expect(data.sections.education.items).toHaveLength(1);
			expect(data.sections.education.items[0]?.school).toBe(source.sections.education.items[0]?.school);
			expect(data.sections.education.items[0]?.website).toEqual(source.sections.education.items[0]?.website);
			for (const key of ["projects", "skills", "awards"] as const) expect(data.sections[key].items).toEqual([]);
		} else if (kind === "bare-url") {
			expect(data.basics.website).toEqual(source.basics.website);
			expect(data.basics.customFields).toEqual([]);
		} else if (kind === "uppercase-body") {
			expect(plain(data.sections.experience.items[0]?.description ?? "")).toBe(
				"Built reliable tools. REFERENCES Mentored engineers.",
			);
			expect(data.sections.references.items.map((item) => item.name)).not.toContain("Mentored engineers.");
		} else
			for (const key of keys) {
				const expected = source.sections[key].items[0];
				const actual = data.sections[key].items[0];
				if (!expected || !actual) throw new Error(`Missing ${key} record`);
				expect(actual.website).toEqual(expected.website);
				expect(plain(actual.description)).toBe(plain(expected.description));
			}
	},
	60000,
);

it("keeps a Research interest beneath its real heading", async () => {
	const source = ownershipSource({ template: "azurill", kind: "two-before" });
	const interest = source.sections.interests.items[0];
	if (!interest) throw new Error("Missing source interest");
	interest.name = "RESEARCH";
	const data = await save(source, "azurill");
	expect(data.sections.interests.items[0]?.name).toBe("RESEARCH");
});

const subLabels = [
	["ACHIEVEMENTS", "Cut costs by a fifth."],
	["PROJECTS", "Built Atlas tooling."],
	["SKILLS", "Led platform reviews."],
	["LANGUAGES", "Spoke at regional meetups."],
] as const;
const subLabelCases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		[
			{ heading: 9.5, labels: 4, emphasis: "" },
			{ heading: 10, labels: 3, emphasis: "" },
			{ heading: 10.5, labels: 4, emphasis: "" },
			{ heading: 10.5, labels: 4, emphasis: "strong" },
			{ heading: 10.8, labels: 4, emphasis: "" },
		].map((typography) => ({ template, layout, ...typography })),
	),
);

it.each(subLabelCases)(
	"keeps short-resume sections beside role sub-labels / $template / $layout / heading $heading / $labels $emphasis",
	async ({ template, layout, heading, labels, emphasis }) => {
		// Headings close to the 10pt body size: only the real heading style may set the alias-count bar.
		const source = ownershipSource({ template, kind: layout });
		keepShortResume(source);
		source.metadata.typography.heading = { ...source.metadata.typography.heading, fontSize: heading };
		const runs = subLabels.slice(0, labels);
		const experience = source.sections.experience.items[0];
		const education = source.sections.education.items[0];
		if (!experience || !education) throw new Error("Missing source record");
		experience.description = runs
			.map(
				([label, bullet]) =>
					`<p>${emphasis ? `<${emphasis}>${label}</${emphasis}>` : label}</p><ul><li>${bullet}</li></ul>`,
			)
			.join("");
		const data = await save(source, template);
		expect(plain(data.summary.content)).toBe(plain(source.summary.content));
		expect(data.sections.experience.items).toHaveLength(1);
		expect(data.sections.experience.items[0]).toMatchObject({
			company: experience.company,
			position: experience.position,
			website: experience.website,
		});
		expect(plain(data.sections.experience.items[0]?.description ?? "")).toBe(runs.flat().join(" "));
		expect(data.sections.education.items).toHaveLength(1);
		expect(data.sections.education.items[0]).toMatchObject({ school: education.school, website: education.website });
		for (const key of ["projects", "skills", "awards", "languages"] as const)
			expect(data.sections[key].items).toEqual([]);
	},
	60000,
);

it.each(
	templateSchema.options.flatMap((template) => ["full-before", "two-before"].map((layout) => ({ template, layout }))),
)(
	"keeps body words when every section title is hidden / $template / $layout",
	async ({ template, layout }) => {
		// Word retention only: without printed titles the sections cannot be recovered as structure.
		const source = ownershipSource({ template, kind: layout });
		source.summary.showHeading = false;
		for (const key of Object.keys(source.sections) as (keyof typeof source.sections)[])
			source.sections[key].showHeading = false;
		for (const section of source.customSections) section.showHeading = false;
		const text = JSON.stringify(await save(source, template));
		for (const words of [
			plain(source.summary.content),
			"eBay",
			"Built reliable tools for customers across every supported device.",
			"Mentored engineers with exact complete wording.",
			"Open-source scheduling toolkit.",
		])
			expect(text).toContain(words);
	},
	60000,
);

const longBullet = (role: number, label: number, bullet: number) =>
	`Delivered careful fictional platform outcome ${role}-${label}-${bullet} for regional partners while keeping every accessible workflow available`;
const roleLabelCases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		[
			{ trigger: "blank line", heading: 10, roles: 1, bullets: 1, emphasis: "" },
			{ trigger: "blank line", heading: 10.5, roles: 1, bullets: 1, emphasis: "" },
			{ trigger: "page break", heading: 10.5, roles: 3, bullets: 1, emphasis: "" },
			{ trigger: "page break", heading: 10.5, roles: 3, bullets: 3, emphasis: "" },
			{ trigger: "page break", heading: 10.5, roles: 3, bullets: 3, emphasis: "strong" },
		].map((variant) => ({ template, layout, ...variant })),
	),
);

it.each(roleLabelCases)(
	"keeps entries when a role sub-label is isolated / $template / $layout / $trigger / heading $heading / $roles roles x $bullets $emphasis",
	async ({ template, layout, trigger, heading, roles, bullets, emphasis }) => {
		// A blank paragraph or a page top isolates a body sub-label; it must not outvote the real heading style.
		const source = ownershipSource({ template, kind: layout });
		keepShortResume(source);
		source.metadata.typography.heading = { ...source.metadata.typography.heading, fontSize: heading };
		const first = source.sections.experience.items[0];
		const education = source.sections.education.items[0];
		if (!first || !education) throw new Error("Missing source record");
		for (let role = 1; role <= roles; role++) {
			const item = role === 1 ? first : structuredClone(first);
			if (role > 1) {
				item.id = `${first.id}-${role}`;
				item.company = `Fictional Company ${role}`;
				item.position = `Staff Engineer ${role}`;
				item.website = { url: `https://example.invalid/experience-${role}`, label: "Details", inlineLink: false };
				source.sections.experience.items.push(item);
			}
			item.description = subLabels
				.map(([label, bullet], index) => {
					const items = [bullet, ...Array.from({ length: bullets - 1 }, (_, n) => longBullet(role, index, n + 1))];
					const text = emphasis ? `<${emphasis}>${label}</${emphasis}>` : label;
					return `${trigger === "blank line" ? "<p></p>" : ""}<p>${text}</p><ul>${items.map((entry) => `<li>${entry}</li>`).join("")}</ul>`;
				})
				.join("");
		}
		const data = await save(source, template);
		expect(plain(data.summary.content)).toBe(plain(source.summary.content));
		expect(data.sections.experience.items).toHaveLength(roles);
		source.sections.experience.items.forEach((expected, index) => {
			const actual = data.sections.experience.items[index];
			expect(actual).toMatchObject({
				company: expected.company,
				position: expected.position,
				website: expected.website,
			});
			expect(plain(actual?.description ?? "")).toBe(plain(expected.description));
		});
		expect(data.sections.education.items).toHaveLength(1);
		expect(data.sections.education.items[0]).toMatchObject({ school: education.school, website: education.website });
		for (const key of ["projects", "skills", "awards", "languages"] as const)
			expect(data.sections[key].items).toEqual([]);
	},
	60000,
);

const headingStyleCases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		["body font", "body size", "sub-labels 10.5"].map((style) => ({ template, layout, style })),
	),
);

it.each(headingStyleCases)(
	"keeps a full resume's entries with headings in the $style / $template / $layout",
	async ({ template, layout, style }) => {
		const source = ownershipSource({ template, kind: layout });
		const { body, heading } = source.metadata.typography;
		if (style === "body font") source.metadata.typography.heading = { ...body };
		if (style === "body size") source.metadata.typography.heading = { ...heading, fontSize: body.fontSize };
		const experience = source.sections.experience.items[0];
		const education = source.sections.education.items[0];
		if (!experience || !education) throw new Error("Missing source record");
		if (style === "sub-labels 10.5") {
			source.metadata.typography.heading = { ...heading, fontSize: 10.5 };
			experience.description = subLabels
				.map(([label, bullet]) => `<p>${label}</p><ul><li>${bullet}</li></ul>`)
				.join("");
		}
		const data = await save(source, template);
		expect(plain(data.summary.content)).toBe(plain(source.summary.content));
		expect(data.sections.experience.items[0]).toMatchObject({
			company: experience.company,
			position: experience.position,
		});
		expect(plain(data.sections.experience.items[0]?.description ?? "")).toBe(plain(experience.description));
		expect(data.sections.education.items.map((item) => item.school)).toEqual([education.school]);
	},
	60000,
);

it.each(
	templateSchema.options.flatMap((template) => ["full-before", "two-before"].map((layout) => ({ template, layout }))),
)(
	"keeps a header-only PDF with linked custom fields out of Summary / $template / $layout",
	async ({ template, layout }) => {
		const source = ownershipSource({ template, kind: layout });
		source.basics.customFields = ownershipSource({ template, kind: "custom-links" }).basics.customFields;
		source.summary.content = "";
		for (const key of Object.keys(source.sections) as (keyof typeof source.sections)[]) source.sections[key].items = [];
		source.customSections = [];
		const data = await save(source, template);
		expect(data.summary.content).toBe("");
		expect(Object.values(data.sections).reduce((count, section) => count + section.items.length, 0)).toBe(0);
		expect([data.basics.email, data.basics.phone]).toEqual([source.basics.email, source.basics.phone]);
	},
	60000,
);

it.each(
	templateSchema.options.flatMap((template) => ["full-before", "two-before"].map((layout) => ({ template, layout }))),
)(
	"keeps body words but not identity in Summary when Summary and Experience titles are hidden / $template / $layout",
	async ({ template, layout }) => {
		// Word retention only: with no printed title the role cannot be recovered as an entry.
		const source = ownershipSource({ template, kind: layout });
		for (const key of Object.keys(source.sections) as (keyof typeof source.sections)[])
			if (key !== "experience") source.sections[key].items = [];
		source.customSections = [];
		source.summary.showHeading = false;
		source.sections.experience.showHeading = false;
		const experience = source.sections.experience.items[0];
		if (!experience) throw new Error("Missing source record");
		const data = await save(source, template);
		expect([data.basics.email, data.basics.phone, data.basics.website.url]).toEqual([
			source.basics.email,
			source.basics.phone,
			source.basics.website.url,
		]);
		const summary = plain(data.summary.content);
		for (const identity of [source.basics.email, source.basics.phone]) expect(summary).not.toContain(identity);
		const text = plain(JSON.stringify(data));
		for (const words of [
			plain(source.summary.content),
			experience.company,
			...plain(experience.description).split(". "),
		])
			expect(text).toContain(words.replace(/\.$/, ""));
	},
	60000,
);

const isolatedLabelCases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		[
			"bold labels once after blank lines / heading 10.5",
			"bold labels once after blank lines / heading 10",
			"bold labels once across a page / heading 10.5",
			"Technical Skills title and a bold label / heading 10.5",
			"Achievements title and a bold label / heading 10.5",
			"Qualifications title and a bold label / heading 10.5",
			"Technical Skills title and a Languages skill group / heading 10.5",
			"body typography headings and a bold label",
			"Speaking section and a bold label / heading 10.5",
		].map((variant) => ({ template, layout, variant })),
	),
);

it.each(isolatedLabelCases)(
	"keeps the real sections beside isolated or duplicated labels / $template / $layout / $variant",
	async ({ template, layout, variant }) => {
		// A sub-label style inside one section, or a second title for one section key, must not unseat the real headings.
		const source = ownershipSource({ template, kind: layout });
		const talk = source.customSections[0];
		if (!talk) throw new Error("Missing source custom section");
		const custom = (id: string, title: string) => {
			source.customSections.push({
				...structuredClone(talk),
				id,
				title,
				items: [
					{ id: `${id}-1`, hidden: false, content: "<p>Certified first aider with current fictional credentials.</p>" },
				],
			});
			const page = source.metadata.layout.pages[0];
			if (page && !page.fullWidth && title !== "Speaking" && title !== "Qualifications") page.sidebar.push(id);
			else page?.main.push(id);
		};
		const short =
			variant.startsWith("bold labels") || variant.startsWith("Qualifications") || variant.startsWith("Speaking");
		if (short) keepShortResume(source);
		const size = /heading ([\d.]+)/.exec(variant)?.[1];
		if (size) source.metadata.typography.heading = { ...source.metadata.typography.heading, fontSize: Number(size) };
		if (variant.startsWith("body typography"))
			source.metadata.typography.heading = { ...source.metadata.typography.body };
		const experience = source.sections.experience.items[0];
		const education = source.sections.education.items[0];
		if (!experience || !education) throw new Error("Missing source record");
		const bold = (label: string, bullets: string[]) =>
			`<p><strong>${label}</strong></p><ul>${bullets.map((bullet) => `<li>${bullet}</li>`).join("")}</ul>`;
		if (variant.includes("blank lines"))
			experience.description = subLabels.map(([label, bullet]) => `<p></p>${bold(label, [bullet])}`).join("");
		else if (variant.includes("across a page"))
			experience.description = subLabels
				.map(([label, bullet], index) =>
					bold(label, [bullet, ...Array.from({ length: 9 }, (_, n) => longBullet(1, index, n + 1))]),
				)
				.join("");
		else if (!variant.includes("skill group"))
			experience.description += `<p></p>${bold("Projects", ["Built Atlas tooling."])}`;
		if (variant.startsWith("Technical Skills")) custom("techskills", "Technical Skills");
		if (variant.startsWith("Achievements")) custom("achievements", "Achievements");
		if (variant.startsWith("Qualifications")) custom("qualifications", "Qualifications");
		if (variant.startsWith("Speaking")) custom("speaking", "Speaking");
		const skill = source.sections.skills.items[0];
		if (variant.includes("skill group") && skill) {
			skill.name = "Languages";
			skill.keywords = ["TypeScript", "Go"];
		}
		const data = await save(source, template);
		expect(plain(data.summary.content)).toBe(plain(source.summary.content));
		expect(data.sections.experience.items).toHaveLength(1);
		expect(data.sections.experience.items[0]).toMatchObject({
			company: experience.company,
			position: experience.position,
			website: experience.website,
		});
		expect(plain(data.sections.experience.items[0]?.description ?? "")).toBe(plain(experience.description));
		expect(data.sections.education.items[0]?.school).toBe(education.school);
		// Known smeargle limit: with body-style headings an isolated degree line takes the Education website.
		if (!(template === "smeargle" && variant.startsWith("body typography")))
			expect(data.sections.education.items[0]?.website).toEqual(education.website);
		if (!short) expect(data.sections.projects.items[0]?.name).toBe(source.sections.projects.items[0]?.name);
		if (variant.includes("skill group"))
			expect(data.sections.skills.items.map((item) => item.name)).toContain("Languages");
		const text = plain(JSON.stringify(data));
		if (variant.startsWith("Qualifications"))
			expect(text).toContain("Certified first aider with current fictional credentials");
		if (variant.startsWith("Speaking"))
			// Some templates print section titles in capitals or letter-spaced; the title text is what the PDF carries.
			expect(
				data.customSections.map((section) => [
					section.title.toLowerCase().replace(/\s/g, ""),
					plain(section.items[0]?.content ?? ""),
				]),
			).toContainEqual(["speaking", "Certified first aider with current fictional credentials."]);
	},
	60000,
);
