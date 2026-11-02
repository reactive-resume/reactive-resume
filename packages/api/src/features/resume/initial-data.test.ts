import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { createResumeData } from "./initial-data";

describe("createResumeData", () => {
	it("starts a blank resume with the account's name and email", () => {
		const data = createResumeData({ name: "Sam Lee", email: "sam@example.test" });
		expect(data.basics).toMatchObject({ name: "Sam Lee", email: "sam@example.test" });
	});

	it("keeps a sample's own contact details", () => {
		const data = createResumeData({ withSampleData: true, email: "sam@example.test" });
		expect(data.basics.email).toBe(sampleResumeData.basics.email);
	});
});
