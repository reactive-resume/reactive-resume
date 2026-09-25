import { randomUUID } from "node:crypto";
import { del, get, issueSignedToken, list, presignUrl } from "@vercel/blob";
import { z } from "zod";
import { getRedis, redisKey } from "@reactive-resume/db/redis";
import { env } from "@reactive-resume/env/server";
import { resolveUserFromRequestHeaders } from "../../context";
import { createRateLimiter } from "../../redis";
import { blobOptions, blobPath } from "./blob";

const HEADER = "x-resume-staged-body";
const TTL_SECONDS = 600;
// Covers the 100 MiB thread attachment allowance, including base64 and RPC framing.
const MAX_BYTES = 160 * 1024 * 1024;
const limiter = createRateLimiter("staged-body", { maxRequests: 30, window: 60_000 });
const payloadSchema = z.object({
	path: z.string().startsWith("/api/rpc").max(4096),
	contentType: z.string().min(1).max(512),
	size: z.number().int().positive().max(MAX_BYTES),
});
const enabled = () => process.env.VERCEL === "1" && env.STORAGE_BACKEND === "blob";

function authenticatedUser(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(env.APP_URL).origin) return null;
	return resolveUserFromRequestHeaders(request.headers);
}

/** Bounded lazy cleanup on each prepare; upload credentials expire before an object becomes eligible. */
async function cleanupExpiredBodies() {
	const page = await list({ ...blobOptions(), prefix: blobPath("_staging/"), limit: 100 });
	const expired = page.blobs.filter((blob) => blob.uploadedAt.getTime() < Date.now() - TTL_SECONDS * 1000);
	if (expired.length)
		await del(
			expired.map((blob) => blob.pathname),
			blobOptions(),
		);
}

export async function prepareStagedBody(request: Request): Promise<Response> {
	if (!enabled()) return new Response("Not Found", { status: 404 });
	const user = await authenticatedUser(request);
	if (!user) return new Response("Unauthorized", { status: 401 });
	if (!(await limiter.limit(user.id)).success) return new Response("Too many uploads", { status: 429 });
	const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return new Response("Invalid upload", { status: 400 });
	const target = new URL(parsed.data.path, env.APP_URL);
	if (target.origin !== new URL(env.APP_URL).origin || !/^\/api\/rpc(?:\/|$)/.test(target.pathname)) {
		return new Response("Invalid target", { status: 400 });
	}
	const redis = getRedis();
	if (!redis) return new Response("Upload coordination unavailable", { status: 503 });
	await cleanupExpiredBodies();
	const id = randomUUID();
	const pathname = blobPath(`_staging/${Date.now()}-${id}`);
	const constraints = { maximumSizeInBytes: parsed.data.size, allowedContentTypes: ["application/octet-stream"] };
	const signed = await issueSignedToken({
		...blobOptions(),
		...constraints,
		pathname,
		operations: ["put"],
		validUntil: Date.now() + 300_000,
	});
	const { presignedUrl } = await presignUrl(signed, {
		...constraints,
		operation: "put",
		pathname,
		access: "private",
		addRandomSuffix: false,
		allowOverwrite: false,
	});
	await redis.set(
		redisKey("staged-body", id),
		JSON.stringify({ ...parsed.data, userId: user.id, pathname }),
		"EX",
		TTL_SECONDS,
	);
	return Response.json({ id, url: presignedUrl }, { headers: { "Cache-Control": "no-store" } });
}

/** Restore the transport body, then run the normal RPC authorization and validators. */
export async function withStagedBody(request: Request, handle: (request: Request) => Promise<Response>) {
	const id = request.headers.get(HEADER);
	if (!id) return handle(request);
	if (!enabled() || request.method !== "POST" || !z.uuid().safeParse(id).success) {
		return new Response("Invalid upload reference", { status: 400 });
	}
	const user = await authenticatedUser(request);
	if (!user) return new Response("Unauthorized", { status: 401 });
	const redis = getRedis();
	const key = redisKey("staged-body", id);
	const raw = await redis?.get(key);
	if (!raw) return new Response("Upload expired or already used", { status: 410 });
	const stored = JSON.parse(raw) as z.infer<typeof payloadSchema> & { userId: string; pathname: string };
	const url = new URL(request.url);
	if (stored.userId !== user.id || stored.path !== `${url.pathname}${url.search}`) {
		return new Response("Upload does not belong to this request", { status: 403 });
	}
	// Atomically consume only after ownership validation; parallel finalizations cannot repeat a mutation.
	if ((await redis?.getdel(key)) !== raw) return new Response("Upload already used", { status: 409 });
	try {
		const result = await get(stored.pathname, { ...blobOptions(), access: "private", useCache: false });
		if (result?.statusCode !== 200) return new Response("Upload missing", { status: 400 });
		// The signed PUT capped the object at the declared size; reject anything shorter.
		const body = await new Response(result.stream).arrayBuffer();
		if (body.byteLength !== stored.size) return new Response("Upload size mismatch", { status: 413 });
		const headers = new Headers(request.headers);
		headers.delete(HEADER);
		headers.delete("content-length");
		headers.set("content-type", stored.contentType);
		return await handle(
			new Request(request.url, {
				method: "POST",
				headers,
				body,
				signal: request.signal,
			}),
		);
	} finally {
		await del(stored.pathname, blobOptions()).catch((error: unknown) =>
			console.error("Staged upload cleanup failed", error),
		);
	}
}
