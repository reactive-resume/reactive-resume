import type { Fact } from "../hooks";
import type { FactCategory, MemoryMode } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { KeyboardEvent } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { memo, useDeferredValue, useEffect, useId, useRef, useState } from "react";
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
import { CollapseRow, FilterChip, flash, useCareerTime, withUndo } from "../shared";
import { useProfile } from "./preferences";
import { toastError } from "@/libs/error-message";
import { D2, EASE, EXIT } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

export const CATEGORIES = factCategorySchema.options;
/** Older rows may carry a retired category; they read as experience. */
const categoryOf = (fact: Fact): FactCategory => factCategorySchema.catch("experience").parse(fact.category);

export const categoryLabel = (category: FactCategory) =>
	({
		accomplishment: t`Accomplishment`,
		experience: t`Experience`,
		skill: t`Skill`,
		preference: t`Preference`,
	})[category];

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
	const listRef = useRef<HTMLDivElement>(null);

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
	const correct = (fact: Fact, text: string) => {
		patch(fact.id, { text, revisions: [...fact.revisions, { text: fact.text, at: new Date().toISOString() }] });
		updateFact({ id: fact.id, text });
	};
	const share = (fact: Fact) => {
		patch(fact.id, { applicationId: null, company: null });
		updateFact({ id: fact.id, share: true });
	};

	const forget = (fact: Fact) => {
		setHidden((current) => [...current, fact.id]);
		withUndo({
			description: t`Fact forgotten`,
			onUndo: () => setHidden((current) => current.filter((id) => id !== fact.id)),
			commit: () =>
				client.career
					.forgetFact({ id: fact.id })
					.catch((error: unknown) => {
						setHidden((current) => current.filter((id) => id !== fact.id));
						toastError(error, t`Couldn't forget that fact. Try again.`);
					})
					.finally(refresh),
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
				<FilterChip pressed={type === null} onClick={() => setType(null)}>
					<Trans>All</Trans>
				</FilterChip>
				{CATEGORIES.map((category) => (
					<FilterChip key={category} pressed={type === category} onClick={() => setType(category)}>
						{categoryLabel(category)}
					</FilterChip>
				))}
			</div>

			<AddFact onAdded={added} />
			{!facts && (factQuery.isError ? <CareerLoadError onRetry={() => void factQuery.refetch()} /> : <CareerLoading />)}

			{facts && (
				<div ref={listRef} className="overflow-hidden rounded-xl border border-line bg-surface">
					<AnimatePresence initial={false}>
						{visible.map((fact) => (
							<FactRow
								key={fact.id}
								fact={fact}
								onStatus={setStatus}
								onCorrect={correct}
								onShare={share}
								onForget={forget}
							/>
						))}
					</AnimatePresence>
					{visible.length === 0 && (
						<EmptyState
							variant="compact"
							title={facts.length === 0 ? t`No facts yet` : t`No facts match`}
							description={facts.length === 0 ? t`Add one above.` : t`Try another word or type.`}
							action={
								type !== null ? (
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
				onValueChange={(value) => profile && save({ ...profile, memoryMode: value as MemoryMode })}
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
					className={cn("h-8 px-3", !ready && "text-ink-3")}
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
	onCorrect: (fact: Fact, text: string) => void;
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
					<p className="flex flex-wrap items-center gap-2 font-mono text-xs font-medium text-ink-3">
						{categoryLabel(categoryOf(fact))}
						<span
							className={cn(
								"h-[18px] rounded-lg px-1.5 font-sans text-[11px] leading-[18px] normal-case",
								company === null ? "bg-sunken text-ink-2" : "bg-info-soft text-info-text",
							)}
						>
							{company === null ? t`All applications` : t`${company} only`}
						</span>
					</p>

					{correcting ? (
						<Correction
							text={fact.text}
							onCancel={() => setCorrecting(false)}
							onSave={(text) => {
								setCorrecting(false);
								if (text !== fact.text) onCorrect(fact, text);
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
													<span className="font-mono text-[11px]">{date(revision.at)}</span> · {revision.text}
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

type CorrectionProps = { text: string; onSave: (text: string) => void; onCancel: () => void };

function Correction({ text, onSave, onCancel }: CorrectionProps) {
	const [draft, setDraft] = useState(text);
	const save = () => draft.trim() && onSave(draft.trim());

	return (
		<div className="grid gap-2">
			<Textarea
				ref={(element) => {
					// Focused with the cursor at the end, ready to fix the last few words.
					if (!element || element === document.activeElement) return;
					element.focus();
					element.setSelectionRange(element.value.length, element.value.length);
				}}
				aria-label={t`Correct this fact`}
				rows={3}
				maxLength={2000}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
				}}
				className="border-accent px-3 py-2.5 text-sm leading-[21px] shadow-[0_0_0_3px_var(--accent-soft)]"
			/>
			<div className="flex flex-wrap items-center gap-1.5">
				<Button variant="secondary" size="sm" className="h-[30px] px-3" disabled={!draft.trim()} onClick={save}>
					<Trans>Save correction</Trans>
				</Button>
				<Button variant="ghost" size="sm" className="h-[30px] text-ink-2" onClick={onCancel}>
					<Trans>Cancel</Trans>
				</Button>
				<span className="text-xs text-ink-3">
					<Trans>The original stays in the history.</Trans>
				</span>
			</div>
		</div>
	);
}
