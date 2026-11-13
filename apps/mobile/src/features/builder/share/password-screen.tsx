// B12 › Password: set a password for the web page (Password and Confirm), or remove it after asking.
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useBuilderDocument, useDocumentId } from "./document";
import { useResumeStore, useSharing } from "@/data";
import { Button, Dialog, Form, PushScreen, Text, TextField, haptic, showToast } from "@/ui";

export function PasswordScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const document = useBuilderDocument(id).data;
	const sharing = useSharing(id);
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [removing, setRemoving] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const confirmRef = useRef<{ focus: () => void } | null>(null);
	const mismatch = confirm.length > 0 && confirm !== password;
	const run = async (work: () => Promise<unknown>, done: string, hasPassword: boolean) => {
		setBusy(true);
		setError("");
		try {
			await work();
			// The open draft carries the sharing state Share reads.
			const current = useResumeStore.getState().document;
			if (current?.id === id) useResumeStore.setState({ document: { ...current, hasPassword } });
			haptic("success");
			showToast({ message: done });
			router.back();
		} catch {
			setError(t`Couldn't update sharing. Try again.`);
			haptic("error");
		} finally {
			setBusy(false);
		}
	};
	return (
		<PushScreen
			title={t`Password`}
			backLabel={t`Back to Web page`}
			overlay={
				<Dialog
					open={removing}
					onClose={() => setRemoving(false)}
					title={t`Remove the password?`}
					message={t`Anyone with the link will be able to view your resume.`}
					actions={[
						{
							label: t`Remove`,
							tone: "danger",
							onPress: () => {
								setRemoving(false);
								void run(() => sharing.removePassword(), t`Password removed`, false);
							},
						},
						{ label: t`Cancel`, tone: "secondary", onPress: () => setRemoving(false) },
					]}
				/>
			}
		>
			<Form>
				<TextField
					label={t`Password`}
					value={password}
					onChangeText={setPassword}
					autoFocus
					returnKeyType="next"
					submitBehavior="submit"
					onSubmitEditing={() => confirmRef.current?.focus()}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
				/>
				<TextField
					label={t`Confirm`}
					value={confirm}
					{...({ ref: confirmRef } as object)}
					onChangeText={setConfirm}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					error={mismatch ? t`The passwords don't match.` : undefined}
				/>
				<Button
					label={t`Set password`}
					tone="primary"
					size="lg"
					block
					disabled={busy || password.length < 6 || password !== confirm}
					onPress={() => void run(() => sharing.setPassword(password), t`Password set`, true)}
				/>
				{document?.hasPassword ? (
					<Button label={t`Remove password`} tone="dangerGhost" block onPress={() => setRemoving(true)} />
				) : null}
				<Text color="ink3">{t`Visitors enter it before they see the page. At least 6 characters.`}</Text>
				{error ? (
					<View accessibilityRole="alert">
						<Text color="dangerText">{error}</Text>
					</View>
				) : null}
			</Form>
		</PushScreen>
	);
}
