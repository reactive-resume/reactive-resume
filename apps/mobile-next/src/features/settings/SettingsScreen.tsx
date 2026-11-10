// S1 · Settings: the person row as the header, four rows that say what's inside, a quiet About, and Sign out as a
// text link. Sign out with nothing queued signs out at once (no haptic); with queued work it opens S8 (which plays
// `warning`).
import { t } from "@lingui/core/macro";
import Constants from "expo-constants";
import { useNetworkState } from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { type PendingCounts, type SignOutStep, totalPending } from "./sign-out";
import { SignOutDialog } from "./SignOutDialog";
import { storyboardSignOut } from "./storyboard";
import { useStoryboardView } from "./storyboard-view";
import { signOut, useSession } from "@/auth/session";
import { pendingCounts, useAccount, useAIProviders, useQueuedWrites } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { hostOf } from "@/features/auth/options";
import { Avatar, IconTile, ListRow, PushScreen, SectionHeading, Text, Touch, hitSlopFor } from "@/ui";

export const initialsOf = (name: string | undefined) =>
	(name ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");

export function SettingsScreen() {
	const router = useRouter();
	const session = useSession();
	const account = useAccount();
	const providers = useAIProviders();
	const queued = useQueuedWrites();
	const network = useNetworkState();
	const view = useStoryboardView();
	const params = useLocalSearchParams<{ queued?: string }>();
	// Storyboard: `queued` makes the Sign out link find three queued changes (S8 itself: src/dev/storyboard/backdrop.tsx).
	const queuedPreset = STORYBOARD && params.queued ? storyboardSignOut(params.queued) : null;
	const [dialog, setDialog] = useState<{
		counts: PendingCounts;
		initial: SignOutStep;
		open: boolean;
		key: number;
	} | null>(null);
	const offline = queuedPreset
		? queuedPreset.offline
		: network.isConnected === false || network.isInternetReachable === false;
	const guest = session.status === "guest";

	const defaultProvider = providers.data?.find((p) => p.isDefault) ?? providers.data?.[0];
	const aiLine = !defaultProvider
		? t`Not set up`
		: defaultProvider.testStatus === "failure"
			? t`Failed`
			: t`${defaultProvider.label} · default`;
	const name = guest ? t`Guest account` : (account.data?.name ?? "");

	const signedOut = () => {
		if (router.canDismiss()) router.dismissAll();
		router.replace("/welcome");
	};

	const startSignOut = async () => {
		const counts = queuedPreset?.counts ?? (await pendingCounts());
		if (totalPending(counts) === 0) {
			await signOut();
			signedOut();
			return;
		}
		setDialog({ counts, initial: { step: "ask" }, open: true, key: Date.now() });
	};

	const open = (url: string) => void WebBrowser.openBrowserAsync(url);

	return (
		<PushScreen
			title={t`Settings`}
			back="close"
			overlay={
				dialog ? (
					<SignOutDialog
						key={dialog.key}
						open={dialog.open}
						counts={dialog.counts}
						initial={dialog.initial}
						offline={offline}
						conflicts={queued.rows.filter((row) => row.failure === "conflict").length}
						onClose={() => setDialog({ ...dialog, open: false })}
						onSignedOut={signedOut}
					/>
				) : null
			}
		>
			<View style={{ marginTop: 16 }}>
				<ListRow
					title={name}
					secondary={guest ? t`Create account` : account.data?.email}
					leading={<Avatar initials={guest ? "?" : initialsOf(account.data?.name)} size={56} />}
					trailing="caret"
					last
					onPress={() => router.push(guest ? "/register" : "/settings/account")}
				/>
			</View>
			<View style={{ marginTop: 12 }}>
				<ListRow
					title={t`Account and security`}
					leading={<IconTile icon="shield-check" />}
					trailing="caret"
					top
					onPress={() => router.push("/settings/account")}
				/>
				<ListRow
					title={t`Preferences`}
					secondary={t`Appearance, language, notifications`}
					leading={<IconTile icon="sliders-horizontal" />}
					trailing="caret"
					onPress={() => router.push("/settings/preferences")}
				/>
				<ListRow
					title={t`Application profile`}
					secondary={t`Details for job forms`}
					leading={<IconTile icon="identification-card" />}
					trailing="caret"
					onPress={() => router.push("/settings/profile")}
				/>
				<ListRow
					title={t`AI and developer`}
					secondary={aiLine}
					leading={<IconTile icon="sparkle" />}
					trailing="caret"
					last
					onPress={() => router.push("/settings/ai")}
				/>
			</View>
			<SectionHeading title={t`About`} />
			<ListRow title={t`Help and feedback`} trailing="caret" onPress={() => open("https://docs.rxresu.me")} />
			<ListRow
				title={t`Privacy and terms`}
				trailing="caret"
				onPress={() => open("https://docs.rxresu.me/legal/privacy-policy")}
			/>
			<ListRow
				title={t`Version`}
				value={`${view?.version ?? Constants.expoConfig?.version ?? ""} · ${hostOf(session.server)}`}
				last
				boxHidden
			/>
			{guest ? null : (
				<Touch
					onPress={() => void startSignOut()}
					accessibilityRole="button"
					accessibilityLabel={t`Sign out`}
					hitSlop={hitSlopFor(57, 44)}
					style={{ alignSelf: "flex-start", marginTop: 12, marginHorizontal: 24, paddingVertical: 12 }}
					testID="settings-sign-out"
				>
					<Text variant="textLink" color="dangerText">
						{t`Sign out`}
					</Text>
				</Touch>
			)}
		</PushScreen>
	);
}
