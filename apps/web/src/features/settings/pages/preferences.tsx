import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Button } from "@reactive-resume/ui/components/button";
import { Label } from "@reactive-resume/ui/components/label";
import { LocaleCombobox } from "@/features/locale/combobox";
import { ThemeCombobox } from "@/features/theme/combobox";

export function PreferencesSettingsPage() {
	return (
		<div className="grid max-w-xl gap-6">
			<div className="grid gap-1.5">
				<Label className="mb-0.5">
					<Trans>Theme</Trans>
				</Label>
				<ThemeCombobox />
			</div>

			<div className="grid gap-1.5">
				<Label className="mb-0.5">
					<Trans>Language</Trans>
				</Label>
				<LocaleCombobox />
				<Button
					size="sm"
					variant="link"
					nativeButton={false}
					className="h-5 justify-start text-muted-foreground text-xs"
					render={
						<a href="https://crowdin.com/project/reactive-resume" target="_blank" rel="noopener noreferrer">
							<Trans>Help translate the app to your language</Trans>
							<ArrowRightIcon className="size-3" />
						</a>
					}
				/>
			</div>
		</div>
	);
}
