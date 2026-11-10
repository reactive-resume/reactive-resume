// A4 · Connect an application: who is asking, what it gets in plain rows (from the requested scopes, nothing hidden)
// and how to undo it. Deny and Allow share the width; Allow is the accent and plays `success`.
//
// The grant itself is Better Auth's signed consent request, which needs the browser session: on a real server both
// buttons finish on the server's consent page in the system browser (a native consent call is a reported gap).
import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { type ConsentRequest, parseConsentRequest } from "./consent-request";
import { useSession } from "@/auth/session";
import { useAccount, useDataBackend } from "@/data";
import { useStoryboardView } from "@/features/settings/storyboard-view";
import {
	Button,
	FooterBar,
	Icon,
	IconTile,
	ListRow,
	Logo,
	PageSubtitle,
	PageTitle,
	PushScreen,
	SectionHeading,
	Spinner,
	Text,
	haptic,
} from "@/ui";

export function ConsentScreen() {
	const { t } = useLingui();
	const router = useRouter();
	const { server } = useSession();
	const { backend } = useDataBackend();
	const account = useAccount();
	const view = useStoryboardView();
	const params = useLocalSearchParams<Record<string, string>>();
	const fake = backend.kind === "fake";
	const request: ConsentRequest | null = parseConsentRequest(params, fake);
	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

	const answer = async (accept: boolean) => {
		if (!request) return close();
		if (!fake) await WebBrowser.openBrowserAsync(`${server}/auth/consent?${request.query}`);
		if (accept && fake) haptic("success");
		close();
	};

	if (!request)
		return (
			<PushScreen back="close" title={t`Connect an application`}>
				<PageSubtitle>
					{t`This connection request is invalid or has expired. Start the connection again from your client.`}
				</PageSubtitle>
			</PushScreen>
		);

	if (account.isPending && !fake)
		return (
			<PushScreen back="close">
				<View style={{ padding: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Spinner />
					<Text variant="ui" color="ink3">
						{t`Loading connection request…`}
					</Text>
				</View>
			</PushScreen>
		);

	const who = view?.username ?? account.data?.username ?? account.data?.email ?? "";
	const rows = [
		request.scopes.has("api:read")
			? { icon: "eye" as const, text: t`See your resumes, letters and applications` }
			: null,
		request.scopes.has("api:write") ? { icon: "pencil-simple" as const, text: t`Change them` } : null,
		request.scopes.has("api:delete") ? { icon: "trash" as const, text: t`Move them to the trash` } : null,
		!request.scopes.has("api:read") && request.scopes.has("profile")
			? { icon: "user-circle" as const, text: t`Read your profile information.` }
			: null,
		!request.scopes.has("api:read") && request.scopes.has("email")
			? { icon: "envelope-simple" as const, text: t`Read your email address.` }
			: null,
	].filter((row) => row !== null);

	return (
		<PushScreen
			back="close"
			footer={
				<FooterBar>
					<Button label={t`Deny`} size="lg" grow onPress={() => void answer(false)} />
					<Button
						label={t`Allow`}
						tone="primary"
						size="lg"
						grow
						onPress={() => void answer(true)}
						testID="consent-allow"
					/>
				</FooterBar>
			}
		>
			<View style={{ paddingTop: 16, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 12 }}>
				<IconTile size={56}>
					<Logo size={32} />
				</IconTile>
				<Icon name="arrows-left-right" size={24} color="ink3" />
				<IconTile size={56} accent>
					<Icon name="sparkle" size={22} color="accentText" />
				</IconTile>
			</View>
			<View style={{ paddingTop: 20 }}>
				<PageTitle>{t`Allow ${request.clientName} to use your Reactive Resume?`}</PageTitle>
			</View>
			<PageSubtitle status>{t`${request.destination} · signed in as ${who}`}</PageSubtitle>
			<SectionHeading title={t`It will be able to`} />
			{rows.map((row, i) => (
				<ListRow
					key={row.text}
					title={row.text}
					wrapTitle
					leading={<IconTile icon={row.icon} />}
					last={i === rows.length - 1}
					boxHidden={i === rows.length - 1}
				/>
			))}
			<View style={{ paddingTop: 16, paddingHorizontal: 24 }}>
				<Text variant="ui" color="ink3">
					{t`You can disconnect it at any time in Settings › Account › Connected apps.`}
				</Text>
			</View>
		</PushScreen>
	);
}
