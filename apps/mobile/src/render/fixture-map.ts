import type { PageMap, PageMapTarget } from "@reactive-resume/pdf/page-map";
/** B18 layout dump: paper (16,119,358,506), content x=40..350, marker (324,179,24,24). */
export function fixturePageMap(width: number, height: number): PageMap {
	const entries: { target: PageMapTarget; y: number; bottom: number }[] = [
		{ target: { kind: "header" }, y: 141, bottom: 192 },
		{ target: { kind: "section", sectionId: "summary" }, y: 201, bottom: 234 },
		{ target: { kind: "section", sectionId: "experience" }, y: 243, bottom: 349 },
		{ target: { kind: "item", sectionId: "experience", itemId: "northwind" }, y: 259, bottom: 305.5 },
		{ target: { kind: "item", sectionId: "experience", itemId: "harbour" }, y: 311.5, bottom: 349 },
		{ target: { kind: "section", sectionId: "education" }, y: 358, bottom: 391.5 },
		{ target: { kind: "section", sectionId: "skills" }, y: 400.5, bottom: 433.5 },
		{ target: { kind: "section", sectionId: "languages" }, y: 442, bottom: 466.5 },
	];
	return {
		pages: [{ width, height }],
		nodes: entries.map(({ target, y, bottom }) => ({
			...target,
			key:
				target.kind === "header"
					? "header"
					: target.kind === "section"
						? target.sectionId
						: `${target.sectionId}.${target.itemId}`,
			page: 0,
			x: (24 / 358) * width,
			y: ((y - 119) / 506) * height,
			width: (310 / 358) * width,
			height: ((bottom - y) / 506) * height,
		})),
	};
}
export function fixtureIssueMarkers(width: number, height: number) {
	return [
		{
			key: "storyboard-issue-1",
			page: 0,
			x: (308 / 358) * width,
			y: (60 / 506) * height,
			width: (24 / 358) * width,
			height: (24 / 506) * height,
		},
	];
}
