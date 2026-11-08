import type { Fact } from "../hooks";
import type { CareerFactCorrection, FactCategory, MemoryMode } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { KeyboardEvent } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { memo, useCallback, useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { factCategorySchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Switch } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { CollapseRow, FilterChip, flash, useCareerTime, withQueryUndo } from "../shared";
import { CATEGORIES, categoryLabel } from "./fact-categories";
import { useProfile } from "./preferences";
import { ResumeFacts } from "./resume-facts";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { toastError } from "@/libs/error-message";
import { D2, EASE, EXIT } from "@/libs/motion";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

/** Older rows may carry a retired category; they read as experience. */
const categoryOf = (fact: Fact): FactCategory => factCategorySchema.catch("experience").parse(fact.category);

const FACTS_INPUT = { applicationId: null, all: true };

type FactsPageProps = { highlight: string | undefined };

export function FactsPage({ highlight }: FactsPageProps) {
	const queryClient = useQueryClient();
	const queryKey = orpc.career.facts.queryKey({ input: FACTS_INPUT });
	const factQuery = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const facts = factQuery.data;
	const [search, setSearch] = useState("");
	const [type, setType] = useState<FactCategory | null>(null);
	const [hidden, setHidden] = useState<string[]>([]);
	const [showForgotten, setShowForgotten] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const addRef = useRef<HTMLDivElement>(null);

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

	// The input updates at once; the list filters in a deferred render that typing can interrupt.
	const query = useDeferredValue(search).trim().toLocaleLowerCase();
	const visible = (facts ?? []).filter(
		(fact) =>
			!hidden.includes(fact.id) &&
			(type === null || categoryOf(fact) === type) &&
			(!query || `${fact.text} ${sourceLabel(fact)}`.toLocaleLowerCase().includes(query)),
	);

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
		<div className="grid gap-3.5">
			<MemoryCard />

			<div className="flex flex-wrap items-center gap-2">
				<label className="flex h-[34px] w-full items-center gap-1.5 rounded-md border border-control-border bg-raised px-2.5 transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] sm:w-[280px] pointer-coarse:h-11">
					<Icon name="magnifying-glass" size={18} className="text-ink-3" />
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={t`Search facts`}
						aria-label={t`Search facts`}
						className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
					/>
				</label>
				{/* Phones: the type filters stay on one row that scrolls sideways. */}
				<div className="flex flex-wrap gap-2 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:[scrollbar-width:none] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1.5 max-sm:*:shrink-0">
					<FilterChip pressed={type === null} onClick={() => setType(null)}>
						<Trans>All</Trans>
					</FilterChip>
					{CATEGORIES.map((category) => (
						<FilterChip key={category} pressed={type === category} onClick={() => setType(category)}>
							{categoryLabel(category)}
						</FilterChip>
					))}
				</div>
			</div>

			<ResumeFacts />
			<div ref={addRef}>
				<AddFact onAdded={added} />
			</div>
			<FilterChip
				pressed={showForgotten}
				onClick={() => setShowForgotten((shown) => !shown)}
				className="justify-self-start"
			>
				<Trans>Show forgotten</Trans>
			</FilterChip>
			{showForgotten && <ForgottenFacts />}
			{!facts && (factQuery.isError ? <CareerLoadError onRetry={() => void factQuery.refetch()} /> : <CareerLoading />)}

			{facts && (
				<div ref={listRef} className="overflow-hidden rounded-xl border border-line bg-surface">
					<AnimatePresence initial={false}>
						{visible.map((fact) => (
							<FactRow
								key={fact.id}
								fact={fact}
								onStatus={setStatus}
								onCorrect={correctFact}
								onShare={share}
								onForget={forget}
							/>
						))}
					</AnimatePresence>
					{visible.length === 0 && (
						<EmptyState
							variant={facts.length === 0 ? "default" : "compact"}
							title={facts.length === 0 ? t`No facts yet` : t`No facts match`}
							description={
								facts.length === 0
									? t`Add things you've done, with numbers when you have them, such as “Cut checkout errors by 30% in 2025”. The coach backs its answers and your stories with them.`
									: t`Try another word or type.`
							}
							action={
								facts.length === 0 ? (
									<Button onClick={() => addRef.current?.querySelector("input")?.focus()}>
										<Trans>Add a fact</Trans>
									</Button>
								) : type !== null ? (
									<Button variant="link" size="sm" onClick={() => setType(null)}>
										<Trans>Show all types</Trans>
									</Button>
								) : undefined
							}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function ForgottenFacts() {
	const history = useQuery({ ...orpc.career.forgottenFacts.queryOptions({ input: {} }), retry: false });
	const { when } = useCareerTime();
	if (history.isError) return <CareerLoadError onRetry={() => void history.refetch()} />;
	if (!history.data) return <CareerLoading />;
	return (
		<div className="grid gap-2 rounded-xl border border-line bg-surface p-4" aria-live="polite">
			{history.data.length === 0 && (
				<p className="text-sm text-ink-3">
					<Trans>No forgotten facts</Trans>
				</p>
			)}
			{history.data.map(({ count, at }) => (
				<p key={at.toISOString()} className="text-sm text-ink-3">
					{plural(count, { one: "# fact forgotten", other: "# facts forgotten" })} · {when(at)}
				</p>
			))}
		</div>
	);
}

// ---- Memory mode ----

export function MemoryCard() {
	const { profile, save, isError, retry } = useProfile();
	const labelId = useId();
	const mode = profile?.memoryMode;
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
	if (!profile) return isError ? <CareerLoadError onRetry={retry} /> : <CareerLoading />;

	return (
		<div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
			<Icon name="brain" size={20} className="text-ink-2" />
			<div className="grid min-w-0 flex-1 basis-56 gap-px">
				<p id={labelId} className="text-sm font-semibold">
					<Trans>Remember facts from my messages</Trans>
				</p>
				<p className="text-xs text-ink-3">{hints[profile.memoryMode]}</p>
			</div>
			<SegmentedControl
				aria-labelledby={labelId}
				value={mode}
				disabled={!profile}
				onValueChange={(value) => profile && save({ memoryMode: value as MemoryMode })}
				className="h-[34px]"
			>
				{modes.map(([value, label]) => (
					<SegmentedControlItem
						key={value}
						value={value}
						className="touch-target relative flex-none px-2.5 data-checked:bg-transparent data-checked:shadow-none"
					>
						{mode === value && (
							<m.span
								layoutId="memory-mode"
								transition={{ duration: D2, ease: EASE }}
								className="absolute inset-0 rounded-sm bg-raised shadow-e1"
							/>
						)}
						<span className="relative">{label}</span>
					</SegmentedControlItem>
				))}
			</SegmentedControl>
		</div>
	);
}

// ---- Add ----

type AddFactProps = { onAdded: (fact: Fact) => void };

function AddFact({ onAdded }: AddFactProps) {
	const [text, setText] = useState("");
	const [category, setCategory] = useState<FactCategory>("accomplishment");
	const ready = text.trim().length >= 4;
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
		<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 py-1.5 ps-3.5 pe-1.5">
			<Icon name="plus" size={20} className="text-ink-3" />
			<input
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
					if (event.key === "Enter" && !event.nativeEvent.isComposing) add();
				}}
				maxLength={2000}
				placeholder={t`Add a fact, for example “I mentored two associate PMs in 2025”`}
				aria-label={t`New fact`}
				className="h-[34px] min-w-0 flex-1 basis-60 bg-transparent text-sm outline-none placeholder:text-ink-3"
			/>
			<div className="flex gap-2">
				<div className="w-auto">
					<NativeSelect
						aria-label={t`Fact type`}
						value={category}
						onChange={(event) => setCategory(event.target.value as FactCategory)}
						className="h-8 text-[13px] font-medium"
					>
						{CATEGORIES.map((option) => (
							<option key={option} value={option}>
								{categoryLabel(option)}
							</option>
						))}
					</NativeSelect>
				</div>
				<Button
					variant="secondary"
					size="sm"
					onClick={add}
					loading={save.isPending}
					aria-disabled={!ready}
					className={cn("h-8 px-3 pointer-coarse:h-11", !ready && "text-ink-3")}
				>
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
	onStatus: (fact: Fact, status: "active" | "excluded") => void;
	onCorrect: (input: CareerFactCorrection) => Promise<unknown>;
	onShare: (fact: Fact) => void;
	onForget: (fact: Fact) => void;
};

// Memoized with its motion wrapper: one fact's change re-renders (and re-measures) only its own row.
const FactRow = memo(function FactRow({ fact, onStatus, onCorrect, onShare, onForget }: FactRowProps) {
	const { format } = useCareerTime();
	const [sourceOpen, setSourceOpen] = useState(false);
	const [correcting, setCorrecting] = useState(false);
	const on = fact.status === "active";
	// Names the switch apart from every other row's.
	const excerpt = fact.text.length > 60 ? `${fact.text.slice(0, 60)}…` : fact.text;
	const date = (value: Date | string) => format(value, { day: "numeric", month: "short" });
	const company = fact.company;
	const lastRevision = fact.revisions.at(-1);
	const correctedOn = lastRevision ? date(lastRevision.at) : null;
	const usage =
		fact.usedBy.stories + fact.usedBy.savedItems === 0
			? t`Not used in a story or saved item yet`
			: `${plural(fact.usedBy.stories, { one: "Backs # story", other: "Backs # stories" })} · ${plural(fact.usedBy.savedItems, { one: "used in # saved item", other: "used in # saved items" })}`;

	type Action = { icon: IconName; label: string; onClick: () => void; expanded?: boolean };
	const share: Action[] =
		company === null
			? []
			: [{ icon: "share-network", label: t`Use for all applications`, onClick: () => onShare(fact) }];
	const actions: Action[] = [
		{
			icon: "clock-counter-clockwise",
			label: t`Source`,
			onClick: () => setSourceOpen((open) => !open),
			expanded: sourceOpen,
		},
		{ icon: "pencil-simple", label: t`Correct`, onClick: () => setCorrecting(true) },
		...share,
		{ icon: "trash", label: t`Forget`, onClick: () => onForget(fact) },
	];

	return (
		<CollapseRow className="border-b border-line last:border-b-0">
			<div
				data-fact={fact.id}
				// Off-screen rows skip layout and paint; they stay findable and in the accessibility tree.
				className="flex items-start gap-4 px-4 py-3.5 [contain-intrinsic-size:auto_112px] [content-visibility:auto]"
			>
				<div className="grid min-w-0 flex-1 gap-1.5">
					<p className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-3">
						{categoryLabel(categoryOf(fact))}
						<span
							className={cn(
								"h-[18px] rounded-lg px-1.5 font-sans text-xs leading-[18px] normal-case",
								company === null ? "bg-sunken text-ink-2" : "bg-info-soft text-info-text",
							)}
						>
							{company === null ? t`All applications` : t`${company} only`}
						</span>
					</p>

					{correcting ? (
						<Correction
							fact={fact}
							onCancel={() => setCorrecting(false)}
							onSave={async (input) => {
								await onCorrect(input);
								setCorrecting(false);
							}}
						/>
					) : (
						<p
							className={cn(
								"text-sm leading-[21px] text-pretty transition-colors duration-quick",
								on ? "text-ink" : "text-ink-3",
							)}
						>
							{fact.text}
						</p>
					)}

					<div className="-ms-2 flex flex-wrap gap-0.5">
						{actions.map((action) => (
							<button
								key={action.label}
								type="button"
								onClick={action.onClick}
								aria-expanded={action.expanded}
								className="touch-target relative flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink"
							>
								<Icon name={action.icon} size={16} />
								{action.label}
							</button>
						))}
					</div>

					<AnimatePresence initial={false}>
						{sourceOpen && (
							<m.div
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1, transition: { duration: D2, ease: EASE } }}
								exit={{ height: 0, opacity: 0, transition: { duration: D2 * EXIT, ease: EASE } }}
								className="overflow-hidden"
							>
								<div className="grid gap-1 rounded-md bg-sunken px-3 py-2.5 text-xs leading-[17px] text-ink-2">
									<p className="font-semibold text-ink">
										{sourceLabel(fact)} · {date(fact.createdAt)}
									</p>
									<p>{usage}</p>
									<p className="text-xs text-ink-3">
										{correctedOn ? t`Corrected ${correctedOn} · original kept` : t`No corrections`}
									</p>
									{fact.source.quote && (
										<blockquote className="border-s-2 border-line ps-2">{fact.source.quote}</blockquote>
									)}
									{fact.revisions.length > 0 && (
										<ol className="mt-1 grid gap-1 border-t border-line pt-2">
											{fact.revisions.toReversed().map((revision) => (
												<li key={revision.at} className="text-ink-3">
													<span className="font-mono text-xs">{date(revision.at)}</span> · {revision.text}
												</li>
											))}
										</ol>
									)}
								</div>
							</m.div>
						)}
					</AnimatePresence>
				</div>

				<div className="flex w-[120px] flex-none flex-col items-end gap-1 max-sm:w-20">
					<Switch
						checked={on}
						aria-label={t`Use in coaching: ${excerpt}`}
						onCheckedChange={(checked) => onStatus(fact, checked ? "active" : "excluded")}
					/>
					<span className="text-end text-xs text-ink-3">{on ? t`Used in coaching` : t`Not used`}</span>
				</div>
			</div>
		</CollapseRow>
	);
});

type CorrectionProps = { fact: Fact; onSave: (input: CareerFactCorrection) => Promise<unknown>; onCancel: () => void };

function Correction({ fact, onSave, onCancel }: CorrectionProps) {
	const [before] = useState(() => ({ text: fact.text, category: fact.category, applicationId: fact.applicationId }));
	const [draft, setDraft] = useState(before.text);
	const [category, setCategory] = useState(before.category);
	const [applicationId, setApplicationId] = useState(before.applicationId ?? "");
	const [pending, setPending] = useState(false);
	const applications = useQuery(applicationsListQueryOptions());
	const focus = useCallback((element: HTMLTextAreaElement | null) => {
		if (!element) return;
		element.focus();
		element.setSelectionRange(element.value.length, element.value.length);
	}, []);
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
		<div className="grid gap-2">
			<Textarea
				ref={focus}
				aria-label={t`Correct this fact`}
				rows={3}
				maxLength={2000}
				disabled={pending}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !pending) onCancel();
				}}
				className="border-accent px-3 py-2.5 text-sm leading-[21px] shadow-[0_0_0_3px_var(--accent-soft)]"
			/>
			<div className="flex flex-wrap gap-2">
				<NativeSelect
					aria-label={t`Fact type`}
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
				<NativeSelect
					aria-label={t`Scope`}
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
			{applications.isError && <CareerLoadError onRetry={() => void applications.refetch()} />}
			<div className="flex flex-wrap items-center gap-1.5">
				<Button
					variant="secondary"
					size="sm"
					className="h-[30px] px-3"
					disabled={!draft.trim() || !changed}
					loading={pending}
					onClick={() => void save()}
				>
					<Trans>Save correction</Trans>
				</Button>
				<Button variant="ghost" size="sm" className="h-[30px] text-ink-2" disabled={pending} onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
				<span className="text-xs text-ink-3">
					<Trans>The original stays in the history.</Trans>
				</span>
			</div>
		</div>
	);
}
