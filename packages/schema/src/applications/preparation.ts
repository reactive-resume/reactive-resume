import type { CareerWorkspace } from "../career";
import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { hasApplicationSubmission } from "./data";

type PreparationApplication = {
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
	jobDescription: string | null;
	resumeId: string | null;
	coverLetterId: string | null;
	resumeFileUrl: string | null;
	coverLetterUrl: string | null;
};

/** Guidance only: the existing review checks are user acknowledgements, never proof of submission or quality. */
export function nextPreparationStep(
	application: PreparationApplication,
	workspace: Pick<CareerWorkspace, "checklist" | "answers">,
	documents?: readonly { id: string; type: "resume" | "letter" }[],
) {
	if (hasApplicationSubmission(application)) return "submitted";
	if (application.status === "closed") return "closed";
	if (!application.jobDescription?.trim()) return "posting";
	const selected = (type: "resume" | "letter", id: string | null) =>
		id && (!documents || documents.some((document) => document.type === type && document.id === id));
	if (!selected("resume", application.resumeId) && !application.resumeFileUrl) return "resume";
	if (!workspace.checklist.includes(1)) return "tailor";
	// Document review also acknowledges that an optional letter is unnecessary.
	if (!selected("letter", application.coverLetterId) && !application.coverLetterUrl && !workspace.checklist.includes(0))
		return "letter";
	if (
		workspace.answers.some((answer) => !answer.question.trim() || !answer.answer.trim()) ||
		!workspace.checklist.includes(2)
	)
		return "answers";
	return "review";
}
