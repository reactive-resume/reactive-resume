import { ORPCError } from "@orpc/server";
import { isbot } from "isbot";
import * as schema from "@reactive-resume/db/schema";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import {
	assertCanView,
	isOwner,
	publicResumeData,
	requiresPassword,
	resolveViewer,
	shouldCountForStatistics,
} from "./access-policy";
import { publicRenderRateLimiter } from "./public-render-rate-limit";
import { findResume } from "./slugs";
import { countVisit } from "./view-dedup";

export type PublicResumeDownloadInput = {
	username: string;
	slug: string;
	requestHeaders: Headers;
	trustedClient: string;
	/** Count downloads once an hour per visitor, across formats. */
	countDownload?: boolean;
};

/** Revalidate access before rendering or returning any cached public file. */
export async function authorizePublicResumeDownload(input: PublicResumeDownloadInput, format: "pdf" | "docx") {
	const resume = await findResume(
		{ username: input.username, slug: input.slug },
		{
			id: schema.resume.id,
			userId: schema.resume.userId,
			data: schema.resume.data,
			isPublic: schema.resume.isPublic,
			hideContactDetails: schema.resume.hideContactDetails,
			showDownloadButtons: schema.resume.showDownloadButtons,
			passwordHash: schema.resume.password,
			allowWordDownload: schema.resume.allowWordDownload,
		},
	);
	if (!resume) throw new ORPCError("NOT_FOUND");

	const viewer = await resolveViewer(input.requestHeaders);
	assertCanView(resume, viewer);
	// Each format needs its own owner opt-in; old clients only control the existing PDF setting.
	const allowed = format === "docx" ? resume.allowWordDownload === true : resume.showDownloadButtons;
	if (!allowed && !isOwner(resume, viewer)) throw new ORPCError("NOT_FOUND");
	if (
		requiresPassword(resume, viewer) &&
		!(await import("./access")).hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)
	) {
		throw new ORPCError("NEED_PASSWORD", {
			status: 401,
			data: { username: input.username, slug: input.slug },
		});
	}

	if (input.countDownload && shouldCountForStatistics(resume, viewer) && !isbot(input.requestHeaders.get("user-agent")))
		await countVisit({ kind: "download", resumeId: resume.id, trustedClient: input.trustedClient });

	return resume;
}

/** Word uses the owned builder with the public view, never the owner's private document or a public storage URL. */
export async function createPublicResumeDocx(input: PublicResumeDownloadInput) {
	const resume = await authorizePublicResumeDownload(input, "docx");
	await publicRenderRateLimiter.consume({ trustedClient: input.trustedClient, resumeId: resume.id });
	const { fileResponse } = await import("../documents/exports");
	return fileResponse(getResumeExportData(publicResumeData(resume), "resume"), "", "docx", null);
}
