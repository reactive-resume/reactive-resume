import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { ImportPage } from "@/features/documents/import/import-page";
import { getPageTitle } from "@/libs/seo";

// `documents_`: a page of its own beside Documents, not a child drawn inside it.
export const Route = createFileRoute("/dashboard/documents_/import")({
	head: () => ({ meta: [{ title: getPageTitle(t`Import a resume`) }] }),
	validateSearch: z.object({ application: z.string().min(1).optional().catch(undefined) }),
	component: RouteComponent,
});

function RouteComponent() {
	const { application } = Route.useSearch();
	return <ImportPage applicationId={application} />;
}
