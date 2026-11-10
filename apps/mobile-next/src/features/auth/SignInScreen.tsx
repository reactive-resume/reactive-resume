// A2 · Sign in, also create account (register) and reset (forgot password). Email and password, one primary button,
// then the other ways in that the server reports as equal secondary buttons. A failed sign-in plays `error` and the
// form shakes 4 dp twice (d2); reduced motion: no shake.
//
// The app signs in through OAuth 2.1 + PKCE in the system browser (src/auth): the server's own pages take the
// password, passkey, provider and two-step steps. Until a native credential exchange exists (reported), every button
// here starts that browser sign-in.
import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InlineLink } from "./InlineLink";
import { type SignInMethod, signInMethods, useAuthOptions } from "./options";
import { signInErrorMessage } from "@/auth/messages";
import { signIn, useSession } from "@/auth/session";
import { useDataBackend } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	Form,
	type IconName,
	PushScreen,
	Spinner,
	Text,
	TextField,
	Touch,
	haptic,
	hitSlopFor,
	shake,
} from "@/ui";

export type SignInMode = "sign-in" | "register" | "reset";

const methodIcon: Record<SignInMethod, IconName> = {
	passkey: "fingerprint",
	google: "google-logo",
	github: "github-logo",
	linkedin: "linkedin-logo",
	custom: "key",
	apple: "apple-logo",
};

