import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { ProfileSettings } from "@/features/settings/profile";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/settings/profile")({
	head: () => ({ meta: [{ title: getPageTitle(t`Profile`) }] }),
	component: ProfileSettings,
});
