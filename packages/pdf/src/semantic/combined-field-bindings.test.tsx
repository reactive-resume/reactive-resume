import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";
import { createBindingInventory } from "./binding-inventory";
import { getTemplateSemanticBindingRegistry } from "./template-manifest";
import { buildSemanticTree } from "./tree";

type HostNode = {
	type: string;
	style?: unknown;
	value?: string;
	children?: HostNode[];
};

const nodeText = (node: HostNode): string =>
	node.value ?? (node.children ?? []).map((child) => nodeText(child)).join("");

const mergedStyle = (node: HostNode): Record<string, unknown> =>
	Object.assign({}, ...(Array.isArray(node.style) ? node.style : node.style ? [node.style] : []));

const findTexts = (node: HostNode, text: string): HostNode[] => [
	...(node.type === "TEXT" && nodeText(node) === text ? [node] : []),
	...(node.children ?? []).flatMap((child) => findTexts(child, text)),
];

const fixture = (
	section: "experience" | "education",
	rule = "",
	layout: "stacked" | "inline" = "stacked",
): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.metadata.design.entry = { layout, lead: "organization", accent: "none" };
	data.picture.hidden = true;
	data.basics.name = "Ada Lovelace";
	data.basics.email = "";
	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engines",
			position: "Engineer",
			location: "London",
			period: "1842",
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [],
		},
	];
	data.sections.education.items = [
		{
			id: "education-1",
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
	data.metadata.layout.pages = [{ fullWidth: true, main: [section], sidebar: [] }];
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: `@version 1; ${rule}` } };
	return data;
};

const renderHost = async (template: Template, data: ResumeData): Promise<HostNode> => {
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	return instance.container.document as HostNode;
};

const expectColor = (document: HostNode, text: string, color: string) => {
	expect(findTexts(document, text).some((node) => mergedStyle(node).color === color)).toBe(true);
};

