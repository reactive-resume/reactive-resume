import type { Theme } from "@/libs/theme";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useId } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "./section";
import { LocaleCombobox } from "@/features/locale/combobox";
import { useTheme } from "@/features/theme/provider";
import { themeMap } from "@/libs/theme";

const THEMES: Array<{ value: Theme; icon: IconName }> = [
	{ value: "light", icon: "light_mode" },
	{ value: "dark", icon: "dark_mode" },
	{ value: "system", icon: "contrast" },
];

export function PreferencesSettings() {
	const languageId = useId();

	return (
		<>
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
