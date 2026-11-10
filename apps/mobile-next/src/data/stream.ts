import type { RouterInput, RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { dataClient } from "./client";
import { fakeReplyStream } from "./fixture-stream";
import { useDataBackend } from "./provider";
import { assertDataScope } from "./scope";
import { streamClient } from "@/api/client";

export type ConversationMessage = RouterInput["agent"]["messages"]["send"]["message"];
export type StreamChunk = { type: string; [key: string]: unknown };
/** oRPC strings carry the AI SDK's SSE frames; a frame can span iterator values. */
export function createFrameDecoder() {
	let pending = "";
	return (value: string): StreamChunk[] => {
		pending = (pending + value).replace(/\r\n/g, "\n");
		const frames = pending.split("\n\n");
		pending = frames.pop() ?? "";
		return frames.flatMap((frame) => {
			const data = frame
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (!data || data === "[DONE]") return [];
			const chunk: unknown = JSON.parse(data);
			if (!chunk || typeof chunk !== "object" || !("type" in chunk) || typeof chunk.type !== "string")
				throw new Error(t`Invalid assistant stream.`);
			return [chunk as StreamChunk];
		});
	};
}
export type StreamView = { messageId: string | null; text: string; chunks: StreamChunk[] };
export const emptyStream = (): StreamView => ({ messageId: null, text: "", chunks: [] });
/** Replay starts at the run boundary, replacing earlier streamed output instead of duplicating it. */
export function reduceStream(view: StreamView, chunk: StreamChunk): StreamView {
	if (chunk.type === "start")
		return { messageId: typeof chunk.messageId === "string" ? chunk.messageId : null, text: "", chunks: [chunk] };
	if (chunk.type === "error")
		throw new Error(typeof chunk.errorText === "string" ? chunk.errorText : "Assistant interrupted.");
	return {
		...view,
		text: chunk.type === "text-delta" && typeof chunk.delta === "string" ? view.text + chunk.delta : view.text,
		chunks: [...view.chunks, chunk],
	};
}
export async function consumeAgentStream(
	iterator: AsyncIterator<string>,
	signal: AbortSignal,
	publish: (chunk: StreamChunk) => void,
	onIdle?: () => void,
	idleMs = 45_000,
) {
	const decode = createFrameDecoder();
	try {
		for (;;) {
			signal.throwIfAborted();
			let timer: ReturnType<typeof setTimeout> | undefined;
			let next: IteratorResult<string>;
			try {
				next = await Promise.race([
					iterator.next(),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => {
							onIdle?.();
							reject(new Error(t`Assistant stream interrupted.`));
						}, idleMs);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
			signal.throwIfAborted();
			if (next.done) return;
			for (const chunk of decode(next.value)) publish(chunk);
		}
	} finally {
		await iterator.return?.();
	}
}
export function useAssistantStream(threadId: string) {
	const { scope, backend } = useDataBackend();
	const query = useQueryClient();
	const owner = JSON.stringify([scope, threadId]);
	const [stateOwner, setStateOwner] = useState(owner);
	const [view, setView] = useState(emptyStream);
	const [status, setStatus] = useState<"idle" | "streaming" | "reconnecting" | "stopped" | "error">("idle");
	const [error, setError] = useState<unknown>();
	const active = useRef<{ controller: AbortController; frame?: number | undefined } | undefined>(undefined);
	const stopLocal = () => {
		active.current?.controller.abort();
		if (active.current?.frame !== undefined) cancelAnimationFrame(active.current.frame);
		active.current = undefined;
	};
	useEffect(() => stopLocal, [scope, threadId]);
	const run = async (input?: RouterInput["agent"]["messages"]["send"]) => {
		if (!scope) throw new Error(t`Sign in again.`);
		stopLocal();
		const flight: NonNullable<typeof active.current> = { controller: new AbortController() };
		active.current = flight;
		const signal = flight.controller.signal;
		let nextView = emptyStream();
		const publish = (chunk: StreamChunk) => {
			assertDataScope(scope);
			nextView = reduceStream(nextView, chunk);
			if (flight.frame !== undefined) return;
			flight.frame = requestAnimationFrame(() => {
				flight.frame = undefined;
				if (active.current === flight && !signal.aborted) setView(nextView);
			});
		};
		setStateOwner(owner);
		setView(emptyStream());
		setError(undefined);
		setStatus("streaming");
		try {
			const consume = async (resume: boolean) => {
				const transport = new AbortController();
				const abort = () => transport.abort();
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				try {
					const options = { signal: transport.signal, context: { scope } };
					const iterator =
						backend.kind === "fake"
							? await fakeReplyStream(threadId, input, transport.signal, resume)
							: resume || !input
								? await streamClient.agent.messages.resume({ threadId }, options)
								: await streamClient.agent.messages.send(input, options);
					await consumeAgentStream(iterator, signal, publish, abort);
				} finally {
					abort();
					signal.removeEventListener("abort", abort);
				}
			};
			try {
				await consume(!input);
			} catch (failure) {
				if (signal.aborted) throw failure;
				assertDataScope(scope);
				setStatus("reconnecting");
				nextView = emptyStream();
				await consume(true);
			}
			assertDataScope(scope);
			if (active.current === flight) {
				setStatus("idle");
				await query.invalidateQueries({ queryKey: [scope, "conversation"] });
			}
		} catch (failure) {
			if (active.current === flight) {
				setError(failure);
				setStatus(signal.aborted ? "stopped" : "error");
			}
			if (!signal.aborted) throw failure;
		} finally {
			if (flight.frame !== undefined) cancelAnimationFrame(flight.frame);
			if (active.current === flight) {
				setView(nextView);
				active.current = undefined;
			}
		}
	};
	return {
		...(stateOwner === owner ? view : emptyStream()),
		status: stateOwner === owner ? status : "idle",
		error: stateOwner === owner ? error : undefined,
		send: (input: Omit<RouterInput["agent"]["messages"]["send"], "threadId">) => run({ ...input, threadId }),
		reconnect: () => run(),
		async stop() {
			stopLocal();
			setStatus("stopped");
			if (scope) await dataClient.agent.messages.stop({ threadId }, { context: { scope } });
		},
		addAttachment: (
			input: Omit<RouterInput["agent"]["attachments"]["create"], "threadId">,
		): Promise<RouterOutput["agent"]["attachments"]["create"]> =>
			dataClient.agent.attachments.create({ ...input, threadId }, { context: { scope: scope ?? undefined } }),
		removeAttachment: (id: string) =>
			dataClient.agent.attachments.delete({ id }, { context: { scope: scope ?? undefined } }),
	};
}
export const useCoachStream = useAssistantStream;
