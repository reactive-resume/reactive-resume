// S2 · Account and security: one row per credential with its current state, then Your data. Changing a credential
// finishes on the server's settings page in the system browser until the one-form screens have routes (reported).
// Delete account is last, in danger text: it re-verifies first, then a dialog says what goes and offers an export.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { useAccountSecurity } from "./security";
import { useStoryboardView } from "./storyboard-view";
import { useSession } from "@/auth/session";
import { useAccount, useDataBackend } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { useAuthOptions } from "@/features/auth/options";
import { ListRow, PushScreen, SectionHeading, Text, showToast } from "@/ui";

export function AccountScreen() {
	const router = useRouter();
	const { server } = useSession();
	const account = useAccount();
	const fake = useDataBackend().backend.kind === "fake";
	const security = useAccountSecurity();
	const view = useStoryboardView();
	const options = useAuthOptions();
	const params = useLocalSearchParams<{ delete?: string }>();
	const [deleting, setDeleting] = useState(STORYBOARD && !!params.delete);
	const web = (path: string) => () => void WebBrowser.openBrowserAsync(`${server}${path}`);
	const data = account.data;
	const canEmail = options.data?.flags.smtpEnabled !== false;

	return (
		<PushScreen
			title={t`Account and security`}
			overlay={
				<DeleteAccountDialog
					open={deleting}
					initialStep={params.delete === "confirm" ? "confirm" : "verify"}
					onClose={() => setDeleting(false)}
					onDeleted={() => {
						setDeleting(false);
						if (router.canDismiss()) router.dismissAll();
						router.replace("/welcome");
					}}
				/>
			}
		>
			<View style={{ marginTop: 20 }}>
				<ListRow
					title={t`Email`}
					secondary={data && !data.emailVerified ? t`Not verified yet. Resend the link` : data?.email}
					trailing="caret"
					top
					onPress={web("/dashboard/settings/account")}
				/>
				{canEmail ? null : (
					<Text variant="ui" color="ink3" style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
						{t`This server can't send email, so the address can't be changed here. Ask the person who runs it.`}
					</Text>
				)}
				<ListRow
					title={t`Username`}
					secondary={data ? t`${view?.username ?? data.username} · used in your public links` : undefined}
					trailing="caret"
					onPress={web("/dashboard/settings/account")}
				/>
				<ListRow
					title={t`Password`}
					secondary={security.password}
					trailing="caret"
					onPress={web("/dashboard/settings/authentication")}
				/>
				<ListRow
					title={t`Two-step verification`}
					secondary={security.twoStep}
					trailing="caret"
					onPress={web("/dashboard/settings/authentication")}
				/>
				<ListRow
					title={t`Passkeys`}
					secondary={security.passkeys}
					trailing="caret"
					onPress={web("/dashboard/settings/authentication")}
				/>
				<ListRow
					title={t`Connected apps`}
					secondary={security.connectedApps}
					trailing="caret"
					last
					boxHidden
					onPress={web("/dashboard/settings/integrations")}
				/>
			</View>
			<SectionHeading title={t`Your data`} />
			<ListRow
				title={t`Export my data`}
				secondary={t`A JSON file of everything`}
				trailing="caret"
				onPress={
					fake ? () => showToast({ message: t`We'll email you when it's ready` }) : web("/dashboard/settings/account")
				}
			/>
			<ListRow
				title={t`Delete account`}
				danger
				last
				boxHidden
				onPress={fake ? () => setDeleting(true) : web("/dashboard/settings/account")}
			/>
		</PushScreen>
	);
}
