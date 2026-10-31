import { expect, it } from "vite-plus/test";
import { EMPTY_WORKSPACE } from "../career";
import { isJobCopy, nextPreparationStep } from "./preparation";

const application = {
	status: "saved" as const,
	activity: [],
	jobDescription: "Posting",
	resumeId: "resume",
	coverLetterId: null,
	resumeFileUrl: null,
	coverLetterUrl: null,
};

it("guides missing work in order, with optional letters and answers acknowledged by existing review checks", () => {
	expect(nextPreparationStep({ ...application, jobDescription: "  " }, EMPTY_WORKSPACE)).toBe("posting");
	expect(nextPreparationStep({ ...application, resumeId: null }, EMPTY_WORKSPACE)).toBe("resume");
	expect(nextPreparationStep(application, EMPTY_WORKSPACE, [])).toBe("resume");
	expect(nextPreparationStep(application, EMPTY_WORKSPACE)).toBe("tailor");
	expect(nextPreparationStep(application, { answers: [], checklist: [1] })).toBe("letter");
	expect(nextPreparationStep(application, { answers: [], checklist: [0, 1] })).toBe("answers");
	expect(nextPreparationStep(application, { answers: [], checklist: [0, 1, 2] })).toBe("review");
	expect(
		nextPreparationStep(application, {
			answers: [{ id: "q", question: "Why?", answer: " ", factIds: [] }],
			checklist: [0, 1, 2],
		}),
	).toBe("answers");
	expect(nextPreparationStep({ ...application, resumeId: null, resumeFileUrl: "/file.pdf" }, EMPTY_WORKSPACE)).toBe(
		"tailor",
	);
});

it("keeps submitted and closed applications out of pre-submission guidance", () => {
	expect(nextPreparationStep({ ...application, status: "interview" }, EMPTY_WORKSPACE)).toBe("submitted");
	expect(nextPreparationStep({ ...application, status: "closed" }, EMPTY_WORKSPACE)).toBe("closed");
	expect(
		nextPreparationStep(
			{ ...application, status: "closed", activity: [{ id: "sent", type: "stage", stage: "applied", at: new Date() }] },
			EMPTY_WORKSPACE,
		),
	).toBe("submitted");
});

it("tailors only a resume copied for this job, and offers the copy until documents load", () => {
	const job = { id: "job", resumeId: "resume" };
	expect(isJobCopy(job, [{ id: "resume", type: "resume", application: { id: "job" } }])).toBe(true);
	expect(isJobCopy(job, [{ id: "resume", type: "resume", application: null }])).toBe(false);
	expect(isJobCopy(job, [{ id: "resume", type: "resume", application: { id: "other-job" } }])).toBe(false);
	expect(isJobCopy(job)).toBe(false);
});
