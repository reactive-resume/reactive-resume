import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { createResumeData } from "./initial-data";

describe("createResumeData", () => {
	it("starts a blank resume with the account's name and email", () => {
		const data = createResumeData({ name: "Sam Lee", email: "sam@example.test" });
		expect(data.basics).toMatchObject({ name: "Sam Lee", email: "sam@example.test" });
	});

	it("keeps a sample's own contact details and person", () => {
		const data = createResumeData({ withSampleData: true, email: "sam@example.test", name: "Guest" });
		expect(data.basics.email).toBe(sampleResumeData.basics.email);
		expect(data.basics.name).toBe(sampleResumeData.basics.name);
	});

	it("starts a blank resume on an offered pairing and accent, on Letter paper where that's the norm", () => {
		const us = createResumeData({ locale: "en-US" });
		expect(us.metadata.typography.heading.fontFamily).toBe("Source Serif 4");
		expect(us.metadata.typography.body.fontFamily).toBe("Source Sans 3");
		expect(us.metadata.design.colors.primary).toBe("rgba(47, 90, 138, 1)");
		expect(us.metadata.page.format).toBe("letter");
		expect(createResumeData({ locale: "de-DE" }).metadata.page.format).toBe("a4");
	});
});
