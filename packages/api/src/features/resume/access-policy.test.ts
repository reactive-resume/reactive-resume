import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { assertCanView, redactResumeForViewer, requiresPassword } from "./access-policy";

describe("assertCanView", () => {
	it("throws NOT_FOUND for private resume viewed by non-owner", () => {
		expect(() => assertCanView({ userId: "u1", isPublic: false }, { id: "u2" })).toThrow();
	});

	it("error code is NOT_FOUND (not FORBIDDEN) to prevent existence disclosure", () => {
		try {
			assertCanView({ userId: "u1", isPublic: false }, null);
			expect.unreachable();
		} catch (error: unknown) {
			expect((error as { code?: string }).code).toBe("NOT_FOUND");
		}
	});
});

describe("redactResumeForViewer", () => {
	it("leaves hidden contact details out for visitors but not for the owner", () => {
		const data = structuredClone(sampleResumeData);
		const [reference] = data.sections.references.items;
		if (!reference) throw new Error("The sample resume needs a reference.");
		data.sections.references.items = [{ ...reference, id: "ref", name: "Jo", phone: "+1 555 0100" }];
		const resume = { name: "Title", data, hideContactDetails: true };

		const visitor = redactResumeForViewer(resume, false).data;
		expect(visitor.basics).toMatchObject({ email: "", phone: "", location: "", customFields: [] });
		expect(visitor.sections.references.items[0]?.phone).toBe("");
		expect(visitor.basics.name).toBe(data.basics.name);

		const owner = redactResumeForViewer(resume, true).data;
		expect(owner.basics.email).toBe(data.basics.email);
		expect(owner.sections.references.items[0]?.phone).toBe("+1 555 0100");
	});

	it("replaces name with placeholder for non-owner", () => {
		const resume = {
			name: "Senior Eng @ Foo — final draft",
			data: defaultResumeData,
		};
		const result = redactResumeForViewer(resume, false);
		expect(result.name).toBe("Resume");
	});

	it("strips metadata.notes and the author's Check choices for non-owner", () => {
		const resume = {
			name: "Title",
			data: {
				...defaultResumeData,
				metadata: {
					...defaultResumeData.metadata,
					notes: "Private notes",
					check: { ignored: ["MISSING_PHONE:/basics/phone"], hiddenTerms: ["HIPAA"] },
				},
			},
		};
		const result = redactResumeForViewer(resume, false);
		expect(result.data.metadata.notes).toBe("");
		expect(result.data.metadata.check).toBeUndefined();
	});

	it("strips what the author hid for non-owner and keeps what prints", () => {
		const data = structuredClone(sampleResumeData);
		data.picture.hidden = true;
		data.summary.hidden = true;
		data.summary.title = "Private summary heading";
		data.sections.references.hidden = true;
		data.sections.references.title = "References at my current employer";
		data.sections.projects.items = data.sections.projects.items.map((item, index) => ({ ...item, hidden: index > 0 }));
		data.customSections = data.customSections.map((section) => ({ ...section, hidden: true }));

		const shared = redactResumeForViewer({ name: "Title", data }, false).data;

		expect(shared.picture.url).toBe("");
		expect(shared.summary.content).toBe("");
		expect(shared.summary.title).toBe("");
		expect(shared.sections.references.items).toEqual([]);
		expect(shared.sections.references.title).toBe("");
		expect(shared.sections.projects.items).toEqual(data.sections.projects.items.slice(0, 1));
		expect(shared.customSections).toEqual([]);
		expect(shared.sections.education).toEqual(data.sections.education);
	});
});

describe("requiresPassword", () => {
	it("returns false for the resume owner regardless of password state", () => {
		expect(requiresPassword({ userId: "u1", passwordHash: "hash" }, { id: "u1" })).toBe(false);
		expect(requiresPassword({ userId: "u1", hasPassword: true }, { id: "u1" })).toBe(false);
		expect(requiresPassword({ userId: "u1", passwordHash: null }, { id: "u1" })).toBe(false);
	});

	it("returns true for non-owner when passwordHash or hasPassword is set", () => {
		expect(requiresPassword({ userId: "u1", passwordHash: "hash" }, { id: "u2" })).toBe(true);
		expect(requiresPassword({ userId: "u1", hasPassword: true }, { id: "u2" })).toBe(true);
		expect(requiresPassword({ userId: "u1", passwordHash: "hash" }, null)).toBe(true);
		expect(requiresPassword({ userId: "u1", hasPassword: true }, null)).toBe(true);
	});

	it("returns false when resume has no password", () => {
		expect(requiresPassword({ userId: "u1", passwordHash: null }, { id: "u2" })).toBe(false);
		expect(requiresPassword({ userId: "u1", hasPassword: false }, { id: "u2" })).toBe(false);
		expect(requiresPassword({ userId: "u1", passwordHash: null }, null)).toBe(false);
	});
});
