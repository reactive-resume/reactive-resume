import { protectedProcedure } from "../../context";
import { documentsDto } from "../../dto/documents";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { documentsService } from "./service";

const route = (
	method: "GET" | "POST",
	path: `/${string}`,
	operationId: string,
	summary: string,
	description: string,
) => ({
	method,
	path,
	tags: ["Documents"],
	operationId,
	summary,
	description: `${description} Requires authentication.`,
});

/** Resumes and saved cover letters as one library: list, rename, tag, lock, link, Trash and Copy for a job. */
export const documentsRouter = {
	list: protectedProcedure
		.route(
			route(
				"GET",
				"/documents",
				"listDocuments",
				"List documents",
				"Returns the user's resumes and saved cover letters (or those in Trash), newest edit first, with the job application each was made for. Documents in Trash for more than 30 days are deleted first.",
			),
		)
		.input(documentsDto.list.input)
		.output(documentsDto.list.output)
		.handler(({ context, input }) => documentsService.list({ userId: context.user.id, trashed: input.trashed })),

	counts: protectedProcedure
		.route(
			route(
				"GET",
				"/documents/counts",
				"countDocuments",
				"Count documents",
				"Counts live resumes and letters, and everything in Trash.",
			),
		)
		.output(documentsDto.counts.output)
		.handler(({ context }) => documentsService.counts({ userId: context.user.id })),

	rename: protectedProcedure
		.route(route("POST", "/documents/rename", "renameDocument", "Rename a document", "Renames a resume or letter."))
		.input(documentsDto.rename.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.rename.output)
		.handler(({ context, input }) => documentsService.rename({ ...input, userId: context.user.id })),

	setTags: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/tags",
				"setDocumentTags",
				"Set a document's tags",
				"Replaces a resume's or letter's tags.",
			),
		)
		.input(documentsDto.setTags.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.setTags.output)
		.handler(({ context, input }) => documentsService.setTags({ ...input, userId: context.user.id })),

	setLocked: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/lock",
				"lockDocument",
				"Lock or unlock a document",
				"Locks a resume or letter against edits and Trash, or unlocks it.",
			),
		)
		.input(documentsDto.setLocked.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.setLocked.output)
		.handler(({ context, input }) => documentsService.setLocked({ ...input, userId: context.user.id })),

	linkApplication: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/application",
				"linkDocumentApplication",
				"Link a document to an application",
				"Records the job application a resume or letter was made for, or clears it.",
			),
		)
		.input(documentsDto.linkApplication.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.linkApplication.output)
		.handler(({ context, input }) => documentsService.linkApplication({ ...input, userId: context.user.id })),

	trash: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/trash",
				"trashDocument",
				"Move a document to Trash",
				"Moves a resume or letter to Trash, where it stays for 30 days. A resume in Trash isn't shared. Locked documents can't be moved.",
			),
		)
		.input(documentsDto.trash.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.trash.output)
		.handler(({ context, input }) => documentsService.trash({ ...input, userId: context.user.id })),

	restore: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/restore",
				"restoreDocument",
				"Restore a document",
				"Brings a document back from Trash.",
			),
		)
		.input(documentsDto.restore.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.restore.output)
		.handler(({ context, input }) => documentsService.restore({ ...input, userId: context.user.id })),

	purge: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/purge",
				"purgeDocument",
				"Delete a document now",
				"Permanently deletes a document that is already in Trash.",
			),
		)
		.input(documentsDto.purge.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.purge.output)
		.handler(({ context, input }) => documentsService.purge({ ...input, userId: context.user.id })),

	copyForJob: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/copy-for-job",
				"copyResumeForJob",
				"Copy a resume for a job",
				"Duplicates a resume and links the copy to a job application. Saved jobs select the copy; submitted document history is preserved.",
			),
		)
		.input(documentsDto.copyForJob.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.copyForJob.output)
		.handler(({ context, input }) => documentsService.copyForJob({ ...input, userId: context.user.id })),
};
