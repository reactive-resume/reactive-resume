// S2 Delete account: first re-verify with the password or a passkey, then a dialog that says what goes and whether an
// export is ready, with a danger "Delete account permanently" (no hold, no timer). `warning` plays when the delete
// lands. Deleting never waits on an export and never claims one exists when it doesn't.
//
// Re-verification and deletion are Better Auth session calls the app can't make with its tokens yet (reported): on a
// real server the confirm finishes on the server's account page in the system browser.
import { t } from "@lingui/core/macro";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { signOut, useSession } from "@/auth/session";
import { useDataBackend } from "@/data";
import { Dialog, TextField, haptic } from "@/ui";

export function DeleteAccountDialog({
	open,
	initialStep = "verify",
	onClose,
	onDeleted,
	exportedAt = null,
	onExport,
}: {
	/** When this session last saved Export everything; the dialog never claims an export it hasn't seen. */
	exportedAt?: Date | null;
	onExport?: () => void;
	open: boolean;
	initialStep?: "verify" | "confirm";
	onClose: () => void;
	onDeleted: () => void;
}) {
	const { server } = useSession();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const exportedTime = exportedAt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	const [step, setStep] = useState<"verify" | "confirm">(initialStep);
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | undefined>();

	const close = () => {
		setStep(initialStep);
		setPassword("");
		setError(undefined);
		onClose();
	};

	const verify = () => {
		if (!password) return setError(t`Enter your password.`);
		setError(undefined);
		setStep("confirm");
	};

	const remove = async () => {
		if (!fake) {
			await WebBrowser.openBrowserAsync(`${server}/dashboard/settings/account`);
			return close();
		}
		haptic("warning");
		await signOut({ discard: true });
		onDeleted();
	};

	if (step === "verify")
		return (
			<Dialog
				open={open}
				onClose={close}
				title={t`Confirm it's you`}
				message={t`Enter your password or use a passkey before you delete your account.`}
				actions={[
					{ label: t`Continue`, tone: "primary", onPress: verify },
					{ label: t`Use a passkey`, tone: "secondary", onPress: () => setStep("confirm") },
					{ label: t`Cancel`, tone: "secondary", onPress: close },
				]}
			>
				<View style={{ marginTop: 4 }}>
					<TextField
						label={t`Password`}
						value={password}
						onChangeText={(next) => {
							setPassword(next);
							setError(undefined);
						}}
						secureTextEntry
						autoComplete="current-password"
						textContentType="password"
						returnKeyType="go"
						onSubmitEditing={verify}
						error={error}
					/>
				</View>
			</Dialog>
		);

	return (
		<Dialog
			open={open}
			onClose={close}
			title={t`Delete your account?`}
			message={t`This deletes your documents, applications, career knowledge and public pages from ${new URL(server).host}. It can't be undone.`}
			count={{
				icon: "download-simple",
				text: exportedTime ? t`Export saved to Files at ${exportedTime}` : t`No export yet · Export first`,
			}}
			actions={[
				{ label: t`Cancel`, tone: "primary", onPress: close },
				{
					label: t`Export everything first`,
					tone: "secondary",
					onPress: () =>
						onExport ? onExport() : void WebBrowser.openBrowserAsync(`${server}/dashboard/settings/account`),
				},
				{ label: t`Delete account permanently`, tone: "danger", onPress: () => void remove() },
			]}
		/>
	);
}
