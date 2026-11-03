import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";
import { openAssistantFrom } from "@/features/assistant/open";
import { ProviderSetup } from "@/features/assistant/provider-setup";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { orpc } from "@/libs/orpc/client";

/** Ask always fills a composer. Outside the editor, the user picks the document first. */
export function AskCommandGroup() {
	const { session } = useRouteContext({ strict: false });
	return session ? <AccountAskCommandGroup key={session.user.id} /> : null;
}

function AccountAskCommandGroup() {
	const state = useCommandPaletteStore();
	const reset = state.reset;
	const providers = useHasUsableAiProvider();
	const [setup, setSetup] = useState(false);
	const generation = getAccountGeneration();
	useLayoutEffect(
		() => () => {
			// Command pages remount this group; only an account change invalidates the whole task.
			if (generation !== getAccountGeneration()) reset();
		},
		[generation, reset],
	);
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const navigate = useNavigate();
	const picking = state.pages.at(-1) === "ask-documents";
	const documents = useQuery({
		...orpc.documents.list.queryOptions({ input: { trashed: false } }),
		enabled: picking,
	});
	const question = state.search.trim();
	const ready = () => {
		if (generation !== getAccountGeneration()) return false;
		if (providers.isUnavailable) {
			providers.retry();
			return false;
		}
		if (!providers.hasUsableProvider) {
			setSetup(true);
			return false;
		}
		return true;
	};
	const choose = async (document: NonNullable<typeof documents.data>[number]) => {
		const draft = state.askDraft;
		if (!draft || !ready()) return;
		if (document.type === "letter")
			await navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: document.id } });
		else await navigate({ to: "/builder/$resumeId", params: { resumeId: document.id } });
		if (generation !== getAccountGeneration()) return;
		openAssistantFrom({ draft });
		state.reset();
	};
	return (
		<>
			{question && (
				<BaseCommandGroup heading={<Trans>Ask</Trans>} forceMount>
					<CommandItem
						value={`ask ${question}`}
						onSelect={() => {
							if (!ready()) return;
							if (pathname.startsWith("/builder/")) {
								openAssistantFrom({ draft: question });
								state.reset();
							} else {
								useCommandPaletteStore.setState({ askDraft: question });
								state.pushPage("ask-documents");
							}
						}}
						disabled={providers.isLoading}
					>
						<Icon name="sparkle" size={16} />
						<span className="min-w-0 truncate">
							<Trans>Ask the assistant “{question}”</Trans>
						</span>
						{!providers.hasUsableProvider && (
							<span className="ms-auto shrink-0 text-xs text-ink-2">
								{providers.isLoading ? (
									<Trans>Loading…</Trans>
								) : providers.error ? (
									<Trans>Try again</Trans>
								) : (
									<Trans>Connect an AI provider</Trans>
								)}
							</span>
						)}
					</CommandItem>
				</BaseCommandGroup>
			)}
			<BaseCommandGroup
				page="ask-documents"
				heading={<Trans>Choose a document; review your question before sending</Trans>}
			>
				{documents.isPending ? (
					<CommandItem disabled value="ask.loading">{t`Loading documents…`}</CommandItem>
				) : documents.error ? (
					<CommandItem
						value="ask.retry"
						onSelect={() => void documents.refetch()}
					>{t`Couldn't load documents. Try again.`}</CommandItem>
				) : !documents.data?.length ? (
					<CommandItem disabled value="ask.empty">{t`Create a resume or letter first.`}</CommandItem>
				) : (
					[...documents.data]
						.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
						.map((document) => (
							<CommandItem
								key={document.id}
								value={`ask.document.${document.id}`}
								keywords={[document.name]}
								onSelect={() => void choose(document)}
							>
								<Icon name={document.type === "letter" ? "envelope-simple" : "file-text"} size={16} />
								{document.name}
							</CommandItem>
						))
				)}
			</BaseCommandGroup>
			<Dialog open={setup} onOpenChange={setSetup}>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							<Trans>Set up AI</Trans>
						</DialogTitle>
					</DialogHeader>
					<ProviderSetup />
				</DialogContent>
			</Dialog>
		</>
	);
}
