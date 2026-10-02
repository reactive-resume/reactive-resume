import { ORPCError } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { storageDeleteRateLimit, storageUploadRateLimit } from "../../middleware/rate-limit";
import { getStorageService, isImageFile, processImageForUpload, uploadFile } from "./service";

const fileSchema = z.file().max(10 * 1024 * 1024, "File size must be less than 10MB");

const filenameSchema = z.object({
	filename: z.string().min(1).describe("The path or filename of the file to delete."),
});

function normalizeKey(input: string): string {
	return input.trim().replace(/^\/+/, "").split("/").filter(Boolean).join("/");
}

function isUnsafeStorageKey(key: string): boolean {
	return key.split("/").some((segment) => segment === "." || segment === "..");
}

export const uploadFileOutputSchema = z.object({
	url: z.string().describe("The download URL. Profile images are public; other files require owner authentication."),
	path: z.string().describe("The storage path of the uploaded file."),
	contentType: z.string().describe("The MIME type of the uploaded file."),
});

export const storageRouter = {
	uploadFile: protectedProcedure
		.route({
			tags: ["Internal"],
			operationId: "uploadFile",
			summary: "Upload a file",
			description:
				"Uploads a file to storage. Images are automatically resized and converted to JPEG format. Maximum file size is 10MB. Requires authentication.",
			successDescription: "The file was uploaded successfully.",
		})
		.input(fileSchema)
		.use(storageUploadRateLimit)
		.output(uploadFileOutputSchema)
		.handler(async ({ context, input: file }) => {
			const originalMimeType = file.type;
			const isImage = isImageFile(originalMimeType);

			let data: Uint8Array;
			let contentType: string;

			if (isImage) {
				const processed = await processImageForUpload(file);
				data = processed.data;
				contentType = processed.contentType;
			} else {
				const fileBuffer = await file.arrayBuffer();
				data = new Uint8Array(fileBuffer);
				contentType = originalMimeType;
			}

			const result = await uploadFile({ userId: context.user.id, data, contentType });

			return {
				url: result.url,
				path: result.key,
				contentType,
			};
		}),

	deleteFile: protectedProcedure
		.route({
			tags: ["Internal"],
			operationId: "deleteFile",
			summary: "Delete a file",
			description:
				"Deletes a file from storage by its filename or path. If the filename does not start with 'uploads/', the user's picture directory is assumed. Requires authentication.",
			successDescription: "The file was deleted successfully.",
		})
		.input(filenameSchema)
		.use(storageDeleteRateLimit)
		.output(z.void())
		.errors({
			NOT_FOUND: {
				message: "The specified file was not found in storage.",
				status: 404,
			},
			FORBIDDEN: {
				message: "You do not have permission to delete this file.",
				status: 403,
			},
		})
		.handler(async ({ context, input }): Promise<void> => {
			const requestedKey = normalizeKey(input.filename);
			const key = requestedKey.startsWith("uploads/")
				? requestedKey
				: normalizeKey(`uploads/${context.user.id}/pictures/${requestedKey}`);
			const userPrefix = `uploads/${context.user.id}/`;

			if (isUnsafeStorageKey(key) || !key.startsWith(userPrefix)) {
				throw new ORPCError("FORBIDDEN");
			}

			const deleted = await getStorageService().delete(key);

			if (!deleted) throw new ORPCError("NOT_FOUND");
		}),
};
