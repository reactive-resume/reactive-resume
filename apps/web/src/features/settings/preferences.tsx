import type { Theme } from "@/libs/theme";
import type { MessageDescriptor } from "@lingui/core";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useRouteContext } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { SettingsRow, SettingsSection } from "./section";
import { deviceTimeZone, useSaveTimezone } from "./use-save-timezone";
import { List, ListRow } from "@/components/calm/list-row";
import { Combobox } from "@/components/ui/combobox";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { showKeyboardShortcuts } from "@/features/keyboard-shortcuts/store";
import { LocaleCombobox } from "@/features/locale/combobox";
import { useTheme } from "@/features/theme/provider";
import { themeMap } from "@/libs/theme";

const THEMES: Array<{ value: Theme; icon: IconName; note: MessageDescriptor }> = [
	{ value: "light", icon: "sun", note: msg`Always light` },
	{ value: "dark", icon: "moon", note: msg`Always dark` },
	{ value: "system", icon: "circle-half", note: msg`Follows your device` },
];

export function PreferencesSettings() {
	const languageId = useId();
	const timezoneId = useId();

	return (
		<>
			<SettingsSection title={<Trans>Appearance</Trans>}>
				<ThemeTiles />
				<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
					<Trans>Resumes and letters always show on white paper, whatever the theme.</Trans>
				</p>
			</SettingsSection>

			<SettingsSection title={<Trans>Language and time</Trans>}>
				<List>
					<SettingsRow
						title={
							<label htmlFor={languageId} className="block">
								<Trans>Language</Trans>
							</label>
						}
						description={<Trans>Menus, buttons and account emails. Each resume sets its own language in Design.</Trans>}
					>
						<LocaleCombobox id={languageId} aria-label={t`Interface language`} className={pickerClassName} />
					</SettingsRow>
					<TimezoneSetting id={timezoneId} />
				</List>
				<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
					<Trans>Reactive Resume is translated by volunteers.</Trans>{" "}
					<a
						href="https://crowdin.com/project/reactive-resume"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-block font-medium text-accent-text hover:underline"
					>
						<Trans>Help translate</Trans>
					</a>
				</p>
			</SettingsSection>

			{/* Touch screens have no shortcut help to open, so the setting would only add noise there. */}
			<SettingsSection title={<Trans>Keyboard</Trans>} className="pointer-coarse:hidden">
				<List>
					<ShortcutsRow />
					<ListRow
						render={<button type="button" onClick={(event) => showKeyboardShortcuts(event.currentTarget)} />}
						title={<Trans>All shortcuts</Trans>}
						trailing={<Kbd>?</Kbd>}
						caret
					/>
				</List>
			</SettingsSection>
		</>
	);
}

const pickerClassName = "w-[232px] max-sm:w-full";

/** Single-key shortcuts: the whole row is the switch's label. */
function ShortcutsRow() {
	const id = useId();
	const { characterShortcuts, setCharacterShortcuts } = useShortcutSettings();
	return (
		<SettingsRow
			title={
				<label htmlFor={id} className="block">
					<Trans>Single-key shortcuts</Trans>
				</label>
			}
			description={
				<Trans>
					Keys such as <Kbd>?</Kbd> <Kbd>N</Kbd> <Kbd>/</Kbd> and <Kbd>1</Kbd>–<Kbd>4</Kbd> for the editor's modes,
					outside text fields. Turn off if you use speech input.
				</Trans>
			}
		>
			<Switch id={id} checked={characterShortcuts} onCheckedChange={setCharacterShortcuts} />
		</SettingsRow>
	);
}

// Browsers list canonical zones only: UTC, the default for older accounts, and aliases a device reports are missing.
const timeZones = Intl.supportedValuesOf("timeZone");
const timeZoneOptions = (current: string) =>
	(timeZones.includes(current) ? timeZones : [...timeZones, current].sort()).map((zone) => ({
		value: zone,
		label: zone,
	}));

/** The account's timezone, which interview times, reminders and schedules use. Saved as soon as it's chosen. */
function TimezoneSetting({ id }: { id: string }) {
	const { session } = useRouteContext({ strict: false });
	const saved = session?.user.timezone ?? "UTC";
	const [value, setValue] = useState(saved);
	const device = deviceTimeZone();
	const saveTimezone = useSaveTimezone();

	const save = async (timezone: string) => {
		const previous = value;
		setValue(timezone);
		if (!(await saveTimezone(timezone))) setValue(previous);
	};

	return (
		<SettingsRow
			title={
				<label htmlFor={id} className="block">
					<Trans>Timezone</Trans>
				</label>
			}
			description={
				<>
					<Trans>Interview times, reminders and schedules use it.</Trans>
					{device && device !== value && (
						<>
							{" "}
							<Button
								variant="link"
								className="h-auto p-0 text-[13px]/[18px] font-medium"
								onClick={() => void save(device)}
							>
								<Trans>Use this device's timezone ({device})</Trans>
							</Button>
						</>
					)}
				</>
			}
		>
			<Combobox
				id={id}
				aria-label={t`Timezone`}
				className={pickerClassName}
				showClear={false}
				options={timeZoneOptions(value)}
				value={value}
				placeholder={t`Search timezones`}
				emptyMessage={t`No timezone matches.`}
				onValueChange={(zone) => zone && zone !== value && void save(zone)}
			/>
		</SettingsRow>
	);
}

/** Light, Dark and System as three tiles with what each does; the choice applies at once. */
function ThemeTiles() {
	const { i18n } = useLingui();
	const { theme, setTheme } = useTheme();
	const id = useId();

	return (
		<RadioGroup
			aria-label={t`Theme`}
			value={theme}
			onValueChange={(value) => setTheme(value as Theme)}
			className="grid grid-cols-3 gap-3 max-sm:grid-cols-1"
		>
			{THEMES.map((option) => {
				const checked = theme === option.value;
				return (
					<label
						key={option.value}
						htmlFor={`${id}-${option.value}`}
						className={cn(
							"flex min-w-0 cursor-pointer items-center gap-3 rounded-lg bg-raised py-3.5 ps-4 pe-3.5 shadow-[inset_0_0_0_1px_var(--line-2)] transition-[background-color,box-shadow] duration-quick hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-accent",
							checked && "bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)] hover:bg-accent-soft",
						)}
					>
						<Icon name={option.icon} size={22} className="text-ink-2" />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="text-sm/5 font-semibold text-ink">{i18n.t(themeMap[option.value])}</span>
							<span className="text-[13px]/[18px] text-ink-3">{i18n.t(option.note)}</span>
						</span>
						<RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
					</label>
				);
			})}
		</RadioGroup>
	);
}
