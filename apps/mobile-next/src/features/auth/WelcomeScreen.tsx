// A1 · Welcome: the promise, two buttons and the server line. Logo, title and buttons fade up once, 80 ms apart.
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf, useAuthOptions } from "./options";
import { continueAsGuest, useSession } from "@/auth/session";
import { Button, InlineLink, Logo, motion, Screen, Text, Touch, hitSlopFor, useFadeUp } from "@/ui";

export function WelcomeScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { server } = useSession();
	const options = useAuthOptions();
	const [guestError, setGuestError] = useState<string | null>(null);
	const step = (i: number) => ({ ms: motion.d3, delay: motion.stagger.welcome * i });
	const logo = useFadeUp(step(0));
	const title = useFadeUp(step(1));
	const actions = useFadeUp(step(2));
	const signUps = !options.data?.flags.disableSignups;

	const guest = () =>
		continueAsGuest()
			.then(() => router.replace("/"))
			.catch(() => setGuestError(t`Couldn't continue as a guest. Try again.`));

	return (
		<Screen>
			<View
				style={{
					flex: 1,
					justifyContent: "space-between",
					paddingTop: insets.top + 24,
					paddingHorizontal: 24,
					paddingBottom: insets.bottom + 8,
				}}
			>
				<Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 24 }, logo]}>
					<Logo size={28} />
					<Text variant="topBarTitle" weight={600} style={{ fontSize: 16 }}>
						Reactive Resume
					</Text>
				</Animated.View>
				<Animated.View style={title}>
					<Text variant="bigNumber" accessibilityRole="header" style={{ letterSpacing: -0.4 }}>
						{t`Your resume, from first draft to the offer.`}
					</Text>
					<View style={{ paddingTop: 16 }}>
						<Text variant="body" color="ink2">
							{t`Write it, tailor it to each job, and keep every application in one place. Free and open source.`}
						</Text>
					</View>
				</Animated.View>
				<Animated.View style={[{ gap: 12 }, actions]}>
					{signUps ? (
						<Button
							label={t`Create an account`}
							tone="primary"
							size="lg"
							block
							onPress={() => router.push("/register")}
						/>
					) : null}
					<Button label={t`Sign in`} size="lg" block onPress={() => router.push("/sign-in")} />
					{options.data?.flags.allowGuestLogin ? (
						<Quiet label={t`Continue without an account`} onPress={guest} />
					) : null}
					{guestError ? (
						<Text variant="ui" color="dangerText" align="center" accessibilityRole="alert">
							{guestError}
						</Text>
					) : null}
					<Touch
						onPress={() => router.push("/ats-checker")}
						accessibilityRole="link"
						accessibilityLabel={t`Check a resume PDF without an account`}
						hitSlop={hitSlopFor(274, 28)}
						style={{ alignSelf: "center", paddingVertical: 4 }}
					>
						<Text variant="textLink" color="accentText">
							{t`Check a resume PDF without an account`}
						</Text>
					</Touch>
					<InlineLink
						lead={t`Server: ${hostOf(server)} ·`}
						link={t`Change`}
						hint={t`Change server`}
						onPress={() => router.push("/server")}
					/>
				</Animated.View>
			</View>
		</Screen>
	);
}

/** A quiet centred link (the guest entry under the two buttons). */
function Quiet({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Touch
			onPress={onPress}
			accessibilityRole="link"
			accessibilityLabel={label}
			hitSlop={hitSlopFor(200, 20)}
			style={{ alignSelf: "center" }}
		>
			<Text variant="ui" color="ink2">
				{label}
			</Text>
		</Touch>
	);
}
