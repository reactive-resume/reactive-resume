import type { AnyMiddleware } from "@orpc/server";
import { ORPCError } from "@orpc/client";

function isAgentEnvironmentUnavailable(error: unknown) {
	return error instanceof Error && error.message === "AGENT_ENVIRONMENT_UNAVAILABLE";
}

function throwUnavailable(): never {
	throw new ORPCError("PRECONDITION_FAILED", {
		message: "The assistant isn't set up on this server: ENCRYPTION_SECRET is not configured.",
	});
}

// ponytail: single middleware replaces 12 near-identical try/catch blocks across agent route handlers
export const mapAgentEnvironmentError: AnyMiddleware = async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (isAgentEnvironmentUnavailable(error)) throwUnavailable();
		throw error;
	}
};
