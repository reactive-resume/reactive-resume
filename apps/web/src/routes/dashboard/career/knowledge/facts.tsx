import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { FactsPage } from "@/features/career/knowledge/facts";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/knowledge/facts")({
	head: () => ({ meta: [{ title: getPageTitle(t`Facts`) }] }),
	// `highlight`: a fact to scroll to and tint ("View" after remembering, a story's backing fact).
	validateSearch: z.object({ highlight: z.string().min(1).optional().catch(undefined) }),
	component: RouteComponent,
});

function RouteComponent() {
	const { highlight } = Route.useSearch();
	return <FactsPage highlight={highlight} />;
}
