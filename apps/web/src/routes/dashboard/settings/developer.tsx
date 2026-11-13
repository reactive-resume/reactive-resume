import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DeveloperSettings } from "@/features/settings/ai/page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/settings/developer")({
	head: () => ({ meta: [{ title: getPageTitle(t`Developer`) }] }),
	// Agents hand off "create an API key" with `?newKey=true#api-keys`, which opens the New key dialog.
	validateSearch: z.object({ newKey: z.boolean().optional().catch(false) }),
	component: DeveloperSettings,
});
