import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { HOST } from "../forme/primitives";
import { toHtml } from "./to-html";
import { renderResumeWebPage } from "./web-page";

describe("renderResumeWebPage", () => {
	it("keeps text and style values from escaping into markup or the stylesheet", () => {
		const text = (value: string) => ({ type: "#text" as const, text: value });
		const tree = [
			{
				type: HOST.document,
				props: {},
				children: [
					{
						type: HOST.page,
						props: { style: {} },
						children: [
							{
								type: HOST.view,
								props: { style: { backgroundColor: "rgb(1,2,3);}body{background:red", width: "50%;}a{b:c" } },
								children: [
									{
										type: HOST.text,
										props: { style: { fontFamily: 'Inter"}i{color:red', color: "red;}x{y:z" } },
										children: [text('<img src=x onerror="alert(1)">')],
									},
									{ type: HOST.link, props: { src: "javascript:alert(1)" }, children: [text("link")] },
								],
							},
						],
					},
				],
			},
		];

		const { html, css } = toHtml(tree);

		expect(html).not.toMatch(/<img src=x|javascript:/);
		expect(html).toContain("&lt;img src=x onerror=");
		expect(css).not.toMatch(/\}(?:body|a|i|x)\{/);
	});

	it("puts the main column before the sidebar when the page folds on a phone", async () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.template = "gengar";
		const { html, css } = await renderResumeWebPage({ data });

		expect(html).toMatch(/data-split[\s\S]*data-part="(?:header-sidebar|sidebar)"[\s\S]*data-part="main"/);
		expect(css).toMatch(/@media \(max-width:640px\)\{[\s\S]*\[data-part=main\]\{order:1\}/);
	});

	it("lets a folded header shrink to the phone, so its contact line wraps instead of running off it", async () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.template = "pikachu";
		const { css } = await renderResumeWebPage({ data });

		const fold = css.slice(css.indexOf("@media (max-width:640px)"));
		expect(fold).toContain(
			".rr [data-split]>*,.rr [data-region]{width:auto!important;max-width:none!important;flex:0 1 auto!important}",
		);
		// The folded part still never grows: only shrinking is allowed.
		expect(fold).not.toMatch(/\[data-region\][^}]*flex:1/);
	});

	it("makes the name the page's heading and section titles its subheadings", async () => {
		const data = structuredClone(sampleResumeData);
		const { html } = await renderResumeWebPage({ data });

		expect(html.match(/<h1[ >]/g)).toHaveLength(1);
		expect(html).toMatch(new RegExp(`<h1[^>]*>${data.basics.name}</h1>`));
		expect(html).toMatch(/<h2[ >]|role="heading" aria-level="2"/);
	});
});

describe("right-to-left web page with Latin bullets", () => {
	it("keeps each bullet's row mirrored while its sentence reads left to right", async () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.template = "onyx";
		data.metadata.page.locale = "ar-SA";
		const { html, css } = await renderResumeWebPage({ data });
		const rules = [...css.matchAll(/\.rr \.(c\d+)\{([^}]*)\}/g)].map(([, name, body]) => ({ name, body: body ?? "" }));
		// A text box laid out as a row places its runs by justify-content: a left-to-right sentence aligned right must
		// sit at the row's end, next to its bullet, not at the far left.
		const misplaced = rules.filter(
			({ body }) =>
				body.includes("display:flex") &&
				body.includes("--rr-text-direction:ltr") &&
				body.includes("text-align:right") &&
				!body.includes("justify-content:flex-end"),
		);
		expect(misplaced.filter(({ name }) => html.includes(`class="t ${name}"`))).toEqual([]);
		// The sentence itself still reads left to right.
		expect(rules.some(({ name, body }) => body.includes("--rr-text-direction:ltr") && html.includes(name))).toBe(true);
	});
});
