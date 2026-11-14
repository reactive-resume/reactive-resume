// @vitest-environment happy-dom
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";

type Run = { text: string; lineEnd?: boolean };

// pdf.js's text layer, reduced to what it hands over: one element per text run, a <br> where a line ends.
vi.mock("@/features/resume/preview/pdfjs", () => ({
	TextLayer: class {
		textDivs: HTMLElement[] = [];
		textContentItemsStr: string[] = [];
		constructor(private options: { container: HTMLElement; textContentSource: Run[] }) {}
		async render() {
			for (const run of this.options.textContentSource) {
				const div = document.createElement("span");
				div.textContent = run.text;
				this.options.container.append(div);
				if (run.lineEnd) this.options.container.append(document.createElement("br"));
				this.textDivs.push(div);
				this.textContentItemsStr.push(run.text);
			}
		}
		cancel() {}
	},
}));

const { TermHighlights } = await import("./term-highlights");
// The component lazy-loads the matcher; load it here so a cold import on a busy runner can't outlast waitFor.
await import("@reactive-resume/resume/ats-pdf");

afterEach(cleanup);

async function marksFor(term: string, runs: Run[]) {
	const page = { streamTextContent: () => runs, getViewport: () => ({}) };
	const document = { getPage: async () => page } as unknown as PDFDocumentProxy;
	const { container } = render(<TermHighlights document={document} pageIndex={0} scale={1} term={term} />);
	const layer = container.querySelector("[data-term-highlights]") as HTMLElement;
	await waitFor(() => expect(layer.textContent).toBe(runs.map((run) => run.text).join("")));
	await waitFor(() => expect(layer.querySelector("mark")).not.toBeNull());
	return { layer, marks: [...layer.querySelectorAll("mark")].map((mark) => mark.textContent) };
}

it("marks only matched words across runs and line breaks, keeping surrounding text and word boundaries", async () => {
	const runs = [
		{ text: "A design " },
		{ text: "system", lineEnd: true },
		{ text: "design systems" },
		{ text: " and ecosystem" },
	];
	const { layer, marks } = await marksFor("design system", runs);
	expect(marks).toEqual(["design ", "system", "design systems"]);
	expect(layer.textContent).toBe(runs.map((run) => run.text).join(""));
	expect(layer.querySelectorAll("span")[3]?.querySelector("mark")).toBeNull();
});

it.each(["C++", "C#"])("treats punctuation in %s as literal text", async (term) => {
	const { marks } = await marksFor(term, [{ text: "C++ with C# and C" }]);
	expect(marks).toEqual([term]);
});
