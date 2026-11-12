import type { Fact, Story } from "../hooks";
import type { CareerStoryData } from "@reactive-resume/schema/career";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { memo, useId, useState } from "react";
import * as z from "zod";
import { storyDraftFactIds } from "@reactive-resume/schema/career-practice";
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
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { useCoachKnowledge } from "../coach-thread";
import { useSessionDraft } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { useRemoving } from "../removing";
import { CollapseRow, useCareerTime, useNow, withQueryUndo } from "../shared";
import { StoryPractice } from "../workspace/practise";
import { KnowledgeFrame } from "./frame";
import { ChipField } from "./preferences";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { collectInterviews, upcomingInterviews } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

type PartKey = "situation" | "task" | "action" | "result" | "reflection";

/** The five parts, in order. Situation, Task and Action are required; Result and Reflection stay blank until supported. */
const parts = () =>
	[
		{ key: "situation", label: t`Situation`, placeholder: t`What was happening before you started?` },
		{ key: "task", label: t`Task`, placeholder: t`What were you responsible for?` },
		{ key: "action", label: t`Action`, placeholder: t`What did you do, specifically?` },
		{ key: "result", label: t`Result`, placeholder: t`What changed? Leave blank if you can’t support it.` },
		{ key: "reflection", label: t`Reflection`, placeholder: t`What would you do differently?` },
	] satisfies { key: PartKey; label: string; placeholder: string }[];

const REQUIRED: PartKey[] = ["situation", "task", "action"];

/** A backing fact was corrected after the story was last saved. */
const factChanged = (story: Story, facts: Map<string, Fact>) =>
	story.data.factIds.some((id) => {
		const at = facts.get(id)?.revisions.at(-1)?.at;
		return at !== undefined && new Date(at) > new Date(story.updatedAt);
	});

/** A new story started from an interview plan's step: its title, and the step's detail shown as a note. */
type StoryStart = { title: string; note: string; plan: string; factIds?: string[] | undefined };

type StoriesPageProps = {
	storyId: string | undefined;
	edit: boolean;
	practice?: boolean;
	start?: StoryStart | undefined;
};

