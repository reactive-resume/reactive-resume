import type { UIMessageChunk } from "ai";
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import { JsonToSseTransformStream } from "ai";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { getRedis, redisKey } from "@reactive-resume/db/redis";

type AgentStreamContext = Pick<ResumableStreamContext, "createNewResumableStream" | "resumeExistingStream">;

type AgentStreamLifecycleOptions = {
	/** Null without Redis: replies still stream, but can't be picked up again after a reload. */
	getContext: () => AgentStreamContext | null;
};

let streamContext: AgentStreamContext | null = null;
let waitUntil: ((promise: Promise<unknown>) => void) | null = null;

/** Configure once at platform startup; the callback resolves the current request context. */
export function configureAgentStreamLifetime(callback: (promise: Promise<unknown>) => void) {
	if (streamContext) throw new Error("Configure agent stream lifetime before handling requests");
	waitUntil = callback;
}

export function emptyAgentStream() {
	return new ReadableStream<string>({
		start(controller) {
			controller.close();
		},
	});
}

function getAgentStreamContext() {
	if (streamContext) return streamContext;
	const publisher = getRedis();
	if (!publisher) return null;
	streamContext = createResumableStreamContext({
		keyPrefix: redisKey("agent-stream"),
		waitUntil,
		publisher,
		subscriber: publisher.duplicate(),
	});

	return streamContext;
}

export function createAgentStreamLifecycle(options: AgentStreamLifecycleOptions) {
	return {
		async create(streamId: string, makeStream: () => ReadableStream<UIMessageChunk>) {
			const toSse = () => makeStream().pipeThrough(new JsonToSseTransformStream());
			const context = options.getContext();
			if (!context) {
				if (!waitUntil) return toSse();
				// Without a resumable store, the run would end with the client's connection. Draining a copy
				// keeps it going until it finishes or is stopped, so its transcript and claim are always settled.
				const [client, run] = toSse().tee();
				waitUntil(run.pipeTo(new WritableStream()));
				return client;
			}

			const stream = await context.createNewResumableStream(streamId, toSse);
			return stream ?? emptyAgentStream();
		},

		async resume(streamId: string | null | undefined) {
			if (!streamId) return emptyAgentStream();
			const context = options.getContext();
			if (!context) return emptyAgentStream();

			const stream = await context.resumeExistingStream(streamId);
			return stream ?? emptyAgentStream();
		},
	};
}

export const agentStreamLifecycle = createAgentStreamLifecycle({ getContext: getAgentStreamContext });
