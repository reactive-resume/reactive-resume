jest.mock("uuid", () => ({ validate: () => false, v5: () => "test-id", v7: () => "test-id" }));
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { storyboardProposals, applyResumeProposals } from "./proposal-model";

test("a proposal cannot overwrite a passage changed after review", () => {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		{
			id: "northwind",
			hidden: false,
			company: "Test",
			position: "",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			roles: [],
			description: "<ul><li>First line</li><li>Original words</li></ul>",
		},
	];
	const proposal = storyboardProposals(data)[0];
	if (!proposal) throw new Error("Missing proposal");
	const changed = structuredClone(data);
	const entry = changed.sections.experience.items[0];
	if (!entry) throw new Error("Missing entry");
	entry.description = "<p>My new words</p>";
	const result = applyResumeProposals(changed, [proposal]);
	expect(result.applied).toHaveLength(0);
	expect(result.stale).toHaveLength(1);
	expect(changed.sections.experience.items[0]?.description).toBe("<p>My new words</p>");
	const applied = applyResumeProposals(data, [proposal]);
	expect(applied.applied).toHaveLength(1);
	expect(data.sections.experience.items[0]?.description).toContain("and scaled a design system");
});
