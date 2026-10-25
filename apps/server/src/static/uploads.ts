import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";
import { getStorageService, inferContentType, isPublicUploadOwner } from "@reactive-resume/api/features/storage";
import { matchesIfNoneMatch } from "@reactive-resume/utils/http";

// Uploads share the app origin and S3/Blob hand back the client-declared type, so only raster
// images render inline. Anything else (HTML, SVG, PDF, unknown) downloads, whatever was stored.
const INLINE_CONTENT_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
// Short enough that a deleted picture, or one whose owner was banned, leaves shared caches within the hour.
const PUBLIC_PICTURE_CACHE_CONTROL = "public, max-age=3600";

export async function handleUpload(request: Request) {
	const [userId, ...segments] = new URL(request.url).pathname.split("/uploads/")[1]?.split("/") ?? [];
	const filePath = segments.join("/");

	if (!userId || !filePath) return new Response("Bad Request", { status: 400 });

	if (![userId, ...segments].every(isValidPath)) return new Response("Forbidden", { status: 403 });
	if (segments[0] === "agent") return new Response("Not Found", { status: 404 });

	const storageService = getStorageService();
	const key = `uploads/${userId}/${filePath}`;
	const storedFile = await storageService.read(key);
	if (!storedFile) return new Response("Not Found", { status: 404 });

	const filename = filePath.split("/").pop() ?? filePath;
	const contentType = storedFile.contentType ?? inferContentType(filename);
	const isPublicPicture = filePath.startsWith("pictures/") && INLINE_CONTENT_TYPES.has(contentType);
	if (isPublicPicture && !(await isPublicUploadOwner(userId)))
		return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
	if (!isPublicPicture) {
		const { resolveAuthenticationFromRequestHeaders } = await import("@reactive-resume/api/context");
		const authentication = await resolveAuthenticationFromRequestHeaders(request.headers).catch(() => null);
		if (authentication?.user.id !== userId || !authentication.permissions.includes("read"))
			return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
	}
	const etag = createEtag(storedFile);

	if (isPublicPicture && matchesIfNoneMatch(request.headers.get("If-None-Match"), etag))
		return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": PUBLIC_PICTURE_CACHE_CONTROL } });

	const shouldForceDownload = !INLINE_CONTENT_TYPES.has(contentType);

	const headers = new Headers();
	headers.set("Content-Type", shouldForceDownload ? "application/octet-stream" : contentType);
	headers.set("Content-Length", storedFile.size.toString());

	if (shouldForceDownload) {
		headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(basename(filename))}"`);
	}

	headers.set("Cache-Control", isPublicPicture ? PUBLIC_PICTURE_CACHE_CONTROL : "private, no-store");
	headers.set("ETag", etag);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Robots-Tag", "noindex, nofollow");
	headers.set("Cross-Origin-Resource-Policy", "same-site");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Frame-Options", "DENY");
	headers.set("X-Download-Options", "noopen");

	return new Response(storedFile.data as Uint8Array<ArrayBuffer>, { headers });
}

function isValidPath(segment: string): boolean {
	const normalized = normalize(segment).replace(/^(\.\.(\/|\\|$))+/, "");

	return normalized === segment;
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
