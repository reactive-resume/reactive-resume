import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AiSettings } from "@/features/settings/ai/page";
import { getPageTitle } from "@/libs/seo";

/** Sections that moved to Developer. Old clients (phone apps, MCP, agents) still link to them here by anchor. */
const MOVED = new Set(["api-keys", "connected-applications"]);

export const Route = createFileRoute("/dashboard/settings/ai")({
	head: () => ({ meta: [{ title: getPageTitle(t`AI`) }] }),
	// Read only to send `?newKey=true#api-keys` on to Developer, where the New key dialog lives now.
	validateSearch: z.object({ newKey: z.boolean().optional().catch(undefined) }),
	// The anchor never reaches the server, so this is decided here in the browser.
	beforeLoad: ({ location, search }) => {
		if (!search.newKey && !MOVED.has(location.hash)) return;
		throw redirect({
			to: "/dashboard/settings/developer",
			search: search.newKey ? { newKey: true } : {},
			hash: location.hash || "api-keys",
			replace: true,
		});
	},
	component: AiSettings,
});
