import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { SavedItemKind, WorkspaceTab } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { useSavedItems } from "../hooks";
import { CareerLoadError } from "../load-state";
import { formatMoney } from "../offer-compare";
import { useRemoving } from "../removing";
import { CollapseRow, tabLabel, useCareerTime, withQueryUndo } from "../shared";
import { Chip } from "@/components/calm/filter-bar";
import { HeroCard } from "@/components/calm/hero-card";
import { ListRow, IconTile, revealOnRowClassName } from "@/components/calm/list-row";
import { PageHeader } from "@/components/calm/page";
import { AiResultUsage } from "@/features/ai/usage";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

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

/** W18: saved records for this job, newest first, each opening read-only in the tab that made it. */
export function SavedTab({ application, interview, go }: WorkspaceTabProps) {
	const company = application.company;
	const time = useCareerTime();
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const [filter, setFilter] = useState<SavedItemKind | null>(null);
	const { add: hide, drop: unhide } = useRemoving.getState();
	const [expanded, setExpanded] = useState<string | null>(null);

	if (saved.isPending)
		return (
			<div className="grid gap-3">
				<PageHeader title={t`Library`} />
				<Skeleton className="h-8 w-1/2" />
				<Skeleton className="h-72 rounded-xl" />
			</div>
		);

	// A failed load isn't "nothing saved": it says so, with Retry.
	if (saved.isError && !saved.data) return <CareerLoadError onRetry={() => void saved.refetch()} />;

	// useSavedItems already leaves out items whose Undo is still showing.
	const items = saved.data ?? [];
	const present = KINDS.filter(({ kind }) => items.some((item) => item.data.kind === kind));
	const current =
		application.status === "interview"
			? items.find((item) => item.data.kind === "briefing" && (!interview || item.interviewId === interview.id))
			: undefined;
	const shown = items.filter((item) => item.id !== current?.id && (filter === null || item.data.kind === filter));

	if (items.length === 0)
		return (
			<>
				<PageHeader title={t`Library`} />
				<EmptyState
					title={<Trans>Nothing in your library yet</Trans>}
					description={
						<Trans>
							Fit checks, briefings, practice feedback, debriefs, answers, replies and offers land here as you save
							them.
						</Trans>
					}
				/>
			</>
		);

	const onDelete = (item: SavedItem) => {
		if (filter === item.data.kind && shown.length === 1) setFilter(null);
		hide(item.id);
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.savedItems.key(),
			description: t`Deleted from Library`,
			errorMessage: t`Couldn't save that change. Check your connection and try again.`,
			prepare: () => prepareRpc(client.career.deleteSavedItem, { id: item.id }),
			hide: () => hide(item.id),
			restore: () => unhide(item.id),
		});
	};

	return (
		<div>
			<PageHeader
				title={t`Library`}
				className="[&>div]:min-h-9 [&>p]:pt-1 [&>p]:text-sm/5"
				subtitle={t`What you saved while working on ${company}. Each opens read-only in the place that made it.`}
			/>
			{current && (
				<HeroCard
					wide
					className="relative mt-5 gap-4 py-4 ps-[76px] pe-5 sm:gap-4 [&_h2]:t-label [&>div:first-child]:gap-0 [&>div:first-child>p:last-child]:max-w-none [&>div:first-child>p:last-child]:text-[13px]/[18px] [&>div:first-child>p:last-child]:text-ink-3 [&>div:last-child]:flex-none"
					title={current.data.kind === "briefing" ? current.data.headline : current.title}
					kicker={
						<>
							<IconTile accent className="absolute start-5 top-1/2 -translate-y-1/2">
								<Icon name="clipboard-text" size={20} />
							</IconTile>
							{interview
								? t`In use for ${time.format(interview.at, { weekday: "long" })}'s interview`
								: t`In use for the next interview`}
						</>
					}
					actions={
						<Button onClick={() => go("prepare", { version: current.id })}>
							<Trans>Open briefing</Trans>
						</Button>
					}
				>
					{t`Briefing · ${time.when(current.createdAt)} · used ${sourcesOf(current)}`}
				</HeroCard>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3 pt-6 pb-2">
				<div className="flex flex-wrap gap-1.5">
					<Chip pressed={filter === null} onClick={() => setFilter(null)}>
						<Trans>All</Trans>
						<span className="font-mono text-xs">{items.length}</span>
					</Chip>
					{present.map(({ kind }) => (
						<Chip key={kind} pressed={filter === kind} onClick={() => setFilter(kind)}>
							{kindLabel(kind)}
						</Chip>
					))}
				</div>
				<p className="text-[13px]/[18px] text-ink-3">
					<Trans>Newest first</Trans>
				</p>
			</div>

			<div role="list" className="">
				<AnimatePresence initial={false}>
					{shown.map((item) => (
						<CollapseRow key={item.id} role="listitem" className="border-t border-line first:border-t-0">
							<SavedRow
								item={item}
								applicationId={application.id}
								expanded={expanded === item.id}
								onToggle={() => setExpanded((current) => (current === item.id ? null : item.id))}
								onOpen={(tab) => go(tab, { version: item.id })}
								onDelete={() => onDelete(item)}
							/>
						</CollapseRow>
					))}
				</AnimatePresence>
			</div>
		</div>
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
	const { when } = useCareerTime();
	const { i18n } = useLingui();
	const { data: facts } = useQuery(orpc.career.facts.queryOptions({ input: { applicationId } }));
	const meta = KINDS.find(({ kind }) => kind === item.data.kind) ?? KINDS[0];
	const used = sourcesOf(item);
	const usedFacts = item.evidence.factIds.flatMap((id) => facts?.find((fact) => fact.id === id)?.text ?? []);
	const summaryId = `${item.id}-summary`;

	return (
		<ListRow
			className="items-start [&>span:first-child]:mt-0.5"
			interactive
			leading={
				<IconTile>
					<Icon name={meta?.icon ?? "file-text"} size={20} />
				</IconTile>
			}
			title={
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={summaryId}
					onClick={onToggle}
					className="text-start hover:underline"
				>
					{item.title}
				</button>
			}
			subtitle={
				<>
					{kindLabel(item.data.kind)} · {when(item.createdAt)}
					{item.data.kind === "practice" && <> · {item.data.mode === "typed" ? t`typed` : t`spoken`}</>}
					{used && (
						<>
							{" "}
							·{" "}
							{usedFacts.length > 0 ? (
								<Tooltip>
									<TooltipTrigger
										render={<span className="cursor-help underline decoration-dotted underline-offset-3" />}
									>{t`used ${used}`}</TooltipTrigger>
									<TooltipContent className="grid max-w-sm gap-1">
										{usedFacts.map((text) => (
											<span key={text}>{text}</span>
										))}
									</TooltipContent>
								</Tooltip>
							) : (
								t`used ${used}`
							)}
						</>
					)}
					{expanded && (
						<span id={summaryId} className="block pt-1.5 text-sm/[21px] whitespace-normal text-ink-2">
							{summaryOf(item, i18n.locale)}
						</span>
					)}
					<AiResultUsage usage={item.aiUsage} />
				</>
			}
			trailing={
				<div className="flex items-center gap-3.5 pt-2.5">
					<IconButton
						icon="trash"
						label={t`Delete`}
						size="icon-sm"
						iconSize={16}
						className={cn("text-ink-2", revealOnRowClassName)}
						onClick={onDelete}
					/>
					{meta?.tab ? (
						<Button
							variant="link"
							className="h-auto p-0 text-sm/5 text-accent-text"
							onClick={() => meta.tab && onOpen(meta.tab)}
						>{t`Open in ${tabLabel(meta.tab)}`}</Button>
					) : (
						<Link to="/dashboard/career/offers" search={{ a: item.id }} className="text-sm/5 text-accent-text">
							<Trans>Open in Offers</Trans>
						</Link>
					)}
				</div>
			}
		/>
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
			return t`${i18n.number(count("supported"))} supported, ${i18n.number(count("partial"))} partly supported, ${i18n.number(count("missing"))} with no evidence yet. ${data.summary}`;
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
