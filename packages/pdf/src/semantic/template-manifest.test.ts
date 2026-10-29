import type { SemanticNode } from "@reactive-resume/resume/stylesheet/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { getTemplateSemanticManifest } from "./template-manifest";
import { buildSemanticTree } from "./tree";

const flattenTree = (node: SemanticNode): SemanticNode[] => [node, ...node.children.flatMap(flattenTree)];
const findNodes = (node: SemanticNode, predicate: (candidate: SemanticNode) => boolean): SemanticNode[] =>
	flattenTree(node).filter(predicate);

const buildFixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.url = "/uploads/ada.png";
	data.basics = {
		name: "Ada Lovelace",
		headline: "Engineer",
		email: "ada@example.com",
		phone: "",
		location: "",
		website: { url: "", label: "" },
		customFields: [],
	};
	data.summary.content = "<p>Summary</p>";
	// The one-line entry header brings its parts into the tree, so every manifest part shows up.
	data.metadata.design.entry = { layout: "inline", lead: "organization", accent: "none" };
	data.sections.education.items = [
		{
			id: "education/1",
			hidden: false,
			school: "Cambridge",
			area: "Mathematics",
			degree: "BSc",
			grade: "First",
			location: "Cambridge",
			period: "1835",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.sections.experience.columns = 1;
	data.sections.experience.items = [
		{
			id: "experience/1",
			hidden: false,
			company: "Analytical Engines",
			position: "Engineer",
			location: "London",
			period: "1842",
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Built algorithms.</p>",
			roles: [],
		},
	];
	data.sections.projects.items = [
		{
			id: "projects/1",
			hidden: false,
			name: "Analytical Engine",
			period: "1843",
			website: { url: "https://project.example.com", label: "Project", inlineLink: true },
			description: "<p>Wrote the first program.</p>",
		},
	];
	data.sections.skills.items = [
		{
			id: "skills/1",
			hidden: false,
			icon: "code",
			iconColor: "",
			name: "TypeScript",
			proficiency: "Expert",
			level: 4,
			keywords: ["PDF"],
		},
	];

	return data;
};

const buildFixtureTree = (template: Template, showHeader = true): SemanticNode => {
	const data = buildFixture();
	const page = { fullWidth: false, main: ["summary", "experience", "education", "projects"], sidebar: ["skills"] };

	return buildSemanticTree({ data, template, page, pageNumber: 1, showHeader });
};

describe("template semantic manifests", () => {
	it.each(templateSchema.options)("%s builds its manifest-backed tree without key collisions", (template) => {
		const tree = buildFixtureTree(template);
		const nodes = flattenTree(tree);
		const partNames = new Set(
			findNodes(tree, (node) => node.kind === "template-part").map((node) => node.attributes.name),
		);
		const expectedPrimitiveParts = new Set(
			getTemplateSemanticManifest(template).parts.flatMap((part) =>
				part.binding.type === "primitive" ? [part.name] : [],
			),
		);

		expect(partNames).toEqual(expectedPrimitiveParts);
		expect(new Set(nodes.map((node) => node.key)).size).toBe(nodes.length);
	});

	it.each(["ditgar", "gengar"] as const)("%s moves the first-page summary into its featured region", (template) => {
		const tree = buildFixtureTree(template);
		const featured = findNodes(tree, (node) => node.kind === "region" && node.attributes.region === "featured")[0];
		const summaries = findNodes(tree, (node) => node.kind === "section" && node.id === "summary");

		expect(featured && findNodes(featured, (node) => node.kind === "section" && node.id === "summary")).toHaveLength(1);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.roles).toContain("featured-summary");
	});

	it("places Leafish summary in the header only while the renderer shows that header", () => {
		const withHeader = buildFixtureTree("leafish", true);
		const withoutHeader = buildFixtureTree("leafish", false);
		const headerRegion = findNodes(
			withHeader,
			(node) => node.kind === "region" && node.attributes.region === "header",
		)[0];

		expect(
			headerRegion && findNodes(headerRegion, (node) => node.kind === "section" && node.id === "summary"),
		).toHaveLength(1);
		expect(findNodes(withHeader, (node) => node.kind === "section" && node.id === "summary")).toHaveLength(1);
		expect(findNodes(withoutHeader, (node) => node.kind === "section" && node.id === "summary")).toHaveLength(0);
	});

	it.each(["ditgar", "gengar"] as const)("%s leaves summary in main when featured chrome is absent", (template) => {
		const tree = buildFixtureTree(template, false);
		const summary = findNodes(tree, (node) => node.kind === "section" && node.id === "summary");

		expect(findNodes(tree, (node) => node.kind === "region" && node.attributes.region === "featured")).toHaveLength(0);
		expect(summary).toHaveLength(1);
		expect(summary[0]?.attributes).toMatchObject({ origin: "main", placement: "main" });
		expect(summary[0]?.roles).not.toContain("featured-summary");
	});
});
