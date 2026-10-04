import { redisKey } from "@reactive-resume/db/redis";
import { getRedis } from "@reactive-resume/db/redis";

/**
 * Short-lived, server-side holder for a pending PKCE attempt. The verifier only ever lives here: it is
 * never sent to the browser, never put in a URL, and never returned in a response or an error.
 *
 * Redis is used when the deployment has it so a multi-instance install can finish an attempt on a
 * different instance than the one that began it; otherwise an in-process map with the same TTL applies.
 */
export type PendingConnectAttempt = {
	userId: string;
	verifier: string;
	state: string;
	authorizeUrl: string;
	label: string | null;
	/** When reconnecting an existing provider row, its id; otherwise a new row is created. */
	providerId: string | null;
	attempt: number;
	createdAt: number;
};

export const PENDING_CONNECT_TTL_SECONDS = 600;

const memory = new Map<string, PendingConnectAttempt>();

const keyFor = (id: string) => redisKey("orca-connect", id);

function sweep() {
	const now = Date.now();
	for (const [id, attempt] of memory) {
		if (now - attempt.createdAt > PENDING_CONNECT_TTL_SECONDS * 1000) memory.delete(id);
	}
}

export const pendingConnectStore = {
	async save(id: string, attempt: PendingConnectAttempt) {
		const redis = getRedis();
		if (redis) {
			try {
				await redis.set(keyFor(id), JSON.stringify(attempt), "EX", PENDING_CONNECT_TTL_SECONDS);
				return;
			} catch (error) {
				// Falling back keeps the flow usable on an install whose Redis is down; the attempt then
				// has to complete on this instance, which is what a single-process deployment does anyway.
				console.error("[orca] connect store unavailable; using in-process store", error);
			}
		}
		sweep();
		memory.set(id, attempt);
	},

	async get(id: string): Promise<PendingConnectAttempt | null> {
		const redis = getRedis();
		if (redis) {
			try {
				const value = await redis.get(keyFor(id));
				if (value) return JSON.parse(value) as PendingConnectAttempt;
			} catch (error) {
				console.error("[orca] connect store unavailable; using in-process store", error);
			}
		}
		return memory.get(id) ?? null;
	},

	async remove(id: string) {
		const redis = getRedis();
		if (redis) {
			try {
				await redis.del(keyFor(id));
			} catch (error) {
				console.error("[orca] connect store unavailable; using in-process store", error);
			}
		}
		memory.delete(id);
	},
};
