import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { CoachPage } from "@/features/career/coach";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/coach/{-$conversationId}")({
	head: () => ({ meta: [{ title: getPageTitle(t`Coach`) }] }),
	// `offers`: saved offer ids to add as context ("Plan what to ask" from Offers).
	validateSearch: z.object({ offers: z.array(z.string()).max(2).optional().catch(undefined) }),
	component: RouteComponent,
});

function RouteComponent() {
	const { conversationId } = Route.useParams();
	const { offers } = Route.useSearch();
	// Not keyed by the conversation: the page keeps a new conversation's chat mounted (and streaming) when the URL moves
	// to its id, and starts a fresh one for any other change.
	return <CoachPage conversationId={conversationId} offerIds={offers ?? []} />;
}
