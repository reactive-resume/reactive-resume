import type { ApplicationPacket } from "@reactive-resume/schema/applications/autofill";
import type WebViewType from "react-native-webview";
import { useLingui } from "@lingui/react/macro";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import WebView from "react-native-webview";
import { formFillReportSchema, packetFillPlan } from "@reactive-resume/schema/applications/autofill";
import { formFillInvocation } from "@reactive-resume/utils/form-fill";
import { CheckRow } from "./parts";
import { Button, Sheet, Text, useTheme } from "@/ui";

type PacketBrowserProps = { packet: ApplicationPacket; onClose: () => void };
// WebView 14's declaration defaults its extra props to undefined, which intersects to never under strict null checks.
type BrowserExtraProps = Record<never, never>;
export function PacketBrowser({ packet, onClose }: PacketBrowserProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const browser = useRef<WebViewType<BrowserExtraProps>>(null);
	const pending = useRef<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const current = useRef(packet.review.selection.targetUrl);
	const serial = useRef(0);
	const [url, setUrl] = useState(packet.review.selection.targetUrl);
	const [ready, setReady] = useState(false);
	const [approved, setApproved] = useState(false);
	const [message, setMessage] = useState("");
	const [report, setReport] = useState<ReturnType<typeof formFillReportSchema.parse> | null>(null);
	const plan = packetFillPlan(packet);
	const invalidate = () => {
		if (timer.current) clearTimeout(timer.current);
		pending.current = null;
		setApproved(false);
		setReady(false);
		setReport(null);
	};
	const fill = () => {
		if (!plan || !approved || !ready || current.current !== plan.targetUrl) return;
		const request = String(++serial.current);
		pending.current = request;
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (pending.current === request) {
				pending.current = null;
				setMessage(t`No page report received. Verify values and attachments manually before submitting yourself.`);
			}
		}, 15000);
		setApproved(false);
		setMessage(t`Filling this page only. Review every value and attachment yourself.`);
		browser.current?.injectJavaScript(formFillInvocation(plan, request));
	};
	const statuses = { filled: t`Filled`, skipped: t`Skipped`, manual: t`Manual`, error: t`Error` };
	return (
		<Sheet open onClose={onClose} title={t`Employer form prototype`} detents={[0.95]} scroll={false}>
			<View style={{ flex: 1, minHeight: 500, gap: space.s2 }}>
				<Text selectable variant="caption">
					{url}
				</Text>
				<Text variant="caption">{t`Experimental native-control subset. No automatic submission. Account/captcha, framework controls and additional pages are manual. External-browser sessions are separate.`}</Text>
				{(!plan || url !== packet.review.selection.targetUrl) && (
					<Text accessibilityRole="alert">{t`This page is not the reviewed destination. Return to packet review with its exact URL, or complete it manually. Nothing will be filled.`}</Text>
				)}
				<CheckRow
					label={t`I approve filling this exact page with my reviewed packet.`}
					checked={approved}
					disabled={!ready || !plan || url !== packet.review.selection.targetUrl}
					onChange={setApproved}
				/>
				<Button
					label={t`Fill this page`}
					disabled={!approved || !ready || !plan || url !== packet.review.selection.targetUrl}
					onPress={fill}
				/>
				{message && <Text accessibilityLiveRegion="polite">{message}</Text>}
				{report && (
					<ScrollView style={{ maxHeight: 180 }}>
						<Text selectable>
							{report.results
								.map((result) => `${result.field}: ${statuses[result.status]} · ${result.source}\n${result.detail}`)
								.join("\n")}
						</Text>
						<Text>{t`Page report is unverified. Check values and file names on the form. Errors need exact approved downloads; skipped entries stay unchanged. Submit yourself only when ready.`}</Text>
					</ScrollView>
				)}
				<WebView<BrowserExtraProps>
					ref={browser}
					source={{ uri: packet.review.selection.targetUrl }}
					style={{ flex: 1, minHeight: 250 }}
					incognito
					sharedCookiesEnabled={false}
					thirdPartyCookiesEnabled={false}
					allowFileAccess={false}
					allowFileAccessFromFileURLs={false}
					allowUniversalAccessFromFileURLs={false}
					javaScriptCanOpenWindowsAutomatically={false}
					setSupportMultipleWindows={false}
					onShouldStartLoadWithRequest={(request) =>
						request.url.startsWith("https://") ||
						/^http:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::\d+)?\//.test(request.url)
					}
					onLoadStart={invalidate}
					onLoadEnd={() => setReady(true)}
					onNavigationStateChange={(event) => {
						if (current.current !== event.url) {
							invalidate();
							current.current = event.url;
							setUrl(event.url);
						}
					}}
					onError={() => {
						invalidate();
						setMessage(t`Form could not be loaded. Use the external browser and manual downloads instead.`);
					}}
					onMessage={(event) => {
						if (
							!pending.current ||
							// Android's WebMessageListener reports an origin; iOS reports the full frame URL.
							(event.nativeEvent.url !== current.current &&
								event.nativeEvent.url !== new URL(current.current).origin) ||
							current.current !== packet.review.selection.targetUrl ||
							event.nativeEvent.data.length > 200000
						)
							return;
						try {
							const response: unknown = JSON.parse(event.nativeEvent.data);
							if (
								!response ||
								typeof response !== "object" ||
								!("requestId" in response) ||
								response.requestId !== pending.current
							)
								return;
							pending.current = null;
							if (timer.current) clearTimeout(timer.current);
							if (!("report" in response)) {
								setMessage(t`Filling failed. Complete the form manually with exact approved downloads.`);
								return;
							}
							const parsed = formFillReportSchema.parse(response.report);
							if (parsed.targetUrl !== current.current) return;
							setReport(parsed);
							setMessage(t`Fill attempt finished. Nothing submitted or marked as sent.`);
						} catch {
							pending.current = null;
							setMessage(t`Invalid page report. Verify and complete the form manually.`);
						}
					}}
				/>
				<Button
					variant="link"
					label={t`Open in external browser for manual completion`}
					onPress={() =>
						void openBrowserAsync(url).catch(() => setMessage(t`Could not open the browser. Copy the URL instead.`))
					}
				/>
			</View>
		</Sheet>
	);
}
