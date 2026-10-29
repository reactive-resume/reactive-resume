import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";

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

const findPath = (node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] | undefined => {
	if (predicate(node)) return [node];
	for (const child of node.children ?? []) {
		const path = findPath(child, predicate);
		if (path) return [node, ...path];
	}
};

const nodesWithStyle = (node: HostNode, property: string, value: unknown): HostNode[] => [
	...(mergedStyle(node)[property] === value ? [node] : []),
	...(node.children ?? []).flatMap((child) => nodesWithStyle(child, property, value)),
];

const buildFixture = (
	text: string,
	section: "summary" | "skills" | "experience" | "languages" | "references" = "summary",
): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Programmer";
	data.basics.email = "ada@example.com";
	data.basics.phone = "";
	data.basics.location = "";
	data.basics.website = { url: "", label: "" };
	data.basics.customFields = [];
	data.summary.content = "<p>Computing pioneer.</p>";
	data.sections.skills.title = "Expertise";
	data.sections.skills.items = [
		{
			id: "skill-1",
			hidden: false,
			icon: "brain",
			iconColor: "",
			name: "TypeScript",
			proficiency: "Expert",
			level: 0,
			keywords: [],
		},
	];
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
			roles: [
				{
					id: "role-1",
					position: "Architect",
					period: "1843",
					description: "<p>Designed the engine.</p>",
				},
			],
		},
	];
	data.sections.languages.items = [
		{ id: "language-1", hidden: false, language: "English", fluency: "Native", level: 0 },
	];
	data.sections.references.items = [
		{
			id: "reference-1",
			hidden: false,
			name: "Charles Babbage",
			position: "Inventor",
			phone: "+44 123",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.metadata.page.hideSectionIcons = false;
	data.metadata.page.hideIcons = false;
	data.metadata.layout.pages = [{ fullWidth: true, main: [section], sidebar: [] }];
	const stylesheet = { languageVersion: 1, text: `@version 1; ${text}` };
	data.metadata.stylesheet = { mode: "semantic", source: stylesheet };
	return data;
};

const renderFixture = async (template: Template, data: ResumeData): Promise<HostNode> => {
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	return instance.container.document as HostNode;
};

describe("semantic binding host fidelity", () => {
	it("attaches region, contact-list, icon-row heading, no-border item-header, and item-icon styles", async () => {
		const document = await renderFixture(
			"onyx",
			buildFixture(
				`
					region[region="main"] { background-color: #101010; }
					contact-list { background-color: #202020; }
					section-heading { background-color: #303030; }
					item-header { background-color: #404040; }
					icon { opacity: 0.25; }
				`,
				"skills",
			),
		);
		const emailPath = findPath(document, (node) => node.type === "LINK" && nodeText(node) === "ada@example.com");
		const headingPath = findPath(document, (node) => node.type === "TEXT" && nodeText(node) === "Expertise");
		const skillPath = findPath(document, (node) => node.type === "TEXT" && nodeText(node) === "TypeScript");

		expect(emailPath?.some((node) => mergedStyle(node).backgroundColor === "#202020")).toBe(true);
		expect(headingPath?.some((node) => node.type === "VIEW" && mergedStyle(node).backgroundColor === "#303030")).toBe(
			true,
		);
		expect(mergedStyle(headingPath?.at(-1) as HostNode).backgroundColor).toBeUndefined();
		expect(skillPath?.some((node) => mergedStyle(node).backgroundColor === "#404040")).toBe(true);
		expect(skillPath?.some((node) => mergedStyle(node).backgroundColor === "#101010")).toBe(true);
		// Icons carry their opacity in their paint (`fill-opacity`), not their style.
		expect(
			nodesWithStyle(document, "opacity", 0.25).some(({ type }) => type === "SVG") ||
				JSON.stringify(document).includes('fill-opacity=\\"0.25\\"'),
		).toBe(true);
	});

	it.each([
		["languages", "English"],
		["references", "Charles Babbage"],
	] as const)("keeps direct %s Text siblings outside the item-header contract", async (section, text) => {
		const document = await renderFixture(
			"onyx",
			buildFixture(
				`
					item-header { display: none; background-color: #414141; break-before: page; }
					field[role~="primary-text"] { color: #515151; }
				`,
				section,
			),
		);
		const textPath = findPath(document, (node) => node.type === "TEXT" && nodeText(node) === text);
		const textNode = textPath?.at(-1);

		expect(textNode).toBeDefined();
		expect(textNode && mergedStyle(textNode)).toMatchObject({ color: "#515151" });
		expect(textPath?.some((node) => mergedStyle(node).backgroundColor === "#414141")).toBe(false);
	});

	it("binds Rhyhorn's outer contact owner, nested content primitive, link alias, and last-owner alias separately", async () => {
		const document = await renderFixture(
			"rhyhorn",
			buildFixture(`
				contact-item { background-color: #616161; }
				template-part[name="contact-item-content"] { color: #717171; }
				link { text-decoration: none; }
				contact-item[part~="contact-item-last"] { border-bottom-width: 9pt; }
			`),
		);
		const emailPath = findPath(document, (node) => node.type === "LINK" && nodeText(node) === "ada@example.com");
		const link = emailPath?.at(-1);

		expect(link && mergedStyle(link)).toMatchObject({ color: "#717171", textDecoration: "none" });
		expect(emailPath?.some((node) => node.type === "VIEW" && mergedStyle(node).backgroundColor === "#616161")).toBe(
			true,
		);
		expect(emailPath?.some((node) => node.type === "VIEW" && mergedStyle(node).borderBottomWidth === 9)).toBe(true);
	});

	it.each([
		["azurill", 4],
		["ditgar", 1],
		["ditto", 3],
		["gengar", 1],
		["glalie", 1],
		["leafish", 3],
		["pikachu", 1],
		["rhyhorn", 1],
		["scizor", 1],
	] as const)("%s attaches every visible primitive template part to an existing host", async (template, expected) => {
		const document = await renderFixture(template, buildFixture("template-part { opacity: 0.37; }"));

		expect(nodesWithStyle(document, "opacity", 0.37)).toHaveLength(expected);
	});

	it("attaches the one-line entry header's parts to existing hosts", async () => {
		const data = buildFixture("template-part { opacity: 0.37; }", "experience");
		data.metadata.design.entry = { layout: "inline", lead: "organization", accent: "none" };
		const document = await renderFixture("onyx", data);

		expect(nodesWithStyle(document, "opacity", 0.37)).toHaveLength(3);
	});
});