export function StoriesPage({ storyId, edit, practice = false, start: planStart }: StoriesPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const storyQuery = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const factQuery = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = storyQuery.data;
	const facts = factQuery.data;
	const removing = useRemoving((state) => state.ids);
	const { add: hide, drop: unhide } = useRemoving.getState();

	const addStory = (
		<Button
			variant={edit ? "secondary" : "primary"}
			nativeButton={false}
			render={
				<Link
					to="/dashboard/career/knowledge/stories/{-$storyId}"
					params={{ storyId: undefined }}
					search={{ edit: true }}
				/>
			}
		>
			<Icon name="plus" />
			<Trans>Add a story</Trans>
		</Button>
	);

	if ((!stories && storyQuery.isError) || (!facts && factQuery.isError))
		return (
			<KnowledgeFrame current="stories">
				<div className="pt-6">
					<CareerLoadError
						onRetry={() => {
							void storyQuery.refetch();
							void factQuery.refetch();
						}}
					/>
				</div>
			</KnowledgeFrame>
		);
	if (!stories || !facts)
		return (
			<KnowledgeFrame current="stories">
				<div className="pt-6">
					<CareerLoading />
				</div>
			</KnowledgeFrame>
		);

	const factsById = new Map((facts ?? []).map((fact) => [fact.id, fact]));
	const list = stories.filter((story) => !removing.has(story.id));
	const selected = storyId ? list.find((story) => story.id === storyId) : edit ? undefined : list[0];
	const editing = edit && (selected !== undefined || !storyId);

	const open = (id: string | undefined, editMode = false) =>
		void navigate({
			to: "/dashboard/career/knowledge/stories/{-$storyId}",
			params: { storyId: id ?? undefined },
			search: editMode ? { edit: true } : {},
		});

	const remove = (story: Story) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.stories.key(),
			description: t`Story deleted`,
			errorMessage: t`Couldn't delete that story. Try again.`,
			prepare: () => prepareRpc(client.career.deleteStory, { id: story.id }),
			hide: () => {
				hide(story.id);
				open(undefined);
			},
			restore: () => {
				unhide(story.id);
			},
		});
	};

	const back = (id: string | undefined) => (
		<Button variant="ghost" size="sm" className="-ms-2.5 justify-self-start text-ink-3" onClick={() => open(id)}>
			<Icon name="caret-left" />
			<Trans>Back to stories</Trans>
		</Button>
	);

	if (practice && storyId)
		return (
			<KnowledgeFrame current="stories">
				<div className="grid gap-4 pt-5">
					{back(storyId)}
					<StoryPractice key={storyId} storyId={storyId} />
				</div>
			</KnowledgeFrame>
		);

	// Editing turns the story into a form in place, across the page: the list steps aside until it is saved or cancelled.
	if (editing)
		return (
			<KnowledgeFrame current="stories">
				<div className="grid max-w-[720px] gap-2 pt-5">
					{back(selected?.id)}
					<h2 className="pb-2 t-section-title">{selected ? <Trans>Edit story</Trans> : <Trans>Add a story</Trans>}</h2>
					<StoryEditor
						key={selected?.id ?? "new"}
						story={selected}
						facts={facts ?? []}
						onSaved={(id) => open(id)}
						onCancel={() => open(selected?.id)}
						onDelete={selected ? () => remove(selected) : undefined}
						start={selected ? undefined : planStart}
					/>
				</div>
			</KnowledgeFrame>
		);

	return (
		<KnowledgeFrame current="stories" actions={list.length > 0 ? addStory : undefined}>
			{list.length === 0 && !storyId ? (
				<EmptyState
					className="mt-8"
					title={<Trans>No stories yet</Trans>}
					action={addStory}
					description={
						<Trans>
							Write one about something you did, in five parts. Leave Result and Reflection blank until you can support
							them.
						</Trans>
					}
				/>
			) : (
				<div className="mt-2 grid items-start gap-x-12 gap-y-6 lg:grid-cols-[300px_minmax(0,1fr)]">
					<div className="flex flex-col">
						<List aria-label={t`Stories`} className="mt-3">
							<AnimatePresence initial={false}>
								{list.map((story) => (
									<StoryRow
										key={story.id}
										story={story}
										selected={story.id === selected?.id}
										changed={factChanged(story, factsById)}
									/>
								))}
							</AnimatePresence>
						</List>
						<p className="border-t border-line pt-4 t-small text-ink-3">
							<Trans>
								A story has five parts: Situation, Task, Action, Result and Reflection. Leave Result and Reflection
								blank until you can support them.
							</Trans>
						</p>
					</div>

					{selected ? (
						<StoryReader story={selected} facts={factsById} onEdit={() => open(selected.id, true)} />
					) : (
						<div role="status" className="grid justify-items-start gap-2 pt-6">
							<h2 className="t-section-title">
								<Trans>Story not found</Trans>
							</h2>
							<p className="t-ui text-ink-2">
								<Trans>It may have been deleted. Choose another story or add a new one.</Trans>
							</p>
							<Button variant="secondary" onClick={() => open(undefined)}>
								<Trans>Back to stories</Trans>
							</Button>
						</div>
					)}
				</div>
			)}
		</KnowledgeFrame>
	);
}

// ---- List ----

type StoryRowProps = { story: Story; selected: boolean; changed: boolean };

