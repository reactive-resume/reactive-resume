import { getPool } from "@reactive-resume/db/client";
import { getRedis, redisKey } from "../../redis";

const RESUME_UPDATED_CHANNEL = "resume_updated";
const resumeMutationNames = new Set(["sync", "create", "update", "patch", "lock", "password", "delete"] as const);

type PgNotification = {
	channel?: string | undefined;
	payload?: string | undefined;
};

export type ResumeUpdatedEvent = {
	type: "resume.updated";
	resumeId: string;
	userId: string;
	updatedAt: string;
	mutation: "sync" | "create" | "update" | "patch" | "lock" | "password" | "delete";
};

type SubscribeResumeUpdatedInput = {
	resumeId: string;
	userId: string;
	signal?: AbortSignal;
};

function isResumeUpdatedEvent(value: unknown): value is ResumeUpdatedEvent {
	if (!value || typeof value !== "object") return false;

	const event = value as Partial<ResumeUpdatedEvent>;
	return (
		event.type === "resume.updated" &&
		typeof event.resumeId === "string" &&
		typeof event.userId === "string" &&
		typeof event.updatedAt === "string" &&
		typeof event.mutation === "string" &&
		resumeMutationNames.has(event.mutation as ResumeUpdatedEvent["mutation"])
	);
}

export async function publishResumeUpdated(event: ResumeUpdatedEvent) {
	const redis = getRedis();
	if (redis) {
		await redis.publish(redisKey(RESUME_UPDATED_CHANNEL), JSON.stringify(event));
		return;
	}
	await getPool().query("SELECT pg_notify($1, $2)", [RESUME_UPDATED_CHANNEL, JSON.stringify(event)]);
}

export async function* subscribeResumeUpdated({ resumeId, userId, signal }: SubscribeResumeUpdatedInput) {
	if (signal?.aborted) return;
	const subscriber = getRedis()?.duplicate({ commandTimeout: 5_000 });
	const client = subscriber ? undefined : await getPool().connect();
	const channel = subscriber ? redisKey(RESUME_UPDATED_CHANNEL) : RESUME_UPDATED_CHANNEL;
	const queue: ResumeUpdatedEvent[] = [];
	let done = signal?.aborted ?? false;
	let wake: (() => void) | undefined;
	let failure: Error | undefined;
	let stop: () => void = () => {};
	const stopped = new Promise<void>((resolve) => {
		stop = resolve;
	});

	const resolveWake = () => {
		wake?.();
		wake = undefined;
	};

	const onAbort = () => {
		done = true;
		stop();
		resolveWake();
	};
	const onError = (error: Error) => {
		failure = error;
		onAbort();
	};

	const onNotification = (notification: PgNotification) => {
		if (notification.channel !== channel || !notification.payload) return;

		try {
			const event = JSON.parse(notification.payload) as unknown;
			if (!isResumeUpdatedEvent(event)) return;
			if (event.resumeId !== resumeId || event.userId !== userId) return;

			queue.push(event);
			resolveWake();
		} catch {
			// Ignore malformed notifications; the refetch path is invalidation-only.
		}
	};
	const onMessage = (messageChannel: string, payload: string) => onNotification({ channel: messageChannel, payload });

	signal?.addEventListener("abort", onAbort, { once: true });
	client?.on("notification", onNotification);
	subscriber?.on("message", onMessage);
	subscriber?.on("error", onError);

	try {
		if (subscriber) await Promise.race([subscriber.subscribe(channel), stopped]);
		else await client?.query(`LISTEN ${RESUME_UPDATED_CHANNEL}`);

		while (!done) {
			const event = queue.shift();
			if (event) {
				yield event;
				continue;
			}

			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		}
		if (failure) throw failure;
	} finally {
		signal?.removeEventListener("abort", onAbort);
		client?.off("notification", onNotification);
		subscriber?.off("message", onMessage);

		if (subscriber) {
			try {
				if (subscriber.status === "ready") {
					try {
						await subscriber.unsubscribe(channel);
					} finally {
						await subscriber.quit();
					}
				}
			} finally {
				subscriber.disconnect();
				subscriber.off("error", onError);
			}
		} else if (client) {
			try {
				await client.query(`UNLISTEN ${RESUME_UPDATED_CHANNEL}`);
			} finally {
				client.release();
			}
		}
	}
}
