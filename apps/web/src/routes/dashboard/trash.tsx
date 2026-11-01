import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import { TrashPage } from "@/features/documents/trash-page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/trash")({
	head: () => ({ meta: [{ title: getPageTitle(t`Trash`) }] }),
	component: TrashPage,
});
