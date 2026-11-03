// @vitest-environment happy-dom
import { expect, it } from "vite-plus/test";
import { resolveExportTokens } from "./flow-tokens";

const stageToken = () => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
	bar.setAttribute("fill", "var(--stage-screening)");
	const band = document.createElementNS("http://www.w3.org/2000/svg", "stop");
	band.setAttribute("stop-color", "var(--stage-interview)");
	svg.append(bar, band);
	return { svg, bar, band };
};

it.each([
	["light", "oklch(0.64 0.11 200)", "oklch(0.64 0.11 80)"],
	["dark", "oklch(0.7 0.12 200)", "oklch(0.72 0.12 80)"],
])("resolves %s theme tokens before the chart is rasterized", (_, screening, interview) => {
	const { svg, bar, band } = stageToken();
	resolveExportTokens(
		svg,
		(token) => ({ "--stage-screening": screening, "--stage-interview": interview })[token] ?? "",
	);

	expect(bar.getAttribute("fill")).toBe(screening);
	expect(band.getAttribute("stop-color")).toBe(interview);
});

it("leaves concrete colours and unresolved tokens alone", () => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	const concrete = document.createElementNS("http://www.w3.org/2000/svg", "rect");
	concrete.setAttribute("fill", "#5590cc");
	const missing = document.createElementNS("http://www.w3.org/2000/svg", "rect");
	missing.setAttribute("fill", "var(--unknown-token)");
	svg.append(concrete, missing);

	resolveExportTokens(svg, () => "");

	expect(concrete.getAttribute("fill")).toBe("#5590cc");
	expect(missing.getAttribute("fill")).toBe("currentColor");
});
