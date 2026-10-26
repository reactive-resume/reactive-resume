import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { redactResumeForViewer } from "./access-policy";
import { parseStoredResumeData } from "./resume-data-validation";

export type PublicResumeCardInput = { username: string; slug: string };

// Only public, password-free resumes outside Trash with an unbanned owner are matched. Password-protected
// resumes must not leak their summary to an unauthenticated crawler, and this read deliberately skips the view
// counting and access gating of a visit — a card render is not a visit.
const findResume = async (input: PublicResumeCardInput) => {
	const [schema, { eq, isNull }, { findResumeBySlug }] = await Promise.all([
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("./slugs"),
	]);
	const resume = await findResumeBySlug(
		input,
		{
			name: schema.resume.name,
			data: schema.resume.data,
			hideContactDetails: schema.resume.hideContactDetails,
			userId: schema.resume.userId,
			isPrimary: schema.resume.isPrimary,
		},
		eq(schema.resume.isPublic, true),
		isNull(schema.resume.password),
	);
	return resume ?? null;
};

/**
 * What a public resume's link preview card shows: the resume as an anonymous visitor sees it, with hidden sections
 * and (when the owner hid them) contact details removed. `null` when it isn't public or needs a password.
 */
export async function getPublicResumeCardData(
	input: PublicResumeCardInput,
): Promise<{ data: ResumeData; isPrimary: boolean; customDomain: string | null } | null> {
	const resume = await findResume(input);
	if (!resume) return null;
	const { data } = redactResumeForViewer(
		{ name: resume.name, data: parseStoredResumeData(resume.data), hideContactDetails: resume.hideContactDetails },
		false,
	);
	const customDomain = resume.isPrimary
		? await import("../custom-domain/service").then(({ verifiedDomainOf }) => verifiedDomainOf(resume.userId))
		: null;
	return { data, isPrimary: resume.isPrimary, customDomain };
}
