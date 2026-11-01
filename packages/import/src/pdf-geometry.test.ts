import { expect, it } from "vite-plus/test";
import { GeometryIndex, GeometryLimit } from "./pdf-geometry";
const line = (y: number, page = 1) => ({
	page,
	x: 10,
	y,
	width: 100,
	height: 10,
	text: "field",
	spans: [],
	fontSize: 10,
	fontRef: "body",
	meanStreamIndex: 0,
});
it("indexes page-local y windows rather than scanning other pages", () => {
	const fields = Array.from({ length: 8000 }, (_, i) => line((i % 100) * 10, Math.floor(i / 100) + 1));
	const index = new GeometryIndex(fields);
	expect(index.near(line(100, 4), 10, 10).map((row) => row.y)).toEqual([90, 100, 110]);
	expect(index.visits).toBe(3);
});
it("bounds nested candidate work deterministically across shared indexes", () => {
	const index = new GeometryIndex(Array.from({ length: 100 }, (_, i) => line(i)));
	const spans = new GeometryIndex(index.fields, index.budget);
	let queries = 0;
	expect(() => {
		for (let iteration = 0; iteration < 4000; iteration++) {
			index.all();
			spans.all();
			queries++;
		}
	}).toThrow(GeometryLimit);
	expect(queries).toBe(2000);
	expect(index.visits).toBe(400100);
});
