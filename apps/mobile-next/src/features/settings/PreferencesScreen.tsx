// S3 · Preferences: appearance, language, timezone and haptics, then one switch per notification channel. Reduced
// motion and text size follow the system and aren't repeated here. The theme segment plays `selection` (Segmented),
// switches `toggleOn` / `toggleOff`; the Haptics switch plays its own `toggleOn` after enabling.
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { Linking, View } from "react-native";
import { useStoryboardView } from "./storyboard-view";
import { type Settings, useSettings } from "@/data";
import { timeZone } from "@/data/clock";
import {
	haptic,
	ListRow,
	PushScreen,
	SectionHeading,
	Segmented,
	Switch,
	useSwitchRow,
	type ThemePreference,
	useThemeStore,
} from "@/ui";
import { setHapticsEnabled } from "@/ui/motion";

const channels = [
	{ key: "interviews", label: () => t`Interviews and briefings` },
	{ key: "followUps", label: () => t`Follow-ups` },
	{ key: "newRoles", label: () => t`New roles` },
	{ key: "offers", label: () => t`Offer deadlines` },
	{ key: "feedback", label: () => t`Feedback comments` },
] as const;

/** "Berlin" from "Europe/Berlin". */
export const zoneCity = (zone: string) => (zone.split("/").pop() ?? zone).replaceAll("_", " ");

export function languageName(locale: string): string {
	try {
		const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
		return name.charAt(0).toUpperCase() + name.slice(1);
	} catch {
		return locale;
	}
}

export function PreferencesScreen() {
	const { i18n } = useLingui();
	const settings = useSettings();
	const view = useStoryboardView();
	const theme = useThemeStore((s) => s.preference);
	const setPreference = useThemeStore((s) => s.setPreference);
	const data: Settings | undefined = settings.data;
	const haptics = data?.haptics ?? true;
	const automatic = data?.automaticTimeZone ?? true;
	// The zone schedules run on: the phone's until it moves without "Move them" (T1's travel notice).
	const home = data?.homeTimeZone ?? timeZone();
	const zoneLabel = automatic ? t`${zoneCity(home)} · automatic` : zoneCity(home);
	const router = useRouter();

	const setTheme = (next: ThemePreference) => {
		setPreference(next);
		void settings.save({ theme: next });
	};

	const toggleHaptics = () => {
		const next = !haptics;
		if (!next) haptic("toggleOff");
		setHapticsEnabled(next);
		if (next) haptic("toggleOn");
		void settings.save({ haptics: next });
	};
	const hapticsRow = {
		onPress: toggleHaptics,
		accessibilityRole: "switch" as const,
		accessibilityState: { checked: haptics },
	};

	const setChannel = async (key: string, on: boolean) => {
		if (on) {
			const current = await Notifications.getPermissionsAsync();
			if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync();
		}
		await settings.save({ notificationCategories: { ...data?.notificationCategories, [key]: on } });
	};

	return (
		<PushScreen title={t`Preferences`}>
			<SectionHeading title={t`Appearance`} first />
			<View style={{ paddingTop: 8, paddingHorizontal: 24, paddingBottom: 8 }}>
				<Segmented<ThemePreference>
					accessibilityLabel={t`Theme`}
					value={theme}
					onChange={setTheme}
					options={[
						{ key: "system", label: t`System` },
						{ key: "light", label: t`Light` },
						{ key: "dark", label: t`Dark` },
					]}
				/>
			</View>
			<ListRow
				title={t`Language`}
				value={view?.language ?? languageName(i18n.locale)}
				trailing="caret"
				accessibilityHint={t`Opens this app's settings, where the phone sets its language`}
				onPress={() => void Linking.openSettings()}
			/>
			<ListRow
				title={t`Timezone`}
				value={zoneLabel}
				trailing="caret"
				accessibilityLabel={t`Timezone, ${zoneLabel}`}
				onPress={() => router.push("/settings/timezone")}
			/>
			<ListRow
				title={t`Haptics`}
				trailing={<Switch value={haptics} interactive={false} />}
				last
				boxHidden
				{...hapticsRow}
			/>
			<SectionHeading title={t`Notify me about`} />
			{channels.map((channel, i) => (
				<ChannelRow
					key={channel.key}
					label={channel.label()}
					value={data?.notificationCategories[channel.key] ?? true}
					onChange={(on) => void setChannel(channel.key, on)}
					last={i === channels.length - 1}
				/>
			))}
		</PushScreen>
	);
}

function ChannelRow({
	label,
	value,
	onChange,
	last,
}: {
	label: string;
	value: boolean;
	onChange: (on: boolean) => void;
	last: boolean;
}) {
	const row = useSwitchRow(value, onChange);
	return (
		<ListRow
			title={label}
			trailing={<Switch value={value} interactive={false} />}
			last={last}
			boxHidden={last}
			{...row}
		/>
	);
}
