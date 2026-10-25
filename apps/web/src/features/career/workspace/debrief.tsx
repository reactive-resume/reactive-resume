import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { Application } from "@/features/applications/types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useTicks } from "../hooks";
import { FilterChip, MemoryProposal, PrivacyLine, useCareerTime, Working, workingSteps } from "../shared";
import { buildIcs } from "@/features/applications/ics";
import { isInterview } from "@/features/applications/interviews";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

type Debrief = SavedData<"debrief">;
type Review = Pick<SavedItem, "id" | "interviewId" | "evidence"> & { data: Debrief };
type Draft = { question: string; answer: string; landed: Debrief["landed"] | null };

const isDebrief = (item: SavedItem | undefined): item is SavedItem & { data: Debrief } => item?.data.kind === "debrief";

/** The round to write down: the most recent interview that has ended, else the next one. */
function debriefRound(application: Application, now: Date) {
	const interviews = application.activity.filter(isInterview).sort((a, b) => +new Date(a.at) - +new Date(b.at));
	const ended = interviews.filter((interview) => +new Date(interview.at) + interview.durationMinutes * 60_000 <= +now);
	return ended.at(-1) ?? interviews[0];
}

const afterRound = (kind: InterviewKind | undefined) =>
	({
		screening: t`After the screening`,
		technical: t`After the technical interview`,
		behavioral: t`After the behavioral interview`,
		onsite: t`After the onsite`,
		other: t`After the interview`,
	})[kind ?? "other"];

export function DebriefTab({ application, version, now }: WorkspaceTabProps) {
	const saved = useSavedItems(application.id);
	const [fresh, setFresh] = useState<Review | null>(null);
	const viewing = isDebrief(version) ? version : undefined;
	const round = viewing
		? application.activity.filter(isInterview).find((entry) => entry.id === viewing.interviewId)
		: debriefRound(application, now);
	const forRound = latest(saved.data, "debrief", round?.id ?? null);
	const review = viewing ?? fresh ?? forRound;
	const plan = viewing ?? fresh ?? latest(saved.data, "debrief");

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_320px]">
			<div className="grid min-w-0 gap-4">
				{saved.isPending ? (
					<Skeleton className="h-80 rounded-xl" />
				) : (
					<DebriefForm
						key={`form:${viewing?.id ?? round?.id ?? "none"}`}
						application={application}
						round={round}
						from={viewing ?? forRound}
						readOnly={viewing !== undefined}
						onReviewed={setFresh}
					/>
				)}
				{review && (
					<ReviewCard key={`review:${review.id}`} application={application} review={review} readOnly={!!viewing} />
				)}
			</div>
			{plan ? (
				<WeekPlan key={plan.id} application={application} review={plan} now={now} readOnly={!!viewing} />
			) : (
				<aside className="rounded-xl border border-dashed border-line-2 p-4 text-[13px] leading-[19px] text-ink-3">
					<Trans>After your first review, a light plan for this week appears here.</Trans>
				</aside>
			)}
		</div>
	);
}

type DebriefFormProps = {
	application: Application;
	round: InterviewTimelineEntry | undefined;
	/** A saved debrief to start from: the one opened from Saved, or this round's last review. */
	from: Review | undefined;
	readOnly: boolean;
	onReviewed: (review: Review) => void;
};

