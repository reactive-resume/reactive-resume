import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";

// Set while a guest is on sign-up or sign-in, so the app can confirm the move once they're back in an account. It
// survives provider redirects and two-step verification, which leave this page.
const TRANSFER_KEY = "guest-transfer";
const TRANSFER_MAX_AGE_MS = 60 * 60 * 1000;

const readTransfer = () => {
	try {
		return Number(window.sessionStorage.getItem(TRANSFER_KEY)) || 0;
	} catch {
		return 0;
	}
};
const writeTransfer = (startedAt: number | null) => {
	try {
		if (startedAt) window.sessionStorage.setItem(TRANSFER_KEY, String(startedAt));
		else window.sessionStorage.removeItem(TRANSFER_KEY);
	} catch {
		// A convenience only: without storage there's just no confirmation.
	}
};

/** Guests lose their work when the session ends, so the app says so and offers a way to keep it. */
export function GuestBanner() {
	const { session } = useRouteContext({ strict: false });
	const isAnonymous = session?.user.isAnonymous;

	useEffect(() => {
		if (isAnonymous === undefined) return;
		const startedAt = readTransfer();
		if (!startedAt) return;
		// Back as a guest means they didn't sign up or in; nothing moved.
		writeTransfer(null);
		if (!isAnonymous && Date.now() - startedAt < TRANSFER_MAX_AGE_MS)
			toast.add({ type: "success", description: t`Your guest documents and applications are in this account.` });
	}, [isAnonymous]);

	if (!isAnonymous) return null;

	return (
		<div className="px-4 pt-4">
			<Alert variant="warn">
				<Icon name="warning-circle" />
				<AlertTitle>
					<Trans>You're using a guest account</Trans>
				</AlertTitle>
				<AlertDescription>
					<p>
						<Trans>
							Your work is lost when you sign out or the session ends. Create an account or sign in to keep your
							resumes, cover letters and applications.
						</Trans>
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<Button variant="secondary" size="sm" nativeButton={false} render={<Link to="/auth/register" />}>
							<Trans>Create account</Trans>
						</Button>
						<Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/auth/login" />}>
							<Trans>Sign in</Trans>
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		</div>
	);
}

/**
 * On sign-up and sign-in from a guest session: what moves to the account and what doesn't. It matches the account
 * link in `@reactive-resume/auth` (documents, their history, applications, the application profile, saved answers and
 * Career knowledge move; assistant conversations are deleted with the guest).
 */
export function GuestTransferNote() {
	useEffect(() => writeTransfer(Date.now()), []);

	return (
		<Alert variant="info">
			<Icon name="info" />
			<AlertDescription>
				<Trans>
					Your guest resumes, cover letters, applications and Career knowledge move to this account. Assistant
					conversations don't.
				</Trans>
			</AlertDescription>
		</Alert>
	);
}
