import type { ElementInfo } from "@formepdf/core";
import { expect, it } from "vitest";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { renderResume } from "./render";

// #3590: PDF extraction still finds text drawn at -Number.MAX_VALUE, but the continuation page looks empty.
it("keeps project list continuations visible and following sections after them", async () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Synthetic Resume";
	data.picture.hidden = true;
	data.metadata.template = "scizor";
	data.metadata.typography.body = { fontFamily: "Helvetica", fontWeights: ["400"], fontSize: 10, lineHeight: 1.5 };
	data.metadata.typography.heading = { fontFamily: "Helvetica", fontWeights: ["700"], fontSize: 14, lineHeight: 1.5 };
	data.metadata.page = { ...data.metadata.page, gapX: 4, gapY: 6, marginX: 14, marginY: 12, hideSectionIcons: true };
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary", "projects", "certifications"], sidebar: [] }];
	data.summary.content = Array.from({ length: 50 }, (_, i) => `<p>FILLER_${i}</p>`).join("");
	const tokens: string[] = [];
	data.sections.projects.items = Array.from({ length: 3 }, (_, i) => ({
		id: `project-${i}`,
		hidden: false,
		name: `PROJECT_${i}`,
		period: "",
		website: { url: "https://example.com", label: "", inlineLink: true },
		description: `<ul>${Array.from({ length: 6 }, (_, j) => {
			const token = `PROJECT_${i}_LINE_${j}`;
			tokens.push(token);
			return `<li><p data-resume-whitespace="preserve">${token} ${"Synthetic resume description with useful content. ".repeat(4)}</p></li>`;
		}).join("")}</ul>`,
	}));
	data.sections.certifications.title = "Certifications";
	data.sections.certifications.items = [
		{
			id: "last",
			hidden: false,
			title: "FOLLOWING_SECTION",
			date: "",
			issuer: "",
			description: "",
			website: { url: "", label: "", inlineLink: false },
		},
	];
	const result = await act(() => renderResume(forme, { data }));
	expect(result.layout.pages.length).toBeGreaterThan(1);
	for (const page of result.layout.pages) {
		const checkVisible = (element: ElementInfo) => {
			if (element.kind === "Text") {
				expect(element.y).toBeGreaterThanOrEqual(0);
				expect(element.y + element.height).toBeLessThanOrEqual(page.height);
			}
			element.children.forEach(checkVisible);
		};
		page.elements.forEach(checkVisible);
	}
	const loading = getDocument({ data: result.pdf.slice(), useSystemFonts: true });
	try {
		const document = await loading.promise;
		const pages: string[] = [];
		for (let i = 1; i <= document.numPages; i++) {
			const page = await document.getPage(i);
			pages.push((await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : [])).join(""));
		}
		const text = pages.join("");
		for (const token of tokens) expect(text.split(token)).toHaveLength(2);
		const lastToken = "PROJECT_2_LINE_5";
		expect(text.indexOf("FOLLOWING_SECTION")).toBeGreaterThan(text.indexOf(lastToken));
		expect(pages.findIndex((page) => page.includes("FOLLOWING_SECTION"))).toBe(
			pages.findIndex((page) => page.includes(lastToken)),
		);
	} finally {
		await loading.destroy();
	}
});