function DebriefForm({ application, round, from, readOnly, onReviewed }: DebriefFormProps) {
	const id = useId();
	const { day } = useCareerTime();
	const generate = useGenerate(application.id);
	const connection = useDefaultProvider();
	const { provider } = connection;
	// Tab switches and reloads keep what was written until it's reviewed.
	const storageKey = `career-debrief-draft:${application.id}:${round?.id ?? "none"}`;
	const [draft, setDraft] = useState<Draft>(() => {
		if (!readOnly) {
			try {
				const stored = sessionStorage.getItem(storageKey);
				if (stored) return JSON.parse(stored) as Draft;
			} catch {
				// Storage is blocked: the draft lives in this view only.
			}
		}
		return from
			? { question: from.data.question, answer: from.data.answer, landed: from.data.landed }
			: { question: "", answer: "", landed: null };
	});
	const change = (patch: Partial<Draft>) => {
		if (readOnly) return;
		const next = { ...draft, ...patch };
		setDraft(next);
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			// Storage is blocked: the draft lives in this view only.
		}
	};
	const submit = () => {
		if (!draft.landed) return;
		generate
			.run({
				task: "debrief",
				interviewId: round?.id ?? null,
				question: draft.question.trim(),
				answer: draft.answer.trim(),
				landed: draft.landed,
			})
			.then(({ item }) => {
				if (item?.data.kind !== "debrief") return;
				onReviewed(item as Review);
				try {
					sessionStorage.removeItem(storageKey);
				} catch {
					// Nothing to clear.
				}
			})
			.catch(() => undefined);
	};

	const ready = draft.question.trim() !== "" && draft.answer.trim() !== "" && draft.landed !== null;
	const providerName = provider?.label ?? t`your AI connection`;
	const landed = [
		{ value: "well", label: t`Went well` },
		{ value: "mixed", label: t`Mixed` },
		{ value: "not", label: t`Didn't land` },
	] as const;

	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 id={`${id}-title`} className="text-[15px] font-semibold">
					{readOnly && !round ? from?.data.round || t`Interview debrief` : afterRound(round?.kind)}
					{round && ` · ${day(round.at)}`}
				</h2>
				<p className="text-xs text-ink-3">
					<Trans>Write it down while it's fresh</Trans>
				</p>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-question`}>
					<Trans>What did they ask?</Trans>
				</Label>
				<Input
					id={`${id}-question`}
					value={draft.question}
					readOnly={readOnly}
					maxLength={500}
					onChange={(event) => change({ question: event.target.value })}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-answer`}>
					<Trans>What did you say, as close as you remember?</Trans>
				</Label>
				<Textarea
					id={`${id}-answer`}
					value={draft.answer}
					readOnly={readOnly}
					maxLength={6000}
					onChange={(event) => change({ answer: event.target.value })}
					className="min-h-21 px-3 py-2.5 text-sm leading-[21px] pointer-coarse:text-base"
				/>
			</div>
			<div className="grid gap-1.5">
				<p id={`${id}-landed`} className="text-xs leading-4 font-medium text-ink-2">
					<Trans>How did it land?</Trans>
				</p>
				<fieldset disabled={readOnly} aria-labelledby={`${id}-landed`} className="flex flex-wrap gap-1.5">
					{landed.map((option) => (
						<FilterChip
							key={option.value}
							pressed={draft.landed === option.value}
							onClick={() => change({ landed: draft.landed === option.value ? null : option.value })}
						>
							{option.label}
						</FilterChip>
					))}
				</fieldset>
			</div>
			{!readOnly && (
				<div className="grid justify-items-start gap-2.5">
					<Button disabled={!ready || !provider} loading={generate.isPending} onClick={submit}>
						{generate.isPending ? <Working steps={workingSteps("debrief")} /> : <Trans>Review my answer</Trans>}
					</Button>
					{connection.isUnavailable ? (
						<AiProviderLoadState state={connection} />
					) : provider ? (
						<PrivacyLine>
							<Trans>
								Review my answer sends the question, what you said, this posting and your Knowledge to {providerName}.
							</Trans>
						</PrivacyLine>
					) : (
						<PrivacyLine>
							<Trans>
								Reviewing needs an AI connection.{" "}
								<Link to="/dashboard/settings/ai" className="text-accent-text underline underline-offset-3">
									Add one in Settings
								</Link>
								. What you write here stays in this browser until then.
							</Trans>
						</PrivacyLine>
					)}
				</div>
			)}
		</section>
	);
}

type ReviewCardProps = { application: Application; review: Review; readOnly: boolean };

