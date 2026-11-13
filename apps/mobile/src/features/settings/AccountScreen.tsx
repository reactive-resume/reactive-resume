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
import { useAccount, useDataBackend, useAccountActions } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { useAuthOptions } from "@/features/auth/options";
import { ListRow, PushScreen, SectionHeading, Text, showToast } from "@/ui";

export function AccountScreen() {
	const router = useRouter();
	const { server } = useSession();
	const account = useAccount();
	const actions = useAccountActions();
	const [exporting, setExporting] = useState(false);
	const fake = useDataBackend().backend.kind === "fake";
	const security = useAccountSecurity();
	const view = useStoryboardView();
	const options = useAuthOptions();
	// Storyboard flows reach S2's states: `state=unverified` (email not verified) or `state=no-email` (no SMTP).
	const params = useLocalSearchParams<{ delete?: string; state?: string }>();
	const preset = STORYBOARD ? params.state : undefined;
	const [exportedAt, setExportedAt] = useState<Date | null>(null);
	const [deleting, setDeleting] = useState(STORYBOARD && !!params.delete);
	const web = (path: string) => () => void WebBrowser.openBrowserAsync(`${server}${path}`);
	const data = account.data;
	const canEmail = preset !== "no-email" && options.data?.flags.smtpEnabled !== false;
	const verified = preset !== "unverified" && !!data?.emailVerified;
	const exportData = () => {
		if (exporting) return;
		setExporting(true);
		void actions
			.exportEverything()
			.then(() => {
				setExportedAt(new Date());
				showToast({ message: t`Saved to Files` });
			})
			.catch(() => showToast({ message: t`Couldn't export your data. Try again.` }))
			.finally(() => setExporting(false));
	};

	return (
		<PushScreen
			title={t`Account and security`}
			overlay={
				<DeleteAccountDialog
					open={deleting}
					initialStep={params.delete === "confirm" ? "confirm" : "verify"}
					exportedAt={exportedAt}
					onExport={exportData}
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
					secondary={data && !verified ? t`Not verified yet. Resend the link` : data?.email}
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
					onPress={() => void actions.openSecurity("password")}
				/>
				<ListRow
					title={t`Two-step verification`}
					secondary={security.twoStep}
					trailing="caret"
					onPress={() => void actions.openSecurity("two-step")}
				/>
				<ListRow
					title={t`Passkeys`}
					secondary={security.passkeys}
					trailing="caret"
					onPress={() => void actions.openSecurity("passkeys")}
				/>
				<ListRow
					title={t`Connected apps`}
					secondary={security.connectedApps}
					trailing="caret"
					last
					boxHidden
					onPress={() => router.push("/settings/connections")}
				/>
			</View>
			<SectionHeading title={t`Your data`} />
			<ListRow
				title={t`Export my data`}
				secondary={t`A JSON file of everything`}
				trailing="caret"
				onPress={exportData}
			/>
			<ListRow
				title={t`Delete account`}
				danger
				last
				boxHidden
				onPress={fake ? () => setDeleting(true) : () => void actions.openSecurity("delete-account")}
			/>
		</PushScreen>
	);
}
