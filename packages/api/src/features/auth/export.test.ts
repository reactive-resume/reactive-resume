import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	predicates: [] as unknown[],
	getLetter: vi.fn(),
	exportCareer: vi.fn(),
	getApplicationProfile: vi.fn(),
	getPipeline: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@reactive-resume/db/schema", () => ({
	user: { id: "user.id" },
	resume: { userId: "resume.userId" },
	coverLetter: { userId: "coverLetter.userId" },
	application: { userId: "application.userId" },
	aiContentReport: { userId: "aiContentReport.userId" },
	resumeVersion: { userId: "resumeVersion.userId" },
	coverLetterVersion: { userId: "coverLetterVersion.userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));
vi.mock("@reactive-resume/env/server", () => ({ env: {} }));
vi.mock("@reactive-resume/auth/config", () => ({ isCustomOAuthProviderEnabled: () => false }));
vi.mock("../storage/service", () => ({ getStorageService: vi.fn() }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { getById: mocks.getLetter } }));
vi.mock("../applications/lanes", () => ({ applicationLaneService: { get: mocks.getPipeline } }));
vi.mock("../career/service", () => ({ careerService: { exportData: mocks.exportCareer } }));
vi.mock("../application-profile/service", () => ({ applicationProfileService: { get: mocks.getApplicationProfile } }));
const { authService } = await import("./service");

describe("account backup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.predicates.length = 0;
		mocks.getPipeline.mockResolvedValue({ revision: 0, lanes: [] });
		mocks.getApplicationProfile.mockResolvedValue({
			data: { email: "private@example.test" },
			reviewedAt: "2030-01-01T00:00:00.000Z",
			revision: "profile-revision",
		});
	});

	it.each([false, true])(
		"includes owned letters, applications and career data alongside resumes (linked: %s)",
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
			const career = {
				facts: [
					{
						id: "fact",
						text: "I led a warehouse migration.",
						source: { kind: "manual", id: "career-note", quote: "I led a warehouse migration." },
					},
				],
				artifacts: [
					{
						id: "brief",
						data: { kind: "brief", markdown: "Discuss the warehouse migration." },
						evidence: { factIds: ["fact"], sources: [] },
					},
				],
				transcripts: [{ id: "transcript", original: "I lead the migration.", edited: "I led the migration." }],
			};
			mocks.exportCareer.mockResolvedValue(career);
			const application = { id: "application", userId: "owner", company: "Lumen", role: "Designer" };
			for (const rows of [
				[{ id: "owner", name: "Owner" }],
				[{ id: "resume", data: defaultResumeData }],
				[letter],
				[application],
				[
					{
						id: "approved-resume-version",
						userId: "owner",
						resumeId: "resume",
						kind: "named",
						data: defaultResumeData,
					},
				],
				[{ id: "approved-letter-version", userId: "owner", coverLetterId: "letter", kind: "named", data: letter }],
				[{ id: "report", userId: "owner", content: "Reported output" }],
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
			expect(mocks.exportCareer).toHaveBeenCalledExactlyOnceWith("owner");
			expect(exported.career).toEqual(career);
			expect(mocks.getApplicationProfile).toHaveBeenCalledExactlyOnceWith("owner");
			expect(exported.applicationProfile).toMatchObject({
				data: { email: "private@example.test" },
				revision: "profile-revision",
			});
			expect(exported.applicationPipeline).toEqual({ revision: 0, lanes: [] });
			expect(exported.documentVersions).toMatchObject({
				resumes: [{ id: "approved-resume-version", resumeId: "resume" }],
				letters: [{ id: "approved-letter-version", coverLetterId: "letter" }],
			});
			expect(exported.documentVersions.resumes[0]).not.toHaveProperty("userId");
			expect(mocks.predicates).toContainEqual({ column: "resumeVersion.userId", value: "owner" });
			expect(mocks.predicates).toContainEqual({ column: "coverLetterVersion.userId", value: "owner" });
			expect(mocks.getPipeline).toHaveBeenCalledExactlyOnceWith("owner");
			expect(exported.aiContentReports).toEqual([{ id: "report", userId: "owner", content: "Reported output" }]);
			expect(mocks.predicates).toContainEqual({ column: "aiContentReport.userId", value: "owner" });
		},
	);
});
