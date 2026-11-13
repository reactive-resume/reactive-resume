import { t } from "@lingui/core/macro";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import z from "zod";
import { TrashPage } from "@/features/trash/trash-page";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/trash")({
	head: () => ({ meta: [{ title: getPageTitle(t`Trash`) }] }),
	validateSearch: z.object({ kind: z.enum(["all", "documents", "applications"]).default("all").catch("all") }),
	search: { middlewares: [stripSearchParams({ kind: "all" })] },
	component: RouteComponent,
});

function RouteComponent() {
	const { kind } = Route.useSearch();
	const navigate = Route.useNavigate();
	return <TrashPage kind={kind} onKindChange={(next) => void navigate({ search: { kind: next }, replace: true })} />;
}
