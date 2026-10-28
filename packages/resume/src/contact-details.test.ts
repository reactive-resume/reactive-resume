import { expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { removeContactDetails } from "./contact-details";

it("redacts built-in and custom reference phones without changing the source document", () => {
	const source = structuredClone(sampleResumeData);
	source.customSections.push({
		...structuredClone(source.sections.references),
		id: "custom-reference",
		type: "references",
	});
	for (const reference of source.sections.references.items) reference.phone = "+49 555 0100";
	const custom = source.customSections.at(-1);
	if (custom?.type !== "references") throw new Error("Invalid reference fixture");
	for (const reference of custom.items) reference.phone = "+49 555 0101";
	const publicData = structuredClone(source);
	removeContactDetails(publicData);
	expect(JSON.stringify(publicData)).not.toMatch(/555 010[01]/);
	expect(JSON.stringify(source)).toContain("555 0101");
	expect(publicData.basics.email).toBe("");
});
