import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";

type HostNode = { type: string; style?: unknown; value?: string; children?: HostNode[] };

const HEADER_BACKGROUND = "#ff0000";
const STYLESHEET = `@version 1;\nitem-header { background-color: ${HEADER_BACKGROUND}; }`;

const mergedStyle = (node: HostNode): Record<string, unknown> =>
	Object.assign({}, ...(Array.isArray(node.style) ? node.style : node.style ? [node.style] : []));
const nodeText = (node: HostNode): string => node.value ?? (node.children ?? []).map(nodeText).join("");
const flatten = (node: HostNode): HostNode[] => [node, ...(node.children ?? []).flatMap(flatten)];

const buildFixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.sections.certifications.items = [
		{
			id: "certification/1",
			hidden: false,
			title: "Certified Kubernetes Administrator",
			issuer: "The Linux Foundation",
			date: "Sep 2023",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.sections.experience.items = [
		{
			id: "experience/1",
			hidden: false,
			company: "Braincore",
			position: "Automation Engineer",
			location: "Jakarta",
			period: "Jan 2024 - Mar 2025",
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [],
		},
	];
	const page = data.metadata.layout.pages[0];
	if (!page) throw new Error("Missing authored page");
	page.main = ["certifications", "experience"];
	page.sidebar = [];

	return data;
};

const renderHeaderBoxes = async (template: Template): Promise<string[]> => {
	const data = buildFixture();
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: STYLESHEET } };
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	const document = instance.container.document as unknown as HostNode;

	return flatten(document)
		.filter((node) => mergedStyle(node).backgroundColor === HEADER_BACKGROUND)
		.map((node) => nodeText(node));
};

// https://github.com/reactive-resume/reactive-resume/issues/3349: the resolved `item-header` style used
// to be bound onto the first child that happened to be a literal `View`, so sections whose header
// starts with anything else lost it entirely and stacked headers only styled their first row.
describe("item-header binding", () => {
	it.each(templateSchema.options)("covers every header row of every section on %s", async (template) => {
		const headers = await renderHeaderBoxes(template);

		expect(headers).toHaveLength(2);
		const [certification, experience] = headers;
		expect(certification).toContain("Certified Kubernetes Administrator");
		expect(certification).toContain("The Linux Foundation");
		expect(certification).toContain("Sep 2023");
		expect(experience).toContain("Braincore");
		expect(experience).toContain("Automation Engineer");
		expect(experience).toContain("Jan 2024 - Mar 2025");
	});
});
