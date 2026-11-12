// @vitest-environment happy-dom
import { expect, it } from "vite-plus/test";
import { markTerm } from "./term-highlights";

it("marks only matched words across runs and line breaks, keeping surrounding text and word boundaries", () => {
	const root = document.createElement("div");
	const strings = ["A design ", "system", "design systems", " and ecosystem"];
	const divs = strings.map((text) => {
		const div = document.createElement("span");
		div.textContent = text;
		root.append(div);
		return div;
	});
	divs[1]?.after(document.createElement("br"));
	const before = root.textContent;
	markTerm(divs, strings, ["design system", "system"]);
	expect([...root.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
		"design ",
		"system",
		"design systems",
	]);
	expect(root.textContent).toBe(before);
	expect(divs[3]?.querySelector("mark")).toBeNull();
});

it("treats punctuation in a skill as literal text", () => {
	const div = document.createElement("span");
	markTerm([div], ["C++ with C# and C"], ["C++", "C#"]);
	expect([...div.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["C++", "C#"]);
});
