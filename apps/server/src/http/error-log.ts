import { ORPCError } from "@orpc/server";

const SAFE_REQUEST_ID = /^[\w:.-]{1,128}$/;

/**
 * The hosting platform's own request ID. Read only on the platform that sets the header; anywhere else the header
 * is whatever the caller sent, so it's left out.
 */
export function platformRequestId(headers: Headers | undefined) {
	const header = process.env.CLOUDFLARE === "1" ? "cf-ray" : process.env.VERCEL === "1" ? "x-vercel-id" : undefined;
	const value = header ? headers?.get(header) : undefined;
	return value && SAFE_REQUEST_ID.test(value) ? value : undefined;
}

// "at fn (location)" or "at location", where the location ends in ":line:column" or is "index N" (Promise.all).
// A line of a message that merely starts with "at " does not pass.
const STACK_FRAME =
	/^at (?:(?:async |new )?[\w.$<>[\] ]+ \((?:[\w./\\:<>@+~-]+:\d+:\d+|index \d+)\)|(?:[\w./\\:<>@+~-]+:\d+:\d+))$/;

// V8 starts a stack with "<name>: <message>"; the message can hold SQL parameters or submitted text. Frames only.
function stackFrames(error: Error) {
	const stack = typeof error.stack === "string" ? error.stack : "";
	const messageEnd = error.message ? stack.indexOf(error.message) : -1;
	const frames = (messageEnd === -1 ? stack : stack.slice(messageEnd + error.message.length))
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => STACK_FRAME.test(line))
		.slice(0, 8);
	return frames.length > 0 ? frames : undefined;
}

/**
 * What an API failure may say in a server log: never its message, data or cause. Validation errors carry the
 * submitted input, and driver errors carry SQL parameters or addresses with credentials.
 */
export function describeError(error: unknown) {
	if (error instanceof ORPCError) return { code: error.code };
	if (!(error instanceof Error)) return { code: "INTERNAL_SERVER_ERROR", errorName: "Unknown" };
	const stack = stackFrames(error);
	return { code: "INTERNAL_SERVER_ERROR", errorName: error.name, ...(stack ? { stack } : {}) };
}
