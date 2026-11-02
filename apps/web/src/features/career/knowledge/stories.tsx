import type { Fact, Story } from "../hooks";
import type { CareerStoryData } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { memo, useId, useState } from "react";
import * as z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { useCoachKnowledge } from "../coach-thread";
import { useSessionDraft } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { CollapseRow, Eyebrow, Swap, useCareerTime, useNow, withUndo } from "../shared";
import { collectInterviews, upcomingInterviews } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type PartKey = "situation" | "task" | "action" | "result" | "reflection";

/** STARR, in order. Situation, Task and Action are required; Result and Reflection stay blank until supported. */
const parts = () =>
	[
		{ key: "situation", letter: "S", label: t`Situation`, placeholder: t`What was happening before you started?` },
		{ key: "task", letter: "T", label: t`Task`, placeholder: t`What were you responsible for?` },
		{ key: "action", letter: "A", label: t`Action`, placeholder: t`What did you do, specifically?` },
		{
			key: "result",
			letter: "R",
			label: t`Result`,
			placeholder: t`What changed? Leave blank if you can’t support it.`,
		},
		{ key: "reflection", letter: "R", label: t`Reflection`, placeholder: t`What would you do differently?` },
	] satisfies { key: PartKey; letter: string; label: string; placeholder: string }[];

const REQUIRED: PartKey[] = ["situation", "task", "action"];

/** A backing fact was corrected after the story was last saved. */
const factChanged = (story: Story, facts: Map<string, Fact>) =>
	story.data.factIds.some((id) => {
		const at = facts.get(id)?.revisions.at(-1)?.at;
		return at !== undefined && new Date(at) > new Date(story.updatedAt);
	});

type StoriesPageProps = { storyId: string | undefined; edit: boolean };

export function StoriesPage({ storyId, edit }: StoriesPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const storyQuery = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const factQuery = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = storyQuery.data;
	const facts = factQuery.data;
	const [hidden, setHidden] = useState<string[]>([]);

	if ((!stories && storyQuery.isError) || (!facts && factQuery.isError))
		return (
			<CareerLoadError
				onRetry={() => {
					void storyQuery.refetch();
					void factQuery.refetch();
				}}
			/>
		);
	if (!stories || !facts) return <CareerLoading />;

	const factsById = new Map((facts ?? []).map((fact) => [fact.id, fact]));
	const list = stories.filter((story) => !hidden.includes(story.id));
	const selected = storyId ? list.find((story) => story.id === storyId) : edit ? undefined : list[0];
	const editing = edit && (selected !== undefined || !storyId);

	const open = (id: string | undefined, editMode = false) =>
		void navigate({
			to: "/dashboard/career/knowledge/stories/{-$storyId}",
			params: { storyId: id ?? undefined },
			search: editMode ? { edit: true } : {},
		});

	const remove = (story: Story) => {
		setHidden((current) => [...current, story.id]);
		open(undefined);
		withUndo({
			description: t`Story deleted`,
			onUndo: () => setHidden((current) => current.filter((id) => id !== story.id)),
			commit: () =>
				client.career
					.deleteStory({ id: story.id })
					.catch((error: unknown) => {
						setHidden((current) => current.filter((id) => id !== story.id));
						toastError(error, t`Couldn't delete that story. Try again.`);
					})
					.finally(() => {
						void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
						void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
					}),
		});
	};

	return (
		<div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
			<div className="grid content-start gap-2">
				<AnimatePresence initial={false}>
					{list.map((story) => (
						<StoryCard
							key={story.id}
							story={story}
							selected={story.id === selected?.id}
							changed={factChanged(story, factsById)}
						/>
					))}
				</AnimatePresence>
				<Link
					to="/dashboard/career/knowledge/stories/{-$storyId}"
					params={{ storyId: undefined }}
					search={{ edit: true }}
					className={cn(
						"touch-target relative flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-[13px] font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink",
						editing && !selected && "border-accent text-ink",
					)}
				>
					<Icon name="plus" size={18} />
					<Trans>Add a story</Trans>
				</Link>
				<p className="px-0.5 py-1 text-xs leading-[17px] text-ink-3">
					<Trans>
						Situation, Task, Action, Result, Reflection. Link each story to facts you can support; leave unknown
						outcomes blank.
					</Trans>
				</p>
			</div>

			{storyId && !selected ? (
				<div role="status" className="grid gap-2 rounded-xl border border-line p-6">
					<h2 className="text-lg font-semibold">
						<Trans>Story not found</Trans>
					</h2>
					<p className="text-sm text-ink-2">
						<Trans>It may have been deleted. Choose another story or add a new one.</Trans>
					</p>
					<Button variant="secondary" onClick={() => open(undefined)}>
						<Trans>Back to stories</Trans>
					</Button>
				</div>
			) : selected || editing ? (
				<div className="relative rounded-xl border border-line bg-surface px-4 py-5 sm:px-6 sm:py-[22px]">
					<Swap id={editing ? "edit" : "read"}>
						{editing ? (
							<StoryEditor
								key={selected?.id ?? "new"}
								story={selected}
								facts={facts ?? []}
								onSaved={(id) => open(id)}
								onCancel={() => open(selected?.id)}
								onDelete={selected ? () => remove(selected) : undefined}
							/>
						) : (
							selected && <StoryReader story={selected} facts={factsById} onEdit={() => open(selected.id, true)} />
						)}
					</Swap>
				</div>
			) : (
				<EmptyState
					title={<Trans>No stories yet</Trans>}
					description={
						<Trans>
							Write one about something you did, in five parts. Leave Result and Reflection blank until you can support
							them.
						</Trans>
					}
				/>
			)}
		</div>
	);
}

