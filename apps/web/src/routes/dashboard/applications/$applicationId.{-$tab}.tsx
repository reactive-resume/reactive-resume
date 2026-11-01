import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { workspaceTabSchema } from "@reactive-resume/schema/career";
import { Workspace } from "@/features/career/workspace/shell";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/applications/$applicationId/{-$tab}")({
	head: () => ({ meta: [{ title: getPageTitle(t`Job application workspace`) }] }),
	// Sheets and dialogs are URL state, so back, forward, reload and notification links all open them.
	validateSearch: z.object({
		// true: the newest conversation about this job; "new": a fresh one; otherwise that conversation's id.
		coach: z
			.union([z.literal(true), z.string().min(1)])
			.optional()
			.catch(undefined),
		edit: z.literal("interview").optional().catch(undefined),
		version: z.string().min(1).optional().catch(undefined),
		// Practise opens with Speak selected ("Rehearse one answer aloud").
		speak: z.boolean().optional().catch(undefined),
		story: z.string().min(1).optional().catch(undefined),
		// "Add the offer's terms": Messages opens with the offer form.
		offer: z.literal("new").optional().catch(undefined),
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { applicationId, tab } = Route.useParams();
	const search = Route.useSearch();
	const parsed = workspaceTabSchema.safeParse(tab);
	return <Workspace applicationId={applicationId} tab={parsed.success ? parsed.data : undefined} search={search} />;
}
