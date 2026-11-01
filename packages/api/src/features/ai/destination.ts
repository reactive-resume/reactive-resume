import type { AiVoiceOperation } from "@reactive-resume/ai/types";
import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError } from "@orpc/server";
import { aiDestination, NO_AI_DESTINATION } from "@reactive-resume/ai/types";

const approvedDestination = new AsyncLocalStorage<string>();

/** Optional for older clients. New clients bind disclosure approval to the connection actually resolved. */
export function withAiDestination<T>(destination: string | null, run: () => T): T {
	if (!destination) return run();
	if (destination.length > 4000) throw new ORPCError("BAD_REQUEST");
	return approvedDestination.run(destination, run);
}

export function isNoAiDestination() {
	return approvedDestination.getStore() === NO_AI_DESTINATION;
}

export function approvedAiProviderId(): string | undefined {
	const expected = approvedDestination.getStore();
	if (!expected) return;
	if (expected === NO_AI_DESTINATION)
		throw new ORPCError("CONFLICT", { message: "This operation was approved without AI. Nothing was sent." });
	try {
		const value: unknown = JSON.parse(expected);
		if (Array.isArray(value) && typeof value[0] === "string") return value[0];
	} catch {
		/* Invalid approval must fail closed. */
	}
	throw new ORPCError("BAD_REQUEST");
}

export function assertAiDestination(provider: Parameters<typeof aiDestination>[0], voice?: AiVoiceOperation) {
	const expected = approvedDestination.getStore();
	if (expected && expected !== aiDestination(provider, voice))
		throw new ORPCError("CONFLICT", {
			message: "Your AI destination changed. Nothing was sent; review the connection and try again.",
		});
}

const approvedWebDestination = new AsyncLocalStorage<string>();
export function withWebDestination<T>(destination: string | null, run: () => T): T {
	if (!destination) return run();
	if (destination.length > 128) throw new ORPCError("BAD_REQUEST");
	return approvedWebDestination.run(destination, run);
}
export function assertWebDestination(revision: string) {
	const expected = approvedWebDestination.getStore();
	if (expected && expected !== revision)
		throw new ORPCError("CONFLICT", {
			message: "Your web destination changed. Nothing was sent; review web access and try again.",
		});
}