/** What the evidence supports versus what was only observed, and one thing worth remembering for this job. */
function ReviewCard({ application, review, readOnly }: ReviewCardProps) {
	const queryClient = useQueryClient();
	const { data } = review;
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const dismissKey = `career-memory-dismissed:${review.id}`;
	const [dismissed, setDismissed] = useState(() => {
		try {
			return localStorage.getItem(dismissKey) === "1";
		} catch {
			return false;
		}
	});
	const save = useMutation({
		...orpc.career.saveFact.mutationOptions(),
		onSuccess: (fact) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			if (!fact) {
				toast.add({ description: t`You forgot this before, so it wasn't saved again.` });
				setDismissed(true);
			}
		},
		onError: (error) => toastError(error, t`Couldn't save that to Knowledge. Try again.`),
	});
	const remembered =
		Boolean(save.data) ||
		(facts.data?.some((fact) => fact.source.kind === "debrief" && fact.source.id === review.id) ?? false);
	const readable = (text: string) =>
		[...new Set([...review.evidence.factIds, ...(facts.data ?? []).map((fact) => fact.id)])]
			.filter(Boolean)
			.reduce((value, id) => value.split(id).join(t`your Knowledge`), text);
	const company = application.company;

	return (
		<section
			aria-label={t`Review`}
			className={cn("grid gap-4 rounded-xl border border-line bg-surface p-4 md:p-5", ENTER_CLASS)}
		>
			<h2 className="text-base font-semibold">{data.title}</h2>
			{data.verdicts.length > 0 && (
				<ul className="grid gap-3">
					{data.verdicts.map((verdict) => (
						<li key={verdict.text} className="flex items-start gap-2.5">
							<span
								className={cn(
									"inline-flex h-[22px] shrink-0 items-center rounded-sm px-1.5 text-xs font-semibold",
									verdict.tag === "supported" ? "bg-accent-soft text-accent-text" : "bg-warn-soft text-warn-text",
								)}
							>
								{verdict.tag === "supported" ? t`Supported` : t`Observation`}
							</span>
							<span className="text-sm leading-[21px]">{readable(verdict.text)}</span>
						</li>
					))}
				</ul>
			)}
			{data.nextRound && (
				<p className="text-sm leading-[21px]">
					<strong className="font-semibold">
						<Trans>For the next round:</Trans>
					</strong>{" "}
					{readable(data.nextRound)}
				</p>
			)}
			{data.priority && (
				<p className="text-sm leading-[21px]">
					<strong className="font-semibold">
						<Trans>Practice priority:</Trans>
					</strong>{" "}
					{readable(data.priority)}
				</p>
			)}
			{data.remember && !readOnly && (
				<MemoryProposal
					question={t`Remember for ${company} only?`}
					facts={[data.remember]}
					state={remembered ? "remembered" : dismissed ? "dismissed" : "pending"}
					remembered={<Trans>Saved to Knowledge, private to this application.</Trans>}
					busy={save.isPending}
					onRemember={() => {
						if (!data.remember) return;
						save.mutate({
							applicationId: application.id,
							category: "experience",
							text: data.remember,
							source: { kind: "debrief", id: review.id, quote: data.remember },
						});
					}}
					onDismiss={() => {
						setDismissed(true);
						try {
							localStorage.setItem(dismissKey, "1");
						} catch {
							// Storage is blocked: it stays hidden for this visit.
						}
					}}
				/>
			)}
		</section>
	);
}

// ---- This week's plan ----

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function zonedParts(at: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		hourCycle: "h23",
	}).formatToParts(at);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
	const number = (type: Intl.DateTimeFormatPartTypes) => Number(part(type));
	return {
		weekday: WEEKDAYS.indexOf(part("weekday").toLowerCase() as (typeof WEEKDAYS)[number]),
		year: number("year"),
		month: number("month"),
		day: number("day"),
		hour: number("hour"),
		minute: number("minute"),
	};
}

