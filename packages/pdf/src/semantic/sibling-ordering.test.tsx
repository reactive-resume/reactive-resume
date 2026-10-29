import type { SemanticNode } from "@reactive-resume/resume/stylesheet";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";
import { resolveResumeRuntime } from "./resolve";

type HostNode = {
	type: string;
	value?: string;
	children?: HostNode[];
};

const textValues = (node: HostNode): string[] => [
	...(node.type === "TEXT_INSTANCE" && node.value ? [node.value] : []),
	...(node.children ?? []).flatMap((child) => textValues(child)),
];
const findSemanticNode = (
	node: SemanticNode,
	predicate: (candidate: SemanticNode) => boolean,
): SemanticNode | undefined => {
	if (predicate(node)) return node;
	for (const child of node.children) {
		const match = findSemanticNode(child, predicate);
		if (match) return match;
	}
};

const renderTextValues = async (data: ResumeData, template: Template): Promise<string[]> => {
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	return textValues(instance.container.document as HostNode);
};

const semanticFixture = (rule: string): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.basics = {
		name: "Ada Lovelace",
		headline: "",
		email: "",
		phone: "",
		location: "",
		website: { url: "", label: "" },
		customFields: [],
	};
	const stylesheet = { languageVersion: 1, text: `@version 1; ${rule}` };
	data.metadata.stylesheet = { mode: "semantic", source: stylesheet };
	return data;
};

const expectBefore = (values: readonly string[], first: string, second: string) => {
	const firstIndex = values.indexOf(first);
	const secondIndex = values.indexOf(second);
	expect(firstIndex, `${first} is present`).toBeGreaterThanOrEqual(0);
	expect(secondIndex, `${second} is present`).toBeGreaterThanOrEqual(0);
	expect(firstIndex, `${first} before ${second}`).toBeLessThan(secondIndex);
};

