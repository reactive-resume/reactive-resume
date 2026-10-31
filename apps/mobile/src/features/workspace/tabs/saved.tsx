// Saved (web workspace/saved.tsx, W18): saved records for this job, newest first, each opening read-only
// in the tab that made it.
import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { IconName } from "@/ui";
import type { SavedItemKind, WorkspaceTab } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useFacts, useSavedItems } from "../hooks";
import { Actions, Block, tabLabel } from "../parts";
import { WorkspaceScreen } from "../shell";
import { dispatchForOrigin } from "../state";
import { client, orpc } from "@/api/client";
import { getDraftScope } from "@/draft";
import { useUserTime } from "@/features/application-detail/hooks";
import { formatMoney } from "@/features/career/offer-compare";
import { withUndo } from "@/features/career/undo";
import { routes } from "@/routes";
import { Button, Chip, EmptyState, Icon, IconButton, Skeleton, Text, showToast, useTheme } from "@/ui";

const KINDS: { kind: SavedItemKind; icon: IconName; tab: WorkspaceTab | null }[] = [
	{ kind: "fit", icon: "list-checks", tab: "fit" },
	{ kind: "briefing", icon: "clipboard-text", tab: "prepare" },
	{ kind: "practice", icon: "user-sound", tab: "practise" },
	{ kind: "debrief", icon: "chat-centered-text", tab: "debrief" },
	{ kind: "answers", icon: "pencil-line", tab: "apply" },
	{ kind: "reply", icon: "envelope-simple", tab: "messages" },
	{ kind: "offer", icon: "scales", tab: null },
];

const kindLabel = (kind: SavedItemKind) =>
	({
		fit: t({ message: "Fit", context: "Application workspace tab: how well a job fits your experience" }),
		briefing: t`Briefing`,
		practice: t`Practice`,
		debrief: t`Debrief`,
		answers: t`Answers`,
		reply: t`Reply`,
		offer: t`Offer`,
	})[kind];

export function SavedTab() {
	return <WorkspaceScreen tab="saved">{(props) => <Saved {...props} />}</WorkspaceScreen>;
}

function Saved({ application, go }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const [filter, setFilter] = useState<SavedItemKind | null>(null);
	const [hidden, setHidden] = useState<string[]>([]);
	const [expanded, setExpanded] = useState<string | null>(null);
	const company = application.company;

	if (saved.isPending) return <Skeleton height={space.s12 * 5} />;

	const items = (saved.data ?? []).filter((item) => !hidden.includes(item.id));
	const present = KINDS.filter(({ kind }) => items.some((item) => item.data.kind === kind));
	const shown = items.filter((item) => filter === null || item.data.kind === filter);

	if (items.length === 0)
		return (
			<EmptyState
				variant="card"
				title={t`Nothing in your library yet`}
				message={t`Fit checks, briefings, practice feedback, debriefs, answers, replies and offers land here as you save them.`}
			>
				<Button variant="secondary" label={t`Check fit`} onPress={() => go("fit")} />
			</EmptyState>
		);

	const onDelete = (item: SavedItem) => {
		if (filter === item.data.kind && shown.length === 1) setFilter(null);
		setHidden((ids) => [...ids, item.id]);
		const origin = getDraftScope();
		withUndo({
			message: t`Deleted from Library`,
			restore: () => setHidden((ids) => ids.filter((id) => id !== item.id)),
			failed: () => showToast({ message: t`Couldn't delete it. It's back in Library.` }),
			// Dropped if another account is signed in when the Undo window ends.
			commit: () =>
				dispatchForOrigin(origin, getDraftScope, async () => {
					await client.career.deleteSavedItem({ id: item.id });
					await queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
				}),
		});
	};

	return (
		<View style={{ gap: space.s4 }}>
			<Actions>
				<Chip label={t`All`} selected={filter === null} onPress={() => setFilter(null)} />
				{present.map(({ kind }) => (
					<Chip key={kind} label={kindLabel(kind)} selected={filter === kind} onPress={() => setFilter(kind)} />
				))}
			</Actions>
			<Text variant="caption" color="ink3">
				{t`Library items for ${company}, newest first.`}
			</Text>
			{shown.map((item) => (
				<SavedRow
					key={item.id}
					item={item}
					applicationId={application.id}
					expanded={expanded === item.id}
					onToggle={() => setExpanded((current) => (current === item.id ? null : item.id))}
					onOpen={(tab) => go(tab, { version: item.id })}
					onDelete={() => onDelete(item)}
				/>
			))}
		</View>
	);
}

