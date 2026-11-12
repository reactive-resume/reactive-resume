// P1 · feedback link (`/feedback/{token}`): the states a link that doesn't open shows, with the web's guidance copy.
// An open link's review page (resume, comments, progress) is the web's; the app hands it to the browser.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { getServer } from "@/auth/session";
import { useFeedbackView } from "@/data";
import { Button, Icon, PushScreen, Spinner, Text } from "@/ui";

export type FeedbackUnavailable = "revoked" | "expired" | "missing";

/** The server answers 404 with `data.reason` for a link that was turned off or expired; anything else is missing. */
export function unavailableReason(error: unknown): FeedbackUnavailable {
	const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason;
	return reason === "revoked" || reason === "expired" ? reason : "missing";
}

export function FeedbackLinkScreen() {
	const { token } = useLocalSearchParams<{ token: string }>();
	const router = useRouter();
	const view = useFeedbackView(token);
	const url = `${getServer()}/feedback/${encodeURIComponent(token)}`;
	const reason = view.isError ? unavailableReason(view.error) : null;
	return (
		<PushScreen title={t`Feedback link`}>
			<View style={{ padding: 24, gap: 12, alignItems: "center" }} accessibilityLiveRegion="polite">
				{view.isPending ? (
					<Spinner size={24} color="ink3" />
				) : reason ? (
					<>
						<Icon name="link-simple" size={28} color="ink3" />
						<Text variant="sheetTitle" style={{ textAlign: "center" }}>
							{reason === "revoked"
								? t`This link was turned off`
								: reason === "expired"
									? t`This link has expired`
									: t`This link doesn't open`}
						</Text>
						<Text variant="body" color="ink2" style={{ textAlign: "center" }}>
							{reason === "missing"
								? t`Check that you copied the whole link, or ask the person who sent it for a new one.`
								: t`Ask the person who sent it for a new link. Comments you left are still with them.`}
						</Text>
						<Button label={t`Go to Reactive Resume`} onPress={() => router.replace("/")} />
					</>
				) : (
					<>
						<Text variant="body" color="ink2" style={{ textAlign: "center" }}>
							{t`Feedback pages open in your browser.`}
						</Text>
						<Button
							label={t`Open feedback page`}
							tone="primary"
							onPress={() => void WebBrowser.openBrowserAsync(url)}
						/>
					</>
				)}
			</View>
		</PushScreen>
	);
}
