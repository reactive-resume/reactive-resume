import { describe, expect, it } from "vite-plus/test";
import { renderWebPageDocument, webPageMessages } from "./document";

const page = { lang: "en", html: "<div>Resume</div>", css: ".rr{color:red}" };
const render = (css?: string) => renderWebPageDocument({ page, messages: webPageMessages("en"), css });
const stylesheet = (document: string) => document.slice(document.indexOf("<style>") + 7, document.indexOf("</style>"));

describe("renderWebPageDocument", () => {
	it("applies the owner's CSS after the page's own styles", () => {
		const css = stylesheet(render("@media (max-width:640px){.rr h1{font-size:20px}}"));
		expect(css.indexOf("@media (max-width:640px){.rr h1{font-size:20px}}")).toBeGreaterThan(
			css.indexOf(".rr{color:red}"),
		);
	});

	it("keeps the owner's CSS inside its style element", () => {
		const document = render(".rr{color:blue}</style><script>alert(1)</script><STYLE>");
		expect(document.match(/<\/style/gi)).toHaveLength(1);
		// Still text of the stylesheet, which the browser reads as CSS, never as markup.
		expect(stylesheet(document)).toContain(".rr{color:blue}<\\/style><script>alert(1)<\\/script>");
	});

	it("leaves the stylesheet as it was without owner CSS", () => {
		expect(stylesheet(render(""))).toBe(stylesheet(render(undefined)));
		expect(stylesheet(render(undefined)).endsWith(".rr{color:red}")).toBe(true);
	});
});
