import { Trans, useLingui } from "@lingui/react/macro";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Platform, View } from "react-native";
import { SettingsGroup, SettingsPage } from "@/features/settings/layout";
import { useProfile } from "@/features/settings/queries";
import { SignOutRow } from "@/features/settings/sign-out";
import { routes } from "@/routes";
import { Avatar, ListRow, Text, showToast, useTheme, useThemePreference } from "@/ui";

export default function SettingsScreen() {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const profile = useProfile();
	const openLink = (url: string) => {
		void openBrowserAsync(url).catch(() => showToast({ message: t`Couldn't open the browser. Try again.` }));
	};
	const theme = useThemePreference();
	const appearance = { system: t`System`, light: t`Light`, dark: t`Dark` }[theme];
	return (
		<SettingsPage onRefresh={profile.refetch} title={t`Settings`} root>
			<SettingsGroup>
				<ListRow
					title={profile.data?.name ?? t`Account`}
					subtitle={profile.data?.email}
					leading={<Avatar name={profile.data?.name ?? t`Account`} uri={profile.data?.image} />}
					chevron
					onPress={() => router.push(routes.settings("account"))}
				/>
			</SettingsGroup>
			<SettingsGroup>
				<ListRow
					title={t`Preferences`}
					leading="circle-half"
					value={appearance}
					chevron
					onPress={() => router.push(routes.settings("preferences"))}
				/>
				<ListRow title={t`AI & developer`} leading="robot" chevron onPress={() => router.push(routes.settings("ai"))} />
			</SettingsGroup>
			<SettingsGroup>
				<SignOutRow switchServer />
			</SettingsGroup>
			<SettingsGroup title={t`Support`}>
				<ListRow
					title={t`Help & docs`}
					leading="question"
					external
					onPress={() => openLink("https://docs.rxresu.me")}
				/>
				<ListRow
					title={t`Report an issue`}
					leading="bug"
					external
					onPress={() => openLink("https://github.com/reactive-resume/reactive-resume/issues/new/choose")}
				/>
				<ListRow
					title={t`Join the Discord`}
					subtitle={t`Resume feedback, product help, and community ideas.`}
					leading="discord-logo"
					external
					onPress={() => openLink("https://discord.gg/9kAqrGcwn5")}
				/>
				<ListRow
					title={t`Source code on GitHub`}
					leading="github-logo"
					external
					onPress={() => openLink("https://github.com/reactive-resume/reactive-resume")}
				/>
				{Platform.OS !== "ios" ? (
					<ListRow
						title={t`Donate on Open Collective`}
						leading="hand-heart"
						external
						onPress={() => openLink("https://opencollective.com/reactive-resume/donate")}
					/>
				) : null}
			</SettingsGroup>
			<SettingsGroup title={t`Legal`}>
				<ListRow
					title={t`Privacy policy`}
					leading="shield-check"
					external
					onPress={() => openLink("https://docs.rxresu.me/legal/privacy-policy")}
				/>
				<ListRow
					title={t`Terms of service`}
					leading="scroll"
					external
					onPress={() => openLink("https://docs.rxresu.me/legal/terms-of-service")}
				/>
				<ListRow
					title={t`MIT License`}
					leading="scales"
					external
					onPress={() => openLink("https://github.com/reactive-resume/reactive-resume/blob/main/LICENSE")}
				/>
				<ListRow
					title={t`Open-source licenses`}
					leading="file-text"
					chevron
					onPress={() => router.push("/(tabs)/settings/licences")}
				/>
			</SettingsGroup>
			<SettingsGroup>
				<SignOutRow />
			</SettingsGroup>
			<View style={{ alignItems: "center", gap: space.s1 }}>
				<Text variant="caption" color="ink3" align="center">
					Reactive Resume
				</Text>
				<Text variant="caption" color="ink3" align="center">
					<Trans>
						by{" "}
						<Text
							variant="caption"
							color="accentText"
							accessibilityRole="link"
							onPress={() => openLink("https://amruthpillai.com")}
							style={{ textDecorationLine: "underline" }}
						>
							Amruth Pillai
						</Text>
					</Trans>
				</Text>
				<Text variant="caption" color="ink3" align="center">
					v{Constants.expoConfig?.version ?? "—"}
				</Text>
			</View>
		</SettingsPage>
	);
}
