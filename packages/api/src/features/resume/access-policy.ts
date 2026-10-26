import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/client";
import { sql } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";
import { removeContactDetails } from "@reactive-resume/resume/contact-details";
import { parseStoredResumeData } from "./resume-data-validation";

/**
 * Single source of truth for "who can view/edit a resume" and "what fields
 * leak to non-owners on the public view path."
 *
 * Owner-only mutation methods (update / patch / delete / setPassword / …)
 * intentionally do **not** call this module — their `WHERE userId = :owner`
 * clauses already enforce ownership at the query level. The policy here
 * documents that contract and gates the dual-role read path (`getBySlug`)
 * where a non-owner viewer can legitimately read a public resume.
 */

type Resume = {
	userId: string;
	isPublic: boolean;
};

type Viewer = { id: string } | null;

/**
 * Query condition: the joined `user` (the content's owner) is not banned. Same rule as `findActiveUser`
 * in context.ts, so a banned owner's public resumes and pictures stop serving to everyone.
 */
export function ownerIsNotBanned() {
	return sql`(${schema.user.banned} is not true or ${schema.user.banExpires} <= now())`;
}

/** Who is looking at a public page or file: the signed-in account, when its credential may read resumes. */
export const resolveViewer = async (requestHeaders: Headers): Promise<Viewer> =>
	(await import("../../context"))
		.resolveAuthenticationFromRequestHeaders(requestHeaders)
		.then((authentication) => (authentication?.permissions.includes("read") ? { id: authentication.user.id } : null))
		// A cross-site session is refused (FORBIDDEN); fall back to the anonymous view, like /uploads.
		.catch(() => null);

export function isOwner(resume: { userId: string }, viewer: Viewer): boolean {
	return viewer !== null && viewer.id === resume.userId;
}

/**
 * Throws `NOT_FOUND` (not `FORBIDDEN`) when the viewer is not allowed to see
 * the resume — same response as a nonexistent resume so the API does not
 * disclose existence of private resumes by id/slug.
 */
export function assertCanView(resume: Resume, viewer: Viewer): void {
	if (isOwner(resume, viewer)) return;
	if (resume.isPublic) return;
	throw new ORPCError("NOT_FOUND");
}

type PasswordProtectedResume = {
	userId: string;
	passwordHash?: string | null;
	hasPassword?: boolean;
};

/**
 * Returns true if the viewer must satisfy the password gate before viewing or downloading
 * the resume. The owner is exempt from their own password challenge.
 */
export function requiresPassword(resume: PasswordProtectedResume, viewer: Viewer): boolean {
	if (isOwner(resume, viewer)) return false;
	return Boolean(resume.passwordHash || resume.hasPassword);
}

/**
 * Redact owner-only fields before serializing a resume to a non-owner viewer.
 *
 * Stripped on public view:
 *   - `resume.name` — the dashboard title chosen by the owner (often
 *     contains personal context like "Senior Eng @ Foo — final draft").
 *   - `resume.data.metadata.notes` — explicitly documented as "only visible
 *     to the author when editing" in the resume schema.
 *   - `resume.data.metadata.check` — the author's Check choices (ignored
 *     issues, job-posting terms hidden as "not true for me").
 *   - Everything the author hid: hidden sections, summary, picture and items
 *     "aren't printed or shared". Hidden custom sections are dropped; built-in
 *     ones keep their (now empty, untitled) slot because the schema requires it.
 *   - Contact details, when the author hid them in Share (`hideContactDetails`).
 *
 * Everything else (including `data.basics.name`, the person's name on the
 * resume itself) is part of the public payload and is returned unchanged.
 *
 * Owner views pass through untouched.
 */
export function redactResumeForViewer<T extends { name: string; data: ResumeData; hideContactDetails?: boolean }>(
	resume: T,
	viewerIsOwner: boolean,
): T {
	if (viewerIsOwner) return resume;

	const data = structuredClone(resume.data);
	if (resume.hideContactDetails) removeContactDetails(data);
	data.metadata.notes = "";
	data.metadata.check = undefined;
	if (data.picture.hidden) data.picture.url = "";
	if (data.summary.hidden) Object.assign(data.summary, { title: "", content: "" });
	data.customSections = data.customSections.filter((section) => !section.hidden);
	// A hidden built-in section keeps its slot but not its heading, which the author may have written privately too.
	for (const section of Object.values(data.sections)) if (section.hidden) section.title = "";
	const sections: { hidden: boolean; items: { hidden: boolean }[] }[] = [
		...Object.values(data.sections),
		...data.customSections,
	];
	for (const section of sections) section.items = section.hidden ? [] : section.items.filter((item) => !item.hidden);

	return { ...resume, name: "Resume", data };
}

/** A stored resume as every visitor sees it, whoever is looking, so one rendering serves them all. */
export const publicResumeData = (resume: { data: unknown; hideContactDetails: boolean }) =>
	redactResumeForViewer(
		{ name: "", data: parseStoredResumeData(resume.data), hideContactDetails: resume.hideContactDetails },
		false,
	).data;

/**
 * Owner self-views/downloads do not count toward the public statistics —
 * the dashboard would otherwise inflate metrics every time the author
 * previewed their own resume. Call sites that increment `views` /
 * `downloads` should gate on this helper.
 */
export function shouldCountForStatistics(resume: Resume, viewer: Viewer): boolean {
	return !isOwner(resume, viewer);
}