describe("combined PDF field bindings", () => {
	it("binds each stacked and one-line combined Text identity once without widening field styles to its host", async () => {
		const semanticRule = `
			combined-text { color: #334455; font-size: 14pt; opacity: 0.6; margin-left: 3pt; }
			field[name="degree"] { opacity: 0.4; }
		`;
		const stackedData = fixture("education", semanticRule);
		const inlineData = fixture("education", semanticRule, "inline");
		const treeOf = (data: ResumeData) =>
			buildSemanticTree({
				data,
				template: "onyx",
				page: data.metadata.layout.pages[0] as NonNullable<(typeof data.metadata.layout.pages)[number]>,
				pageNumber: 1,
				showHeader: true,
			});
		const combinedNodes = (root: Parameters<typeof createBindingInventory>[0]) => {
			const matches: (typeof root)[] = [];
			const visit = (node: typeof root) => {
				if ((node.kind as string) === "combined-text") matches.push(node);
				for (const child of node.children) visit(child);
			};
			visit(root);
			return matches;
		};

		for (const [tree, inline] of [
			[treeOf(stackedData), false],
			[treeOf(inlineData), true],
		] as const) {
			const inventory = createBindingInventory(tree, getTemplateSemanticBindingRegistry("onyx"));
			const combined = combinedNodes(tree);
			expect(combined).not.toEqual([]);
			expect(
				combined.filter(({ key }) => inventory.bindings[key]?.type === "primitive").map(({ key }) => key),
			).toHaveLength(new Set(combined.map(({ key }) => key)).size - (inline ? 1 : 0));
			const aliases = combined.flatMap(({ key }) => {
				const binding = inventory.bindings[key];
				return binding?.type === "alias" ? [{ key, binding }] : [];
			});
			if (inline) {
				expect(aliases).toHaveLength(1);
				expect(aliases[0]?.binding).toEqual({
					type: "alias",
					canonicalKind: "template-part",
					canonicalNodeKey: aliases[0]?.key.replace(/\/combined-text-education-grade-location$/, ""),
					token: "combined-text",
				});
			} else {
				expect(aliases).toEqual([]);
			}
			expect(
				Object.values(inventory.bindings).every((binding) => binding.type === "alias" || binding.source === "existing"),
			).toBe(true);
		}

		for (const [data, text] of [
			[stackedData, "BSc • First"],
			[inlineData, "Mathematics (BSc)"],
		] as const) {
			const document = await renderHost("onyx", data);
			const outer = findTexts(document, text).map(mergedStyle);
			expect(outer).toContainEqual(
				expect.objectContaining({ color: "#334455", fontSize: 14, opacity: 0.6, marginLeft: 3 }),
			);
		}
	});

	it("splits all five combined variants into separately styleable existing Text runs", async () => {
		const colors = `
			field[name="position"] { color: #110000; }
			field[name="location"] { color: #220000; }
			field[name="area"] { color: #330000; }
			field[name="degree"] { color: #440000; }
			field[name="grade"] { color: #550000; }
			field[name="period"] { color: #660000; }
		`;
		const experience = await renderHost("onyx", fixture("experience", colors, "inline"));
		const inlineEducation = await renderHost("onyx", fixture("education", colors, "inline"));
		const splitEducation = await renderHost("onyx", fixture("education", colors));

		expect(nodeText(experience)).toContain("Engineer (London)");
		expectColor(experience, "Engineer", "#110000");
		expectColor(experience, "(London)", "#220000");

		expect(nodeText(inlineEducation)).toContain("Mathematics (BSc)");
		expect(nodeText(inlineEducation)).toContain("First • Cambridge");
		expectColor(inlineEducation, "Mathematics", "#330000");
		expectColor(inlineEducation, "(BSc)", "#440000");
		expectColor(inlineEducation, "First", "#550000");
		expectColor(inlineEducation, "Cambridge", "#220000");

		expect(nodeText(splitEducation)).toContain("BSc • First");
		expect(nodeText(splitEducation)).toContain("Cambridge • 1835");
		expectColor(splitEducation, "BSc", "#440000");
		expectColor(splitEducation, "First", "#550000");
		expectColor(splitEducation, "Cambridge", "#220000");
		expectColor(splitEducation, "1835", "#660000");
	});

	it("uses the promoted single field's real semantic key", async () => {
		const experienceData = fixture(
			"experience",
			'field[name="period"] { color: #660000; } field[name="location"] { color: #220000; }',
		);
		const experience = experienceData.sections.experience.items[0];
		if (!experience) throw new Error("Expected experience fixture.");
		experience.location = "";

		const educationData = fixture(
			"education",
			'field[name="period"] { color: #660000; } field[name="degree"] { color: #440000; }',
		);
		const education = educationData.sections.education.items[0];
		if (!education) throw new Error("Expected education fixture.");
		education.degree = "";
		education.grade = "";
		education.location = "";

		expectColor(await renderHost("onyx", experienceData), "1842", "#660000");
		expectColor(await renderHost("onyx", educationData), "1835", "#660000");
	});

	it("keeps non-inheritable split-field styles on their final field hosts", async () => {
		const document = await renderHost(
			"onyx",
			fixture(
				"experience",
				'field[name="position"] { opacity: 0.6; } field[name="location"] { margin-left: 3pt; }',
				"inline",
			),
		);
		const combined = findTexts(document, "Engineer (London)");
		const position = findTexts(document, "Engineer");
		const location = findTexts(document, "(London)");

		expect(combined.some((node) => mergedStyle(node).opacity === 0.6)).toBe(false);
		expect(combined.some((node) => mergedStyle(node).marginLeft === 3)).toBe(false);
		expect(position.map(mergedStyle)).toContainEqual(expect.objectContaining({ opacity: 0.6 }));
		expect(location.map(mergedStyle)).toContainEqual(expect.objectContaining({ marginLeft: 3 }));
	});
});
