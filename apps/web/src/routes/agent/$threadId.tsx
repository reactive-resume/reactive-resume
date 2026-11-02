import { t } from "@lingui/core/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
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
		// An old link lands on Documents with the reason, instead of silently.
		toast.add({
			type: "error",
			description: detail
				? t`That conversation's document was deleted.`
				: t`That conversation isn't available. It may have been deleted.`,
		});
		throw redirect({ to: "/dashboard", replace: true });
	},
});