// ---- List ----

type StoryCardProps = { story: Story; selected: boolean; changed: boolean };

// Memoized with its motion wrapper: picking a story re-renders only the two cards whose selection changed.
const StoryCard = memo(function StoryCard({ story, selected, changed }: StoryCardProps) {
	const filled = parts().filter((part) => story.data[part.key].trim()).length;
	const factCount = story.data.factIds.length;

	return (
		<CollapseRow>
			<Link
				to="/dashboard/career/knowledge/stories/{-$storyId}"
				params={{ storyId: story.id }}
				aria-current={selected ? "page" : undefined}
				className={cn(
					"grid gap-2 rounded-xl border p-3.5 text-start transition-colors duration-quick",
					selected ? "border-accent bg-surface" : "border-line hover:bg-hover",
				)}
			>
				<span className="text-sm leading-5 font-semibold">{story.data.title}</span>
				<span className="text-xs text-ink-3">
					<Trans>{filled} of 5 parts</Trans> · {plural(factCount, { one: "# fact", other: "# facts" })}
				</span>
				<PartTiles story={story} />
				{changed && (
					<span className="flex items-center gap-1.5 text-xs text-warn-text">
						<span aria-hidden="true" className="size-2 shrink-0 rounded-sm bg-warn" />
						<Trans>A fact changed. Review this story.</Trans>
					</span>
				)}
			</Link>
		</CollapseRow>
	);
});

function PartTiles({ story }: { story: Story }) {
	return (
		<span aria-hidden="true" className="flex gap-[3px]">
			{parts().map((part) => (
				<span
					key={part.key}
					title={part.label}
					className={cn(
						"h-5 w-[22px] rounded-md text-center font-mono text-[11px] leading-5 font-semibold",
						story.data[part.key].trim() ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-3",
					)}
				>
					{part.letter}
				</span>
			))}
		</span>
	);
}

// ---- Reader ----

const partTile = (filled: boolean) =>
	cn(
		"size-7 rounded-lg text-center font-mono text-[13px] leading-7 font-semibold",
		filled ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-3",
	);

type StoryReaderProps = { story: Story; facts: Map<string, Fact>; onEdit: () => void };

function StoryReader({ story, facts, onEdit }: StoryReaderProps) {
	const backing = story.data.factIds.flatMap((id) => facts.get(id) ?? []);

	return (
		<div className="grid gap-[18px]">
			<header className="flex flex-wrap items-start gap-3">
				<div className="grid min-w-0 flex-1 basis-60 gap-1">
					<h2 className="font-display text-[22px] leading-7 font-medium text-pretty">{story.data.title}</h2>
					<p className="text-[13px] text-ink-3">{story.data.tags.join(" · ") || t`No tags yet`}</p>
				</div>
				<div className="flex gap-1.5">
					<PractiseButton storyId={story.id} />
					<Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={onEdit}>
						<Icon name="pencil-simple" size={18} />
						<Trans>Edit</Trans>
					</Button>
				</div>
			</header>

			<div className="grid">
				{parts().map((part) => {
					const text = story.data[part.key].trim();
					return (
						<div key={part.key} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3.5 border-t border-line py-3">
							<span aria-hidden="true" className={partTile(Boolean(text))}>
								{part.letter}
							</span>
							<div className="grid min-w-0 gap-1">
								<h3 className="text-[13px] font-semibold text-ink-2">{part.label}</h3>
								{text ? (
									<p className="text-[15px] leading-[23px] text-pretty whitespace-pre-line">{text}</p>
								) : (
									<p className="text-sm leading-[21px] text-ink-3 italic">
										<Trans>Not recorded yet. Leave it blank until you can support it.</Trans>
									</p>
								)}
							</div>
						</div>
					);
				})}
			</div>

			<div className="grid gap-2 pt-1">
				<Eyebrow>
					<Trans>Backed by</Trans>
				</Eyebrow>
				{backing.map((fact) => (
					<Link
						key={fact.id}
						to="/dashboard/career/knowledge/facts"
						search={{ highlight: fact.id }}
						className="flex items-start gap-2.5 rounded-md bg-bg px-2.5 py-2 text-[13px] leading-[19px] transition-colors duration-quick hover:bg-hover"
					>
						<Icon name="link-simple-horizontal" size={16} className="mt-0.5 shrink-0 text-accent-text" />
						<span className={cn(fact.status !== "active" && "text-ink-3")}>{fact.text}</span>
					</Link>
				))}
				{backing.length === 0 && (
					<p className="flex items-center gap-1.5 text-[13px] text-warn-text">
						<Icon name="warning" size={16} />
						<Trans>No supporting facts. Link one before using this story.</Trans>
					</p>
				)}
			</div>
		</div>
	);
}

