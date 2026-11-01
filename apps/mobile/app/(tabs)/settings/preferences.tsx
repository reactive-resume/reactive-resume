import type { ThemePreference } from "@/ui";
import type { Locale } from "@reactive-resume/utils/locale";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DevSettings, View, useWindowDimensions } from "react-native";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { client, orpc } from "@/api/client";
import { SettingsGroup, SettingsPage } from "@/features/settings/layout";
import { localeMap } from "@/features/settings/locale-names";
import { useProfile } from "@/features/settings/queries";
import { getDeviceLocale, getLocalePreference, selectableLocales, setLocalePreference } from "@/i18n";
import { timeZones } from "@/lib/timezones";
import {
	Banner,
	Button,
	ConfirmDialog,
	ListRow,
	Segmented,
	Sheet,
	Switch,
	Text,
	TextField,
	haptics,
	setHapticsEnabled,
	setThemePreference,
	showToast,
	useHapticsEnabled,
	useTheme,
	useThemePreference,
} from "@/ui";

export default function PreferencesScreen() {
	const { t, i18n } = useLingui();
	const theme = useThemePreference();
	const hapticsOn = useHapticsEnabled();
	const toggleHaptics = (value: boolean) => {
		setHapticsEnabled(value);
		haptics.selection();
	};
	const { space } = useTheme();
	const { fontScale } = useWindowDimensions();
	const profile = useProfile();
	const queryClient = useQueryClient();
	const [locale, setLocale] = useState(getLocalePreference);
	const [picker, setPicker] = useState<"language" | "timezone" | null>(null);
	const [search, setSearch] = useState("");
	const [zoneLimit, setZoneLimit] = useState(40);
	const [changingLanguage, setChangingLanguage] = useState(false);
	const [restart, setRestart] = useState(false);
	const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const timezone = useMutation({
		mutationKey: ["settings", "timezone"],
		mutationFn: async (value: string) => {
			const result = await client.auth.updateProfile({ timezone: value });
			if (!result.status) throw new Error("Timezone update rejected");
		},
		onSuccess: async () => {
			setPicker(null);
			await queryClient.invalidateQueries({ queryKey: orpc.auth.getProfile.key() });
		},
		onError: () => showToast({ message: t`Couldn't save the timezone. Try again.` }),
	});
	const languageName = (value: Locale) => i18n._(localeMap[value]);
	const languages = selectableLocales.map((value) => ({ value, label: languageName(value) }));
	const matchingLanguages = languages.filter(({ value, label }) =>
		`${value} ${label}`.toLowerCase().includes(search.trim().toLowerCase()),
	);
	const zones = [
		...new Set(["UTC", deviceTimezone, ...(profile.data ? [profile.data.timezone] : []), ...timeZones]),
	].sort();
	const matches = zones.filter((zone) => zone.toLowerCase().includes(search.trim().toLowerCase()));
	const enteredZone = search.trim();
	const chooseLanguage = async (value: Locale | null) => {
		setChangingLanguage(true);
		try {
			const needsRestart = await setLocalePreference(value);
			setLocale(value);
			setPicker(null);
			setRestart(needsRestart);
		} catch {
			showToast({ message: t`Couldn't change the language. Try again.` });
		} finally {
			setChangingLanguage(false);
		}
	};
	const openPicker = (value: "language" | "timezone") => {
		setSearch("");
		setZoneLimit(40);
		setPicker(value);
	};
	return (
		<SettingsPage onRefresh={profile.refetch} title={t`Preferences`}>
			<Text variant="caption" color="ink2">{t`Appearance`}</Text>
			<Segmented<ThemePreference>
				label={t`Theme`}
				orientation={fontScale > 1.3 ? "vertical" : "horizontal"}
				value={theme}
				onChange={(value) => {
					try {
						setThemePreference(value);
					} catch {
						showToast({ message: t`Couldn't save the theme. Try again.` });
					}
				}}
				options={[
					{ value: "system", label: t`System` },
					{ value: "light", label: t`Light` },
					{ value: "dark", label: t`Dark` },
				]}
			/>
			<Text variant="callout" color="ink3">{t`Resumes always render on white paper, whatever the theme.`}</Text>
			<SettingsGroup title={t`Feedback`} note={t`Applies to this device only.`}>
				<ListRow
					title={t`Haptic feedback`}
					leading="vibrate"
					onPress={() => toggleHaptics(!hapticsOn)}
					trailing={<Switch label={t`Haptic feedback`} value={hapticsOn} onValueChange={toggleHaptics} />}
				/>
			</SettingsGroup>
			<SettingsGroup
				title={t`Language`}
				note={`${t`Interface only. Each resume sets its own language in Design.`} ${t`Account emails use it too.`}`}
			>
				<ListRow
					title={t`Language`}
					subtitle={locale ? languageName(locale) : t`System`}
					leading="translate"
					chevron
					onPress={() => openPicker("language")}
				/>
			</SettingsGroup>
			<SettingsGroup title={t`Timezone`} note={t`Interview times, reminders and schedules in Career use it.`}>
				<ListRow
					title={t`Timezone`}
					subtitle={profile.data?.timezone ?? (profile.isPending ? t`Loading…` : t`Unavailable`)}
					leading="clock"
					chevron
					disabled={!profile.data || timezone.isPending}
					onPress={() => openPicker("timezone")}
				/>
				{profile.isError ? (
					<Banner
						tone="danger"
						message={t`Couldn't load your timezone.`}
						action={{ label: t`Try again`, onPress: () => void profile.refetch() }}
					/>
				) : null}
			</SettingsGroup>
			<Sheet
				open={picker !== null}
				onClose={() => setPicker(null)}
				title={picker === "language" ? t`Language` : t`Timezone`}
				detents={[0.9]}
			>
				<View style={{ paddingHorizontal: space.s4 }}>
					<TextField
						label={picker === "language" ? t`Search languages` : t`Search timezones`}
						value={search}
						onChangeText={(value) => {
							setSearch(value);
							setZoneLimit(40);
						}}
						autoCapitalize="none"
						autoCorrect={false}
						returnKeyType="search"
					/>
				</View>
				{picker === "language" ? (
					<>
						<ListRow
							title={t`System`}
							subtitle={languageName(getDeviceLocale())}
							selected={locale === null}
							disabled={changingLanguage}
							onPress={() => void chooseLanguage(null)}
						/>
						{matchingLanguages.map(({ value, label }) => (
							<ListRow
								key={value}
								title={label}
								subtitle={value}
								selected={locale === value}
								disabled={changingLanguage}
								onPress={() => void chooseLanguage(value)}
							/>
						))}
						{matchingLanguages.length === 0 ? <Text color="ink3">{t`No language matches.`}</Text> : null}
					</>
				) : (
					<>
						{deviceTimezone !== profile.data?.timezone ? (
							<ListRow
								title={t`Use this device's timezone (${deviceTimezone})`}
								disabled={timezone.isPending}
								onPress={() => timezone.mutate(deviceTimezone)}
							/>
						) : null}
						{matches.slice(0, zoneLimit).map((zone) => (
							<ListRow
								key={zone}
								title={zone}
								selected={zone === profile.data?.timezone}
								disabled={timezone.isPending}
								onPress={() => timezone.mutate(zone)}
							/>
						))}
						{matches.length > zoneLimit ? (
							<Button variant="ghost" label={t`Show more`} onPress={() => setZoneLimit((limit) => limit + 40)} />
						) : null}
						{!zones.includes(enteredZone) && timezoneSchema.safeParse(enteredZone).success ? (
							<ListRow title={enteredZone} disabled={timezone.isPending} onPress={() => timezone.mutate(enteredZone)} />
						) : null}
						{matches.length === 0 && !timezoneSchema.safeParse(enteredZone).success ? (
							<Text color="ink3">{t`No timezone matches.`}</Text>
						) : null}
					</>
				)}
			</Sheet>
			<ConfirmDialog
				open={restart}
				title={t`Restart to change text direction`}
				message={t`Your language is saved. Restart Reactive Resume to apply the new left-to-right or right-to-left layout.`}
				confirmLabel={__DEV__ ? t`Reload now` : t`Done`}
				cancelLabel={t`Later`}
				onCancel={() => setRestart(false)}
				onConfirm={() => {
					setRestart(false);
					if (__DEV__) DevSettings.reload();
				}}
			/>
		</SettingsPage>
	);
}
