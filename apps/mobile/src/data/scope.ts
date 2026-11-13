import { t } from "@lingui/core/macro";
import { isFake } from "./fixtures";
import { getAccountScope } from "@/auth/session";
export function activeDataScope() {
	const scope = isFake() ? "storyboard" : getAccountScope();
	if (!scope) throw new Error(t`Sign in again.`);
	return scope;
}
export function assertDataScope(scope: string) {
	if (activeDataScope() !== scope) throw new Error(t`The account changed.`);
}