type SavedRowProps = {
	item: SavedItem;
	applicationId: string;
	expanded: boolean;
	onToggle: () => void;
	onOpen: (tab: WorkspaceTab) => void;
	onDelete: () => void;
};

function SavedRow({ item, applicationId, expanded, onToggle, onOpen, onDelete }: SavedRowProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, space } = useTheme();
	const router = useRouter();
	const { when } = useUserTime();
	const facts = useFacts(applicationId);
	const meta = KINDS.find(({ kind }) => kind === item.data.kind) ?? KINDS[0];
	const used = sourcesOf(item);
	const usedFacts = item.evidence.factIds.flatMap((id) => facts.data?.find((fact) => fact.id === id)?.text ?? []);
	const tab = meta?.tab ?? null;
	const tabName = tab ? tabLabel(tab) : "";
	const subtitle = [kindLabel(item.data.kind), when(item.createdAt), used ? t`used ${used}` : ""]
		.filter(Boolean)
		.join(" · ");

	return (
		<Block>
			<View style={{ flexDirection: "row", gap: space.s3 }}>
				<View
					style={{
						width: 34,
						height: 34,
						borderRadius: radius.rMd,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: colors.sunken,
					}}
				>
					<Icon name={meta?.icon ?? "file-text"} size={19} color={colors.ink2} />
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityState={{ expanded }}
					onPress={onToggle}
					style={{ flex: 1, gap: space.s0 }}
				>
					<Text variant="label">{item.title}</Text>
					<Text variant="caption" color="ink3">
						{subtitle}
					</Text>
				</Pressable>
				<IconButton icon="trash" label={t`Delete`} onPress={onDelete} />
			</View>
			{expanded ? (
				<View style={{ gap: space.s2 }}>
					<Text color="ink2">{summaryOf(item, i18n.locale)}</Text>
					{usedFacts.map((text) => (
						<Text key={text} variant="callout" color="ink3">
							· {text}
						</Text>
					))}
				</View>
			) : null}
			{tab ? (
				<Button variant="secondary" size="sm" label={t`Open in ${tabName}`} onPress={() => onOpen(tab)} />
			) : (
				<Button
					variant="secondary"
					size="sm"
					label={t`Open in Offers`}
					onPress={() => router.push(routes.career("offers"))}
				/>
			)}
		</Block>
	);
}

/** "3 facts, 2 stories, posting": what the coach read to write it. */
function sourcesOf(item: SavedItem) {
	const parts: string[] = [];
	const facts = item.evidence.factIds.length;
	const stories = item.evidence.storyIds.length;
	if (facts) parts.push(plural(facts, { one: "# fact", other: "# facts" }));
	if (stories) parts.push(plural(stories, { one: "# story", other: "# stories" }));
	const kind = item.data.kind;
	if (kind === "fit" || kind === "briefing") parts.push(t`posting`);
	if (kind === "debrief") parts.push(t`your notes`);
	if (kind === "reply") parts.push(t`the message`);
	return parts.join(", ");
}

/** One paragraph per kind, from the stored structure (no prose parsing, works without AI). */
function summaryOf(item: SavedItem, locale: string): string {
	const data = item.data;
	switch (data.kind) {
		case "fit": {
			const count = (status: string) => data.requirements.filter((requirement) => requirement.status === status).length;
			const supported = count("supported");
			const partial = count("partial");
			const missing = count("missing");
			const summary = data.summary;
			return t`${supported} supported, ${partial} partly supported, ${missing} with no evidence yet. ${summary}`;
		}
		case "briefing":
			return [data.focus, data.honesty].filter(Boolean).join(" ");
		case "practice":
			return [data.works, data.strengthen].filter(Boolean).join(" ");
		case "debrief":
			return [data.nextRound, data.priority].filter(Boolean).join(" ");
		case "answers":
			return `${plural(data.answers.length, { one: "# answer", other: "# answers" })}: ${data.answers.map((answer) => answer.question).join(" · ")}`;
		case "reply":
			return [...data.asks, ...data.unconfirmed].join(" ");
		case "offer": {
			const base = data.base === null ? null : formatMoney(locale, data.currency, data.base);
			return [base, data.location, data.leave].filter(Boolean).join(" · ");
		}
	}
}