// Memoized with its motion wrapper: picking a story re-renders only the two rows whose selection changed.
const StoryRow = memo(function StoryRow({ story, selected, changed }: StoryRowProps) {
	const filled = parts().filter((part) => story.data[part.key].trim()).length;
	const factCount = story.data.factIds.length;

	return (
		<CollapseRow className="overflow-visible">
			<ListRow
				render={
					<Link
						to="/dashboard/career/knowledge/stories/{-$storyId}"
						params={{ storyId: story.id }}
						aria-current={selected ? "page" : undefined}
					/>
				}
				className={cn("min-h-0 items-start py-3", selected && "border-transparent before:bg-hover")}
			>
				<span className="flex min-w-0 flex-1 flex-col gap-px">
					<span className={cn("text-[15px]/[22px] text-ink", selected ? "font-semibold" : "font-medium")}>
						{story.data.title}
					</span>
					<span className="t-small text-ink-3">
						{t`${i18n.number(filled)} of 5 parts`} · {plural(factCount, { one: "# fact", other: "# facts" })}
					</span>
					{changed && (
						<span className="flex items-center gap-1.5 pt-0.5 t-small text-warn-text">
							<Icon name="warning-circle" size={16} />
							<Trans>A fact changed. Review this story.</Trans>
						</span>
					)}
				</span>
			</ListRow>
		</CollapseRow>
	);
});

// ---- Reader ----

type StoryReaderProps = { story: Story; facts: Map<string, Fact>; onEdit: () => void };

