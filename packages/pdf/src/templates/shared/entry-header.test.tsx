import type { SemanticNode } from "@reactive-resume/resume/stylesheet/types";
import type { EntryHeader, ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { entryHeaderLayouts } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { pdf } from "../../forme/testing";
import { buildSemanticTree } from "../../semantic/tree";

type HostNode = { type: string; value?: string; children?: HostNode[] };

const SECTIONS = ["experience", "education", "volunteer", "projects", "awards"];
const TEXTS = {
	experience: ["Analytical Engines", "Engineer", "London", "1842"],
	education: ["Cambridge University", "Mathematics", "BSc", "First", "Cambridge", "1835"],
	volunteer: ["Royal Society", "Westminster", "1840"],
	projects: ["Difference Engine", "1833"],
	awards: ["Medal", "Academy", "1850"],
};

const website = { url: "", label: "", inlineLink: false };

const fixture = (entry: EntryHeader, placement: "main" | "sidebar"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.metadata.design.entry = entry;
	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engines",
			position: "Engineer",
			location: "London",
			period: "1842",
			website,
			description: "",
			roles: [],
		},
	];
	data.sections.education.items = [
		{
			id: "education-1",
			hidden: false,
			school: "Cambridge University",
			area: "Mathematics",
			degree: "BSc",
			grade: "First",
			location: "Cambridge",
			period: "1835",
			website,
			description: "",
		},
	];
	data.sections.volunteer.items = [
		{
			id: "volunteer-1",
			hidden: false,
			organization: "Royal Society",
			location: "Westminster",
			period: "1840",
			website,
			description: "",
		},
	];
	data.sections.projects.items = [
		{ id: "project-1", hidden: false, name: "Difference Engine", period: "1833", website, description: "" },
	];
	data.sections.awards.items = [
		{ id: "award-1", hidden: false, title: "Medal", awarder: "Academy", date: "1850", website, description: "" },
	];
	data.metadata.layout.pages = [
		placement === "main"
			? { fullWidth: true, main: SECTIONS, sidebar: [] }
			: { fullWidth: false, main: [], sidebar: SECTIONS },
	];
	return data;
};

const textValues = (node: HostNode): string[] => [
	...(node.type === "TEXT_INSTANCE" && node.value ? [node.value] : []),
	...(node.children ?? []).flatMap(textValues),
];

const renderTexts = async (template: Template, data: ResumeData) => {
	const instance = pdf(createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0]);
	await expect.poll(() => instance.container.document).not.toBeNull();
	return textValues(instance.container.document as HostNode);
};

const cases = entryHeaderLayouts.flatMap((layout) =>
	(["organization", "role"] as const).flatMap((lead) =>
		[
			["onyx", "main"],
			["chikorita", "sidebar"],
		].map(([template, placement]) => ({ layout, lead, template: template as Template, placement })),
	),
);

describe("entry header layouts", () => {
	// A field the renderer draws but the Semantic CSS tree lacks is dropped silently, so every layout must keep
	// every header text; the lead goes first, except under an eyebrow, where the rest sits above the lead.
	it.each(cases)(
		"$layout, $lead first, in the $placement column of $template draws every header text in lead order",
		async ({ layout, lead, template, placement }) => {
			const values = await renderTexts(
				template,
				fixture({ layout, lead, accent: "rule" }, placement as "main" | "sidebar"),
			);
			for (const text of Object.values(TEXTS).flat()) expect(values, text).toContain(text);

			const before = (first: string, second: string) =>
				expect(values.indexOf(first), `${first} before ${second}`).toBeLessThan(values.indexOf(second));
			const [leadFirst, rest] = layout === "eyebrow" ? [false, true] : [true, false];
			const roleFirst = lead === "role";
			for (const [organization, role] of [
				["Analytical Engines", "Engineer"],
				["Cambridge University", "Mathematics"],
			] as const) {
				if (roleFirst === leadFirst) before(role, organization);
				else before(organization, role);
			}
			if (rest) before("Westminster", "Royal Society");
			else before("Royal Society", "Westminster");
		},
	);

	it.each(["organization", "role"] as const)(
		"orders the one-line header's parts by the %s lead in the tree",
		(lead) => {
			const data = fixture({ layout: "inline", lead, accent: "none" }, "main");
			const page = data.metadata.layout.pages[0];
			if (!page) throw new Error("Missing page");
			const tree = buildSemanticTree({ data, template: "onyx", page, pageNumber: 1, showHeader: true });
			const partsOf = (node: SemanticNode): string[][] => [
				...(node.kind === "item-header"
					? [node.children.flatMap((child) => (child.kind === "template-part" ? [child.attributes.name ?? ""] : []))]
					: []),
				...node.children.flatMap(partsOf),
			];
			const [experience, education, volunteer] = partsOf(tree).filter((parts) => parts.length > 0);
			const roleFirst = ["inline-item-header-leading", "inline-item-header-middle", "inline-item-header-trailing"];
			const organizationFirst = [
				"inline-item-header-middle",
				"inline-item-header-leading",
				"inline-item-header-trailing",
			];

			expect(experience).toEqual(lead === "role" ? roleFirst : organizationFirst);
			expect(education).toEqual(lead === "role" ? roleFirst : organizationFirst);
			expect(volunteer).toEqual(organizationFirst);
		},
	);
});
