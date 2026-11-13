import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { AuthLead, AuthTitle, authAction } from "@/features/auth/components/auth-page";
import { androidCallbackIntent } from "@/features/auth/native-callback";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/auth/native-callback")({
	head: () => ({ meta: [{ title: getPageTitle(t`Return to the app`) }] }),
	component: NativeCallbackPage,
});

function openApp() {
	// Build only at navigation time: authorization codes must never enter rendered markup.
	window.location.assign(
		/Android/i.test(navigator.userAgent) ? androidCallbackIntent(window.location.search) : window.location.href,
	);
}

function NativeCallbackPage() {
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (/Android/i.test(navigator.userAgent) && params.has("state") && (params.has("code") || params.has("error")))
			openApp();
	}, []);

	// A flag only: authorization codes must never enter rendered markup.
	const signedIn = !new URLSearchParams(window.location.search).has("error");

	return (
		<>
			<AuthTitle>
				<Trans>Return to the app</Trans>
			</AuthTitle>
			<AuthLead>
				{signedIn && (
					<>
						<Trans>You're signed in.</Trans>{" "}
					</>
				)}
				<Trans>If the app did not open, try again on a device where it is installed.</Trans>
			</AuthLead>
			<a
				href="/auth/native-callback"
				className={authAction("primary", "mt-7")}
				onClick={(event) => {
					event.preventDefault();
					openApp();
				}}
			>
				<Icon name="device-mobile" />
				<Trans>Try opening the app again</Trans>
			</a>
		</>
	);
}
