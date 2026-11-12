import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { authClient } from "@/libs/auth/client";
import { sessionSignInURL, useSessionRecovery } from "@/libs/auth/session-recovery";
import { sessionQueryKey } from "@/libs/root-context";

export function SessionRecovery() {
	const accountId = useSessionRecovery((state) => state.accountId);
	const queryClient = useQueryClient();
	const router = useRouter();
	const location = useLocation();

	useEffect(() => {
		if (!accountId) return;
		const generation = getAccountGeneration();
		let active = true;
		let checking = false;
		const refresh = async () => {
			if (checking || document.visibilityState !== "visible") return;
			checking = true;
			try {
				const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
				if (!active || generation !== getAccountGeneration() || accountId !== getAccountId() || error || !data) return;
				// Root's account fence clears old work before adopting a different identity; same-account work stays open.
				queryClient.setQueryData(sessionQueryKey, data);
				await router.invalidate();
				useSessionRecovery.setState({ accountId: null });
				void queryClient.invalidateQueries();
			} catch {
				// A network failure does not establish that sign-in succeeded.
			} finally {
				checking = false;
			}
		};
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			active = false;
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [accountId, queryClient, router]);

	if (!accountId || accountId !== getAccountId()) return null;
	return (
		<div
			role="alert"
			className="fixed inset-x-4 top-4 z-200 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-line bg-raised py-4 ps-5 pe-4 shadow-e3"
		>
			<p className="min-w-0 flex-1 basis-60 t-ui">
				<Trans>
					<span className="font-semibold">Your session ended.</span> Sign in again to keep working. Nothing on this page
					is lost.
				</Trans>
			</p>
			<Button
				nativeButton={false}
				render={<a href={sessionSignInURL(location.href)} target="_blank" rel="noopener noreferrer" />}
			>
				<Trans>Sign in again</Trans>
			</Button>
		</div>
	);
}