export function SignInScreen({ mode }: { mode: SignInMode }) {
	const { t, i18n } = useLingui();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { server } = useSession();
	const { backend } = useDataBackend();
	const options = useAuthOptions();
	const params = useLocalSearchParams<{ email?: string; filled?: string }>();
	// Storyboard captures draw the form as filled in (A2-SignIn).
	const filled = STORYBOARD && params.filled === "1";
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState(params.email ?? "");
	const [password, setPassword] = useState(filled ? "storyboard" : "");
	const [reveal, setReveal] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const x = useSharedValue(0);
	const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

	const flags = options.data?.flags;
	const providers = options.data?.providers ?? {};
	const emailAuth = !flags?.disableEmailAuth;
	const methods = mode === "reset" ? [] : signInMethods(providers, mode === "register" ? "register" : "sign-in");

	const fail = (message: string) => {
		setError(message);
		haptic("error");
		shake(x);
	};

	const browserSignIn = async () => {
		setError(undefined);
		setBusy(true);
		try {
			const done = await signIn(server);
			if (!done) return;
			// The storyboard server asks for the second step in the app (A3); a real server asks for it in the browser.
			if (backend.kind === "fake" && mode === "sign-in") router.push("/two-step");
			else router.replace("/");
		} catch (failure) {
			fail(signInErrorMessage(i18n, failure));
		} finally {
			setBusy(false);
		}
	};

	const submit = () => {
		if (mode === "reset") return void sendReset();
		if (!email.trim())
			return fail(mode === "register" ? t`Enter a valid email address.` : t`Enter your email or username.`);
		if (!password) return fail(t`Enter your password.`);
		if (mode === "register" && !name.trim()) return fail(t`Enter your name.`);
		if (mode === "register" && password.length < 8) return fail(t`Use at least 8 characters.`);
		void browserSignIn();
	};

	const sendReset = async () => {
		if (!/^\S+@\S+\.\S+$/.test(email.trim())) return fail(t`Enter a valid email address.`);
		setError(undefined);
		if (backend.kind !== "fake") await WebBrowser.openBrowserAsync(`${server}/auth/forgot-password`);
		setSent(true);
	};

	const title = mode === "register" ? t`Start your resume` : mode === "reset" ? t`Forgot your password?` : t`Sign in`;
	const primary = mode === "register" ? t`Sign up` : mode === "reset" ? t`Send reset link` : t`Sign in`;

	const footer =
		mode === "reset" ? null : (
			<View style={{ paddingTop: 12, paddingBottom: 12 + insets.bottom, paddingHorizontal: 24 }}>
				{mode === "register" ? (
					<InlineLink
						lead={t`Already have an account?`}
						link={t`Sign in now`}
						onPress={() => router.replace("/sign-in")}
					/>
				) : flags?.disableSignups ? null : (
					<InlineLink lead={t`New here?`} link={t`Create an account`} onPress={() => router.push("/register")} />
				)}
			</View>
		);

	if (mode === "reset" && sent)
		return (
			<PushScreen
				title={t`Check your email`}
				subtitle={t`If an account uses that address, a reset link is on its way.`}
			>
				<View style={{ paddingTop: 24, paddingHorizontal: 24, gap: 12 }}>
					<Button label={t`Back to sign in`} size="lg" block onPress={() => router.replace("/sign-in")} />
					<Button label={t`Send again`} tone="ghost" size="lg" block onPress={() => void sendReset()} />
				</View>
			</PushScreen>
		);

	return (
		<PushScreen title={title} footer={footer}>
			<Animated.View style={shaking}>
				{emailAuth ? (
					<Form>
						{mode === "register" ? (
							<>
								<TextField
									label={t`Name`}
									value={name}
									onChangeText={setName}
									autoComplete="name"
									textContentType="name"
									returnKeyType="next"
								/>
								<TextField
									label={t`Username`}
									value={username}
									onChangeText={setUsername}
									placeholder="john.doe"
									autoCapitalize="none"
									autoCorrect={false}
									autoComplete="username-new"
									textContentType="username"
									returnKeyType="next"
								/>
							</>
						) : null}
						<TextField
							label={mode === "sign-in" ? t`Email or username` : t`Email address`}
							value={email}
							onChangeText={(next) => {
								setEmail(next);
								setError(undefined);
							}}
							placeholder={mode === "sign-in" ? undefined : "john.doe@example.com"}
							keyboardType="email-address"
							autoCapitalize="none"
							autoCorrect={false}
							autoComplete={mode === "sign-in" ? "username" : "email"}
							textContentType={mode === "sign-in" ? "username" : "emailAddress"}
							returnKeyType={mode === "reset" ? "send" : "next"}
							onSubmitEditing={mode === "reset" ? submit : undefined}
							submitBehavior={mode === "reset" ? "blurAndSubmit" : "submit"}
							error={mode === "reset" ? error : undefined}
						/>
						{mode === "reset" ? null : (
							<TextField
								label={t`Password`}
								value={password}
								onChangeText={(next) => {
									setPassword(next);
									setError(undefined);
								}}
								secureTextEntry={!reveal}
								trailingIcon={reveal ? "eye-slash" : "eye"}
								trailingLabel={reveal ? t`Hide password` : t`Show password`}
								onTrailingPress={() => setReveal((v) => !v)}
								autoCapitalize="none"
								autoCorrect={false}
								autoComplete={mode === "register" ? "new-password" : "current-password"}
								textContentType={mode === "register" ? "newPassword" : "password"}
								returnKeyType="go"
								onSubmitEditing={submit}
								error={error}
							/>
						)}
						<Button
							label={primary}
							tone="primary"
							size="lg"
							block
							disabled={busy}
							leading={busy ? <Spinner color="onAccent" /> : undefined}
							onPress={submit}
							testID="sign-in-submit"
						/>
					</Form>
				) : error ? (
					<Text
						variant="ui"
						color="dangerText"
						accessibilityRole="alert"
						style={{ paddingTop: 24, paddingHorizontal: 24 }}
					>
						{error}
					</Text>
				) : null}
				{mode === "sign-in" && emailAuth ? (
					<Touch
						onPress={() => router.push("/forgot-password")}
						accessibilityRole="link"
						accessibilityLabel={t`Forgot password?`}
						hitSlop={hitSlopFor(122, 44)}
						style={{ alignSelf: "center", marginTop: 12, paddingVertical: 12 }}
					>
						<Text variant="textLink" color="accentText">
							{t`Forgot password?`}
						</Text>
					</Touch>
				) : null}
				{methods.length > 0 ? (
					<View style={{ paddingTop: 12, paddingHorizontal: 24, gap: 12 }}>
						{emailAuth ? (
							<Text variant="ui" color="ink3" align="center">
								{t`or`}
							</Text>
						) : null}
						{methods.map((method) => (
							<Button
								key={method}
								label={
									method === "passkey"
										? t`Use a passkey`
										: method === "google"
											? t`Continue with Google`
											: method === "github"
												? t`Continue with GitHub`
												: method === "linkedin"
													? t`Continue with LinkedIn`
													: method === "apple"
														? t`Continue with Apple`
														: t`Continue with ${providers.custom ?? ""}`
								}
								icon={methodIcon[method]}
								size="lg"
								block
								disabled={busy}
								onPress={() => void browserSignIn()}
							/>
						))}
					</View>
				) : null}
			</Animated.View>
		</PushScreen>
	);
}
