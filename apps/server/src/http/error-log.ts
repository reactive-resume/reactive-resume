import { ORPCError } from "@orpc/server";

const REQUEST_ID_HEADERS = ["cf-ray", "x-vercel-id"];
const SAFE_REQUEST_ID = /^[\w:.-]{1,128}$/;

/** The hosting platform's request ID, when one fronts this server. A client can send these headers too, so check them. */
export function platformRequestId(headers: Headers | undefined) {
	for (const name of REQUEST_ID_HEADERS) {
		const value = headers?.get(name);
		if (value && SAFE_REQUEST_ID.test(value)) return value;
	}
	return undefined;
}

// V8 starts a stack with "<name>: <message>"; the message can hold SQL parameters or submitted text. Frames only.
function stackFrames(error: Error) {
	const stack = typeof error.stack === "string" ? error.stack : "";
	const messageEnd = error.message ? stack.indexOf(error.message) : -1;
	const frames = (messageEnd === -1 ? stack : stack.slice(messageEnd + error.message.length))
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("at "))
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
