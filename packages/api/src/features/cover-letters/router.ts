import { eventIterator } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { coverLetterDto } from "../../dto/cover-letter";
import { aiRequestRateLimit, resumeMutationRateLimit } from "../../middleware/rate-limit";
import { paginate } from "../../pagination";
import { draftLetterBody } from "./draft";
import { coverLetterService } from "./service";
import { deleteLetterVersion, getLetterVersion, listLetterVersions, renameLetterVersion } from "./versions";

export const coverLettersRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters",
			tags: ["Cover Letters"],
			operationId: "listCoverLetters",
			summary: "List cover letters",
			description:
				"Returns the authenticated user's saved cover letters, optionally filtered by search, resume, or application.",
			successDescription: "A paginated list of cover letters.",
		})
		.input(coverLetterDto.list.input)
		.output(coverLetterDto.list.output)
		.handler(({ context, input }) => coverLetterService.list({ ...input, userId: context.user.id })),
	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters/{id}",
			tags: ["Cover Letters"],
			operationId: "getCoverLetter",
			summary: "Get cover letter by ID",
			description: "Returns a single saved cover letter belonging to the authenticated user.",
			successDescription: "The cover letter.",
		})
		.input(coverLetterDto.getById.input)
		.output(coverLetterDto.getById.output)
		.handler(({ context, input }) => coverLetterService.getById({ ...input, userId: context.user.id })),
	create: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters",
			tags: ["Cover Letters"],
			operationId: "createCoverLetter",
			summary: "Create a cover letter",
			description: "Creates a saved cover letter, optionally linked to a resume or job application.",
			successDescription: "The newly created cover letter.",
		})
		.input(coverLetterDto.create.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.create.output)
		.handler(({ context, input }) => coverLetterService.create({ ...input, userId: context.user.id })),
	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/cover-letters/{id}",
			tags: ["Cover Letters"],
			operationId: "updateCoverLetter",
			summary: "Update a cover letter",
			description: "Updates the supplied fields of a saved cover letter using its expected revision.",
			successDescription: "The updated cover letter.",
		})
		.input(coverLetterDto.update.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.update.output)
		.handler(({ context, input }) => coverLetterService.update({ ...input, userId: context.user.id })),
	refreshStyle: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/{id}/refresh-style",
			tags: ["Cover Letters"],
			operationId: "refreshCoverLetterStyle",
			summary: "Refresh cover letter style",
			description: "Refreshes a cover letter's style from a selected resume while preserving its content and template.",
			successDescription: "The cover letter with refreshed style.",
		})
		.input(coverLetterDto.refreshStyle.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.refreshStyle.output)
		.handler(({ context, input }) => coverLetterService.refreshStyle({ ...input, userId: context.user.id })),
	duplicate: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/{id}/duplicate",
			tags: ["Cover Letters"],
			operationId: "duplicateCoverLetter",
			summary: "Duplicate a cover letter",
			description: "Creates a copy of an existing saved cover letter, optionally with a new name.",
			successDescription: "The duplicated cover letter.",
		})
		.input(coverLetterDto.duplicate.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.duplicate.output)
		.handler(({ context, input }) => coverLetterService.duplicate({ ...input, userId: context.user.id })),
	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/cover-letters/{id}",
			tags: ["Cover Letters"],
			operationId: "deleteCoverLetter",
			summary: "Move a cover letter to Trash",
			description:
				"Moves a saved cover letter to Trash using its expected revision. It stays there for 30 days, then it is deleted; until then it can be restored (documents.restore) or deleted at once (documents.purge). Locked letters can't be moved.",
			successDescription: "The cover letter is in Trash.",
		})
		.input(coverLetterDto.delete.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.delete.output)
		.handler(({ context, input }) => coverLetterService.delete({ ...input, userId: context.user.id })),
	export: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters/{id}/export",
			tags: ["Cover Letters"],
			operationId: "exportCoverLetter",
			summary: "Export a cover letter",
			description: "Exports a saved cover letter as a standalone Reactive Resume cover-letter document.",
			successDescription: "The exported cover letter document.",
		})
		.input(coverLetterDto.export.input)
		.output(coverLetterDto.export.output)
		.handler(({ context, input }) => coverLetterService.export({ ...input, userId: context.user.id })),
	import: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/import",
			tags: ["Cover Letters"],
			operationId: "importCoverLetter",
			summary: "Import a cover letter",
			description: "Creates a saved cover letter from an exported Reactive Resume cover-letter document.",
			successDescription: "The imported cover letter.",
		})
		.input(coverLetterDto.import.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.import.output)
		.handler(({ context, input }) => coverLetterService.import({ ...input, userId: context.user.id })),
	listVersions: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters/{id}/versions",
			tags: ["Cover Letters"],
			operationId: "listCoverLetterVersions",
			summary: "List a cover letter's versions",
			description:
				"Returns the letter's History, newest first (at most 100): sessions, named, sent and restore points.",
			successDescription: "The versions.",
		})
		.input(coverLetterDto.listVersions.input)
		.output(coverLetterDto.listVersions.output)
		.handler(async ({ context, input }) =>
			paginate(
				await listLetterVersions({ coverLetterId: input.id, userId: context.user.id }),
				input,
				context.resHeaders,
			),
		),
	getVersion: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters/{id}/versions/{versionId}",
			tags: ["Cover Letters"],
			operationId: "getCoverLetterVersion",
			summary: "Get a cover letter version",
			description: "Returns one version of the letter, with the letter as it read then.",
			successDescription: "The version.",
		})
		.input(coverLetterDto.getVersion.input)
		.output(coverLetterDto.getVersion.output)
		.handler(({ context, input }) =>
			getLetterVersion({ coverLetterId: input.id, userId: context.user.id, versionId: input.versionId }),
		),
	createVersion: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/{id}/versions",
			tags: ["Cover Letters"],
			operationId: "createCoverLetterVersion",
			summary: "Name a version of a cover letter",
			description: "Saves the letter as it is now as a named version.",
			successDescription: "The new version.",
		})
		.input(coverLetterDto.createVersion.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.createVersion.output)
		.handler(({ context, input }) => coverLetterService.createVersion({ ...input, userId: context.user.id })),
	renameVersion: protectedProcedure
		.route({
			method: "PATCH",
			path: "/cover-letters/{id}/versions/{versionId}",
			tags: ["Cover Letters"],
			operationId: "renameCoverLetterVersion",
			summary: "Rename a named version",
			description: "Renames one of the letter's named versions.",
			successDescription: "The renamed version.",
		})
		.input(coverLetterDto.renameVersion.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.renameVersion.output)
		.handler(({ context, input }) =>
			renameLetterVersion({
				coverLetterId: input.id,
				userId: context.user.id,
				versionId: input.versionId,
				name: input.name,
			}),
		),
	deleteVersion: protectedProcedure
		.route({
			method: "DELETE",
			path: "/cover-letters/{id}/versions/{versionId}",
			tags: ["Cover Letters"],
			operationId: "deleteCoverLetterVersion",
			summary: "Delete a named version",
			description: "Deletes one of the letter's named versions. Other versions can't be deleted.",
			successDescription: "The version was deleted.",
		})
		.input(coverLetterDto.deleteVersion.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.deleteVersion.output)
		.handler(({ context, input }) =>
			deleteLetterVersion({ coverLetterId: input.id, userId: context.user.id, versionId: input.versionId }),
		),
	restoreVersion: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/{id}/versions/{versionId}/restore",
			tags: ["Cover Letters"],
			operationId: "restoreCoverLetterVersion",
			summary: "Restore a cover letter version",
			description:
				'Saves the current letter as "Before restore", then makes the letter read as the version did. Linked details and design keep coming from the resume.',
			successDescription: "The restored letter.",
		})
		.input(coverLetterDto.restoreVersion.input)
		.use(resumeMutationRateLimit)
		.output(coverLetterDto.restoreVersion.output)
		.handler(({ context, input }) => coverLetterService.restoreVersion({ ...input, userId: context.user.id })),
	draft: protectedProcedure
		.route({
			method: "POST",
			path: "/cover-letters/{id}/draft",
			tags: ["Cover Letters", "AI"],
			operationId: "draftCoverLetter",
			summary: "Draft a cover letter's body",
			description:
				"Streams a draft of the letter's body, as text, from its linked resume and its application's posting, using only facts from them. Nothing is saved. `shorter` and `personal` revise a previous draft.",
			successDescription: "The draft, streamed as text.",
		})
		.input(coverLetterDto.draft.input)
		.output(eventIterator(z.string()))
		.use(aiRequestRateLimit)
		.handler(({ context, input, signal }) => draftLetterBody({ ...input, userId: context.user.id, signal })),
};
