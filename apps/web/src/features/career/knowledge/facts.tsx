import type { Fact, Story } from "../hooks";
import type { CareerFactCorrection, FactCategory, MemoryMode } from "@reactive-resume/schema/career";
import type { KeyboardEvent } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { memo, useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { factCategorySchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { CollapseRow, flash, useCareerTime, withQueryUndo } from "../shared";
import { CATEGORIES, categoryLabel } from "./fact-categories";
import { KnowledgeFrame } from "./frame";
import { useProfile } from "./preferences";
import { ResumeFacts } from "./resume-facts";
import { Chip, FilterBar, FilterField } from "@/components/calm/filter-bar";
import { List, ListRow } from "@/components/calm/list-row";
import { Columns } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { isEditableElementFocused } from "@/features/resume/builder/draft";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

/** Older rows may carry a retired category; they read as experience. */
const categoryOf = (fact: Fact): FactCategory => factCategorySchema.catch("experience").parse(fact.category);

const FACTS_INPUT = { applicationId: null, all: true };

/** A text action at the end of a row or heading ("Change", "Show"). */
const textAction = "relative z-10 rounded-xs text-sm/5 font-medium text-accent-text hover:underline";

const isResume = (fact: Fact) => fact.source.kind === "resume" || fact.source.kind === "resume-version";

type FactsPageProps = { highlight: string | undefined };

/** C2 and C9: facts as flat rows with one tick each; adding is one line above them, and a fact opens in place. */
export function FactsPage({ highlight }: FactsPageProps) {
	const queryClient = useQueryClient();
	const queryKey = orpc.career.facts.queryKey({ input: FACTS_INPUT });
	const factQuery = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const facts = factQuery.data;
	const [search, setSearch] = useState("");
	const [type, setType] = useState<FactCategory | null>(null);
	const [hidden, setHidden] = useState<string[]>([]);
	const [adding, setAdding] = useState(false);
	const [opened, setOpened] = useState<string | null>(null);
	const [correcting, setCorrecting] = useState<Fact | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);

	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"/",
		(event) => {
			if (isEditableElementFocused()) return;
			event.preventDefault();
			filterRef.current?.focus();
		},
		{ enabled: characterShortcuts, meta: { name: t`Filter facts` } },
	);

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
	};
	const patch = (id: string, values: Partial<Fact>) =>
		queryClient.setQueryData<Fact[]>(queryKey, (list) =>
			list?.map((fact) => (fact.id === id ? { ...fact, ...values } : fact)),
		);
	// Only the stable `mutate`: the result object is new each render and would re-render every row.
	const { mutate: updateFact } = useMutation({
		...orpc.career.updateFact.mutationOptions(),
		onError: (error) => toastError(error, t`Couldn't save that change. Try again.`),
		onSettled: refresh,
	});
	const { mutateAsync: correctFact } = useMutation({
		...orpc.career.correctFact.mutationOptions(),
		onError: (error) => toastError(error, t`Couldn't save that change. Try again.`, { allowServerMessage: true }),
		onSettled: refresh,
	});

	// Scroll to and tint the fact a link pointed at, once its row exists.
	const flashed = useRef<string | null>(null);
	useEffect(() => {
		if (!highlight || !facts || flashed.current === highlight) return;
		flashed.current = highlight;
		flash(listRef.current?.querySelector(`[data-fact="${CSS.escape(highlight)}"]`) ?? null);
	}, [highlight, facts]);

	const shown = (facts ?? []).filter((fact) => fact.status !== "forgotten" && !hidden.includes(fact.id));
	// The input updates at once; the list filters in a deferred render that typing can interrupt.
	const query = useDeferredValue(search).trim().toLocaleLowerCase();
	const visible = shown.filter(
		(fact) =>
			(type === null || categoryOf(fact) === type) &&
			(!query || `${fact.text} ${sourceLabel(fact)}`.toLocaleLowerCase().includes(query)),
	);
	const types = CATEGORIES.filter((category) => shown.some((fact) => categoryOf(fact) === category));

	// The source is said once above the list when every fact shares it; otherwise each row names its own.
	const [first] = shown;
	const oneSource =
		first !== undefined &&
		shown.every(
			(fact) => fact.source.kind === first.source.kind && (!isResume(first) || fact.source.id === first.source.id),
		);
	const resumeName =
		first && isResume(first) ? documents.data?.find((row) => row.id === first.source.id)?.name : undefined;
	const count = plural(shown.length, { one: "# fact", other: "# facts" });
	const summary =
		!first || !oneSource
			? count
			: resumeName
				? t`${count} · all from your ${resumeName} resume`
				: `${count} · ${t`all`} ${sourceLabel(first).toLocaleLowerCase()}`;

	const setStatus = (fact: Fact, status: "active" | "excluded") => {
		patch(fact.id, { status });
		updateFact({ id: fact.id, status });
	};
	const share = (fact: Fact) => {
		patch(fact.id, { applicationId: null, company: null });
		updateFact({ id: fact.id, share: true });
	};

	const forget = (fact: Fact) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.facts.key(),
			description: t`Fact forgotten`,
			errorMessage: t`Couldn't forget that fact. Try again.`,
			prepare: () => prepareRpc(client.career.forgetFact, { id: fact.id }),
			hide: () => setHidden((current) => [...current, fact.id]),
			restore: () => {
				setHidden((current) => current.filter((id) => id !== fact.id));
				void queryClient.invalidateQueries({ queryKey: orpc.career.forgottenFacts.key() });
			},
		});
	};

	const added = (fact: Fact) => {
		queryClient.setQueryData<Fact[]>(queryKey, (list) => [fact, ...(list ?? [])]);
		// The new fact shows even when the current search or filter wouldn't match it.
		setSearch("");
		setType(null);
		refresh();
	};

	return (
		<KnowledgeFrame
			current="facts"
			actions={
				<>
					<ResumeFacts />
					<Button
						variant={adding ? "secondary" : "primary"}
						aria-expanded={adding}
						onClick={() => setAdding((open) => !open)}
					>
						<Icon name="plus" />
						<Trans>Add a fact</Trans>
					</Button>
				</>
			}
		>
			<Columns className="xl:grid-cols-[minmax(0,1fr)_320px]" aside={<FactsAside />}>
				{adding ? (
					<AddFact onAdded={added} />
				) : (
					<FilterBar>
						<FilterField
							ref={filterRef}
							label={t`Filter facts`}
							shortcut="/"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							className="me-2"
						/>
						{types.length > 1 && (
							<>
								<Chip pressed={type === null} onClick={() => setType(null)}>
									<Trans>All</Trans>
								</Chip>
								{types.map((category) => (
									<Chip key={category} pressed={type === category} onClick={() => setType(category)}>
										{categoryLabel(category)}
									</Chip>
								))}
							</>
						)}
					</FilterBar>
				)}

				{!facts &&
					(factQuery.isError ? <CareerLoadError onRetry={() => void factQuery.refetch()} /> : <CareerLoading />)}

				{facts && (
					<>
						{shown.length > 0 && (
							<div className="flex items-center gap-2 border-b border-line pt-3.5 pb-2 text-[13px]/[18px] text-ink-3">
								<span className="min-w-0 flex-1">{summary}</span>
								<span className="w-[104px] flex-none text-center max-sm:w-auto">
									<Trans>Used in coaching</Trans>
								</span>
							</div>
						)}
						<List ref={listRef}>
							<AnimatePresence initial={false}>
								{visible.map((fact) => (
									<FactRow
										key={fact.id}
										fact={fact}
										open={opened === fact.id}
										namesSource={!oneSource}
										story={
											opened === fact.id
												? stories.data?.filter((story) => story.data.factIds.includes(fact.id))
												: undefined
										}
										resumeName={
											opened === fact.id && isResume(fact)
												? documents.data?.find((row) => row.id === fact.source.id)?.name
												: undefined
										}
										onOpenChange={setOpened}
										onStatus={setStatus}
										onCorrect={setCorrecting}
										onShare={share}
										onForget={forget}
									/>
								))}
							</AnimatePresence>
						</List>
						{visible.length === 0 && (
							<EmptyState
								variant={shown.length === 0 ? "default" : "compact"}
								title={shown.length === 0 ? t`No facts yet` : t`No facts match`}
								description={
									shown.length === 0
										? t`Add things you've done, with numbers when you have them, such as “Cut checkout errors by 30% in 2025”. The coach backs its answers and your stories with them.`
										: t`Try another word or type.`
								}
								action={
									shown.length === 0 ? (
										!adding && (
											<Button variant="secondary" onClick={() => setAdding(true)}>
												<Trans>Add a fact</Trans>
											</Button>
										)
									) : type !== null ? (
										<Button variant="link" size="sm" onClick={() => setType(null)}>
											<Trans>Show all types</Trans>
										</Button>
									) : undefined
								}
							/>
						)}
					</>
				)}
			</Columns>

			<Dialog open={correcting !== null} onOpenChange={(open) => !open && setCorrecting(null)}>
				<DialogContent closeLabel={t`Close`}>
					{correcting && (
						<Correction
							key={correcting.id}
							fact={correcting}
							onCancel={() => setCorrecting(null)}
							onSave={async (input) => {
								await correctFact(input);
								setCorrecting(null);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</KnowledgeFrame>
	);
}

// ---- Beside the list: what gets sent, remembering, forgotten facts ----

function FactsAside() {
	const [showForgotten, setShowForgotten] = useState(false);
	const forgotten = useQuery({ ...orpc.career.forgottenFacts.queryOptions({ input: {} }), retry: false });
	const total = forgotten.data?.reduce((sum, row) => sum + row.count, 0);

	return (
		<>
			<SectionHeading className="pt-5">
				<Trans>How it's used</Trans>
			</SectionHeading>
			<p className="pb-2 text-ink-2 t-ui">
				<Trans>
					Ticked facts can be sent to your AI connection when you use the coach, a fit check or interview prep. The rest
					stay here and are never sent.
				</Trans>
			</p>
			<List>
				<MemoryRow />
				<ListRow
					title={<Trans>Forgotten facts</Trans>}
					subtitle={
						total === undefined ? undefined : total === 0 ? (
							<Trans>No forgotten facts</Trans>
						) : (
							<Trans>{total} · gone for good</Trans>
						)
					}
					trailing={
						total !== 0 && (
							<button
								type="button"
								aria-expanded={showForgotten}
								onClick={() => setShowForgotten((open) => !open)}
								className={textAction}
							>
								{showForgotten ? <Trans>Hide</Trans> : <Trans>Show</Trans>}
							</button>
						)
					}
				/>
			</List>
			{showForgotten && <ForgottenFacts />}
		</>
	);
}

/** Forgotten facts are a record, not a bin: only when and how many is kept, so there is nothing to restore. */
function ForgottenFacts() {
	const history = useQuery({ ...orpc.career.forgottenFacts.queryOptions({ input: {} }), retry: false });
	const { when } = useCareerTime();
	if (history.isError) return <CareerLoadError onRetry={() => void history.refetch()} />;
	if (!history.data) return <CareerLoading />;
	return (
		<div className="flex flex-col gap-2 rounded-lg bg-sunken px-3.5 py-3" aria-live="polite">
			{history.data.length === 0 && (
				<p className="text-ink-3 t-small">
					<Trans>No forgotten facts</Trans>
				</p>
			)}
			{history.data.map(({ count, at }) => (
				<p key={at.toISOString()} className="flex items-center gap-2 t-small">
					<Icon name="eye-slash" size={16} className="text-ink-3" />
					<span className="min-w-0 flex-1">
						{plural(count, { one: "# fact forgotten", other: "# facts forgotten" })}
					</span>
					<span className="text-ink-3">{when(at)}</span>
				</p>
			))}
			<p className="pt-0.5 text-xs/4 text-ink-3">
				<Trans>
					Only when and how many is kept, never the wording. The coach won't save a forgotten fact again from your
					messages.
				</Trans>
			</p>
		</div>
	);
}

// ---- Memory mode ----

function MemoryRow() {
	const { profile, save, isError, retry } = useProfile();
	const [changing, setChanging] = useState(false);
	const hints: Record<MemoryMode, string> = {
		ask: t`The coach proposes each fact in the chat. Nothing is saved until you agree.`,
		auto: t`The coach saves facts you state, and tells you. You can undo.`,
		off: t`The coach doesn't remember anything from your messages.`,
	};
	const modes: [MemoryMode, string][] = [
		["ask", t`Ask first`],
		["auto", t`Automatically`],
		["off", t`Never`],
	];
	// Never claim a privacy default that wasn't read from the saved setting.
	if (!profile) return isError ? <CareerLoadError onRetry={retry} /> : <CareerLoading />;
	const mode = profile.memoryMode;

	return (
		<>
			<ListRow
				className={cn(changing && "border-b-0")}
				title={t`Remember facts from my messages`}
				subtitle={modes.find(([value]) => value === mode)?.[1]}
				trailing={
					<button
						type="button"
						aria-expanded={changing}
						onClick={() => setChanging((open) => !open)}
						className={textAction}
					>
						{changing ? <Trans>Done</Trans> : <Trans>Change</Trans>}
					</button>
				}
			/>
			{changing && (
				<div className="flex flex-col gap-2 border-b border-line pb-3">
					<SegmentedControl
						aria-label={t`Remember facts from my messages`}
						value={mode}
						onValueChange={(value) => save({ memoryMode: value as MemoryMode })}
						className="flex"
					>
						{modes.map(([value, label]) => (
							<SegmentedControlItem key={value} value={value} className="px-2">
								{label}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
					<p className="text-xs/4 text-ink-3">{hints[mode]}</p>
				</div>
			)}
		</>
	);
}

// ---- Add ----

type AddFactProps = { onAdded: (fact: Fact) => void };

/** One line above the list. Enter adds, and the field stays open for the next fact. */
function AddFact({ onAdded }: AddFactProps) {
	const id = useId();
	const [text, setText] = useState("");
	const [category, setCategory] = useState<FactCategory>("accomplishment");
	const save = useMutation({
		...orpc.career.saveFact.mutationOptions(),
		onSuccess: (fact) => {
			setText("");
			if (fact) onAdded({ ...fact, company: null, usedBy: { stories: 0, savedItems: 0 } });
		},
		onError: (error) => toastError(error, t`Couldn't add that fact. Try again.`),
	});

	const add = () => {
		const value = text.trim();
		if (value.length < 4 || save.isPending) return;
		save.mutate({
			applicationId: null,
			text: value,
			category,
			source: { kind: "manual", id: crypto.randomUUID(), quote: value },
		});
	};

	return (
		<div className="flex flex-col gap-1.5 pt-[18px] pb-1">
			<Label htmlFor={id} className="justify-between">
				<Trans>New fact</Trans>
				<span className="text-xs/4 font-normal text-ink-3 max-sm:hidden">
					<Trans>One thing you did, with a number if you have one</Trans>
				</span>
			</Label>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					id={id}
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- Add a fact was just chosen; typing goes straight into the fact
					autoFocus
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) add();
					}}
					maxLength={2000}
					placeholder={t`For example “I mentored two associate PMs in 2025”`}
					className="min-w-0 flex-1 basis-60"
				/>
				<div className="w-40 flex-none max-sm:flex-1">
					<NativeSelect
						aria-label={t`Fact type`}
						value={category}
						onChange={(event) => setCategory(event.target.value as FactCategory)}
					>
						{CATEGORIES.map((option) => (
							<option key={option} value={option}>
								{categoryLabel(option)}
							</option>
						))}
					</NativeSelect>
				</div>
				<Button onClick={add} loading={save.isPending} aria-disabled={text.trim().length < 4}>
					<Trans>Add</Trans>
				</Button>
			</div>
		</div>
	);
}

// ---- Row ----

/** Where a fact came from, in words: "Added by you", "From your resume". */
function sourceLabel(fact: Fact) {
	switch (fact.source.kind) {
		case "manual":
			return t`Added by you`;
		case "user-message":
			return t`From your message`;
		case "resume":
		case "resume-version":
			return t`From your resume`;
		case "letter":
		case "letter-version":
			return t`From your cover letter`;
		case "attachment":
			return t`From a document you attached`;
		case "debrief":
			return t`From a debrief`;
	}
}

type FactRowProps = {
	fact: Fact;
	open: boolean;
	/** The list has more than one source, so each row says its own. */
	namesSource: boolean;
	/** Stories this fact backs, read only while the row is open. */
	story: Story[] | undefined;
	resumeName: string | undefined;
	onOpenChange: (id: string | null) => void;
	onStatus: (fact: Fact, status: "active" | "excluded") => void;
	onCorrect: (fact: Fact) => void;
	onShare: (fact: Fact) => void;
	onForget: (fact: Fact) => void;
};

// Memoized with its motion wrapper: one fact's change re-renders (and re-measures) only its own row.
const FactRow = memo(function FactRow({
	fact,
	open,
	namesSource,
	story,
	resumeName,
	onOpenChange,
	onStatus,
	onCorrect,
	onShare,
	onForget,
}: FactRowProps) {
	const { date } = useCareerTime();
	const detailId = useId();
	const on = fact.status === "active";
	// Names the tick apart from every other row's.
	const excerpt = fact.text.length > 60 ? `${fact.text.slice(0, 60)}…` : fact.text;
	const company = fact.company;
	const lastRevision = fact.revisions.at(-1);
	const correctedOn = lastRevision ? date(lastRevision.at) : null;
	const source = sourceLabel(fact);
	const subtitle = [
		categoryLabel(categoryOf(fact)),
		company !== null ? t`${company} only` : open ? t`all applications` : null,
		namesSource && !open ? source.toLocaleLowerCase() : null,
		on ? null : t`not used in coaching`,
	]
		.filter(Boolean)
		.join(" · ");

	const actions = (
		<>
			<Button variant="ghost" size="sm" onClick={() => onCorrect(fact)}>
				<Icon name="pencil-simple" />
				<Trans>Correct</Trans>
			</Button>
			{company !== null && (
				<Button variant="ghost" size="sm" onClick={() => onShare(fact)}>
					<Icon name="share-network" />
					<Trans>Use for all applications</Trans>
				</Button>
			)}
			<Button variant="ghost" size="sm" onClick={() => onForget(fact)}>
				<Icon name="eye-slash" />
				<Trans>Forget</Trans>
			</Button>
		</>
	);

	return (
		<CollapseRow className="overflow-visible border-b border-line last:border-b-0">
			<ListRow
				data-fact={fact.id}
				interactive={!open}
				className={cn("border-b-0", open && "pb-1")}
				trailing={
					<span className="flex w-[104px] justify-center max-sm:w-11">
						<Checkbox
							checked={on}
							aria-label={t`Use in coaching: ${excerpt}`}
							onCheckedChange={(checked) => onStatus(fact, checked ? "active" : "excluded")}
							className="data-checked:border-control-border data-checked:bg-raised data-checked:text-ink"
						/>
					</span>
				}
			>
				<span className="flex min-w-0 flex-1 flex-col gap-px">
					<button
						type="button"
						aria-expanded={open}
						aria-controls={open ? detailId : undefined}
						onClick={() => onOpenChange(open ? null : fact.id)}
						className="rounded-xs text-start text-[15px]/[22px] font-medium text-pretty text-ink after:absolute after:inset-y-0 after:-inset-s-3 after:inset-e-[104px] max-sm:after:inset-e-11"
					>
						{fact.text}
					</button>
					<span className="text-[13px]/[18px] text-ink-3">{subtitle}</span>
				</span>
				{open ? (
					<IconButton
						icon="caret-up"
						label={t`Close details`}
						size="icon-sm"
						className="relative z-10 text-ink-3"
						onClick={() => onOpenChange(null)}
					/>
				) : (
					// A shortcut for the pointer: the same two actions sit with the detail the row opens.
					<span className="relative z-10 hidden shrink-0 items-center gap-1 group-hover/row:flex pointer-coarse:hidden">
						{actions}
					</span>
				)}
			</ListRow>
			{open && (
				<div id={detailId} className="pb-3">
					<dl className="grid max-w-[560px] grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-sunken px-3.5 py-2.5 t-small">
						<dt className="text-ink-3">
							<Trans>Source</Trans>
						</dt>
						<dd className="text-ink-2">
							{resumeName ? `${source}, ${resumeName}` : source} · {date(fact.createdAt)}
							{fact.source.quote && <span className="block text-ink-3">“{fact.source.quote}”</span>}
						</dd>
						{lastRevision && (
							<>
								<dt className="text-ink-3">
									<Trans>Corrected</Trans>
								</dt>
								<dd className="text-ink-2">
									<Trans>{correctedOn} · the original wording is kept above</Trans>
									{fact.revisions
										.slice(0, -1)
										.toReversed()
										.map((revision) => (
											<span key={revision.at} className="block text-ink-3">
												{date(revision.at)} · {revision.text}
											</span>
										))}
								</dd>
							</>
						)}
						<dt className="text-ink-3">
							<Trans>Used by</Trans>
						</dt>
						<dd className="text-ink-2">
							{fact.usedBy.stories + fact.usedBy.savedItems === 0
								? t`Not used in a story or saved item yet`
								: [
										plural(fact.usedBy.stories, { one: "# story", other: "# stories" }) +
											(story?.length === 1 && story[0] ? `, “${story[0].data.title}”` : ""),
										plural(fact.usedBy.savedItems, { one: "# saved item", other: "# saved items" }),
									].join(" · ")}
						</dd>
					</dl>
					<div className="-ms-2.5 flex flex-wrap gap-1 pt-3 pb-0.5">{actions}</div>
				</div>
			)}
		</CollapseRow>
	);
});

type CorrectionProps = { fact: Fact; onSave: (input: CareerFactCorrection) => Promise<unknown>; onCancel: () => void };

/** C10: the app's three fields. "Used for" moves a fact between all applications and one of them. */
function Correction({ fact, onSave, onCancel }: CorrectionProps) {
	const id = useId();
	const [before] = useState(() => ({ text: fact.text, category: fact.category, applicationId: fact.applicationId }));
	const [draft, setDraft] = useState(before.text);
	const [category, setCategory] = useState(before.category);
	const [applicationId, setApplicationId] = useState(before.applicationId ?? "");
	const [pending, setPending] = useState(false);
	const applications = useQuery(applicationsListQueryOptions());
	const changed =
		draft.trim() !== before.text || category !== before.category || (applicationId || null) !== before.applicationId;
	const save = async () => {
		if (!draft.trim() || !changed || pending) return;
		setPending(true);
		try {
			await onSave({
				id: fact.id,
				before,
				...(draft.trim() !== before.text ? { text: draft.trim() } : {}),
				...(category !== before.category ? { category: factCategorySchema.parse(category) } : {}),
				...((applicationId || null) !== before.applicationId ? { applicationId: applicationId || null } : {}),
			});
		} catch {
			// Mutation reports the error; keep the authored correction open.
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					<Trans>Correct this fact</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>The original stays in the fact's history. Stories that use it are marked to review.</Trans>
				</DialogDescription>
			</DialogHeader>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-text`}>
					<Trans>Fact</Trans>
				</Label>
				<Textarea
					id={`${id}-text`}
					rows={3}
					maxLength={2000}
					disabled={pending}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					className="min-h-16"
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-type`}>
						<Trans>Type</Trans>
					</Label>
					<NativeSelect
						id={`${id}-type`}
						value={category}
						disabled={pending}
						onChange={(event) => setCategory(event.target.value)}
					>
						{!factCategorySchema.safeParse(before.category).success && (
							<option value={before.category}>{before.category}</option>
						)}
						{CATEGORIES.map((option) => (
							<option key={option} value={option}>
								{categoryLabel(option)}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-scope`}>
						<Trans>Used for</Trans>
					</Label>
					<NativeSelect
						id={`${id}-scope`}
						value={applicationId}
						disabled={pending || !applications.data}
						onChange={(event) => setApplicationId(event.target.value)}
					>
						<option value="">{t`All applications`}</option>
						{before.applicationId &&
							!applications.data?.some((application) => application.id === before.applicationId) && (
								<option value={before.applicationId}>{fact.company ?? t`Application`}</option>
							)}
						{applications.data?.map((application) => (
							<option key={application.id} value={application.id}>
								{application.company} · {application.role}
							</option>
						))}
					</NativeSelect>
				</div>
			</div>
			{applications.isError && <CareerLoadError onRetry={() => void applications.refetch()} />}
			<DialogFooter>
				<Button variant="ghost" disabled={pending} onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
				<Button disabled={!draft.trim() || !changed} loading={pending} onClick={() => void save()}>
					<Trans>Save correction</Trans>
				</Button>
			</DialogFooter>
		</>
	);
}
