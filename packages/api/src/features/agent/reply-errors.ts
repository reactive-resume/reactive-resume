import { ORPCError } from "@orpc/client";
import { AISDKError, APICallError, RetryError } from "ai";
import { AGENT_REPLY_ERRORS } from "@reactive-resume/ai/tools/agent-tool-contracts";

/**
 * What a failed reply tells the user. Provider bodies and SDK text are English, can echo request data and aren't
 * actionable, so only the HTTP status picks the wording; this server's own reasons (an ORPCError) pass through.
 */
export function replyErrorMessage(error: unknown): string {
	if (error instanceof ORPCError && error.message) return error.message;
	const cause = RetryError.isInstance(error) ? error.lastError : error;
	if (APICallError.isInstance(cause)) {
		const status = cause.statusCode;
		if (status === 401 || status === 403) return AGENT_REPLY_ERRORS.providerKey;
		if (status === 404) return AGENT_REPLY_ERRORS.providerModel;
		if (status === 402 || status === 429) return AGENT_REPLY_ERRORS.providerLimit;
		// No status: the provider couldn't be reached at all (a local model that isn't running, say).
		if (status === undefined || status >= 500) return AGENT_REPLY_ERRORS.providerDown;
		return AGENT_REPLY_ERRORS.provider;
	}
	return AISDKError.isInstance(cause) ? AGENT_REPLY_ERRORS.provider : AGENT_REPLY_ERRORS.failed;
}
