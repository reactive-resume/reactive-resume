import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { renderCustomSection } from "./section-renderers";

function fixture() {
	const section = structuredClone(defaultResumeData.sections.skills);
	Object.assign(section, { keywordLayout: "list" });
	section.items = [
		{
			id: "one",
			hidden: false,
			name: "Engineering",
			proficiency: "Expert",
			level: 3,
			icon: "",
			iconColor: "",
			keywords: ["Alpha", "Beta", "Gamma"],
		},
	];
	return section;
}

describe("skill keyword lists", () => {
	it("emits real bullet paragraphs in a custom skills section", () => {
		const section = fixture();
		const paragraphs = renderCustomSection({ ...section, id: "custom", type: "skills" }, "000000");
		const xml = JSON.stringify(paragraphs.map((paragraph) => paragraph.prepForXml({ stack: [] } as never)));
		expect(xml.match(/w:numPr/g)).toHaveLength(3);
		for (const keyword of ["Alpha", "Beta", "Gamma"]) expect(xml.split(keyword)).toHaveLength(2);
		expect(xml).not.toContain("Alpha, Beta");
	});
});