/** The next `weekday` at 18:00 in the Preferences timezone; today when it's that day and 18:00 is still ahead. */
function nextEvening(weekday: (typeof WEEKDAYS)[number], now: Date, timeZone: string) {
	const today = zonedParts(now, timeZone);
	let ahead = (WEEKDAYS.indexOf(weekday) - today.weekday + 7) % 7;
	if (ahead === 0 && today.hour >= 18) ahead = 7;
	// 18:00 on that date read as UTC, moved by the zone's offset at that moment.
	// ponytail: the offset is taken at the guess, so a DST switch that same evening lands an hour off.
	const guess = Date.UTC(today.year, today.month - 1, today.day + ahead, 18);
	const there = zonedParts(new Date(guess), timeZone);
	return new Date(guess - (Date.UTC(there.year, there.month - 1, there.day, there.hour, there.minute) - guess));
}

type WeekPlanProps = { application: Application; review: Review; now: Date; readOnly: boolean };

function WeekPlan({ application, review, now, readOnly }: WeekPlanProps) {
	const { format, timeZone } = useCareerTime();
	const ticks = useTicks(application.id, `week:${review.id}`);
	const rows = review.data.plan.map((row, index) => ({
		...row,
		key: String(index),
		start: nextEvening(row.day, now, timeZone),
	}));
	const done = rows.filter((row) => ticks.ticked.includes(row.key)).length;
	const count = rows.length;
	const minutes = rows.reduce((sum, row) => sum + row.minutes, 0);
	const company = application.company;

	const addToCalendar = () => {
		const ics = buildIcs(
			rows.map((row) => ({
				uid: `${review.id}-${row.key}`,
				title: row.task,
				start: row.start,
				end: new Date(row.start.getTime() + row.minutes * 60_000),
				description: t`Practice for your ${company} interviews.`,
			})),
		);
		downloadWithAnchor(
			new Blob([ics], { type: "text/calendar" }),
			`${company}-practice-week.ics`.replace(/[^\w.-]+/g, "-"),
		);
	};

	return (
		<aside className="grid gap-3 rounded-xl border border-line bg-surface p-4">
			<div className="grid gap-1">
				<h2 className="text-sm font-semibold">
					<Trans>This week: make your evidence easier to follow</Trans>
				</h2>
				<p className="text-xs text-ink-3">
					{t`${done} of ${count} done`} · {plural(minutes, { one: "# minute in total", other: "# minutes in total" })}
				</p>
			</div>
			<ul className="grid">
				{rows.map((row) => {
					const checked = ticks.ticked.includes(row.key);
					const weekday = format(row.start, { weekday: "short" });
					const length = row.minutes;
					return (
						<li key={row.key} className="border-t border-line py-3 first:border-t-0 first:pt-1">
							<label className="grid cursor-pointer grid-cols-[18px_40px_minmax(0,1fr)] items-start gap-3">
								<Checkbox
									disabled={readOnly}
									checked={checked}
									onCheckedChange={(on) => ticks.toggle(row.key, on)}
									className="mt-px"
								/>
								<span className="font-mono text-xs leading-4 font-medium text-ink-3">
									{weekday}
									<br />
									{t`${length}m`}
								</span>
								<span
									className={cn(
										"text-[13px] leading-[19px] transition-colors duration-quick",
										checked ? "text-ink-2" : "text-ink",
									)}
								>
									{row.task}
								</span>
							</label>
						</li>
					);
				})}
			</ul>
			{rows.length > 0 && (
				<Button size="sm" variant="secondary" className="h-8 w-fit" onClick={addToCalendar}>
					<Icon name="calendar-plus" size={16} />
					<Trans>Add to calendar</Trans>
				</Button>
			)}
			<p className="text-xs leading-[17px] text-ink-3">
				<Trans>Practice priorities, not conclusions about why an employer decided anything.</Trans>
			</p>
		</aside>
	);
}
