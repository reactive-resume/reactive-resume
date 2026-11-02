import { describe, expect, it } from "vite-plus/test";
import { addPageWith, spillingSections } from "./spill";

const page = (main: string[], sidebar: string[] = []) => ({ fullWidth: false, main, sidebar });
const section = (sectionId: string, pageIndex: number) => ({ kind: "section", sectionId, page: pageIndex });

describe("spillingSections", () => {
	it("moves the sections that start past the last page, keeping their column", () => {
		const pages = [page(["summary", "experience", "projects", "awards"], ["skills", "languages"])];
		const rendered = [
			section("summary", 0),
			section("experience", 0),
			section("experience", 1),
			section("projects", 1),
			section("awards", 1),
			section("skills", 0),
			section("languages", 1),
			{ kind: "item", sectionId: "projects", page: 1 },
		];
		expect(spillingSections(pages, rendered)).toEqual({ main: ["projects", "awards"], sidebar: ["languages"] });
	});

	it("moves the section that runs across the break when none starts past it", () => {
		const pages = [page(["summary", "experience"])];
		expect(
			spillingSections(pages, [section("summary", 0), section("experience", 0), section("experience", 1)]),
		).toEqual({ main: ["experience"], sidebar: [] });
	});

	it("moves nothing when the only section spills, or without a page map", () => {
		expect(spillingSections([page(["experience"])], [section("experience", 0), section("experience", 1)])).toBeNull();
		expect(spillingSections([page(["experience"])], undefined)).toBeNull();
	});

	it("reads the last authored page of several", () => {
		const pages = [page(["summary"]), page(["experience", "education"])];
		expect(spillingSections(pages, [section("summary", 0), section("experience", 1), section("education", 2)])).toEqual(
			{ main: ["education"], sidebar: [] },
		);
	});
});

describe("addPageWith", () => {
	it("adds a page holding the moved sections", () => {
		const pages = [{ fullWidth: true, main: ["summary", "projects"], sidebar: ["skills"] }];
		addPageWith(pages, { main: ["projects"], sidebar: [] });
		expect(pages).toEqual([
			{ fullWidth: true, main: ["summary"], sidebar: ["skills"] },
			{ fullWidth: true, main: ["projects"], sidebar: [] },
		]);
	});
});
