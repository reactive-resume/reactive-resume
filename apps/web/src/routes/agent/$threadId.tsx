import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { orpc } from "@/libs/orpc/client";

// A conversation opens on its document, with the assistant showing it; without one, Documents, saying why.
export const Route = createFileRoute("/agent/$threadId")({
	loader: async ({ params, context }) => {
		const detail = await context.queryClient
			.fetchQuery(orpc.agent.threads.get.queryOptions({ input: { id: params.threadId } }))
			.catch(() => null);
		const document = detail?.document;
		if (document?.kind === "letter")
			throw redirect({
				to: "/builder/letter/$coverLetterId",
				params: { coverLetterId: document.id },
				search: { assistant: params.threadId },
				replace: true,
			});
		if (document?.kind === "resume")
			throw redirect({
				to: "/builder/$resumeId",
				params: { resumeId: document.id },
				search: { assistant: params.threadId },
				replace: true,
			});
		// A coach conversation has no document: it opens in Career, or in its application's workspace.
		const thread = detail?.thread;
		if (thread?.scope === "application" && thread.applicationId)
			throw redirect({
				to: "/dashboard/applications/$applicationId/{-$tab}",
				params: { applicationId: thread.applicationId },
				search: { coach: params.threadId },
				replace: true,
			});
		if (thread?.scope === "career")
			throw redirect({
				to: "/dashboard/career/coach/{-$conversationId}",
				params: { conversationId: params.threadId },
				replace: true,
			});
		return { documentDeleted: detail !== null };
	},
	component: UnavailableConversation,
});

function UnavailableConversation() {
	const { documentDeleted } = Route.useLoaderData();
	const { threadId } = Route.useParams();
	const navigate = Route.useNavigate();
	const notified = useRef<string | null>(null);
	useEffect(() => {
		let active = true;
		// The root toaster subscribes in a sibling mount effect; let those effects finish before notifying.
		queueMicrotask(() => {
			if (!active || notified.current === threadId) return;
			notified.current = threadId;
			toast.add({
				type: "error",
				description: documentDeleted
					? t`That conversation's document was deleted.`
					: t`That conversation isn't available. It may have been deleted.`,
			});
			void navigate({ to: "/dashboard", replace: true });
		});
		return () => {
			active = false;
		};
	}, [documentDeleted, navigate, threadId]);
	return null;
}