function StoryReader({ story, facts, onEdit }: StoryReaderProps) {
	const titleId = useId();
	const backing = story.data.factIds.flatMap((id) => facts.get(id) ?? []);

	return (
		<article aria-labelledby={titleId} className="flex min-w-0 flex-col">
			<header className="flex flex-wrap items-start gap-2 pt-6">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 id={titleId} className="t-section-title text-pretty">
						{story.data.title}
					</h2>
					<p className="pt-0.5 t-small text-ink-3">{story.data.tags.join(" · ") || t`No tags yet`}</p>
				</div>
				<Button variant="ghost" onClick={onEdit}>
					<Icon name="pencil-simple" />
					<Trans>Edit</Trans>
				</Button>
				<PractiseButton storyId={story.id} />
			</header>

			<div className="mt-4 border-t border-line">
				{parts().map((part) => {
					const text = story.data[part.key].trim();
					return (
						<div key={part.key} className="flex items-start gap-4 border-b border-line py-3">
							<h3 className="w-[104px] flex-none text-[13px]/6 font-medium text-ink-3 max-sm:w-20">{part.label}</h3>
							{text ? (
								<p className="min-w-0 flex-1 t-body text-pretty whitespace-pre-line">{text}</p>
							) : (
								<>
									<p className="min-w-0 flex-1 text-sm/6 text-ink-3">
										<Trans>Not recorded yet. Leave it blank until you can support it.</Trans>
									</p>
									<button
										type="button"
										aria-label={t`Add ${part.label}`}
										onClick={onEdit}
										className="rounded-xs text-sm/5 font-medium text-accent-text hover:underline"
									>
										<Trans>Add</Trans>
									</button>
								</>
							)}
						</div>
					);
				})}
			</div>

			<SectionHeading
				className="pt-6"
				note={
					backing.length > 0 &&
					`${plural(backing.length, { one: "# fact", other: "# facts" })} · ${t`a story needs at least one to be used`}`
				}
			>
				<Trans>Backed by</Trans>
			</SectionHeading>
			<List>
				{backing.map((fact) => (
					<ListRow
						key={fact.id}
						render={<Link to="/dashboard/career/knowledge/facts" search={{ highlight: fact.id }} />}
						className="min-h-0 items-start gap-2.5 py-2.5"
					>
						<Icon name="link-simple-horizontal" size={18} className="mt-px shrink-0 text-accent-text" />
						<span className={cn("min-w-0 flex-1 t-ui", fact.status !== "active" && "text-ink-3")}>{fact.text}</span>
						<Icon name="caret-right" size={18} className="shrink-0 text-ink-3" />
					</ListRow>
				))}
			</List>
			{backing.length === 0 && (
				<p className="flex items-center gap-1.5 t-small text-warn-text">
					<Icon name="warning" size={16} />
					<Trans>No supporting facts. Link one before using this story.</Trans>
				</p>
			)}
		</article>
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
			<Icon name="microphone" />
			<Trans context="Button: rehearse interview answers">Practice</Trans>
		</>
	);
	if (isError || knowledge.isError)
		return (
			<div role="alert">
				<Button
					variant="secondary"
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
			<Button variant="secondary" disabled>
				<Trans>Loading interviews…</Trans>
			</Button>
		);

	const reason = !usable
		? story?.data.factIds.length
			? t`A fact this story uses is switched off or changed since. Edit the story to check it.`
			: t`Link a fact to practice this story`
		: null;
	if (reason)
		return (
			<Tooltip>
				{/* Focusable while disabled (aria-disabled), so hover and keyboard still reach the tooltip. */}
				<TooltipTrigger
					render={
						<Button variant="secondary" disabled focusableWhenDisabled className="aria-disabled:cursor-not-allowed" />
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
	if (upcoming.length === 0)
		return (
			<Button
				variant="secondary"
				onClick={() =>
					void navigate({
						to: "/dashboard/career/knowledge/stories/{-$storyId}",
						params: { storyId },
						search: { practice: true },
					})
				}
			>
				{label}
			</Button>
		);
	const [next] = upcoming;
	if (upcoming.length === 1 && next)
		return (
			<Button variant="secondary" onClick={() => practise(next)}>
				<Icon name="microphone" />
				<Trans context="Button: rehearse interview answers">Practice for {next.application.company}</Trans>
			</Button>
		);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="secondary" />}>
				{label}
				<Icon name="caret-down" />
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
	/** A new story from an interview plan's "Draft story" step. */
	start?: StoryStart | undefined;
};

export function StoryEditor({ story, facts, onSaved, onCancel, onDelete, proposal, start: plan }: StoryEditorProps) {
	const queryClient = useQueryClient();
	const start = proposal?.story ?? story?.data;
	const applicationId = proposal ? proposal.applicationId : null;
	const {
		value: draft,
		setValue: setDraft,
		clear,
	} = useSessionDraft(
		proposal
			? `story:proposal:${proposal.key}`
			: story
				? `story:${story.id}`
				: plan
					? `story:new:plan:${plan.plan}:${plan.title}`
					: "story:new",
		{
			title: start?.title ?? plan?.title ?? "",
			situation: start?.situation ?? "",
			task: start?.task ?? "",
			action: start?.action ?? "",
			result: start?.result ?? "",
			reflection: start?.reflection ?? "",
			tags: start?.tags.join(", ") ?? "",
			factIds: start?.factIds ?? (plan ? storyDraftFactIds({ detail: plan.note, factIds: plan.factIds }, facts) : []),
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

	const [allFacts, setAllFacts] = useState(false);
	// The ticked facts and the first few; the rest wait behind one line.
	const listed = allFacts ? shared : shared.filter((fact, index) => index < 5 || draft.factIds.includes(fact.id));
	const tags = draft.tags
		.split(",")
		.map((tag) => tag.trim())
		.filter(Boolean);
	const optional = (
		<span aria-hidden="true" className="text-xs/4 font-normal text-ink-3">
			<Trans>optional</Trans>
		</span>
	);

	return (
		<form
			className="grid gap-[18px]"
			onSubmit={(event) => {
				event.preventDefault();
				submit(event.currentTarget);
			}}
		>
			{plan?.note && (
				<p className="rounded-lg bg-info-soft px-3 py-2 t-small text-info-text">
					<Trans>From your interview plan: {plan.note}</Trans>
				</p>
			)}
			<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
				<div className="grid content-start gap-1.5">
					<Label htmlFor={`${errorId}-title-field`}>
						<Trans>Title</Trans>
					</Label>
					<Input
						id={`${errorId}-title-field`}
						value={draft.title}
						maxLength={200}
						placeholder={t`Name the story`}
						aria-required
						aria-describedby={tried && missingTitle ? `${errorId}-title` : undefined}
						aria-invalid={tried && missingTitle ? true : undefined}
						onChange={(event) => setDraft({ ...draft, title: event.target.value })}
					/>
					{tried && missingTitle && (
						<p id={`${errorId}-title`} role="alert" className="flex items-center gap-1.5 t-small text-danger-text">
							<Icon name="warning-circle" size={16} className="shrink-0" aria-hidden="true" />
							<Trans>Give the story a title before you can save.</Trans>
						</p>
					)}
				</div>
				<ChipField
					label={t`Tags`}
					hint={optional}
					placeholder={tags.length ? "" : t`Add a tag`}
					value={tags}
					onChange={(next) => setDraft({ ...draft, tags: next.join(", ") })}
				/>
			</div>

			{parts().map((part) => {
				const text = draft[part.key];
				const required = REQUIRED.includes(part.key);
				const invalid = tried && missingParts.includes(part.key);
				return (
					<div key={part.key} className="grid gap-1.5">
						<Label htmlFor={`${errorId}-field-${part.key}`} className="justify-between">
							{part.label}
							{/* One rule: only the parts that may stay blank are marked. */}
							{!required && optional}
						</Label>
						<Textarea
							id={`${errorId}-field-${part.key}`}
							rows={1}
							value={text}
							maxLength={part.key === "action" ? 6000 : 4000}
							placeholder={required ? undefined : part.placeholder}
							aria-label={required ? undefined : `${part.label} ${t`(optional)`}`}
							aria-required={required}
							aria-invalid={invalid || undefined}
							aria-describedby={invalid ? `${errorId}-${part.key}` : undefined}
							onChange={(event) => setDraft({ ...draft, [part.key]: event.target.value })}
							className="min-h-10"
						/>
						{invalid && (
							<span
								id={`${errorId}-${part.key}`}
								role="alert"
								className="flex items-center gap-1.5 t-small text-danger-text"
							>
								<Icon name="warning-circle" size={16} className="shrink-0" aria-hidden="true" />
								{t`Complete ${part.label} before saving.`}
							</span>
						)}
					</div>
				);
			})}

			<fieldset className="grid gap-1">
				<legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-[13px]/[18px] font-medium text-ink-2">
					<Trans>Backed by</Trans>
					<span className="text-xs/4 font-normal text-ink-3">
						<Trans>A story needs one fact before the coach or practice can use it</Trans>
					</span>
				</legend>
				{listed.map((fact) => {
					const disabled = fact.status !== "active";
					const checked = draft.factIds.includes(fact.id) && !disabled;
					return (
						<label
							key={fact.id}
							className={cn(
								"flex items-start gap-2.5 py-1.5 t-ui",
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
									<span className="block text-xs/4 text-ink-3">
										<Trans>Not used in coaching, so it can't back a story.</Trans>
									</span>
								)}
							</span>
						</label>
					);
				})}
				{shared.length > listed.length && (
					<button
						type="button"
						onClick={() => setAllFacts(true)}
						className="ms-7 justify-self-start rounded-xs py-1.5 text-sm/5 font-medium text-accent-text hover:underline"
					>
						{plural(shared.length - listed.length, { one: "Show # more fact", other: "Show # more facts" })}
					</button>
				)}
				{shared.length === 0 && (
					<p className="t-small text-ink-3">
						<Trans>No facts to link yet. Add them in Facts.</Trans>
					</p>
				)}
				{unavailable.length > 0 && (
					<p role="status" className="flex items-start gap-1.5 t-small text-warn-text">
						<Icon name="warning" size={16} className="mt-px shrink-0" />
						{plural(unavailable.length, {
							one: "# proposed fact isn't available here and won't back the story.",
							other: "# proposed facts aren't available here and won't back the story.",
						})}
					</p>
				)}
			</fieldset>

			<div className="flex flex-wrap items-center gap-2 pt-1">
				{onDelete && (
					<Button
						variant="danger-text"
						className="-ms-3.5"
						onClick={() => {
							clear();
							onDelete();
						}}
					>
						<Icon name="trash" />
						<Trans>Delete story</Trans>
					</Button>
				)}
				<div className="ms-auto flex gap-2">
					<Button
						variant="ghost"
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
		</form>
	);
}
