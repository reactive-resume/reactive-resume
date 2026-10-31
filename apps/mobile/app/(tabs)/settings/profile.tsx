import { useLingui } from "@lingui/react/macro";
import { ApplicationProfileSection } from "@/features/settings/application-profile";
import { SettingsPage } from "@/features/settings/layout";

export default function ProfileScreen() {
	const { t } = useLingui();
	return (
		<SettingsPage title={t`Profile`}>
			<ApplicationProfileSection />
		</SettingsPage>
	);
}
