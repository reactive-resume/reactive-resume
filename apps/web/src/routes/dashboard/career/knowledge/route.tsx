import { t } from "@lingui/core/macro";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/knowledge")({
	head: () => ({ meta: [{ title: getPageTitle(t`Knowledge`) }] }),
	// Knowledge opens on Facts.
	beforeLoad: ({ location }) => {
		if (location.pathname.replace(/\/$/, "") === "/dashboard/career/knowledge")
			throw redirect({ to: "/dashboard/career/knowledge/facts", replace: true });
	},
	// Each sub-page draws the shared frame (`KnowledgeFrame`) itself, so its header can hold that page's own actions.
	component: Outlet,
});
