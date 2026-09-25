import type { UIMessageChunk } from "ai";
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import { JsonToSseTransformStream } from "ai";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { env } from "@reactive-resume/env/server";
import { getRedis } from "../../redis";

type AgentStreamContext = Pick<ResumableStreamContext, "createNewResumableStream" | "resumeExistingStream">;

type AgentStreamLifecycleOptions = {
	getContext: () => AgentStreamContext;
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
	if (!publisher) throw new Error("Agent streaming requires Redis");
	streamContext = createResumableStreamContext({
		keyPrefix: `reactive-resume:${env.DEPLOYMENT_NAMESPACE ?? "default"}:agent-stream`,
		waitUntil,
		publisher,
		subscriber: publisher.duplicate(),
	});

	return streamContext;
}

export function createAgentStreamLifecycle(options: AgentStreamLifecycleOptions) {
	return {
		async create(streamId: string, makeStream: () => ReadableStream<UIMessageChunk>) {
			const stream = await options
				.getContext()
				.createNewResumableStream(streamId, () => makeStream().pipeThrough(new JsonToSseTransformStream()));

			return stream ?? emptyAgentStream();
		},

		async resume(streamId: string | null | undefined) {
			if (!streamId) return emptyAgentStream();

			const stream = await options.getContext().resumeExistingStream(streamId);
			return stream ?? emptyAgentStream();
		},
	};
}

export const agentStreamLifecycle = createAgentStreamLifecycle({ getContext: getAgentStreamContext });
