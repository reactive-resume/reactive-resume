// A3 · Two-step verification: six boxes and nothing else; it submits by itself on the sixth digit. The boxes are one
// field for VoiceOver and TalkBack ("Code, 6 digits") with one-time-code autofill and paste. A wrong code clears the
// boxes, shakes them once (d2) and plays `error`; an accepted one plays `success`.
import { useLingui } from "@lingui/react/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { takePendingLink } from "./pending-link";
import { verifySecondStep } from "./two-step";
import { useDataBackend } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { Button, CodeBoxes, Form, PushScreen, Text, TextField, Touch, haptic, hitSlopFor, shake } from "@/ui";

const LENGTH = 6;

export function TwoStepScreen() {
	const { t } = useLingui();
	const router = useRouter();
	const { backend } = useDataBackend();
	const params = useLocalSearchParams<{ code?: string }>();
	const [code, setCode] = useState(STORYBOARD ? (params.code ?? "") : "");
	const [focused, setFocused] = useState(STORYBOARD);
	const [backup, setBackup] = useState(false);
	const [backupCode, setBackupCode] = useState("");
	const [error, setError] = useState<string | undefined>();
	const x = useSharedValue(0);
	const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

	const verify = (value: string) => {
		const result = verifySecondStep(value, { fake: backend.kind === "fake", backup });
		if (result === "accepted") {
			haptic("success");
			router.replace(takePendingLink() as never);
			return;
		}
		if (result === "expired") {
			setError(t`This sign-in step expired. Sign in again.`);
			router.replace("/sign-in");
			return;
		}
		const message =
			result === "limited"
				? t`Too many attempts. Wait a moment, then try again.`
				: backup
					? t`Couldn't verify your backup code. Check the code and try again.`
					: t`That code doesn't match. Check it and try again.`;
		setError(message);
		setCode("");
		haptic("error");
		shake(x, 1);
		AccessibilityInfo.announceForAccessibility(message);
	};

	const change = (next: string) => {
		const digits = next.replace(/\D/g, "").slice(0, LENGTH);
		setCode(digits);
		setError(undefined);
		if (digits.length === LENGTH) void verify(digits);
	};

	return (
		<PushScreen
			title={t`Enter the code`}
			subtitle={backup ? t`Enter one of your saved backup codes.` : t`From your authenticator app.`}
		>
			{backup ? (
				<Form>
					<TextField
						label={t`Backup code`}
						value={backupCode}
						onChangeText={(next) => {
							setBackupCode(next);
							setError(undefined);
						}}
						autoCapitalize="none"
						autoCorrect={false}
						autoFocus
						returnKeyType="go"
						onSubmitEditing={() => (backupCode.trim() ? void verify(backupCode.trim()) : null)}
						error={error}
					/>
					<Button
						label={t`Verify`}
						tone="primary"
						size="lg"
						block
						disabled={!backupCode.trim()}
						onPress={() => void verify(backupCode.trim())}
					/>
				</Form>
			) : (
				<View style={{ paddingTop: 32, paddingHorizontal: 24, gap: 8 }}>
					<Animated.View style={shaking}>
						<CodeBoxes
							value={code}
							length={LENGTH}
							focusedIndex={focused ? Math.min(code.length, LENGTH - 1) : undefined}
							error={!!error}
						/>
						<TextInput
							value={code}
							onChangeText={change}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(STORYBOARD)}
							autoFocus={!STORYBOARD}
							keyboardType="number-pad"
							textContentType="oneTimeCode"
							autoComplete="one-time-code"
							maxLength={LENGTH}
							caretHidden
							contextMenuHidden={false}
							accessibilityLabel={t`Code, 6 digits`}
							style={styles.capture}
							testID="two-step-code"
						/>
					</Animated.View>
					{error ? (
						<Text variant="caption" weight={400} color="dangerText" accessibilityLiveRegion="polite">
							{error}
						</Text>
					) : null}
				</View>
			)}
			<Touch
				onPress={() => {
					setBackup((v) => !v);
					setError(undefined);
				}}
				accessibilityRole="link"
				accessibilityLabel={backup ? t`Use the authenticator app instead` : t`Use a backup code instead`}
				hitSlop={hitSlopFor(181, 44)}
				style={{
					alignSelf: "flex-start",
					marginTop: error && !backup ? 12 : 20,
					marginHorizontal: 24,
					paddingVertical: 12,
				}}
			>
				<Text variant="textLink" color="accentText">
					{backup ? t`Use the authenticator app instead` : t`Use a backup code instead`}
				</Text>
			</Touch>
		</PushScreen>
	);
}

// The real input sits over the boxes, invisible, so taps, paste and one-time-code autofill land in it.
const styles = StyleSheet.create({
	capture: { ...StyleSheet.absoluteFill, opacity: 0.02, color: "transparent" },
});
