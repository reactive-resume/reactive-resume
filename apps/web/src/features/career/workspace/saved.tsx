import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { SavedItemKind, WorkspaceTab } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useSavedItems } from "../hooks";
import { formatMoney } from "../offer-compare";
import { CollapseRow, FilterChip, tabLabel, useCareerTime, withUndo } from "../shared";
import { orpc } from "@/libs/orpc/client";

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
export function SavedTab({ application, go }: WorkspaceTabProps) {
	const company = application.company;
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const remove = useMutation(orpc.career.deleteSavedItem.mutationOptions());
	const [filter, setFilter] = useState<SavedItemKind | null>(null);
	const [hidden, setHidden] = useState<string[]>([]);
	const [expanded, setExpanded] = useState<string | null>(null);

	if (saved.isPending)
		return (
			<div className="grid gap-3">
				<Skeleton className="h-8 w-1/2" />
				<Skeleton className="h-72 rounded-xl" />
			</div>
		);

	const items = (saved.data ?? []).filter((item) => !hidden.includes(item.id));
	const present = KINDS.filter(({ kind }) => items.some((item) => item.data.kind === kind));
	const shown = items.filter((item) => filter === null || item.data.kind === filter);

	if (items.length === 0)
		return (
			<div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line-2 p-7 text-center">
				<h2 className="font-display text-[22px] leading-7 font-medium">
					<Trans>Nothing saved yet</Trans>
				</h2>
				<p className="max-w-[340px] text-sm text-ink-2">
					<Trans>
						Fit checks, briefings, practice feedback, debriefs, answers, replies and offers land here as you save them.
					</Trans>
				</p>
			</div>
		);

	const onDelete = (item: SavedItem) => {
		if (filter === item.data.kind && shown.length === 1) setFilter(null);
		setHidden((ids) => [...ids, item.id]);
		withUndo({
			description: t`Deleted from Saved`,
			onUndo: () => setHidden((ids) => ids.filter((id) => id !== item.id)),
			commit: () =>
				remove
					.mutateAsync({ id: item.id })
					.then(() => queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() }))
					.catch(() => setHidden((ids) => ids.filter((id) => id !== item.id))),
		});
	};

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap gap-1.5">
					<FilterChip pressed={filter === null} onClick={() => setFilter(null)}>
						<Trans>All</Trans>
					</FilterChip>
					{present.map(({ kind }) => (
						<FilterChip key={kind} pressed={filter === kind} onClick={() => setFilter(kind)}>
							{kindLabel(kind)}
						</FilterChip>
					))}
				</div>
				<p className="text-xs text-ink-3">{t`Saved items for ${company}, newest first.`}</p>
			</div>

			<div role="list" className="overflow-hidden rounded-xl border border-line bg-surface">
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
		<div className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-x-3 px-4 py-3.5 sm:grid-cols-[34px_minmax(0,1fr)_auto]">
			<span className="grid size-[34px] place-items-center rounded-lg bg-sunken text-ink-2">
				<Icon name={meta?.icon ?? "file-text"} size={19} />
			</span>
			<div className="grid min-w-0 gap-0.5">
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={summaryId}
					onClick={onToggle}
					className="w-fit text-start text-sm font-semibold hover:underline hover:underline-offset-3"
				>
					{item.title}
				</button>
				<p className="text-xs text-ink-3">
					{kindLabel(item.data.kind)} · {when(item.createdAt)}
					{used && (
						<>
							{" · "}
							{usedFacts.length > 0 ? (
								<Tooltip>
									<TooltipTrigger
										render={<span className="cursor-help underline decoration-dotted underline-offset-3" />}
									>
										{t`used ${used}`}
									</TooltipTrigger>
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
				</p>
			</div>
			<div className="col-start-2 mt-2 flex items-center gap-1 sm:col-start-3 sm:row-start-1 sm:mt-0">
				{meta?.tab ? (
					<Button size="sm" variant="secondary" className="h-8" onClick={() => meta.tab && onOpen(meta.tab)}>
						{t`Open in ${tabLabel(meta.tab)}`}
					</Button>
				) : (
					<Link
						to="/dashboard/career/offers"
						search={{ a: item.id }}
						className={buttonVariants({ size: "sm", variant: "secondary", className: "h-8" })}
					>
						<Trans>Open in Offers</Trans>
					</Link>
				)}
				<IconButton
					icon="trash"
					label={t`Delete`}
					size="icon-sm"
					iconSize={18}
					className="text-ink-2"
					onClick={onDelete}
				/>
			</div>
			<AnimatePresence initial={false}>
				{expanded && (
					<CollapseRow id={summaryId} className="col-span-full sm:ps-[46px]">
						<p className="pt-2.5 text-sm leading-[21px] text-ink-2">{summaryOf(item, i18n.locale)}</p>
					</CollapseRow>
				)}
			</AnimatePresence>
		</div>
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
			return t`${count("supported")} supported, ${count("partial")} partly supported, ${count("missing")} with no evidence yet. ${data.summary}`;
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
