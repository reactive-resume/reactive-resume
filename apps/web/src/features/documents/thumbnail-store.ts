import type { ResumeThumbnailSize } from "@/features/resume/preview/resume-thumbnail.shared";

// Rendered dashboard thumbnails, kept across sessions so an unchanged resume is never rendered twice.
// One entry per resume; the oldest writes go once there are more than MAX_ENTRIES.
const CACHE_NAME = "resume-thumbnails";
const MAX_ENTRIES = 100;

/** `build` names the renderer that drew the image; a new one redraws every thumbnail. */
type ThumbnailVersion = { updatedAt: Date; size: ResumeThumbnailSize; build: string };

// Cache Storage resolves the relative path against the page, so stored keys are unchanged.
const keyFor = (resumeId: string) => `/__resume-thumbnails/${encodeURIComponent(resumeId)}`;

/** The stored image, if it was drawn from this edit by this renderer at least this large. */
export async function readStoredThumbnail(resumeId: string, { updatedAt, size, build }: ThumbnailVersion) {
	try {
		const response = await (await caches.open(CACHE_NAME)).match(keyFor(resumeId));
		if (!response) return undefined;
		const headers = response.headers;
		if (headers.get("x-build") !== build) return undefined;
		if (headers.get("x-updated-at") !== String(updatedAt.getTime())) return undefined;
		if (Number(headers.get("x-width")) < size.width || Number(headers.get("x-height")) < size.height) return undefined;
		return await response.blob();
	} catch {
		// No Cache Storage (insecure origin, private mode, quota): render instead.
		return undefined;
	}
}

export async function storeThumbnail(resumeId: string, { updatedAt, size, build }: ThumbnailVersion, image: Blob) {
	try {
		const cache = await caches.open(CACHE_NAME);
		const headers = {
			"content-type": image.type,
			"x-build": build,
			"x-updated-at": String(updatedAt.getTime()),
			"x-width": String(size.width),
			"x-height": String(size.height),
		};
		await cache.put(keyFor(resumeId), new Response(image, { headers }));
		// Keys come back oldest write first.
		const keys = await cache.keys();
		await Promise.all(keys.slice(0, -MAX_ENTRIES).map((key) => cache.delete(key)));
	} catch {
		// Storing is best effort.
	}
}

/** Removes every saved thumbnail; called when an account signs out or is deleted. */
export async function clearStoredThumbnails() {
	try {
		await caches.delete(CACHE_NAME);
	} catch {
		// Nothing was stored.
	}
}
