import { ORPCError } from "@orpc/server";
import { getStorageService } from "@reactive-resume/api/features/storage";
import { fileInputSchema } from "./contracts";

export async function readMcpFile(value: unknown, userId: string, maxBytes = 10 * 1024 * 1024): Promise<File> {
	const input = fileInputSchema.parse(value);
	let bytes: Uint8Array;
	if ("storagePath" in input) {
		const path = input.storagePath;
		if (
			!path.startsWith(`uploads/${userId}/`) ||
			path.includes("\\") ||
			Array.from(path).some((character) => character.charCodeAt(0) < 32) ||
			path.split("/").some((part) => !part || part === "." || part === "..")
		) {
			throw new ORPCError("FORBIDDEN", { message: "Supply a file uploaded by this account." });
		}
		const stored = await getStorageService().read(path);
		if (!stored) throw new ORPCError("NOT_FOUND", { message: "Stored file not found." });
		bytes = stored.data;
	} else {
		bytes = new Uint8Array(Buffer.from(input.dataBase64, "base64"));
	}
	if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
		throw new ORPCError("BAD_REQUEST", { message: `Files must contain 1 byte to ${maxBytes} bytes.` });
	}
	return new File([Uint8Array.from(bytes)], input.name, { type: input.contentType });
}
