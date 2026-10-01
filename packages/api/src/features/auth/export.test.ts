import { describe, expect, it, vi } from "vitest";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({ select: vi.fn(), predicates: [] as unknown[], getLetter: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@reactive-resume/db/schema", () => ({
	user: { id: "user.id" },
	resume: { userId: "resume.userId" },
	coverLetter: { userId: "coverLetter.userId" },
	application: { userId: "application.userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));
vi.mock("@reactive-resume/env/server", () => ({ env: {} }));
vi.mock("@reactive-resume/auth/config", () => ({ isCustomOAuthProviderEnabled: () => false }));
vi.mock("../storage/service", () => ({ getStorageService: vi.fn() }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { getById: mocks.getLetter } }));
const { authService } = await import("./service");

describe("account backup", () => {
	it.each([false, true])(
		"includes current owned letters and applications alongside resumes (linked: %s)",
		async (linked) => {
			const letter = {
				id: "letter",
				name: "Saved",
				recipient: "",
				content: "<p>Body</p>",
				style: copyCoverLetterStyle(defaultResumeData),
				layout: "freeform",
				recipientName: "",
				recipientCompany: "",
				letterDate: null,
				senderLinked: linked,
				designLinked: linked,
				isLocked: false,
				sourceResumeId: linked ? "resume" : null,
				sourceApplicationId: null,
				revision: 1,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			const resolved = structuredClone(letter);
			if (linked) {
				resolved.style.basics.name = "Current sender";
				resolved.style.metadata.template = "gengar";
			}
			mocks.getLetter.mockResolvedValue(resolved);
			const application = { id: "application", userId: "owner", company: "Lumen", role: "Designer" };
			for (const rows of [
				[{ id: "owner", name: "Owner" }],
				[{ id: "resume", data: defaultResumeData }],
				[letter],
				[application],
			]) {
				mocks.select.mockReturnValueOnce({
					from: () => ({
						where: (predicate: unknown) => {
							mocks.predicates.push(predicate);
							return Promise.resolve(rows);
						},
					}),
				});
			}
			const exported = await authService.exportData({ userId: "owner" });
			expect(exported).toMatchObject({ coverLetters: [resolved], resumes: [{ id: "resume" }] });
			// Applications come along, without the owner's id.
			expect(exported.applications).toEqual([{ id: "application", company: "Lumen", role: "Designer" }]);
			expect(mocks.predicates).toContainEqual({ column: "coverLetter.userId", value: "owner" });
		},
	);
});
