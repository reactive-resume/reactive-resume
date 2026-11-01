import { t } from "@lingui/core/macro";

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
