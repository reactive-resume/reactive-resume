import { getRedis, redisKey } from "@reactive-resume/db/redis";

const controllers = new Map<string, AbortController>();
const CANCELLATION_TTL_MS = 15 * 60_000;
const HEARTBEAT_TTL_MS = 10_000;

export async function requestRunCancellation(runId: string, reason: string): Promise<void> {
	try {
		await getRedis()?.set(redisKey("agent-cancellation", runId), reason, "PX", CANCELLATION_TTL_MS);
	} finally {
		controllers.get(runId)?.abort(new DOMException(reason, "AbortError"));
	}
}

/** Polls for remote stops and keeps a liveness heartbeat until the owner calls the returned cleanup. */
export async function monitorRunCancellation(runId: string, controller: AbortController): Promise<() => void> {
	controllers.set(runId, controller);
	const redis = getRedis();
	let stopped = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const cleanup = () => {
		stopped = true;
		clearTimeout(timeout);
		if (controllers.get(runId) === controller) controllers.delete(runId);
	};

	const check = async () => {
		if (stopped || !redis) return;
		try {
			// Keep beating after an abort: the owner still holds the claim while it persists the transcript.
			await redis.set(redisKey("agent-run-alive", runId), "1", "PX", HEARTBEAT_TTL_MS);
			const reason = controller.signal.aborted ? null : await redis.get(redisKey("agent-cancellation", runId));
			if (!stopped && reason) controller.abort(new DOMException(reason, "AbortError"));
		} catch {
			if (!stopped) controller.abort(new DOMException("CANCELLATION_UNAVAILABLE", "AbortError"));
		}
		// ponytail: two Redis commands per second per run; pub/sub can reduce traffic at higher concurrency.
		if (!stopped) timeout = setTimeout(() => void check(), 1_000);
	};
	await check();
	return cleanup;
}

/** False once a run's owner has stopped heartbeating, meaning it died without releasing its claim. */
export async function isRunAlive(runId: string, startedAt: Date | null): Promise<boolean> {
	const redis = getRedis();
	if (!redis) return true;
	// A just-claimed run may not have written its first heartbeat yet.
	if (startedAt && Date.now() - startedAt.getTime() < HEARTBEAT_TTL_MS) return true;
	return (await redis.exists(redisKey("agent-run-alive", runId))) === 1;
}
