// A1 "Change server": a sheet with the address field and Check. Checking runs the health check and discovery, then
// makes it the current server; A1's server line shows the new host.
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { hostOf } from "./options";
import { toOrigin } from "@/auth/oauth";
import { chooseServer, useSession } from "@/auth/session";
import { Button, FooterBar, SheetScreen, Spinner, Text, TextField } from "@/ui";

export function ServerSheet() {
	const router = useRouter();
	const { server } = useSession();
	const [address, setAddress] = useState(hostOf(server));
	const [error, setError] = useState<string | undefined>();
	const [checking, setChecking] = useState(false);
	const close = () => (router.canGoBack() ? router.back() : router.replace("/welcome"));

	const check = async () => {
		const typed = address.trim();
		if (!typed) return setError(t`Enter an address like resume.example.org.`);
		if (/^http:\/\//i.test(typed) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(typed))
			return setError(t`This server uses http. The app needs https.`);
		const origin = toOrigin(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
		if (!origin) return setError(t`Enter an address like resume.example.org.`);
		setError(undefined);
		setChecking(true);
		try {
			if (origin !== server) await chooseServer(origin);
			close();
		} catch {
			setError(t`Couldn't reach that server. Check the address and try again.`);
		} finally {
			setChecking(false);
		}
	};

	return (
		<SheetScreen
			title={t`Change server`}
			height={360}
			keyboard
			dirty={address.trim() !== hostOf(server)}
			onClose={close}
			footer={
				<FooterBar divider={false} bg="raised" inset={false}>
					<Button
						label={checking ? t`Checking ${hostOf(address)}…` : t`Check`}
						tone="primary"
						size="lg"
						grow
						disabled={checking}
						leading={checking ? <Spinner color="onAccent" /> : undefined}
						onPress={() => void check()}
						testID="server-check"
					/>
				</FooterBar>
			}
		>
			<View style={{ paddingTop: 8, paddingHorizontal: 24, gap: 12 }}>
				<TextField
					label={t`Server address`}
					value={address}
					onChangeText={(next) => {
						setAddress(next);
						setError(undefined);
					}}
					placeholder="resume.example.org"
					keyboardType="url"
					autoCapitalize="none"
					autoCorrect={false}
					textContentType="URL"
					returnKeyType="go"
					onSubmitEditing={() => void check()}
					error={error}
					testID="server-address"
				/>
				<Text variant="ui" color="ink3">
					{t`Enter the address you open Reactive Resume at in a browser. The app checks it's a Reactive Resume server that allows app sign-in before you continue.`}
				</Text>
			</View>
		</SheetScreen>
	);
}
