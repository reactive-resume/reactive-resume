import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";
import { openAssistantFrom } from "@/features/assistant/open";
import { orpc } from "@/libs/orpc/client";

/**
 * Always the last row: "Ask the assistant '…'". In the editor it asks about the open document; anywhere else it
 * opens the document edited last, with the assistant ready and the question sent.
 */
export function AskCommandGroup() {
	const search = useCommandPaletteStore((state) => state.search);
	const reset = useCommandPaletteStore((state) => state.reset);
	const { session } = useRouteContext({ strict: false });
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const question = search.trim();
	if (!session || !question) return null;

	const ask = async () => {
		reset();
		if (pathname.startsWith("/builder/")) {
			openAssistantFrom({ ask: question });
			return;
		}

		const documents = await queryClient.fetchQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
		const latest = [...documents].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
		if (!latest) {
			toast.add({ description: t`Create a resume first, then ask about it.` });
			return;
		}
		if (latest.type === "letter")
			await navigate({
				to: "/builder/letter/$coverLetterId",
				params: { coverLetterId: latest.id },
				search: { ask: question },
			});
		else await navigate({ to: "/builder/$resumeId", params: { resumeId: latest.id }, search: { ask: question } });
	};

	return (
		<BaseCommandGroup heading={<Trans>Ask</Trans>}>
			<CommandItem value={`ask ${question}`} onSelect={() => void ask()}>
				<Icon name="auto_awesome" size={16} />
				<span className="min-w-0 truncate">
					<Trans>Ask the assistant “{question}”</Trans>
				</span>
			</CommandItem>
		</BaseCommandGroup>
	);
}
