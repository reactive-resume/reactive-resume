import type { Theme } from "@/libs/theme";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "./section";
import { PageHeader } from "@/components/layout/page-header";
import { Combobox } from "@/components/ui/combobox";
import { LocaleCombobox } from "@/features/locale/combobox";
import { useTheme } from "@/features/theme/provider";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";
import { themeMap } from "@/libs/theme";

const THEMES: Array<{ value: Theme; icon: IconName }> = [
	{ value: "light", icon: "sun" },
	{ value: "dark", icon: "moon" },
	{ value: "system", icon: "circle-half" },
];

export function PreferencesSettings() {
	const languageId = useId();
	const timezoneId = useId();

	return (
		<>
			<PageHeader title={<Trans>Preferences</Trans>} />
			<SettingsSection title={<Trans>Appearance</Trans>}>
				<ThemeTiles />
				<p className="text-xs text-ink-3">
					<Trans>Resumes always render on white paper, whatever the theme.</Trans>
				</p>
			</SettingsSection>

			<SettingsSection title={<Trans>Language</Trans>}>
				<div className="grid max-w-80 gap-1.5">
					<label htmlFor={languageId} className="sr-only">
						<Trans>Interface language</Trans>
					</label>
					<LocaleCombobox id={languageId} />
				</div>
				<p className="text-xs text-ink-3">
					<Trans>Interface only. Each resume sets its own language in Design.</Trans>{" "}
					<a
						href="https://crowdin.com/project/reactive-resume"
						target="_blank"
						rel="noopener noreferrer"
						className="underline underline-offset-2"
					>
						<Trans>Help translate</Trans>
					</a>
				</p>
			</SettingsSection>

			<SettingsSection title={<Trans>Timezone</Trans>}>
				<TimezoneSetting id={timezoneId} />
			</SettingsSection>
		</>
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
	const router = useRouter();
	const queryClient = useQueryClient();
	const { session } = useRouteContext({ strict: false });
	const saved = session?.user.timezone ?? "UTC";
	const [value, setValue] = useState(saved);
	const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const save = async (timezone: string) => {
		const previous = value;
		setValue(timezone);
		const { error } = await authClient.updateUser({ timezone });
		if (error) {
			setValue(previous);
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't save the timezone. Try again.`),
			});
			return;
		}
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
	};

	return (
		<>
			<div className="grid max-w-80 gap-1.5">
				<label htmlFor={id} className="sr-only">
					<Trans>Timezone</Trans>
				</label>
				<Combobox
					id={id}
					showClear={false}
					options={timeZoneOptions(value)}
					value={value}
					placeholder={t`Search timezones`}
					emptyMessage={t`No timezone matches.`}
					onValueChange={(zone) => zone && zone !== value && void save(zone)}
				/>
			</div>
			<p className="flex flex-wrap items-center gap-x-1 text-xs text-ink-3">
				<Trans>Interview times, reminders and schedules in Career use it.</Trans>
				{device && device !== value && (
					<Button variant="link" className="h-auto p-0 text-xs text-ink-2 underline" onClick={() => void save(device)}>
						<Trans>Use this device's timezone ({device})</Trans>
					</Button>
				)}
			</p>
		</>
	);
}

/** Light, Dark and System as three tiles; the choice applies at once. */
function ThemeTiles() {
	const { i18n } = useLingui();
	const { theme, setTheme } = useTheme();

	return (
		<fieldset className="grid grid-cols-3 gap-2.5">
			<legend className="sr-only">{t`Theme`}</legend>
			{THEMES.map((option) => {
				const checked = theme === option.value;
				return (
					<label
						key={option.value}
						className={cn(
							"flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line-2 bg-surface text-sm font-medium transition-[background-color,border-color,box-shadow,scale] duration-quick ease-enter hover:bg-hover active:scale-[0.97] has-focus-visible:outline-2 has-focus-visible:outline-accent",
							checked && "border-accent shadow-[0_0_0_3px_var(--accent-soft)]",
						)}
					>
						<input
							type="radio"
							name="theme"
							value={option.value}
							className="sr-only"
							checked={checked}
							onChange={() => setTheme(option.value)}
						/>
						<Icon name={option.icon} size={22} />
						{i18n.t(themeMap[option.value])}
					</label>
				);
			})}
		</fieldset>
	);
}
