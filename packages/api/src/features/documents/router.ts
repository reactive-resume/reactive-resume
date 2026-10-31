import z from "zod";
import { protectedProcedure } from "../../context";
import { documentsDto } from "../../dto/documents";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { documentsService } from "./service";

const route = (
	method: "GET" | "POST" | "DELETE",
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
	purgeExpired: protectedProcedure
		.route(
			route(
				"DELETE",
				"/documents/trash/expired",
				"purgeExpiredDocuments",
				"Delete expired Trash",
				"Permanently deletes documents in this account that have been in Trash more than 30 days.",
			),
		)
		.input(z.object({}).optional())
		.output(z.void())
		.use(resumeMutationRateLimit)
		.handler(({ context }) => documentsService.purgeExpired(context.user.id)),

	list: protectedProcedure
		.route(
			route(
				"GET",
				"/documents",
				"listDocuments",
				"List documents",
				"Returns the user's resumes and saved cover letters (or those in Trash), with server-side type/search/tags/public filtering and edited/name/created ordering. Limit/offset opt into SQL pagination; omit both for the complete legacy array. X-Total-Count reports all filtered matches.",
			),
		)
		.input(documentsDto.list.input)
		.output(documentsDto.list.output)
		.handler(async ({ context, input }) => {
			const { items, total } = await documentsService.list({ ...input, userId: context.user.id });
			context.resHeaders?.set("X-Total-Count", String(total));
			if (input.limit !== undefined || input.offset !== undefined) {
				context.resHeaders?.set("X-Limit", String(input.limit ?? 20));
				context.resHeaders?.set("X-Offset", String(input.offset ?? 0));
			}
			return items;
		}),

	page: protectedProcedure
		.route(
			route(
				"GET",
				"/documents/page",
				"listDocumentPage",
				"List a document page",
				"Returns at most 100 documents with filtered totals and tag filters. Counts ignore the type tab. Tags show the first 100 alphabetically; search discovers further tags. Name order uses database case-insensitive ordering; dates use newest first. Type and ID break ties. Offset pages reflect current data; restart after edits.",
			),
		)
		.input(documentsDto.page.input)
		.output(documentsDto.page.output)
		.handler(({ context, input }) => documentsService.page({ ...input, userId: context.user.id })),

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
		.input(z.object({}).optional())
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

	restoreMany: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/restore/batch",
				"restoreDocuments",
				"Restore selected documents",
				"Brings the selected loaded documents back from Trash. Only this account's documents still in Trash are restored; active, already deleted, or another account's documents are skipped.",
			),
		)
		.input(documentsDto.restoreMany.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.restoreMany.output)
		.handler(({ context, input }) => documentsService.restoreMany({ ...input, userId: context.user.id })),

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

	purgeMany: protectedProcedure
		.route(
			route(
				"POST",
				"/documents/purge/batch",
				"purgeDocuments",
				"Delete selected documents now",
				"Permanently deletes the selected loaded documents that are still in Trash. Active, already deleted, or another account's documents are skipped.",
			),
		)
		.input(documentsDto.purgeMany.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.purgeMany.output)
		.handler(({ context, input }) => documentsService.purgeMany({ ...input, userId: context.user.id })),

	emptyTrash: protectedProcedure
		.route(
			route(
				"DELETE",
				"/documents/trash",
				"emptyDocumentTrash",
				"Empty Trash",
				"Permanently deletes every document in this account's Trash, not only the documents the client has loaded. Active documents are untouched.",
			),
		)
		.input(documentsDto.emptyTrash.input)
		.use(resumeMutationRateLimit)
		.output(documentsDto.emptyTrash.output)
		.handler(({ context }) => documentsService.emptyTrash({ userId: context.user.id })),

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
