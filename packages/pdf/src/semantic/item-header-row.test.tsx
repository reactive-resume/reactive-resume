import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf } from "../forme/testing";

type HostNode = { type: string; style?: unknown; value?: string; children?: HostNode[] };

const LONG_TITLE = "Belajar Membuat Aplikasi Android untuk Pemula";
const NOWRAP_STYLESHEET = `@version 1;\ntemplate-part[name="item-header-row"] { flex-wrap: nowrap; }`;

const mergedStyle = (node: HostNode): Record<string, unknown> =>
	Object.assign({}, ...(Array.isArray(node.style) ? node.style : node.style ? [node.style] : []));
const nodeText = (node: HostNode): string => node.value ?? (node.children ?? []).map(nodeText).join("");
const pathTo = (node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] | undefined => {
	if (predicate(node)) return [node];
	for (const child of node.children ?? []) {
		const path = pathTo(child, predicate);
		if (path) return [node, ...path];
	}
};

const buildFixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.sections.certifications.items = [
		{
			id: "certification/1",
			hidden: false,
			title: LONG_TITLE,
			issuer: "Dicoding",
			date: "05 Sep 2023",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.sections.experience.items = [
		{
			id: "experience/1",
			hidden: false,
			company: "Braincore",
			position: "Business Process Automation Engineer",
			location: "Jakarta, Indonesia",
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

const renderTitleRowStyles = async (template: Template, stylesheet?: string) => {
	const data = buildFixture();
	if (stylesheet) data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: stylesheet } };
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	const document = instance.container.document as unknown as HostNode;
	const path = pathTo(document, (node) => nodeText(node).trim() === LONG_TITLE);
	if (!path) throw new Error("Missing certification title in the rendered document");
	const row = path.at(-2);
	if (!row) throw new Error("Missing the row wrapping the certification title");

	return mergedStyle(row);
};

describe("item-header-row template part", () => {
	// The row ships with `flex-wrap: wrap`, which drops a long title's date onto its own line. This
	// is the whole point of exposing the part, so assert the override reaches the rendered row.
	it.each(["onyx", "ditgar", "meowth"] as const)("lets %s stylesheets turn off the row wrap", async (template) => {
		expect(await renderTitleRowStyles(template)).toMatchObject({ flexWrap: "wrap" });
		expect(await renderTitleRowStyles(template, NOWRAP_STYLESHEET)).toMatchObject({ flexWrap: "nowrap" });
	});
});
