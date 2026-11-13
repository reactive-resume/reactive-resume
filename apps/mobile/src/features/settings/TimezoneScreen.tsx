// S3 › Timezone: a search list with "Use the phone's timezone" first. Choosing saves the account's timezone (schedules
// and the coach read it) and this device's home zone; a failed save says so and stays here.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { zoneCity } from "./PreferencesScreen";
import { timeZones } from "./timezones";
import { usePlatformActions, useSettings } from "@/data";
import { timeZone } from "@/data/clock";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { haptic, ListRow, PushScreen, Text, TextField } from "@/ui";

/** Enough rows to scan; typing narrows the rest. */
const SHOWN = 60;

export function TimezoneScreen() {
	const router = useRouter();
	const settings = useSettings();
	const actions = usePlatformActions();
	const [query, setQuery] = useState("");
	const [error, setError] = useState(false);
	// Storyboard flows reach the failure: `state=save-error`.
	const params = useLocalSearchParams<{ state?: string }>();
	const failSave = STORYBOARD && params.state === "save-error";
	const phone = timeZone();
	const automatic = settings.data?.automaticTimeZone ?? true;
	const home = settings.data?.homeTimeZone ?? phone;
	const words = query.trim().toLowerCase().replaceAll(" ", "_");
	const matches = timeZones.filter((zone) => zone.toLowerCase().includes(words)).slice(0, SHOWN);

	const choose = async (zone: string | null) => {
		setError(false);
		const next = zone ?? phone;
		try {
			if (failSave) throw new Error("storyboard");
			await actions.run("auth.updateProfile", { timezone: next });
			await settings.save({ automaticTimeZone: zone === null, homeTimeZone: next, lastNotifiedTimeZone: null });
			haptic("selection");
			router.back();
		} catch {
			setError(true);
		}
	};

	return (
		<PushScreen title={t`Timezone`}>
			<View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 }}>
				<TextField
					label={t`Search timezones`}
					leadingIcon="magnifying-glass"
					value={query}
					onChangeText={setQuery}
					placeholder={t`City or region`}
					autoCorrect={false}
					autoCapitalize="none"
					testID="timezone-search"
				/>
			</View>
			{error ? (
				<Text
					variant="ui"
					color="dangerText"
					accessibilityLiveRegion="polite"
					style={{ paddingHorizontal: 24, paddingBottom: 8 }}
				>
					{t`Couldn't save the timezone. Try again.`}
				</Text>
			) : null}
			<ListRow
				title={t`Use the phone's timezone`}
				secondary={zoneCity(phone)}
				trailing={automatic ? <Text variant="ui" color="accentText">{t`On`}</Text> : undefined}
				top
				accessibilityState={{ selected: automatic }}
				onPress={() => void choose(null)}
			/>
			{matches.map((zone, i) => (
				<ListRow
					key={zone}
					title={zoneCity(zone)}
					secondary={zone}
					trailing={
						!automatic && zone === home ? <Text variant="ui" color="accentText">{t`Selected`}</Text> : undefined
					}
					last={i === matches.length - 1}
					accessibilityState={{ selected: !automatic && zone === home }}
					onPress={() => void choose(zone)}
				/>
			))}
			{matches.length === 0 ? (
				<Text variant="ui" color="ink3" style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
					{t`No timezone matches “${query}”.`}
				</Text>
			) : null}
		</PushScreen>
	);
}