describe("semantic sibling ordering reaches final PDF output", () => {
	it("projects contact-list hide and order onto existing contact siblings", async () => {
		const data = semanticFixture(`
			contact-item[name="location"] { display: none; }
			contact-item[name="phone"] { order: -1; }
		`);
		data.basics.email = "ada@example.com";
		data.basics.phone = "+44 123";
		data.basics.location = "London";
		data.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "+44 123", "ada@example.com");
		expect(values).not.toContain("London");
	});

	it("projects Chikorita contacts only within their two existing row hosts", async () => {
		const data = semanticFixture(`
			template-part[name="contact-row-secondary"] { order: -1; }
			contact-item[name="location"] { display: none; }
			contact-item[name="phone"] { order: -1; }
			contact-item[name="custom"] { order: -1; }
		`);
		data.basics.email = "ada@example.com";
		data.basics.phone = "+44 123";
		data.basics.location = "London";
		data.basics.website = { url: "https://example.com", label: "example.com" };
		data.basics.customFields = [{ id: "custom-1", icon: "", text: "portfolio.example", link: "" }];
		data.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: [] }];

		const values = await renderTextValues(data, "chikorita");

		expectBefore(values, "portfolio.example", "example.com");
		expectBefore(values, "example.com", "+44 123");
		expectBefore(values, "+44 123", "ada@example.com");
		expect(values).not.toContain("London");
	});

	it("projects nested-role hide and order across the complete direct item sequence", async () => {
		const data = semanticFixture(`
			item[id="role-2"] { display: none; }
			item[id="role-3"] { order: -1; }
		`);
		data.sections.experience.items = [
			{
				id: "experience-1",
				hidden: false,
				company: "Analytical Engines",
				position: "",
				location: "",
				period: "",
				website: { url: "https://example.com/company", label: "Company site", inlineLink: false },
				description: "",
				roles: [
					{ id: "role-1", position: "First role", period: "", description: "" },
					{ id: "role-2", position: "Hidden role", period: "", description: "" },
					{ id: "role-3", position: "Last role", period: "", description: "" },
				],
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "Last role", "Analytical Engines");
		expectBefore(values, "Company site", "First role");
		expect(values).not.toContain("Hidden role");
	});

	it("projects hide and order across the one-line header's part siblings", async () => {
		const data = semanticFixture(`
			template-part[name="inline-item-header-leading"] { display: none; }
			template-part[name="inline-item-header-trailing"] { order: -1; }
		`);
		data.metadata.design.entry = { layout: "inline", lead: "organization", accent: "none" };
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
		data.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "1842", "Analytical Engines");
		expect(values).not.toContain("Engineer");
		expect(values).not.toContain("London");
	});

	it("projects the one-line header's education grade row at the item boundary and its fields within that row", async () => {
		const data = semanticFixture(`
			template-part[name="education-grade-row"] { order: -1; }
			field[name="location"] { order: -1; }
		`);
		data.metadata.design.entry = { layout: "inline", lead: "organization", accent: "none" };
		data.sections.education.items = [
			{
				id: "education-1",
				hidden: false,
				school: "University of London",
				area: "Mathematics",
				degree: "BSc",
				grade: "First",
				location: "London",
				period: "1835",
				website: { url: "", label: "", inlineLink: false },
				description: "",
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["education"], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "London", "First");
		expectBefore(values, "First", "Mathematics");
		expectBefore(values, "First", "University of London");
	});

	it("reorders role-first one-line header parts without dropping untouched combined fields", async () => {
		const data = semanticFixture(`
			template-part[name="inline-item-header-trailing"] { order: -1; }
		`);
		data.metadata.design.entry = { layout: "inline", lead: "role", accent: "none" };
		data.sections.education.items = [
			{
				id: "education-1",
				hidden: false,
				school: "University of London",
				area: "Mathematics",
				degree: "BSc",
				grade: "",
				location: "",
				period: "1835",
				website: { url: "", label: "", inlineLink: false },
				description: "",
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["education"], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "1835", "Mathematics");
		expectBefore(values, "Mathematics", "BSc");
		expectBefore(values, "BSc", "University of London");
	});

	it("projects rich-text descendant hide and order before renderer mapping", async () => {
		const data = semanticFixture(`
			rich-text > list { display: none; }
			paragraph > underline { order: -1; }
		`);
		data.summary.content = "<ul><li>Hidden run</li></ul><p><strong>First run</strong><u>Last run</u></p>";
		data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];

		const values = await renderTextValues(data, "onyx");

		expectBefore(values, "Last run", "First run");
		expect(values).not.toContain("Hidden run");
	});

	it.each([
		["en-US", "list-marker { display: none; }", "List content", "•"],
		["ar-SA", "list-marker { order: -1; }", "•", "List content"],
	] as const)(
		"projects %s rich-list marker/content keys onto the existing row children",
		async (locale, rule, first, second) => {
			const data = semanticFixture(rule);
			data.metadata.page.locale = locale;
			data.summary.content = "<ul><li>List content</li></ul>";
			data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
			const runtime = resolveResumeRuntime({ data, template: "onyx" });
			const renderedItem = findSemanticNode(runtime.renderTree, (node) => node.kind === "list-item");

			expect(runtime.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
			expect(renderedItem?.children.map(({ kind }) => kind)).toEqual(
				rule.includes("display") ? ["list-item-content"] : ["list-marker", "list-item-content"],
			);

			const values = await renderTextValues(data, "onyx");

			if (rule.includes("display")) {
				expect(values).toContain(first);
				expect(values).not.toContain(second);
			} else {
				const firstIndex = values.indexOf(first);
				const secondIndex = values.findIndex((value) => value.includes(second));
				expect(firstIndex).toBeGreaterThanOrEqual(0);
				expect(secondIndex).toBeGreaterThanOrEqual(0);
				expect(firstIndex).toBeLessThan(secondIndex);
			}
		},
	);
});
