import { protectedProcedure } from "../../context";
import { resumeDto } from "../../dto/resume";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { paginate } from "../../pagination";
import { resumeService } from "./service";

export const versionsRouter = {
	listVersions: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{resumeId}/versions",
			tags: ["Resumes"],
			operationId: "listResumeVersions",
			summary: "List resume version history",
			description:
				"Returns a resume's version history, newest first, without the data: where it came from (created or imported), one autosave per editing session, named versions, restores and AI edits. Autosaves, AI edits and restores are kept for 90 days; the rest until deleted. Only the resume owner can list versions. Requires authentication.",
			successDescription: "Up to 100 versions, newest first.",
		})
		.input(resumeDto.listVersions.input)
		.output(resumeDto.listVersions.output)
		.handler(async ({ context, input }) =>
			paginate(
				await resumeService.versions.list({ resumeId: input.resumeId, userId: context.user.id }),
				input,
				context.resHeaders,
			),
		),

	getVersion: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{resumeId}/versions/{versionId}",
			tags: ["Resumes"],
			operationId: "getResumeVersion",
			summary: "Get a resume version",
			description:
				"Returns one version of a resume with its full data, for previewing it before a restore. Only the resume owner can read versions. Requires authentication.",
			successDescription: "The version with its data.",
		})
		.input(resumeDto.getVersion.input)
		.output(resumeDto.getVersion.output)
		.handler(({ context, input }) => resumeService.versions.get({ ...input, userId: context.user.id })),

	createVersion: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{resumeId}/versions",
			tags: ["Resumes"],
			operationId: "createResumeVersion",
			summary: "Name a resume version",
			description:
				"Saves the resume as it is now as a named version, kept until deleted. Only the resume owner can name versions. Requires authentication.",
			successDescription: "The new named version.",
		})
		.input(resumeDto.createVersion.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.createVersion.output)
		.handler(({ context, input }) => resumeService.versions.create({ ...input, userId: context.user.id })),

	renameVersion: protectedProcedure
		.route({
			method: "PATCH",
			path: "/resumes/{resumeId}/versions/{versionId}",
			tags: ["Resumes"],
			operationId: "renameResumeVersion",
			summary: "Rename a named resume version",
			description: "Renames a named version. Other versions can't be renamed. Requires authentication.",
			successDescription: "The renamed version.",
		})
		.input(resumeDto.renameVersion.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.renameVersion.output)
		.handler(({ context, input }) => resumeService.versions.rename({ ...input, userId: context.user.id })),

	deleteVersion: protectedProcedure
		.route({
			method: "DELETE",
			path: "/resumes/{resumeId}/versions/{versionId}",
			tags: ["Resumes"],
			operationId: "deleteResumeVersion",
			summary: "Delete a named resume version",
			description:
				"Deletes a named version. Other versions expire on their own and can't be deleted. Requires authentication.",
			successDescription: "The version was deleted.",
		})
		.input(resumeDto.deleteVersion.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.deleteVersion.output)
		.handler(({ context, input }) => resumeService.versions.delete({ ...input, userId: context.user.id })),

	restoreVersion: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{resumeId}/versions/{versionId}/restore",
			tags: ["Resumes"],
			operationId: "restoreResumeVersion",
			summary: "Restore a resume version",
			description:
				"Non-destructively restores a resume to a previous version snapshot by writing that snapshot's data back through the normal update path. Prior versions are preserved and the restore itself becomes a new snapshot. Only the resume owner can restore versions. Requires authentication.",
			successDescription: "The restored resume with its full data.",
		})
		.input(resumeDto.restoreVersion.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.restoreVersion.output)
		.handler(({ context, input }) =>
			resumeService.versions.restore({
				resumeId: input.resumeId,
				versionId: input.versionId,
				userId: context.user.id,
			}),
		),
};
