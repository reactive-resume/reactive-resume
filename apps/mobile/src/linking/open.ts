import { t } from "@lingui/core/macro";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import { createSerialQueue } from "@reactive-resume/utils/queue";
import { parseDeepLink } from "./parse";
import { getAccessToken, getServer, restoreSession, signIn } from "@/auth/session";
import { initI18n } from "@/i18n";

// Native intents run outside React, before a cold-start navigator exists. A system dialog works there too.
function confirm(title: string, message: string, action: string): Promise<boolean> {
	return new Promise((resolve) => {
		Alert.alert(
			title,
			message,
			[
				{ text: t`Cancel`, style: "cancel", onPress: () => resolve(false) },
				{ text: action, onPress: () => resolve(true) },
			],
			{ cancelable: true, onDismiss: () => resolve(false) },
		);
	});
}

const queue = createSerialQueue();

async function browserFallback(path: string, fallback: string | null): Promise<string | null> {
	// A browser tab avoids dispatching a rejected App Link straight back to this app via Linking.openURL.
	if (/^https:\/\//i.test(path)) await WebBrowser.openBrowserAsync(path).catch(() => undefined);
	return fallback;
}

/** Expo calls this for cold and warm links; callbacks must bypass even an in-flight sign-in. */
export function redirectSystemPath({
	path,
	initial,
}: {
	path: string;
	initial: boolean;
}): Promise<string | null> | string {
	if (/^me\.rxresu:\/\/\/?expo-sharing\/?$/.test(path)) return initial ? "/" : Promise.resolve(null);
	const immediate = parseDeepLink(path, getServer());
	if (immediate?.kind === "callback") return path;
	if (immediate?.kind === "root") return "/";
	const fallback = initial ? "/" : null;
	return queue(async () => {
		try {
			// One shared restore: a warm link that lands during launch waits for it instead of reading a half-loaded server.
			await restoreSession();
			await initI18n();
			const current = getServer();
			// The allowlist depends on the restored/current session, not the session when the intent was queued.
			const link = parseDeepLink(path, current);
			if (!link || link.kind !== "target") return browserFallback(path, fallback);
			const server = link.server ?? current;
			if (server !== current) {
				if (
					!(await confirm(
						t`Switch server?`,
						t`This link opens ${server}. Sign in there to continue. Your current server is ${current}.`,
						t`Switch server`,
					))
				)
					return fallback;
			} else if (await getAccessToken()) {
				return getServer() === server ? link.href : browserFallback(path, fallback);
			} else if (
				!(await confirm(
					t`Sign in to open this link`,
					t`Sign in to ${server}, then continue to the linked document.`,
					t`Sign in`,
				))
			) {
				return fallback;
			}
			// signIn commits server and tokens together; cancelled/failed sign-in leaves the old account untouched.
			for (;;) {
				try {
					if (!parseDeepLink(path, getServer())) return browserFallback(path, fallback);
					if (!(await signIn(server))) return fallback;
					return getServer() === server ? link.href : browserFallback(path, fallback);
				} catch {
					if (!(await confirm(t`Sign-in didn't complete`, t`Try signing in again to open this link.`, t`Try again`)))
						return fallback;
				}
			}
		} catch {
			// No raw URL/error is logged or displayed: it may contain private query data.
			return browserFallback(path, fallback);
		}
	});
}
