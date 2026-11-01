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

export function providerTestError(kind?: string | null) {
	switch (kind) {
		case "auth":
			return t`The key was rejected. Check the key and test again.`;
		case "model":
			return t`The model wasn't available or couldn't complete the test. Check its name or try another model.`;
		case "network":
			return t`The service couldn't be reached. Check the address and connection, then try again.`;
		case "url":
			return t`Enter the API base URL of your service and test again.`;
		case "rate-limit":
			return t`The provider limited this request. Wait and try again; check your account quota.`;
		case "server":
			return t`The provider reported a server error. Try again later.`;
		default:
			return t`The connection test failed. Check the key, model and address, then try again.`;
	}
}
