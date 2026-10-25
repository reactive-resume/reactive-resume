import type { GenerateTask, WorkspaceTab } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useRouteContext } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { D2, EASE, EXIT } from "@/libs/motion";

// ---- Time: always in the user's timezone, "Thu 8 Oct, 17:58". Relative time is secondary text. ----

/** The current time, ticking once a minute (countdowns, the Prepare switch to "10 minutes before"). */
export function useNow(intervalMs = 60_000) {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return now;
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** Formatters in the user's timezone (Settings → Preferences) and interface locale. */
export function useCareerTime() {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ strict: false });
	const timeZone = session?.user.timezone ?? "UTC";
	const locale = i18n.locale;
	const format = (value: Date | string, options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(value));

	return {
		timeZone,
		locale,
		/** "Thu 8 Oct, 17:58" */
		when: (value: Date | string) =>
			`${format(value, { weekday: "short", day: "numeric", month: "short" })}, ${format(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`,
		/** "Thu 8 Oct" */
		day: (value: Date | string) => format(value, { weekday: "short", day: "numeric", month: "short" }),
		/** "25 Sep" */
		date: (value: Date | string) => format(value, { day: "numeric", month: "short" }),
		/** "17:58" */
		time: (value: Date | string) => format(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
		format,
		/** "In 23 hours", "Yesterday": the largest whole unit. */
		relative: (value: Date | string, now = new Date()) => {
			const seconds = (new Date(value).getTime() - now.getTime()) / 1000;
			const units: [Intl.RelativeTimeFormatUnit, number][] = [
				["day", 86_400],
				["hour", 3600],
				["minute", 60],
			];
			const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ["minute", 60];
			return capitalize(
				new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / size), unit),
			);
		},
	};
}

// ---- Undo over confirm: hide now, commit when the toast closes unless Undo was pressed. ----

type UndoInput = {
	description: string;
	/** Runs when the toast closes (after 6 seconds, or when another toast replaces it). */
	commit: () => unknown;
	/** Restores what was hidden. */
	onUndo: () => void;
};

/** Commits waiting on an open undo toast; leaving the page runs them rather than dropping them. */
const pendingCommits = new Set<() => void>();
if (typeof document !== "undefined")
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") for (const flush of pendingCommits) flush();
	});

/**
 * Forget, delete, dismiss, apply: the caller hides or shows the change at once and this commits it when the toast
 * closes (after 6 seconds, when another toast replaces it, or when the page is hidden). Undo restores it instead.
 * ponytail: closing the tab outright can still beat the commit; the change then simply didn't happen.
 */
export function withUndo({ description, commit, onUndo }: UndoInput) {
	let settled = false;
	const settle = (run: boolean) => {
		if (settled) return false;
		settled = true;
		pendingCommits.delete(flush);
		if (run) void commit();
		return true;
	};
	const flush = () => {
		if (settle(true)) toast.close(id);
	};
	const id = toast.add({
		description,
		actionProps: {
			children: t`Undo`,
			onClick: () => {
				if (!settle(false)) return;
				onUndo();
				toast.close(id);
			},
		},
		onClose: () => settle(true),
	});
	pendingCommits.add(flush);
}

/** Tints a row accent-soft and fades it over 1.2s after navigating to it ("View", "Review"). */
export function flash(element: Element | null) {
	if (!element) return;
	element.scrollIntoView({ block: "nearest", behavior: "smooth" });
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		element.animate([{ outline: "2px solid var(--accent)" }, { outline: "2px solid var(--accent)" }], 1200);
		return;
	}
	element.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], {
		duration: 1200,
		easing: "ease-out",
	});
}

// ---- Motion: rows that leave collapse; panels that swap crossfade. ----

/** A list row that collapses (height and opacity) when it leaves. Wrap the list in `<AnimatePresence initial={false}>`. */
export function CollapseRow({ children, className, ...props }: ComponentProps<typeof m.div>) {
	return (
		<m.div
			layout="position"
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: "auto", opacity: 1, transition: { duration: D2, ease: EASE } }}
			exit={{ height: 0, opacity: 0, transition: { duration: D2 * EXIT, ease: EASE } }}
			className={cn("overflow-hidden", className)}
			{...props}
		>
			{children}
		</m.div>
	);
}

/** Content that appears in place of other content (actions → success line, text → editor): a 200ms crossfade. */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
	return (
		<AnimatePresence mode="popLayout" initial={false}>
			<m.div
				key={id}
				initial={{ opacity: 0, filter: "blur(2px)" }}
				animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: D2, ease: EASE } }}
				exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: D2 * EXIT, ease: EASE } }}
				className={className}
			>
				{children}
			</m.div>
		</AnimatePresence>
	);
}

// ---- Workspace tabs ----

export const tabLabel = (tab: WorkspaceTab) =>
	({
		fit: t({ message: "Fit", context: "Application workspace tab: how well a job fits your experience" }),
		apply: t`Apply`,
		prepare: t`Prepare`,
		practise: t({ message: "Practice", context: "Application workspace tab: rehearse interview answers" }),
		debrief: t`Debrief`,
		messages: t`Messages`,
		saved: t({ message: "Saved", context: "Application workspace tab: earlier results kept for this job" }),
	})[tab];

