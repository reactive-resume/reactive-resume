import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";

export function applicationError(error: unknown) {
	if (error instanceof ORPCError) {
		if (error.code === "POSTING_SUPPORT_UNAVAILABLE")
			return t`Reading without AI couldn't be confirmed. Retry, update your server, or enter the details manually.`;
		if (error.code === "CONFLICT") return t`This changed elsewhere. Reload and try again.`;
		if (error.code === "POSTING_UNREADABLE")
			// The server names the cause (a board's list of jobs, or a page that would not open) and the next step.
			return error.message || t`That link couldn't be read. Paste the posting text instead.`;
		if (error.code === "SEARCH_AUTH") return t`The web service rejected its key. Fix web access or paste a posting.`;
		if (error.code === "SEARCH_QUOTA") return t`The web service quota is used up. Fix web access or paste a posting.`;
		if (error.code === "SEARCH_FAILED") return t`Job search couldn't be reached. Try again or paste a posting link.`;
		if (error.code === "SEARCH_UNAVAILABLE")
			return t`Job search isn't configured on this server. Paste a posting link instead.`;
		if (error.code === "UNAUTHORIZED") return t`Your session expired. Sign in again.`;
		if (error.code === "TOO_MANY_REQUESTS" || error.code === "RATE_LIMIT_EXCEEDED")
			return t`Too many requests. Try again later.`;
		if (error.code === "BAD_GATEWAY")
			return t`The service couldn't be reached. Try again or fill the details manually.`;
		if (error.code === "BAD_REQUEST")
			return t`Check the fields and try again. For unreadable links, paste the posting text instead.`;
	}
	return t`Couldn't complete the request. Check your connection and try again.`;
}
