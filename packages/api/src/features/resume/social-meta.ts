import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { eq, isNull } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";
import { verifiedDomainColumn } from "../custom-domain/service";
import { publicResumeData } from "./access-policy";
import { findResume } from "./slugs";

export type PublicResumeCardInput = { username: string; slug: string };

/**
 * What a public resume's link preview card shows: the resume as an anonymous visitor sees it, with hidden sections
 * and (when the owner hid them) contact details removed. `null` when it isn't public or needs a password.
 *
 * Only public, password-free resumes outside Trash with an unbanned owner are matched: a password-protected resume must
 * not leak its summary to a crawler. A card render is not a visit, so nothing is counted or gated here.
 */
export async function getPublicResumeCardData(
	input: PublicResumeCardInput,
): Promise<{ data: ResumeData; isPrimary: boolean; customDomain: string | null; isReleasedUsername: boolean } | null> {
	const resume = await findResume(
		{ username: input.username, slug: input.slug },
		{
			data: schema.resume.data,
			hideContactDetails: schema.resume.hideContactDetails,
			isPrimary: schema.resume.isPrimary,
			customDomain: verifiedDomainColumn(),
			username: schema.user.username,
		},
		eq(schema.resume.isPublic, true),
		isNull(schema.resume.password),
	);
	if (!resume) return null;
	return {
		data: publicResumeData(resume),
		isPrimary: resume.isPrimary,
		customDomain: resume.isPrimary ? resume.customDomain : null,
		isReleasedUsername: resume.username?.toLowerCase() !== input.username.toLowerCase(),
	};
}
