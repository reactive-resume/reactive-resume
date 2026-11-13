import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
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

	// The callout sits where E1 draws it: at the top of the page's reading column, 20px above the page's header. The
	// page below brings its own top padding (28px), so the frame takes 8px back.
	return (
		<div className="-mb-2 px-4 pt-4 sm:px-8 sm:pt-7 lg:px-10">
			<div
				role="status"
				className="flex max-w-(--content-max) flex-wrap items-center gap-3 rounded-lg bg-warn-soft py-3 ps-3.5 pe-3 text-[13px]/[18px] text-warn-text [--icon-size:18px]"
			>
				<Icon name="warning-circle" className="shrink-0" />
				<p className="min-w-[min(100%,20rem)] flex-1">
					<Trans>
						<b className="font-semibold">You're using a guest account.</b> Everything you make is lost when you sign out
						or this session ends. Create an account and your resumes, cover letters, applications and Career knowledge
						move into it.
					</Trans>
				</p>
				<span className="flex shrink-0 gap-2">
					<Button variant="secondary" size="sm" nativeButton={false} render={<Link to="/auth/register" />}>
						<Trans>Create account</Trans>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-current"
						nativeButton={false}
						render={<Link to="/auth/login" />}
					>
						<Trans>Sign in</Trans>
					</Button>
				</span>
			</div>
		</div>
	);
}

/**
 * On sign-up and sign-in from a guest session: what moves to the account and what doesn't. It matches the account
 * link in `@reactive-resume/auth` (documents, their history, applications, the application profile, saved answers and
 * Career knowledge move, except facts the account already holds; conflicting profiles stop the move, and assistant
 * conversations are deleted with the guest after a successful move).
 */
export function GuestTransferNote({ signUp = false }: { signUp?: boolean }) {
	useEffect(() => writeTransfer(Date.now()), []);

	return (
		<Alert variant="info" className="mt-5">
			<Icon name="info" />
			<AlertDescription>
				{signUp ? (
					// A new account has no facts or Career profile of its own, so those clauses don't apply.
					<Trans>
						Your guest resumes, cover letters, applications and Career knowledge move to this account. Assistant
						conversations don't move.
					</Trans>
				) : (
					<Trans>
						Your guest resumes, cover letters, applications and Career knowledge move to this account, except facts it
						already has. Different Career profiles stop sign-in and keep your guest work. Assistant conversations don't
						move.
					</Trans>
				)}
			</AlertDescription>
		</Alert>
	);
}
