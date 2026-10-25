import type { ThreadSummary } from "./chat";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { refreshThreads } from "./chat";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { ConfirmDialog, IconButton, ListRow, Text, showToast, useTheme } from "@/ui";

/** "Find weak bullets" — the server titles new conversations in English until their first message. */
export const useThreadTitle = () => {
	const { t } = useLingui();
	return (thread: ThreadSummary | undefined) =>
		thread && thread.title !== "New conversation" ? thread.title : t`New conversation`;
};

/** "Oct 12, 14:20". */
export function useThreadTime() {
	const { i18n } = useLingui();
	const format = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" });
	return (value: Date | string) => format.format(new Date(value));
}

/** Deletes a conversation after a confirmation; accepted edits stay in the document. */
export function useDeleteThread(onDeleted?: (id: string) => void) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const scope = getAccountScope();
	const [target, setTarget] = useState<ThreadSummary | null>(null);
	const dialog = (
		<ConfirmDialog
			open={target !== null}
			title={t`Delete this conversation?`}
			message={t`Its messages and attachments are deleted. Edits you accepted stay in the document.`}
			confirmLabel={t`Delete conversation`}
			destructive
			onCancel={() => setTarget(null)}
			onConfirm={() => {
				const thread = target;
				setTarget(null);
				if (!thread || !scope) return;
				client.agent.threads
					.delete({ id: thread.id }, { context: { scope } })
					.then(() => {
						refreshThreads(queryClient);
						onDeleted?.(thread.id);
					})
					.catch(() => showToast({ message: t`Couldn't delete the conversation. Try again.` }));
			}}
		/>
	);
	return { ask: setTarget, dialog };
}

type PastConversationsProps = {
	threads: readonly ThreadSummary[];
	/** Conversations about the open document come first. */
	isMine: (thread: ThreadSummary) => boolean;
	currentId: string | null;
	onOpen: (thread: ThreadSummary) => void;
	onDeleted: (id: string) => void;
};

/** Conversations grouped by document, titled by their task, with what came of them. */
export function PastConversations({ threads, isMine, currentId, onOpen, onDeleted }: PastConversationsProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const title = useThreadTitle();
	const time = useThreadTime();
	const remove = useDeleteThread(onDeleted);
	const mine = threads.filter(isMine);
	const others = threads.filter((thread) => !isMine(thread) && (thread.workingResumeId || thread.coverLetterId));

	const outcome = (thread: ThreadSummary) =>
		thread.editsProposed === 0
			? t`no edits`
			: plural(thread.editsProposed, {
					one: `${thread.editsAccepted} of # edit accepted`,
					other: `${thread.editsAccepted} of # edits accepted`,
				});

	const row = (thread: ThreadSummary, other: boolean) => (
		<ListRow
			key={thread.id}
			title={title(thread)}
			subtitle={[
				time(thread.lastMessageAt),
				outcome(thread),
				...(other ? [thread.coverLetterName ?? thread.resumeName ?? ""] : []),
			]
				.filter(Boolean)
				.join(" · ")}
			selected={thread.id === currentId}
			onPress={() => onOpen(thread)}
			trailing={<IconButton icon="dots-three" label={t`Delete ${title(thread)}`} onPress={() => remove.ask(thread)} />}
		/>
	);

	return (
		<ScrollView contentContainerStyle={{ paddingVertical: space.s3 }}>
			<Section title={t`This document`}>
				{mine.length > 0 ? (
					mine.map((thread) => row(thread, false))
				) : (
					<Text color="ink2" style={{ paddingHorizontal: space.s4, paddingVertical: space.s2 }}>
						<Trans>No conversations about this document yet.</Trans>
					</Text>
				)}
			</Section>
			{others.length > 0 ? (
				<Section title={t`Other documents · ${others.length}`}>{others.map((thread) => row(thread, true))}</Section>
			) : null}
			{remove.dialog}
		</ScrollView>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space.s1, marginBottom: space.s4 }}>
			<Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ paddingHorizontal: space.s4 }}>
				{title}
			</Text>
			{children}
		</View>
	);
}
