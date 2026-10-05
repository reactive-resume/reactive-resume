import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";

type FixtureOptions = { columns: number; gapX: number };

type TextRun = { text: string; x: number; y: number };

function fixture({ columns, gapX }: FixtureOptions): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.page.gapX = gapX;
	data.metadata.page.hideIcons = true;
	data.metadata.layout.pages = [{ fullWidth: false, main: ["projects"], sidebar: [] }];
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: "@version 1;" } };
	data.sections.projects.columns = columns;
	for (let index = 0; index < 3; index++) {
		data.sections.projects.items.push({
			id: `project-${index}`,
			hidden: false,
			name: `Project${index}`,
			period: "",
			description: `<p>Description${index} with enough words to wrap across the narrower column and preserve alignment.</p>`,
			website: { url: `https://example.com/${index}`, label: `Website${index}`, inlineLink: false },
		});
	}
	return data;
}

async function renderText(options: FixtureOptions): Promise<TextRun[]> {
	const bytes = await act(() => renderToBuffer(<ResumeDocument data={fixture(options)} template="ditgar" />));
	const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	try {
		const document = await loading.promise;
		expect(document.numPages).toBe(1);
		const page = await document.getPage(1);
		return (await page.getTextContent()).items.flatMap((item) =>
			"str" in item && item.str ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : [],
		);
	} finally {
		await loading.destroy();
	}
}

function assertAligned(runs: TextRun[]) {
	for (let index = 0; index < 3; index++) {
		const title = runs.find((run) => run.text.startsWith(`Project${index}`));
		const description = runs.find((run) => run.text.startsWith(`Description${index}`));
		const website = runs.find((run) => run.text === `Website${index}`);
		if (!title || !description || !website) throw new Error(`Missing project ${index} text`);
		expect(title.x - description.x).toBeCloseTo(0, 3);
		expect(title.x - website.x).toBeCloseTo(0, 3);
		expect(title.y).toBeGreaterThan(description.y);
	}
}

describe("Ditgar item-header alignment (#3068)", () => {
	it("aligns Projects in 1 columns at gapX 4", async () => {
		assertAligned(await renderText({ columns: 1, gapX: 4 }));
	});
});

function twoColumnFixture(sidebarSide?: "left" | "right", locale = "en-US"): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.page.hideIcons = true;
	data.metadata.page.locale = locale;
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: "@version 1;" } };
	data.basics.name = "Ada Lovelace";
	data.summary.title = "Summary";
	data.summary.content = "<p>Seasoned engineer shipping reliable systems.</p>";
	data.sections.experience.title = "Experience";
	data.sections.experience.items.push({
		id: "experience-1",
		hidden: false,
		company: "Initech",
		position: "Senior Engineer",
		location: "",
		period: "2020 - Present",
		website: { url: "", label: "", inlineLink: false },
		roles: [],
		description: "<p>Shipped reliable systems.</p>",
	});
	data.sections.profiles.title = "Profiles";
	data.sections.profiles.items.push({
		id: "profile-1",
		hidden: false,
		icon: "github-logo",
		iconColor: "",
		network: "GitHub",
		username: "ada",
		website: { url: "https://github.com/ada", label: "github.com/ada", inlineLink: false },
	});
	data.sections.skills.title = "Skills";
	data.sections.skills.items.push({
		id: "skill-1",
		hidden: false,
		icon: "code",
		iconColor: "",
		name: "TypeScript",
		proficiency: "Expert",
		level: 5,
		keywords: [],
	});
	data.metadata.layout.sidebarSide = sidebarSide;
	data.metadata.layout.pages = [{ fullWidth: false, main: ["summary", "experience"], sidebar: ["profiles", "skills"] }];
	return data;
}

const columnOrderRuns = async (sidebarSide?: "left" | "right", locale?: string) => {
	const bytes = await act(() =>
		renderToBuffer(<ResumeDocument data={twoColumnFixture(sidebarSide, locale)} template="ditgar" />),
	);
	const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	try {
		const document = await loading.promise;
		expect(document.numPages).toBe(1);
		const page = await document.getPage(1);
		return (await page.getTextContent()).items.flatMap((item, index) =>
			"str" in item && item.str ? [{ text: item.str, x: item.transform[4], index }] : [],
		);
	} finally {
		await loading.destroy();
	}
};

describe("Ditgar text-layer column order (#3543)", () => {
	it.each([
		["en-US", undefined, "left"],
		["en-US", "right", "right"],
		["ar-SA", undefined, "right"],
		["ar-SA", "left", "left"],
	] as const)(
		"emits the main column before the sidebar on the %s side (locale %s)",
		async (locale, sidebarSide, expectedSide) => {
			const runs = await columnOrderRuns(sidebarSide, locale);

			const firstIndex = (headings: string[]) => {
				const indices = headings
					.map((heading) => runs.find((run) => run.text.includes(heading))?.index)
					.filter((index): index is number => index !== undefined);
				expect(indices.length).toBeGreaterThan(0);
				return Math.min(...indices);
			};

			const mainIndex = firstIndex(["Summary", "Experience"]);
			const sidebarIndex = firstIndex(["Profiles", "Skills"]);
			expect(mainIndex).toBeLessThan(sidebarIndex);

			const sidebarRun = runs.find((run) => run.text.includes("Profiles"));
			const mainRun = runs.find((run) => run.text.includes("Experience"));
			if (expectedSide === "left") expect(sidebarRun?.x).toBeLessThan(mainRun?.x ?? 0);
			else expect(sidebarRun?.x).toBeGreaterThan(mainRun?.x ?? 0);
		},
	);
});
