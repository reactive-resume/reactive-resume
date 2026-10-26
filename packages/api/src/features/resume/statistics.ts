import z from "zod";
import { protectedProcedure, publicProcedure } from "../../context";
import { resumeDto } from "../../dto/resume";
import { resumeDownloadRateLimit } from "../../middleware/rate-limit";
import { resumeService } from "./service";
import { ownerViewer } from "./sharing";

export const resumeStatisticsRouter = {
	recordDownload: publicProcedure
		.route({
			method: "POST",
			path: "/resumes/{username}/{slug}/statistics/download",
			tags: ["Resume Statistics"],
			operationId: "recordResumeDownload",
			summary: "Record a public resume PDF download",
			description:
				"Records a visitor's explicit PDF download after the browser starts saving the file. Requires access to the public resume. For password-protected resumes, first call verifyResumePassword (POST /resumes/{username}/{slug}/password/verify) with the password, then send the returned HttpOnly resume_access_<resumeId> cookie with this request. A missing or invalid access cookie returns NEED_PASSWORD (HTTP 401); the cookie expires after 10 minutes. Owner downloads are excluded. Rate limited per resume and visitor.",
			successDescription: "The download event was accepted.",
		})
		.input(resumeDto.getBySlug.input)
		.use(resumeDownloadRateLimit)
		.output(z.boolean())
		.handler(({ context, input }) =>
			resumeService.statistics.recordDownload({
				...input,
				requestHeaders: context.reqHeaders,
				...(context.trustedClient ? { trustedClient: context.trustedClient } : {}),
				...ownerViewer(context),
			}),
		),

	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/statistics",
			tags: ["Resume Statistics"],
			operationId: "getResumeStatistics",
			summary: "Get resume statistics",
			description:
				"Returns view and download statistics for the specified resume, including total counts and the timestamps of the last view and download. Requires authentication.",
			successDescription: "The resume's view and download statistics.",
		})
		.input(z.object({ id: z.string().describe("The unique identifier of the resume.") }))
		.output(
			z.object({
				isPublic: z.boolean().describe("Whether the resume is currently public."),
				views: z.number().describe("Total number of times the resume has been viewed."),
				downloads: z.number().describe("Total number of times the resume has been downloaded."),
				lastViewedAt: z.date().nullable().describe("Timestamp of the last view, or null if never viewed."),
				lastDownloadedAt: z.date().nullable().describe("Timestamp of the last download, or null if never downloaded."),
			}),
		)
		.handler(({ context, input }) => resumeService.statistics.getById({ id: input.id, userId: context.user.id })),

	getDailyById: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/statistics/daily",
			tags: ["Resume Statistics"],
			operationId: "getResumeDailyStatistics",
			summary: "Get resume daily statistics",
			description:
				"Returns a continuous, zero-filled per-day series of view and download counts for the specified resume over the last `days` days (UTC). Requires authentication and resume ownership.",
			successDescription: "The resume's daily view and download statistics.",
		})
		.input(
			z.object({
				id: z.string().describe("The unique identifier of the resume."),
				days: z.number().int().min(1).max(365).default(30).describe("Number of trailing days to include."),
			}),
		)
		.output(
			z.array(
				z.object({
					date: z.string().describe("The UTC day in YYYY-MM-DD format."),
					views: z.number().describe("Number of views recorded on this day."),
					downloads: z.number().describe("Number of downloads recorded on this day."),
				}),
			),
		)
		.handler(({ context, input }) =>
			resumeService.statistics.getDailySeries({
				id: input.id,
				userId: context.user.id,
				days: input.days,
			}),
		),
};