/** Practise this story aloud in the workspace of the next upcoming interview. */
type PractiseButtonProps = { storyId: string };

/**
 * Practice a story out loud, in the workspace of an upcoming interview: the next one says which, several open a menu.
 * Only a story the coach can use (every backing fact switched on and unchanged since) can be practised; otherwise
 * the button says what to fix.
 */
function PractiseButton({ storyId }: PractiseButtonProps) {
	const navigate = useNavigate();
	const now = useNow();
	const { when } = useCareerTime();
	const knowledge = useCoachKnowledge(null);
	const { data: applications, isPending, isError, refetch } = useQuery(applicationsListQueryOptions());
	const open = (applications ?? []).filter((application) => application.status !== "closed");
	const upcoming = upcomingInterviews(collectInterviews(open), now).slice(0, 5);
	const story = knowledge.allStories.find((item) => item.id === storyId);
	const usable = knowledge.stories.some((item) => item.id === storyId);
	const label = (
		<>
			<Icon name="microphone" size={18} />
			<Trans context="Button: rehearse interview answers">Practice</Trans>
		</>
	);
	if (isError || knowledge.isError)
		return (
			<div role="alert">
				<Button
					variant="secondary"
					size="sm"
					onClick={() => {
						void refetch();
						knowledge.retry();
					}}
				>
					<Trans>Couldn't load interviews. Retry</Trans>
				</Button>
			</div>
		);
	if (isPending || !knowledge.loaded)
		return (
			<Button variant="ghost" size="sm" disabled>
				<Trans>Loading interviews…</Trans>
			</Button>
		);

	const reason = !usable
		? story?.data.factIds.length
			? t`A fact this story uses is switched off or changed since. Edit the story to check it.`
			: t`Link a fact to practice this story`
		: upcoming.length === 0
			? t`Add an interview first`
			: null;
	if (reason)
		return (
			<Tooltip>
				{/* Focusable while disabled (aria-disabled), so hover and keyboard still reach the tooltip. */}
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							disabled
							focusableWhenDisabled
							className="h-8 px-2.5 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:text-ink-3 aria-disabled:hover:bg-transparent"
						/>
					}
				>
					{label}
				</TooltipTrigger>
				<TooltipContent>{reason}</TooltipContent>
			</Tooltip>
		);

	const practise = (item: (typeof upcoming)[number]) =>
		void navigate({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId: item.application.id, tab: "practise" },
			search: { speak: true, story: storyId, round: item.interview.id },
		});
	const [next] = upcoming;
	if (upcoming.length === 1 && next)
		return (
			<Button variant="ghost" className="h-8 px-2.5 text-[13px] text-ink-2" onClick={() => practise(next)}>
				<Icon name="microphone" size={18} />
				<Trans context="Button: rehearse interview answers">Practice for {next.application.company}</Trans>
			</Button>
		);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="ghost" className="h-8 px-2.5 text-[13px] text-ink-2" />}>
				{label}
				<Icon name="caret-down" size={16} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<Trans>Practice for which interview?</Trans>
					</DropdownMenuLabel>
					{upcoming.map((item) => (
						<DropdownMenuItem key={item.interview.id} onClick={() => practise(item)}>
							<span className="grid min-w-0">
								<span className="truncate">{item.application.company}</span>
								<span className="text-xs text-ink-3">{when(item.start)}</span>
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ---- Editor ----

const storyDraftSchema = z.object({
	title: z.string(),
	situation: z.string(),
	task: z.string(),
	action: z.string(),
	result: z.string(),
	reflection: z.string(),
	tags: z.string(),
	factIds: z.array(z.string()),
});

type StoryEditorProps = {
	story: Story | undefined;
	facts: Fact[];
	onSaved: (id: string) => void;
	onCancel: () => void;
	onDelete: (() => void) | undefined;
	/**
	 * A coach's proposal opened with Edit first: its parts start the draft, which lives under the proposal's key and is
	 * kept on Cancel, so the review card can be reopened with the edits. Saved in the proposal's scope.
	 */
	proposal?: { key: string; story: Omit<CareerStoryData, "applicationId">; applicationId: string | null };
};

export function StoryEditor({ story, facts, onSaved, onCancel, onDelete, proposal }: StoryEditorProps) {
	const queryClient = useQueryClient();
	const start = proposal?.story ?? story?.data;
	const applicationId = proposal ? proposal.applicationId : null;
	const {
		value: draft,
		setValue: setDraft,
		clear,
	} = useSessionDraft(
		proposal ? `story:proposal:${proposal.key}` : `story:${story?.id ?? "new"}`,
		{
			title: start?.title ?? "",
			situation: start?.situation ?? "",
			task: start?.task ?? "",
			action: start?.action ?? "",
			result: start?.result ?? "",
			reflection: start?.reflection ?? "",
			tags: start?.tags.join(", ") ?? "",
			factIds: start?.factIds ?? [],
		},
		(value) => {
			const result = storyDraftSchema.safeParse(value);
			return result.success ? result.data : undefined;
		},
	);
	const [tried, setTried] = useState(false);
	const errorId = useId();
	// A story rests on facts in its own scope: shared ones, plus the application's own for a story kept with one
	// application. Switched-off ones are listed but can't be ticked; the server checks all of this again on save.
	const shared = facts.filter((fact) => fact.applicationId === null || fact.applicationId === applicationId);
	const unavailable = draft.factIds.filter((id) => !shared.some((fact) => fact.id === id && fact.status === "active"));
	const usable = new Set(shared.filter((fact) => fact.status === "active").map((fact) => fact.id));

	const save = useMutation({
		...orpc.career.saveStory.mutationOptions(),
		onSuccess: (row) => {
			clear();
			// Newest first, as the server orders them, so the reader opens on it before the refetch lands.
			queryClient.setQueryData<Story[]>(orpc.career.stories.queryKey({ input: { applicationId } }), (list) => [
				row,
				...(list ?? []).filter((item) => item.id !== row.id),
			]);
			void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			onSaved(row.id);
		},
		onError: (error) => toastError(error, t`Couldn't save the story. Try again.`),
	});

	const missingParts = REQUIRED.filter((key) => !draft[key].trim());
	const missingTitle = !draft.title.trim();

	const submit = (form: HTMLFormElement) => {
		setTried(true);
		if (missingTitle || missingParts.length) {
			requestAnimationFrame(() => form.querySelector<HTMLTextAreaElement>('[aria-invalid="true"]')?.focus());
			return;
		}
		save.mutate({
			...(story ? { id: story.id } : {}),
			applicationId,
			title: draft.title.trim(),
			situation: draft.situation.trim(),
			task: draft.task.trim(),
			action: draft.action.trim(),
			result: draft.result.trim(),
			reflection: draft.reflection.trim(),
			factIds: draft.factIds.filter((id) => usable.has(id)),
			tags: [...new Set(draft.tags.split(",").map((tag) => tag.trim()))].filter(Boolean).slice(0, 20),
		});
	};

	const toggleFact = (id: string, checked: boolean) =>
		setDraft((current) => ({
			...current,
			factIds: checked ? [...current.factIds, id] : current.factIds.filter((item) => item !== id),
		}));

	return (
		<form
			className="grid gap-[18px]"
			onSubmit={(event) => {
				event.preventDefault();
				submit(event.currentTarget);
			}}
		>
			<div className="grid gap-2">
				{/* A textarea so a long title wraps as it does in the reader; Enter doesn't add a line. */}
				<Textarea
					rows={1}
					value={draft.title}
					maxLength={200}
					placeholder={t`Name the story`}
					aria-label={t`Title`}
					aria-required
					aria-describedby={tried && missingTitle ? `${errorId}-title` : undefined}
					aria-invalid={tried && missingTitle ? true : undefined}
					onChange={(event) => setDraft({ ...draft, title: event.target.value.replace(/\n/g, " ") })}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.preventDefault();
					}}
					className="min-h-0 resize-none py-1 font-display text-[22px] leading-7 font-medium"
				/>
				{tried && missingTitle && (
					<p id={`${errorId}-title`} role="alert" className="flex items-center gap-1.5 text-[13px] text-danger-text">
						<Icon name="warning-circle" size={16} className="shrink-0" aria-hidden="true" />
						<Trans>Give the story a title before you can save.</Trans>
					</p>
				)}
				<Input
					value={draft.tags}
					placeholder={t`Tags, separated by commas`}
					aria-label={t`Tags`}
					onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
					className="h-8 text-[13px]"
				/>
			</div>

			<p className="text-sm text-ink-3">
				<Trans>
					Give the story a title, then fill in Situation, Task and Action. Leave Result and Reflection blank until you
					can support them.
				</Trans>
			</p>
			<div className="grid">
				{parts().map((part) => {
					const text = draft[part.key];
					const required = REQUIRED.includes(part.key);
					const invalid = tried && missingParts.includes(part.key);
					return (
						<label key={part.key} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3.5 border-t border-line py-3">
							<span aria-hidden="true" className={partTile(Boolean(text.trim()))}>
								{part.letter}
							</span>
							<span className="grid min-w-0 gap-1.5">
								<span id={`${errorId}-label-${part.key}`} className="text-[13px] font-semibold text-ink-2">
									{/* One rule, said once above: only the parts that may stay blank are marked. */}
									{required ? part.label : `${part.label} ${t`(optional)`}`}
								</span>
								<Textarea
									rows={2}
									value={text}
									maxLength={part.key === "action" ? 6000 : 4000}
									placeholder={part.placeholder}
									aria-labelledby={`${errorId}-label-${part.key}`}
									aria-required={required}
									aria-invalid={invalid || undefined}
									aria-describedby={invalid ? `${errorId}-${part.key}` : undefined}
									onChange={(event) => setDraft({ ...draft, [part.key]: event.target.value })}
									className="min-h-[60px] py-[9px] text-sm leading-[21px]"
								/>
								{invalid && (
									<span
										id={`${errorId}-${part.key}`}
										role="alert"
										className="flex items-center gap-1.5 text-[13px] text-danger-text"
									>
										<Icon name="warning-circle" size={16} className="shrink-0" aria-hidden="true" />
										{t`Complete ${part.label} before saving.`}
									</span>
								)}
							</span>
						</label>
					);
				})}
			</div>

			<fieldset className="grid gap-2 pt-1">
				<legend className="mb-2 text-xs font-semibold text-ink-3">
					<Trans>Backed by</Trans>
				</legend>
				{shared.map((fact) => {
					const disabled = fact.status !== "active";
					const checked = draft.factIds.includes(fact.id) && !disabled;
					return (
						<label
							key={fact.id}
							className={cn(
								"flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] leading-[19px] transition-colors duration-quick",
								checked ? "bg-accent-soft" : "bg-bg",
								disabled ? "cursor-not-allowed text-ink-3" : "cursor-pointer",
							)}
						>
							<Checkbox
								checked={checked}
								disabled={disabled}
								onCheckedChange={(value) => toggleFact(fact.id, value)}
								className="mt-px"
							/>
							<span className="min-w-0 flex-1">
								{fact.text}
								{disabled && (
									<span className="block text-xs text-ink-3">
										<Trans>Not used in coaching, so it can't back a story.</Trans>
									</span>
								)}
							</span>
						</label>
					);
				})}
				{shared.length === 0 && (
					<p className="text-[13px] text-ink-3">
						<Trans>No facts to link yet. Add them in Facts.</Trans>
					</p>
				)}
				{unavailable.length > 0 && (
					<p role="status" className="flex items-start gap-1.5 text-[13px] text-warn-text">
						<Icon name="warning" size={16} className="mt-px shrink-0" />
						{plural(unavailable.length, {
							one: "# proposed fact isn't available here and won't back the story.",
							other: "# proposed facts aren't available here and won't back the story.",
						})}
					</p>
				)}
			</fieldset>

			<div className="grid gap-2 border-t border-line pt-3.5">
				<div className="flex flex-wrap items-center gap-2">
					{onDelete && (
						<Button
							variant="ghost"
							className="me-auto text-danger-text"
							onClick={() => {
								clear();
								onDelete();
							}}
						>
							<Icon name="trash" size={18} />
							<Trans>Delete story</Trans>
						</Button>
					)}
					<div className="ms-auto flex gap-2">
						<Button
							variant="ghost"
							className="text-ink-2"
							onClick={() => {
								if (!proposal) clear();
								onCancel();
							}}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" loading={save.isPending}>
							<Trans>Save story</Trans>
						</Button>
					</div>
				</div>
			</div>
		</form>
	);
}
