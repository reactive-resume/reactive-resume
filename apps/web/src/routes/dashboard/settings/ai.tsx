import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { AiDeveloperSettings } from "@/features/settings/ai/page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/settings/ai")({
	head: () => ({ meta: [{ title: getPageTitle(t`AI & developer`) }] }),
	component: AiDeveloperSettings,
});
