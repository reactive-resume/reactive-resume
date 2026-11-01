import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { PreferencesSettings } from "@/features/settings/preferences";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/settings/preferences")({
	head: () => ({ meta: [{ title: getPageTitle(t`Preferences`) }] }),
	component: PreferencesSettings,
});
