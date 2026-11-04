import { expect, it } from "vite-plus/test";
import { parseResumeData } from "./data";
import { defaultResumeData } from "./default";

it("starts a professional resume with its narrative and retains Profiles in the main column", () => {
	const [page] = defaultResumeData.metadata.layout.pages;
	expect(page?.main.slice(0, 4)).toEqual(["summary", "experience", "education", "projects"]);
	expect(page?.main.at(-1)).toBe("profiles");
	expect(page?.sidebar).not.toContain("profiles");
});

it("preserves an existing explicit section order when reading saved or structured imported data", () => {
	const source = structuredClone(defaultResumeData);
	const page = source.metadata.layout.pages[0];
	if (!page) throw new Error("Missing default page");
	page.main = ["profiles", "education", "experience", "summary", "projects", "volunteer", "references"];
	const before = structuredClone(source.metadata.layout);
	expect(parseResumeData(source).metadata.layout).toEqual(before);
	expect(source.metadata.layout).toEqual(before);
});
