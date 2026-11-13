import { t } from "@lingui/core/macro";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career")({
	head: () => ({ meta: [{ title: getPageTitle(t`Career`) }] }),
	// Career is one page (the coach, then rows to Knowledge, Offers and Schedules); each of those draws its own header.
	component: Outlet,
});
