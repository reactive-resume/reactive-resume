import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";
import { getStorageService, inferContentType } from "@reactive-resume/api/features/storage";

// Uploads share the app origin and S3/Blob hand back the client-declared type, so only raster
// images render inline. Anything else (HTML, SVG, PDF, unknown) downloads, whatever was stored.
const INLINE_CONTENT_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export async function handleUpload(request: Request) {
	const { userId, filePath } = parseRouteParams(request.url);

	if (!userId || !filePath) return new Response("Bad Request", { status: 400 });

	if (!isValidPath(userId) || !isValidPathSegments(filePath)) return new Response("Forbidden", { status: 403 });
	if (isPrivateUploadPath(filePath)) return new Response("Not Found", { status: 404 });

	const storageService = getStorageService();
	const key = `uploads/${userId}/${filePath}`;
	const storedFile = await storageService.read(key);
	if (!storedFile) return new Response("Not Found", { status: 404 });

	const filename = filePath.split("/").pop() ?? filePath;
	const contentType = storedFile.contentType ?? inferContentType(filename);
	const isPublicPicture = filePath.startsWith("pictures/") && INLINE_CONTENT_TYPES.has(contentType);
	if (!isPublicPicture) {
		const { resolveAuthenticationFromRequestHeaders } = await import("@reactive-resume/api/context");
		const authentication = await resolveAuthenticationFromRequestHeaders(request.headers).catch(() => null);
		if (authentication?.user.id !== userId || !authentication.permissions.includes("read"))
			return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
	}
	const etag = createEtag(storedFile);

	if (isPublicPicture && isNotModified(request.headers, etag)) return makeNotModifiedResponse(etag);

	const shouldForceDownload = !INLINE_CONTENT_TYPES.has(contentType);

	const headers = new Headers();
	headers.set("Content-Type", shouldForceDownload ? "application/octet-stream" : contentType);
	headers.set("Content-Length", storedFile.size.toString());

	if (shouldForceDownload) {
		headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(basename(filename))}"`);
	}

	headers.set("Cache-Control", isPublicPicture ? "public, max-age=31536000, immutable" : "private, no-store");
	headers.set("ETag", etag);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Robots-Tag", "noindex, nofollow");
	headers.set("Cross-Origin-Resource-Policy", "same-site");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Frame-Options", "DENY");
	headers.set("X-Download-Options", "noopen");

	return new Response(toArrayBuffer(storedFile.data), { headers });
}

function parseRouteParams(url: string): { userId: string | undefined; filePath: string | undefined } {
	const pathname = new URL(url).pathname;
	const [, pathAfterUploads] = pathname.split("/uploads/");
	if (!pathAfterUploads) return { userId: undefined, filePath: undefined };
	const firstSlashIndex = pathAfterUploads.indexOf("/");

	if (firstSlashIndex === -1) {
		return { userId: pathAfterUploads, filePath: undefined };
	}

	const userId = pathAfterUploads.slice(0, firstSlashIndex);
	const filePath = pathAfterUploads.slice(firstSlashIndex + 1);

	return { userId, filePath: filePath || undefined };
}

function isValidPath(segment: string): boolean {
	const normalized = normalize(segment).replace(/^(\.\.(\/|\\|$))+/, "");

	return normalized === segment;
}

function isValidPathSegments(path: string): boolean {
	const segments = path.split("/");

	return segments.every((segment) => isValidPath(segment));
}

function isPrivateUploadPath(path: string): boolean {
	return path.split("/")[0] === "agent";
}

function isNotModified(headers: Headers, etag: string): boolean {
	const ifNoneMatch = headers.get("If-None-Match");
	const candidates = ifNoneMatch?.split(",").map((s) => s.trim()) ?? [];

	return candidates.includes(etag);
}

function makeNotModifiedResponse(etag: string): Response {
	return new Response(null, {
		status: 304,
		headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" },
	});
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
	return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
		? (data.buffer as ArrayBuffer)
		: (data.slice().buffer as ArrayBuffer);
}

function createEtag(storedFile: { data: Uint8Array; size: number; etag?: string }): string {
	if (storedFile.etag) {
		const tag = storedFile.etag.trim();

		if (tag.startsWith("W/") || tag.startsWith('"')) {
			return tag;
		}
		return `"${tag}"`;
	}

	const hash = createHash("sha256").update(storedFile.data).digest("hex");

	return `"${storedFile.size}-${hash}"`;
}
