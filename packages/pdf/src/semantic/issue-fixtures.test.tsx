import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it, vi } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";
import { semanticNodeKeys } from "./node-keys";
import { resolveResumeRuntime } from "./resolve";

const source = (text: string) => ({ languageVersion: 1, text });

type HostNode = {
	type: string;
	style?: unknown;
	value?: string;
	children?: HostNode[];
};

const nodeText = (node: HostNode): string =>
	node.value ?? (node.children ?? []).map((child) => nodeText(child)).join("");

const findText = (node: HostNode, text: string): HostNode | undefined => {
	if (node.type === "TEXT" && nodeText(node) === text) return node;
	for (const child of node.children ?? []) {
		const match = findText(child, text);
		if (match) return match;
	}
};

const findPrimitive = (node: HostNode, type: string, text: string): HostNode | undefined => {
	if (node.type === type && nodeText(node) === text) return node;
	for (const child of node.children ?? []) {
		const match = findPrimitive(child, type, text);
		if (match) return match;
	}
};

const mergedStyle = (node: HostNode | undefined): Record<string, unknown> =>
	Object.assign({}, ...(Array.isArray(node?.style) ? node.style : node?.style ? [node.style] : []));

const containsStyle = (node: HostNode, property: string, value: unknown): boolean =>
	mergedStyle(node)[property] === value || (node.children ?? []).some((child) => containsStyle(child, property, value));

const nodesWithStyle = (node: HostNode, property: string, value: unknown): HostNode[] => [
	...(mergedStyle(node)[property] === value ? [node] : []),
	...(node.children ?? []).flatMap((child) => nodesWithStyle(child, property, value)),
];

const textRuns = (node: HostNode): string[] => [
	...(node.type === "TEXT" ? [nodeText(node)] : []),
	...(node.children ?? []).flatMap((child) => textRuns(child)),
];

const buildIssueFixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);

	data.basics = {
		...data.basics,
		name: "Ada Lovelace",
		headline: "Computing pioneer",
		email: "ada@example.com",
		phone: "+44 123",
		location: "London",
		customFields: [{ id: "custom-1", icon: "globe", text: "Ada Labs", link: "" }],
	};
	data.sections.experience.items = [
		{
			id: "item-1",
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
	data.sections.skills.items = [
		{
			id: "item-1",
			hidden: false,
			icon: "",
			iconColor: "",
			name: "TypeScript",
			proficiency: "Expert",
			level: 3,
			keywords: [],
		},
	];
	data.metadata.layout.pages = [{ fullWidth: true, main: ["experience", "skills"], sidebar: [] }];

	return data;
};

const pageKey = semanticNodeKeys.page(1);
const headerKey = semanticNodeKeys.header(semanticNodeKeys.region(pageKey, "header"));
const sectionItemKey = (section: string) =>
	semanticNodeKeys.item(
		semanticNodeKeys.sectionItems(semanticNodeKeys.section(semanticNodeKeys.region(pageKey, "main"), section)),
		"item-1",
	);

describe("semantic issue fixtures", () => {
	it("cascades contact-link and field-rich-text aliases before selecting winners", () => {
		const data = buildIssueFixture();
		const experience = data.sections.experience.items[0];
		if (!experience) throw new Error("Expected experience fixture.");
		experience.description = "<p>Description</p>";
		const contact = semanticNodeKeys.contactItem(semanticNodeKeys.contactList(headerKey), "email");
		const field = semanticNodeKeys.field(sectionItemKey("experience"), "description");

		const resolve = (text: string) => {
			data.metadata.stylesheet = { mode: "semantic", source: source(`@version 1;${text}`) };
			return resolveResumeRuntime({ data, template: "onyx" }).presentation;
		};

		expect(resolve("contact-item { color: red; } link { color: blue; }")[contact]?.style?.color).toBe("blue");
		expect(resolve("link { color: blue; } contact-item { color: red; }")[contact]?.style?.color).toBe("red");
		expect(resolve("field { color: red; } rich-text { color: blue; }")[field]?.style?.color).toBe("blue");
		expect(resolve("rich-text { color: blue; } field { color: red; }")[field]?.style?.color).toBe("red");
		expect(resolve("link { color: blue; } contact-item[name='email'] { color: red; }")[contact]?.style?.color).toBe(
			"red",
		);
	});

	it("applies issue-regression styles to the final existing PDF primitives", async () => {
		const data = buildIssueFixture();
		const stylesheet = source(`
			@version 1;
			header { background-color: #1e293b; padding: 10pt; }
			name { color: white; }
			headline { font-size: 14pt; }
			contact-list { gap: 8pt; }
			contact-item { padding: 1pt; }
			icon { font-size: 16pt; }
			link { text-decoration: none; }
			section[type="experience"] field[name="company"] { font-weight: 400; }
			section[type="skills"] field[name="name"] { font-weight: 400; }
			level icon[role~="active"] { opacity: 0.2; }
		`);
		data.metadata.stylesheet = { mode: "semantic", source: stylesheet };
		const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
		const document = instance.container.document as HostNode;

		expect(mergedStyle(findText(document, "Ada Lovelace"))).toMatchObject({ color: "white" });
		expect(mergedStyle(findText(document, "Computing pioneer"))).toMatchObject({ fontSize: 14 });
		expect(mergedStyle(findText(document, "Analytical Engines"))).toMatchObject({ fontWeight: "400" });
		expect(mergedStyle(findText(document, "TypeScript"))).toMatchObject({ fontWeight: "400" });
		expect(mergedStyle(findPrimitive(document, "LINK", "ada@example.com")).paddingTop).toBe(1);
		expect(mergedStyle(findPrimitive(document, "LINK", "+44 123")).paddingTop).toBe(1);
		expect(nodesWithStyle(document, "fontSize", 16).some(({ type }) => type === "SVG")).toBe(true);
		expect(mergedStyle(findPrimitive(document, "LINK", "ada@example.com"))).toMatchObject({
			textDecoration: "none",
		});
		expect(containsStyle(document, "backgroundColor", "#1e293b")).toBe(true);
		expect(containsStyle(document, "paddingTop", 10)).toBe(true);
		expect(containsStyle(document, "rowGap", 8)).toBe(true);
		expect(containsStyle(document, "opacity", 0.2)).toBe(true);
	});

	it("hides section heading decoration without hiding section content", async () => {
		const data = buildIssueFixture();
		data.sections.experience.showHeading = false;
		const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
		const document = instance.container.document as HostNode;

		expect(findText(document, "Experience")).toBeUndefined();
		expect(findText(document, "Analytical Engines")).toBeDefined();
	});

	it("unbolds only the final skill-name primitive and preserves the experience title weight (#2223)", async () => {
		const data = buildIssueFixture();
		const stylesheet = source(`
			@version 1;
			section[type="skills"] field[name="name"] { font-weight: 400; }
		`);
		data.metadata.stylesheet = { mode: "semantic", source: stylesheet };
		const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
		const document = instance.container.document as HostNode;

		expect(mergedStyle(findText(document, "TypeScript"))).toMatchObject({ fontWeight: "400" });
		expect(mergedStyle(findText(document, "Analytical Engines")).fontWeight).not.toBe("400");
	});

	it("preserves the first character of a section heading with a leading text padding (#3380)", async () => {
		const data = buildIssueFixture();
		data.sections.experience.title = "Experience";
		data.metadata.page.hideSectionIcons = false;

		const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
		const document = instance.container.document as HostNode;
		const heading = findText(document, "Experience");

		expect(heading).toBeDefined();
		expect(mergedStyle(heading).paddingLeft).toBe(1);
	});

	it("renders descriptor filtering and stable item order instead of remapping raw arrays", async () => {
		const data = buildIssueFixture();
		data.sections.skills.items = ["First", "Hidden", "Last"].map((name, index) => ({
			id: `item-${index + 1}`,
			hidden: false,
			icon: "",
			iconColor: "",
			name,
			proficiency: `${name} proficiency`,
			level: 0,
			keywords: [],
		}));
		data.metadata.layout.pages = [{ fullWidth: true, main: ["skills"], sidebar: [] }];
		const stylesheet = source(`
			@version 1;
			section[type="skills"] item:nth-child(2) { display: none; }
			section[type="skills"] item:last-child { order: -1; }
		`);
		data.metadata.stylesheet = { mode: "semantic", source: stylesheet };
		const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
		const runs = textRuns(instance.container.document as HostNode);

		expect(runs.indexOf("Last")).toBeGreaterThanOrEqual(0);
		expect(runs.indexOf("Last")).toBeLessThan(runs.indexOf("First"));
		expect(runs).not.toContain("Hidden");
	});
});
