import type { ResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { getResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { redactResumeForViewer } from "./access-policy";
import { parseStoredResumeData } from "./resume-data-validation";

export type PublicResumeSocialMetaInput = { username: string; slug: string };

// Only public, password-free resumes outside Trash with an unbanned owner are matched. Password-protected
// resumes must not leak their summary to an unauthenticated crawler, and this read deliberately skips the view
// counting and access gating in resumeService.getBySlug — a card render is not a visit.
const findResume = async (input: PublicResumeSocialMetaInput) => {
	const [schema, { eq, isNull }, { findResumeBySlug }] = await Promise.all([
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("./slugs"),
	]);
	const resume = await findResumeBySlug(
		input,
		{ name: schema.resume.name, data: schema.resume.data },
		eq(schema.resume.isPublic, true),
		isNull(schema.resume.password),
	);
	return resume ?? null;
};

/**
 * Loads metadata (title, description, image) for social card previews of a public resume.
 * Redacts hidden sections and respects password gating and trashed state.
 */
export async function getPublicResumeSocialMeta(input: PublicResumeSocialMetaInput): Promise<ResumeSocialMeta | null> {
	const resume = await findResume(input);
	if (!resume) return null;

	// The card shows what an anonymous visitor gets: no dashboard title, nothing the author hid.
	const visible = redactResumeForViewer({ name: resume.name, data: parseStoredResumeData(resume.data) }, false);
	return getResumeSocialMeta(visible.data, visible.name);
}
