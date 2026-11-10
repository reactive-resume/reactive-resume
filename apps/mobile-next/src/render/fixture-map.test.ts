import { fixtureIssueMarkers, fixturePageMap } from "./fixture-map";
test("B18 marker and semantic boxes scale with rendered paper dimensions", () => {
	const map = fixturePageMap(358, 506);
	expect(map.nodes.find((node) => node.kind === "item" && node.itemId === "northwind")).toMatchObject({
		x: 24,
		y: 140,
		width: 310,
		height: 46.5,
	});
	expect(fixtureIssueMarkers(358, 506)).toEqual([
		{ key: "storyboard-issue-1", page: 0, x: 308, y: 60, width: 24, height: 24 },
	]);
	expect(fixtureIssueMarkers(716, 1012)[0]).toMatchObject({ x: 616, y: 120, width: 48, height: 48 });
});
