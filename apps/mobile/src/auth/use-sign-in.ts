import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { signInErrorMessage } from "./messages";
import { cancelSignIn, signIn } from "./session";

export type SignInAttempt = { state: "idle" } | { state: "waiting" } | { state: "failed"; message: string };

/**
 * One browser sign-in at a time, for a screen: `waiting` while the browser is open, `failed` with the message to show
 * when it was cancelled or rejected. Success changes the session; the session gate then leaves the auth screens.
 */
export function useSignIn() {
	const { t, i18n } = useLingui();
	const [attempt, setAttempt] = useState<SignInAttempt>({ state: "idle" });

	const start = async (server: string) => {
		setAttempt({ state: "waiting" });
		try {
			const done = await signIn(server);
			setAttempt(
				done ? { state: "idle" } : { state: "failed", message: t`You canceled the sign-in before it finished.` },
			);
		} catch (error) {
			setAttempt({ state: "failed", message: signInErrorMessage(i18n, error) });
		}
	};

	return { attempt, start, cancel: cancelSignIn, reset: () => setAttempt({ state: "idle" }) };
}
