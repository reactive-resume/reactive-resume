import { generateId, generateRandomName } from "@reactive-resume/utils/string";
import { protectedProcedure } from "../../context";
import { resumeDto } from "../../dto/resume";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { paginate } from "../../pagination";
import { documentsService } from "../documents/service";
import { createResumeData } from "./initial-data";
import { parseStoredResumeData } from "./resume-data-validation";
import { resumeService } from "./service";

export const crudRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes",
			tags: ["Resumes"],
			operationId: "listResumes",
			summary: "List all resumes",
			description:
				"Returns a list of all resumes belonging to the authenticated user. Results can be filtered by tags and sorted by last updated date, creation date, or name. Resume data is not included in the response for performance; use the get endpoint to fetch full resume data. Requires authentication.",
			successDescription: "A list of resumes with their metadata (without full resume data).",
		})
		.input(resumeDto.list.input.optional().default({ tags: [], sort: "lastUpdatedAt" }))
		.output(resumeDto.list.output)
		.handler(async ({ input, context }) =>
			paginate(
				await resumeService.list({
					userId: context.user.id,
					tags: input.tags,
					sort: input.sort,
				}),
				input,
				context.resHeaders,
			),
		),

	getById: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "getResume",
			summary: "Get resume by ID",
			description:
				"Returns a single resume with its full data, identified by its unique ID. Only resumes belonging to the authenticated user can be retrieved. Requires authentication.",
			successDescription: "The resume with its full data.",
		})
		.input(resumeDto.getById.input)
		.output(resumeDto.getById.output)
		.handler(({ context, input }) => resumeService.getById({ id: input.id, userId: context.user.id })),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes",
			tags: ["Resumes"],
			operationId: "createResume",
			summary: "Create a new resume",
			description:
				"Creates a new resume with the given name and tags. The slug (its public address) is optional: when omitted it is generated from the name and made unique across the user's resumes; when given it must be unique too. Optionally initializes the resume with sample data by setting withSampleData to true. Returns the ID of the newly created resume. Requires authentication.",
			successDescription: "The ID of the newly created resume.",
		})
		.input(resumeDto.create.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.create.output)
		.errors({
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(({ context, input }) =>
			resumeService.create({
				name: input.name,
				...(input.slug ? { slug: input.slug } : {}),
				...(input.autoName ? { autoName: true } : {}),
				tags: input.tags,
				locale: context.locale,
				userId: context.user.id,
				data: createResumeData({
					withSampleData: input.withSampleData,
					name: context.user.name,
					locale: context.locale,
				}),
			}),
		),

	import: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/import",
			tags: ["Resumes"],
			operationId: "importResume",
			summary: "Import a resume",
			description:
				"Creates a new resume from an existing ResumeData object (e.g. from a previously exported JSON file). A random name and slug are generated automatically. Returns the ID of the imported resume. Requires authentication.",
			successDescription: "The ID of the imported resume.",
		})
		.input(resumeDto.import.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.import.output)
		.errors({
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(async ({ context, input }) => {
			const id = generateId();

			// Named from the file's content (the person, else the headline) so nothing needs filling in first.
			const name = input.data.basics.name.trim() || input.data.basics.headline.trim() || generateRandomName();
			await resumeService.create({
				id,
				name: name.slice(0, 100),
				tags: [],
				data: input.data,
				locale: context.locale,
				userId: context.user.id,
				origin: "import",
			});

			return id;
		}),

	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "updateResume",
			summary: "Update a resume",
			description:
				"Updates one or more fields of a resume identified by its ID. All fields are optional; only provided fields will be updated. Locked resumes cannot be updated. Requires authentication.",
			successDescription: "The updated resume with its full data.",
		})
		.input(resumeDto.update.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.update.output)
		.errors({
			RESUME_LOCKED: { status: 403, message: "Unlock the resume first." },
			RESUME_SLUG_ALREADY_EXISTS: {
				message: "A resume with this slug already exists.",
				status: 400,
			},
		})
		.handler(({ context, input }) =>
			resumeService.update({
				id: input.id,
				userId: context.user.id,
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
				...(input.slug !== undefined ? { slug: input.slug } : {}),
				...(input.tags !== undefined ? { tags: input.tags } : {}),
				...(input.data !== undefined ? { data: input.data } : {}),
				...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
				...(input.showDownloadButtons !== undefined ? { showDownloadButtons: input.showDownloadButtons } : {}),
			}),
		),

	patch: protectedProcedure
		.route({
			method: "PATCH",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "patchResume",
			summary: "Patch resume data",
			description:
				"Applies JSON Patch (RFC 6902) operations to partially update a resume's data. This allows small, targeted changes (e.g. updating a single field) without sending the entire resume object. Locked resumes cannot be patched. Requires authentication.",
			successDescription: "The patched resume with its full data.",
		})
		.input(resumeDto.patch.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.patch.output)
		.errors({
			RESUME_LOCKED: { status: 403, message: "Unlock the resume first." },
			INVALID_PATCH_OPERATIONS: {
				message: "The patch operations are invalid or produced an invalid resume.",
				status: 400,
			},
			RESUME_VERSION_CONFLICT: {
				message: "The resume changed after this patch was generated.",
				status: 409,
			},
		})
		.handler(({ context, input }) =>
			resumeService.patch({
				id: input.id,
				userId: context.user.id,
				operations: input.operations,
				...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
			}),
		),

	setLocked: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/lock",
			tags: ["Resumes"],
			operationId: "setResumeLocked",
			summary: "Set resume lock status",
			description:
				"Toggles the locked status of a resume. When locked, a resume cannot be updated, patched, or deleted. Useful for protecting finalized resumes from accidental edits. Requires authentication.",
			successDescription: "The resume lock status was updated successfully.",
		})
		.input(resumeDto.setLocked.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.setLocked.output)
		.handler(({ context, input }) =>
			resumeService.setLocked({
				id: input.id,
				userId: context.user.id,
				isLocked: input.isLocked,
			}),
		),

	duplicate: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/duplicate",
			tags: ["Resumes"],
			operationId: "duplicateResume",
			summary: "Duplicate a resume",
			description:
				"Creates a copy of an existing resume with the same data, and the given name and tags. The slug is optional: when omitted it is generated from the name and made unique across the user's resumes. Returns the ID of the duplicated resume. Requires authentication.",
			successDescription: "The ID of the duplicated resume.",
		})
		.input(resumeDto.duplicate.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.duplicate.output)
		.handler(async ({ context, input }) => {
			const original = await resumeService.getById({ id: input.id, userId: context.user.id });
			const data = parseStoredResumeData(original.data);

			return resumeService.create({
				userId: context.user.id,
				name: input.name ?? original.name,
				...(input.slug ? { slug: input.slug } : {}),
				tags: input.tags ?? original.tags,
				locale: context.locale,
				data,
			});
		}),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/resumes/{id}",
			tags: ["Resumes"],
			operationId: "deleteResume",
			summary: "Move a resume to Trash",
			description:
				"Moves a resume to Trash, which stops its public link. It stays there for 30 days, then it and its files are deleted; until then it can be restored (documents.restore) or deleted at once (documents.purge). Locked resumes can't be moved; unlock the resume first. Requires authentication.",
			successDescription: "The resume is in Trash.",
		})
		.input(resumeDto.delete.input)
		.use(resumeMutationRateLimit)
		.output(resumeDto.delete.output)
		.errors({ RESUME_LOCKED: { status: 403, message: "Unlock the resume first." } })
		.handler(({ context, input }) => documentsService.trash({ type: "resume", id: input.id, userId: context.user.id })),
};
