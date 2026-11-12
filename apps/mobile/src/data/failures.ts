import type { Failure } from "./queue";
import { t } from "@lingui/core/macro";
export function failureCopy(failure: Failure) {
	switch (failure) {
		case "offline":
			return { message: t`You're offline. Your changes are kept on this device.`, action: t`Keep working` };
		case "session-expired":
			return { message: t`Your session expired`, action: t`Sign in again` };
		case "conflict":
			return { message: t`Your changes conflict with a newer version`, action: t`Review` };
		case "no-response":
			return { message: t`The server didn't respond`, action: t`Try again` };
	}
}
