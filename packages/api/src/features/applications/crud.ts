import { protectedProcedure } from "../../context";
import { applicationDto } from "../../dto/application";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { applicationService } from "./service";

export const crudRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/applications",
			tags: ["Applications"],
			operationId: "listApplications",
			summary: "List job applications",
			description:
				"Returns all job applications belonging to the authenticated user, most recently updated first. Archived applications are excluded unless includeArchived is set. Optionally filter by pipeline stage. Requires authentication.",
			successDescription: "A list of the user's job applications.",
		})
		.input(applicationDto.list.input)
		.output(applicationDto.list.output)
		.handler(({ input, context }) =>
			applicationService.list({
				userId: context.user.id,
				...(input.status ? { status: input.status } : {}),
				...(input.tags ? { tags: input.tags } : {}),
				includeArchived: input.includeArchived,
			}),
		),

	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/applications/{id}",
			tags: ["Applications"],
			operationId: "getApplication",
			summary: "Get application by ID",
			description:
				"Returns a single job application with its full detail (contacts, activity timeline, linked resume). Only applications belonging to the authenticated user can be retrieved. Requires authentication.",
			successDescription: "The job application.",
		})
		.input(applicationDto.getById.input)
		.output(applicationDto.getById.output)
		.handler(({ input, context }) => applicationService.getById({ id: input.id, userId: context.user.id })),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/applications",
			tags: ["Applications"],
			operationId: "createApplication",
			summary: "Create a job application",
			description:
				"Creates a new job application in the pipeline. Company and role are required; all other fields (stage, location, salary, source, linked resume, follow-up, notes, contacts) are optional. Requires authentication.",
			successDescription: "The ID of the newly created application.",
		})
		.input(applicationDto.create.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.create.output)
		.handler(({ input, context }) => applicationService.create({ userId: context.user.id, ...input })),

	import: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/import",
			tags: ["Applications"],
			operationId: "importApplications",
			summary: "Bulk import applications",
			description:
				"Creates many applications at once from a parsed CSV. Each item requires company and role. Returns the number imported. Requires authentication.",
			successDescription: "The number of applications imported.",
		})
		.input(applicationDto.import.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.import.output)
		.handler(({ input, context }) => applicationService.importMany({ userId: context.user.id, items: input.items })),

	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/applications/{id}",
			tags: ["Applications"],
			operationId: "updateApplication",
			summary: "Update a job application",
			description:
				"Updates one or more fields of an application, including moving it to a different pipeline stage or archiving it. Moving stages automatically appends an entry to the activity timeline. Only provided fields are changed. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.update.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.update.output)
		.handler(({ input, context }) => applicationService.update({ userId: context.user.id, ...input })),

	attachDocument: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/documents/{kind}",
			tags: ["Applications"],
			operationId: "attachApplicationDocument",
			summary: "Attach an application document",
			description:
				"Uploads and attaches a PDF document to an application. Kind must be either resume or cover-letter. Requires authentication.",
			successDescription: "The updated application.",
			spec: (current) => {
				const requestBody = current.requestBody;
				if (!requestBody || "$ref" in requestBody) return current;

				const multipart = requestBody.content?.["multipart/form-data"];
				if (!multipart) return current;

				return {
					...current,
					requestBody: {
						...requestBody,
						content: { "multipart/form-data": multipart },
					},
				};
			},
		})
		.input(applicationDto.attachDocument.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.attachDocument.output)
		.handler(async ({ input, context }) => {
			const buffer = await input.file.arrayBuffer();

			return applicationService.attachDocument({
				id: input.id,
				userId: context.user.id,
				kind: input.kind,
				fileName: input.file.name,
				contentType: input.file.type,
				data: new Uint8Array(buffer),
			});
		}),

	removeDocument: protectedProcedure
		.route({
			method: "DELETE",
			path: "/applications/{id}/documents/{kind}",
			tags: ["Applications"],
			operationId: "removeApplicationDocument",
			summary: "Remove an application document",
			description:
				"Removes a resume or cover-letter PDF from an application and clears the stored document fields. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.removeDocument.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.removeDocument.output)
		.handler(({ input, context }) =>
			applicationService.removeDocument({ id: input.id, userId: context.user.id, kind: input.kind }),
		),

	addNote: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/notes",
			tags: ["Applications"],
			operationId: "addApplicationNote",
			summary: "Log a note on the timeline",
			description: "Appends a free-text note to the application's activity timeline. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.addNote.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.addNote.output)
		.handler(({ input, context }) =>
			applicationService.addNote({
				id: input.id,
				userId: context.user.id,
				text: input.text,
				date: input.date,
			}),
		),

	addInterview: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/interviews",
			tags: ["Applications"],
			operationId: "addApplicationInterview",
			summary: "Schedule an interview",
			description:
				"Adds an interview (screening, technical, behavioral, onsite or other) with a scheduled date-time to the application's activity timeline. Applications can have any number of interviews. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.addInterview.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.addInterview.output)
		.handler(({ input, context }) => applicationService.addInterview({ ...input, userId: context.user.id })),

	updateInterview: protectedProcedure
		.route({
			method: "PUT",
			path: "/applications/{id}/interviews/{entryId}",
			tags: ["Applications"],
			operationId: "updateApplicationInterview",
			summary: "Update a scheduled interview",
			description:
				"Updates an interview timeline entry (date-time, kind, duration, location, notes). Only provided fields are changed. Delete interviews with the timeline entry delete endpoint. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.updateInterview.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.updateInterview.output)
		.handler(({ input, context }) => applicationService.updateInterview({ ...input, userId: context.user.id })),

	updateTimelineEntry: protectedProcedure
		.route({
			method: "PUT",
			path: "/applications/{id}/timeline/{entryId}",
			tags: ["Applications"],
			operationId: "updateApplicationTimelineEntry",
			summary: "Update a timeline entry",
			description: "Updates a timeline entry date, or note text for note entries. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.updateTimelineEntry.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.updateTimelineEntry.output)
		.handler(({ input, context }) => applicationService.updateTimelineEntry({ ...input, userId: context.user.id })),

	deleteTimelineEntry: protectedProcedure
		.route({
			method: "DELETE",
			path: "/applications/{id}/timeline/{entryId}",
			tags: ["Applications"],
			operationId: "deleteApplicationTimelineEntry",
			summary: "Delete a timeline entry",
			description:
				"Deletes a note or older stage entry. The current stage entry cannot be deleted. Requires authentication.",
			successDescription: "The updated application.",
		})
		.input(applicationDto.deleteTimelineEntry.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.deleteTimelineEntry.output)
		.handler(({ input, context }) => applicationService.deleteTimelineEntry({ ...input, userId: context.user.id })),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/applications/{id}",
			tags: ["Applications"],
			operationId: "deleteApplication",
			summary: "Delete a job application",
			description: "Permanently deletes a job application. Requires authentication.",
			successDescription: "The application was deleted successfully.",
		})
		.input(applicationDto.delete.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.delete.output)
		.handler(({ input, context }) => applicationService.delete({ id: input.id, userId: context.user.id })),

	bulkUpdate: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/bulk-update",
			tags: ["Applications"],
			operationId: "bulkUpdateApplications",
			summary: "Bulk update applications",
			description:
				"Applies the same change (move stage, archive/unarchive, add tags) to multiple applications at once. Requires authentication.",
			successDescription: "The number of applications updated.",
		})
		.input(applicationDto.bulkUpdate.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.bulkUpdate.output)
		.handler(({ input, context }) => applicationService.bulkUpdate({ userId: context.user.id, ...input })),

	bulkDelete: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/bulk-delete",
			tags: ["Applications"],
			operationId: "bulkDeleteApplications",
			summary: "Bulk delete applications",
			description: "Permanently deletes multiple applications at once. Requires authentication.",
			successDescription: "The number of applications deleted.",
		})
		.input(applicationDto.bulkDelete.input)
		.use(resumeMutationRateLimit)
		.output(applicationDto.bulkDelete.output)
		.handler(({ input, context }) => applicationService.bulkDelete({ userId: context.user.id, ids: input.ids })),

	stats: protectedProcedure
		.route({
			method: "GET",
			path: "/applications/stats",
			tags: ["Applications"],
			operationId: "getApplicationStats",
			summary: "Application pipeline stats",
			description: "Returns aggregate counts (per stage, per source) for the Insights view. Requires authentication.",
			successDescription: "Aggregate application counts.",
		})
		.input(applicationDto.stats.input)
		.output(applicationDto.stats.output)
		.handler(({ context }) => applicationService.stats({ userId: context.user.id })),

	tags: protectedProcedure
		.route({
			method: "GET",
			path: "/applications/tags",
			tags: ["Applications"],
			operationId: "listApplicationTags",
			summary: "List application tags",
			description: "Returns the distinct tags used across the user's applications. Requires authentication.",
			successDescription: "Distinct tags.",
		})
		.output(applicationDto.tags.output)
		.handler(({ context }) => applicationService.listTags({ userId: context.user.id })),
};