// ---- Long AI work: what the coach is doing, one phrase at a time ----

/** What each piece of tab work goes through, in order, before the general phrases take over. */
export const workingSteps = (task: GenerateTask["task"] | "tighten" | "chat") =>
	({
		fit: [t`Reading the posting`, t`Matching your facts`, t`Weighing each requirement`, t`Checking your preferences`],
		briefing: [t`Reading the posting`, t`Picking your stories`, t`Timing the plan`, t`Drafting questions`],
		practice: [t`Reading your answer`, t`Finding what works`, t`Sharpening the opening`],
		debrief: [t`Reading your notes`, t`Checking against Knowledge`, t`Planning your week`],
		reply: [t`Reading the message`, t`Spotting what changed`, t`Drafting a reply`],
		answer: [t`Reading the question`, t`Drafting`],
		tighten: [t`Tightening`, t`Trimming words`],
		chat: [t`Thinking`, t`Reading what you shared`],
	})[task];

type WorkingProps = { steps: string[] };

/**
 * A 10–30 second wait reads as progress: the label moves through the work's steps every 2.2 seconds, then loops
 * through general phrases. Each phrase rises in from below out of a 2px blur as the last one leaves upward; all of
 * them share one grid cell, so a button keeps the width of the longest.
 */
export function Working({ steps }: WorkingProps) {
	const general = [t`Thinking`, t`Double-checking`, t`Polishing`];
	const phrases = [...steps, ...general];
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => setTick((current) => current + 1), 2200);
		return () => window.clearInterval(id);
	}, []);
	const at = (n: number) => (n < phrases.length ? n : steps.length + ((n - steps.length) % general.length));
	const shown = at(tick);
	const left = tick > 0 ? at(tick - 1) : -1;

	return (
		<span className="inline-grid">
			<span className="sr-only">{phrases[0]}…</span>
			{phrases.map((phrase, index) => (
				<span
					key={index}
					aria-hidden="true"
					className={cn(
						"col-start-1 row-start-1 transition-[opacity,translate,filter] duration-standard ease-enter motion-reduce:translate-y-0 motion-reduce:blur-none",
						index === shown
							? ""
							: index === left
								? "-translate-y-1 opacity-0 blur-[2px]"
								: "translate-y-1 opacity-0 blur-[2px]",
					)}
				>
					{phrase}…
				</span>
			))}
		</span>
	);
}

// ---- Small parts ----

/** "NEXT STEP", "SCHEDULES": 12px semibold ink-3. */
type EyebrowProps = { children: ReactNode; className?: string };
export function Eyebrow({ children, className }: EyebrowProps) {
	return <h2 className={cn("text-xs font-semibold text-ink-3", className)}>{children}</h2>;
}

const statusPill = {
	supported: { icon: "check-circle", tone: "bg-accent-soft text-accent-text" },
	added: { icon: "check-circle", tone: "bg-accent-soft text-accent-text" },
	partial: { icon: "circle-half", tone: "bg-warn-soft text-warn-text" },
	missing: { icon: "question", tone: "bg-sunken text-ink-2" },
} satisfies Record<string, { icon: IconName; tone: string }>;

/** Evidence status: colour, icon and words together. */
export function StatusPill({ status }: { status: keyof typeof statusPill }) {
	const labels = {
		supported: t`Supported`,
		added: t`Added by you`,
		partial: t`Partly supported`,
		missing: t`No evidence yet`,
	};
	const { icon, tone } = statusPill[status];
	return (
		<span className={cn("inline-flex h-6 w-fit items-center gap-1 rounded-sm px-2 text-xs font-semibold", tone)}>
			<Icon name={icon} size={15} />
			{labels[status]}
		</span>
	);
}

/** A match in the user's own words, or a fact that's unknown. */
export function InfoChip({ tone, children }: { tone: "match" | "unknown"; children: ReactNode }) {
	return (
		<span
			className={cn(
				"inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-medium",
				tone === "match" ? "bg-accent-soft text-accent-text" : "bg-warn-soft text-warn-text",
			)}
		>
			<Icon name={tone === "match" ? "check" : "question"} size={15} />
			{children}
		</span>
	);
}

type FilterChipProps = { pressed: boolean; onClick: () => void; children: ReactNode; className?: string };

/** A 30px pill toggle for filters and single choices; selected is ink-filled. */
export function FilterChip({ pressed, onClick, children, className }: FilterChipProps) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"touch-target inline-flex h-[30px] items-center rounded-sm border px-2.5 text-xs font-medium transition-[background-color,border-color,color,scale] duration-quick ease-enter active:scale-[0.97]",
				pressed ? "border-ink bg-ink text-bg" : "border-line-2 text-ink hover:bg-hover",
				className,
			)}
		>
			{children}
		</button>
	);
}

