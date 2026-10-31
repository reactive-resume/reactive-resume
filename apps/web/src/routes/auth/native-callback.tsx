import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { androidCallbackIntent } from "@/features/auth/native-callback";

export const Route = createFileRoute("/auth/native-callback")({
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

	return (
		<div className="space-y-4 text-center">
			<h1 className="text-[30px] leading-9">
				<Trans>Open the Reactive Resume app</Trans>
			</h1>
			<p className="text-muted-foreground text-sm">
				<Trans>If the app did not open, try again on a device where it is installed.</Trans>
			</p>
			<a
				href="/auth/native-callback"
				className="inline-flex min-h-11 items-center underline underline-offset-4"
				onClick={(event) => {
					event.preventDefault();
					openApp();
				}}
			>
				<Trans>Try opening the app again</Trans>
			</a>
		</div>
	);
}
