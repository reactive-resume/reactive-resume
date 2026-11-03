import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { ApplicationTrashPage } from "@/features/applications/trash-page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/applications/trash")({
	head: () => ({ meta: [{ title: getPageTitle(t`Trash`) }] }),
	component: ApplicationTrashPage,
});