type ContextChipProps = {
	pressed: boolean;
	onPressedChange: (pressed: boolean) => void;
	label: string;
	tooltip: string;
	/** Shown when off instead of `add`; Web research uses `public`. */
	offIcon?: IconName;
};

/** Composer context switches: on is sunken with a check, off is quiet with add. */
export function ContextChip({ pressed, onPressedChange, label, tooltip, offIcon = "plus" }: ContextChipProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-pressed={pressed}
						onClick={() => onPressedChange(!pressed)}
						className={cn(
							"touch-target inline-flex h-7 items-center gap-1 rounded-sm border px-[9px] text-xs font-medium transition-[background-color,border-color,color] duration-quick",
							pressed ? "border-line-2 bg-sunken text-ink" : "border-line text-ink-3 hover:text-ink-2",
						)}
					/>
				}
			>
				<Icon name={pressed ? "check" : offIcon} size={16} />
				{label}
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

/** Names exactly what an AI action sends, and where. `cost` adds the provider-may-charge callout. */
export function PrivacyLine({
	children,
	cost,
	className,
}: {
	children: ReactNode;
	cost?: boolean;
	className?: string;
}) {
	if (cost)
		return (
			<p
				className={cn(
					"flex gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] leading-[19px] text-warn-text",
					className,
				)}
			>
				<Icon name="key" size={16} className="mt-px shrink-0" />
				<span>{children}</span>
			</p>
		);
	return (
		<p className={cn("flex gap-1.5 text-xs leading-[17px] text-ink-3", className)}>
			<Icon name="lock" size={15} className="shrink-0" />
			<span>{children}</span>
		</p>
	);
}

/** Whole minutes until `at`; negative once it has started. */
export const minutesUntil = (at: Date, now: Date) => Math.round((at.getTime() - now.getTime()) / 60_000);

type CountdownChipProps = { at: Date; now: Date; className?: string };

/** "In 23 hours" on sunken; within the hour it turns warn and reads "Starts in 10 minutes". */
export function CountdownChip({ at, now, className }: CountdownChipProps) {
	const { relative } = useCareerTime();
	const minutes = minutesUntil(at, now);
	const soon = minutes <= 60;
	const label = minutes <= 0 ? t`Started` : soon ? t`Starts in ${minutes} minutes` : relative(at, now);
	return (
		<span
			className={cn(
				"inline-flex h-6 w-fit items-center gap-1 rounded-sm px-2 text-xs font-semibold",
				soon ? "bg-warn-soft text-warn-text" : "bg-sunken text-ink-2",
				className,
			)}
		>
			<Icon name="clock" size={15} />
			{label}
			{/* Announced only when it crosses the hour and ten minutes, not every minute. */}
			<span className="sr-only" aria-live="polite">
				{minutes === 60 || minutes === 10 ? label : ""}
			</span>
		</span>
	);
}

type MemoryProposalProps = {
	/** "Remember this for future coaching?" or "Remember for Northstar only?" */
	question: string;
	facts: string[];
	state: "pending" | "remembered" | "dismissed";
	/** Shown after Remember: "Added to Knowledge as a preference." */
	remembered: ReactNode;
	onRemember: (selected: number[]) => void;
	onDismiss: () => void;
	busy?: boolean;
};

/** Offers to remember durable facts from an answer. Several facts become a checklist inside one proposal. */
export function MemoryProposal(props: MemoryProposalProps) {
	const [selected, setSelected] = useState(() => props.facts.map((_, index) => index));
	if (props.state === "dismissed") return null;
	return (
		<Swap id={props.state}>
			{props.state === "remembered" ? (
				<p className="flex items-center gap-1.5 text-sm text-accent-text">
					<Icon name="check-circle" size={18} />
					{props.remembered}
				</p>
			) : (
				<div className="flex flex-wrap items-center gap-3 rounded-lg bg-info-soft px-3.5 py-3">
					<Icon name="bookmark-simple" className="shrink-0 text-info-text" />
					<div className="grid min-w-0 flex-1 basis-60 gap-1 text-[13px] leading-[19px]">
						<p className="font-semibold text-ink">{props.question}</p>
						{props.facts.length === 1 ? (
							<q className="text-ink-2">{props.facts[0]}</q>
						) : (
							props.facts.map((fact, index) => (
								<label key={fact} className="flex items-start gap-2 text-ink-2">
									<Checkbox
										checked={selected.includes(index)}
										onCheckedChange={(checked) =>
											setSelected((current) =>
												checked ? [...current, index] : current.filter((item) => item !== index),
											)
										}
									/>
									<q>{fact}</q>
								</label>
							))
						)}
					</div>
					<div className="flex shrink-0 gap-1">
						<Button
							size="sm"
							variant="secondary"
							loading={props.busy ?? false}
							disabled={selected.length === 0}
							onClick={() => props.onRemember(selected)}
						>
							<Trans>Remember</Trans>
						</Button>
						<Button size="sm" variant="ghost" onClick={props.onDismiss}>
							<Trans>Not now</Trans>
						</Button>
					</div>
				</div>
			)}
		</Swap>
	);
}
