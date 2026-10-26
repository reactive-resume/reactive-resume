import { getCoordination } from "@reactive-resume/db/coordination";
import { getRedis, redisKey } from "@reactive-resume/db/redis";
import { getClientKey } from "../../middleware/rate-limit";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 50_000; // bound the Map; prune expired entries before growing past this.

const seen = new Map<string, number>(); // key -> expiry timestamp

/**
 * Returns `true` at most once per `key` per window. `now` is a parameter (not `Date.now()`)
 * so callers stay testable with a driven clock.
 */
async function shouldCountView(key: string, now: number): Promise<boolean> {
	const redis = getRedis();
	if (redis) return (await redis.set(redisKey("view", key), "1", "PX", WINDOW_MS, "NX")) === "OK";
	// Cloudflare isolates share no memory; its coordination service counts each viewer once across all of them.
	const coordination = getCoordination();
	if (coordination) return (await coordination.consume(redisKey("view", key), { window: WINDOW_MS, max: 1 })).allowed;
	const expiry = seen.get(key);
	if (expiry !== undefined && expiry > now) return false;

	if (seen.size >= MAX_ENTRIES) {
		for (const [k, exp] of seen) {
			if (exp <= now) seen.delete(k);
		}
	}

	seen.set(key, now + WINDOW_MS);
	return true;
}

/** Counts a visitor's view or download of a resume, once an hour per visitor. Callers decide who counts at all. */
export async function countVisit(input: {
	kind: "view" | "download";
	resumeId: string;
	trustedClient?: string | undefined;
}): Promise<void> {
	const client = getClientKey(input.trustedClient);
	const key = input.kind === "view" ? `${input.resumeId}:${client}` : `download:${input.resumeId}:${client}`;
	if (!(await shouldCountView(key, Date.now()))) return;
	// Imported here: the service counts through this module too.
	const { resumeService } = await import("./service");
	await resumeService.statistics.increment({
		id: input.resumeId,
		[input.kind === "view" ? "views" : "downloads"]: true,
	});
}
