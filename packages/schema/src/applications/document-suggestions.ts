import type { ApplicationStatus } from "./data";

type Target = {
	id: string;
	company: string;
	status: ApplicationStatus;
	resumeId: string | null;
	coverLetterId: string | null;
	sentResumeVersionId: string | null;
	sentCoverLetterVersionId: string | null;
};

type Candidate = {
	type: "resume" | "letter";
	name: string;
	isLocked: boolean;
	trashedAt: Date | string | null;
	application: { id: string } | null;
};

/** The first usable company-named document of each missing kind, in the library's edited order. */
export function suggestApplicationDocuments<T extends Candidate>(application: Target, documents: readonly T[]): T[] {
	const company = application.company.trim().toLowerCase();
	if (!company || application.status === "offer" || application.status === "closed") return [];
	return (["resume", "letter"] as const).flatMap((type) => {
		if (
			type === "resume"
				? application.resumeId || application.sentResumeVersionId
				: application.coverLetterId || application.sentCoverLetterVersionId
		)
			return [];
		const match = documents.find(
			(document) =>
				document.type === type &&
				!document.isLocked &&
				!document.trashedAt &&
				(!document.application || document.application.id === application.id) &&
				document.name.toLowerCase().includes(company),
		);
		return match ? [match] : [];
	});
}
