import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";

export function aiSettingsError(error: unknown, testing = false) {
	if (error instanceof ORPCError) {
		if (testing && (error.code === "BAD_GATEWAY" || error.code === "NOT_FOUND"))
			return t`The test didn't run. Try again.`;
		if (error.code === "PRECONDITION_FAILED")
			return t`Ask your server administrator to enable credential encryption or configure a shared connection.`;
		if (error.code === "BAD_REQUEST") return t`That provider setup isn't valid. Check the key, model and base URL.`;
		if (error.code === "FORBIDDEN") return t`This connection is managed by your server.`;
		if (error.code === "UNAUTHORIZED") return t`Your session expired. Sign in again.`;
		if (error.code === "RATE_LIMIT_EXCEEDED" || error.code === "TOO_MANY_REQUESTS")
			return t`Too many requests. Try again later.`;
	}
	return t`The connection couldn't be loaded or saved. Try again.`;
}
