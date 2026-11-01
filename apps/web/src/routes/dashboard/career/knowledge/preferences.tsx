import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { PreferencesPage } from "@/features/career/knowledge/preferences";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/knowledge/preferences")({
	head: () => ({ meta: [{ title: getPageTitle(t`Job search preferences`) }] }),
	component: PreferencesPage,
});
