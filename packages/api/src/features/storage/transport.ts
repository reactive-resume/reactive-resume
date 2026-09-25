import { randomUUID, timingSafeEqual } from "node:crypto";
import { del, get, issueSignedToken, list, presignUrl } from "@vercel/blob";
import { z } from "zod";
import { env } from "@reactive-resume/env/server";
import { resolveUserFromRequestHeaders } from "../../context";
import { createRateLimiter, getRedis, redisKey } from "../../redis";
import { blobOptions, blobPath } from "./blob";

const HEADER = "x-resume-staged-body";
const TTL_SECONDS = 600;
// Covers the existing 100 MiB thread attachment allowance, including base64 and RPC framing.
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

/** Bounded lazy cleanup; upload credentials expire before an object becomes eligible. */
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
	if (request.method === "GET")
		return Response.json({ enabled: enabled() }, { headers: { "Cache-Control": "no-store" } });
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

/** Restore the transport body, then let the existing RPC authorization and validators run unchanged. */
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
		// Private Blob reads may be chunked (SDK size=0); enforce the limit on actual bytes.
		let size = 0;
		let body: ArrayBuffer;
		try {
			body = await new Response(
				result.stream.pipeThrough(
					new TransformStream({
						transform(chunk: Uint8Array, controller) {
							size += chunk.byteLength;
							if (size > stored.size || size > MAX_BYTES) throw new RangeError("Upload size mismatch");
							controller.enqueue(chunk);
						},
					}),
				),
			).arrayBuffer();
		} catch (error) {
			if (error instanceof RangeError) return new Response("Upload size mismatch", { status: 413 });
			throw error;
		}
		if (size !== stored.size) return new Response("Upload size mismatch", { status: 413 });
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

export async function cleanupStagedBodies(request: Request) {
	const supplied = Buffer.from(request.headers.get("authorization") ?? "");
	const expected = Buffer.from(`Bearer ${env.CRON_SECRET ?? ""}`);
	if (!enabled() || !env.CRON_SECRET || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
		return new Response("Unauthorized", { status: 401 });
	}
	// Up to 1,000 expired objects per daily invocation; subsequent runs resume from the oldest keys.
	for (let page = 0; page < 10; page++) await cleanupExpiredBodies();
	return new Response(null, { status: 204 });
}
