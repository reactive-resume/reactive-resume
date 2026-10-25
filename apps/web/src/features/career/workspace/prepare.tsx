import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useTicks, useWorkspace } from "../hooks";
import { Eyebrow, flash, minutesUntil, PrivacyLine, useCareerTime, Working, workingSteps } from "../shared";
import { interviewTypeLabel } from "@/features/applications/components/interview-dialog";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Briefing = SavedItem & { data: SavedData<"briefing"> };

const isBriefing = (item: SavedItem | undefined): item is Briefing => item?.data.kind === "briefing";

/** Before start − 10 min: the plan (W6). Until the end: the 10-minute checklist (W7/W21). After: "How did it go?". */
export function PrepareTab({ application, version, interview, now, go }: WorkspaceTabProps) {
	const saved = useSavedItems(application.id);

	if (!interview && !isBriefing(version))
		return (
			<Notice title={t`Add an interview to plan for it`}>
				<p className="max-w-[340px] text-sm text-ink-2">
					<Trans>Once a round is scheduled, Prepare builds a timed plan, your opening and the questions to ask.</Trans>
				</p>
				<Button variant="secondary" onClick={() => go("prepare", { edit: "interview" })}>
					<Icon name="calendar-dot" size={18} />
					<Trans>Add an interview</Trans>
				</Button>
			</Notice>
		);

	const briefing = isBriefing(version) ? version : latest(saved.data, "briefing", interview?.id ?? null);

	if (interview && !isBriefing(version)) {
		const start = new Date(interview.at).getTime();
		const end = start + interview.durationMinutes * 60_000;
		if (now.getTime() > end)
			return (
				<Notice title={t`How did it go?`}>
					<p className="max-w-[340px] text-sm text-ink-2">
						<Trans>
							Write down what they asked while it's fresh. The coach compares your answers with your stories.
						</Trans>
					</p>
					<Button onClick={() => go("debrief")}>
						<Trans>Start a debrief</Trans>
					</Button>
				</Notice>
			);
		if (now.getTime() >= start - 10 * 60_000)
			return <Soon application={application} interview={interview} briefing={briefing} now={now} go={go} />;
	}

	if (!briefing) {
		if (saved.isPending) return <Skeleton className="h-64 rounded-xl" />;
		return interview ? <PlanEmpty application={application} interview={interview} /> : null;
	}

	return <Plan application={application} interview={interview} briefing={briefing} readOnly={!!version} go={go} />;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="grid justify-items-center gap-3 rounded-xl border border-dashed border-line-2 p-7 text-center">
			<h2 className="font-display text-[22px] leading-7 font-medium">{title}</h2>
			{children}
		</div>
	);
}

type PlanEmptyProps = { application: Application; interview: InterviewTimelineEntry };

function PlanEmpty({ application, interview }: PlanEmptyProps) {
	const connection = useDefaultProvider();
	const { provider } = connection;
	const generate = useGenerate(application.id);
	const label = provider?.label ?? "";
	return (
		<Notice title={t`A focused plan for this round`}>
			<p className="max-w-[340px] text-sm text-ink-2">
				<Trans>
					A timed plan, your opening, the stories to bring and questions to ask. It becomes your checklist 10 minutes
					before the call.
				</Trans>
			</p>
			{connection.isUnavailable ? (
				<AiProviderLoadState state={connection} />
			) : provider ? (
				<>
					<Button
						loading={generate.isPending}
						disabled={!provider}
						onClick={() => void generate.run({ task: "briefing", interviewId: interview.id }).catch(() => {})}
					>
						{generate.isPending ? <Working steps={workingSteps("briefing")} /> : <Trans>Plan my preparation</Trans>}
					</Button>
					<PrivacyLine className="max-w-[360px] text-start">
						<Trans>
							Sends this application (posting, notes, interview details) and Knowledge that's switched on to {label}.
						</Trans>
					</PrivacyLine>
				</>
			) : (
				<Link to="/dashboard/settings/ai" className={cn(buttonVariants({ variant: "secondary" }))}>
					<Trans>Connect an AI provider in Settings</Trans>
				</Link>
			)}
		</Notice>
	);
}

// ---- W6: the day before ----

type PlanProps = {
	application: Application;
	interview: InterviewTimelineEntry | undefined;
	briefing: Briefing;
	readOnly: boolean;
	go: WorkspaceTabProps["go"];
};

function Plan({ application, interview, briefing, readOnly, go }: PlanProps) {
	const { data } = briefing;
	const ticks = useTicks(application.id, `plan:${briefing.id}`);
	const workspace = useWorkspace(application.id);
	const [reading, setReading] = useState(false);
	const questionsRef = useRef<HTMLDivElement>(null);
	const done = (index: number) => ticks.ticked.includes(String(index));
	const total = data.plan.reduce((sum, row) => sum + row.minutes, 0);
	const doneMinutes = data.plan.reduce((sum, row, index) => sum + (done(index) ? row.minutes : 0), 0);
	const questions = [...data.questions, ...workspace.data.questions];
	const { provider } = useDefaultProvider();
	const generate = useGenerate(application.id);

	const action = (row: SavedData<"briefing">["plan"][number]) => {
		const className = cn(buttonVariants({ variant: "secondary", size: "sm" }));
		switch (row.action) {
			case "story":
				return (
					<Link
						to="/dashboard/career/knowledge/stories/{-$storyId}"
						params={{ storyId: row.storyId ?? undefined }}
						className={className}
					>
						<Trans>Open story</Trans>
					</Link>
				);
			case "draft-story":
				return (
					<Link
						to="/dashboard/career/knowledge/stories/{-$storyId}"
						params={{ storyId: undefined }}
						search={{ edit: true }}
						className={className}
					>
						<Trans>Draft story</Trans>
					</Link>
				);
			case "questions":
				return (
					<Button size="sm" variant="secondary" onClick={() => flash(questionsRef.current)}>
						<Trans>See below</Trans>
					</Button>
				);
			case "practise":
				return (
					<Button size="sm" variant="secondary" onClick={() => go("practise", { speak: true })}>
						<Trans context="Button: rehearse interview answers">Practice</Trans>
					</Button>
				);
			case "none":
				return null;
		}
	};

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px] @5xl:grid-cols-[minmax(0,1fr)_340px]">
			<div className="grid gap-3.5">
				<div className="flex flex-wrap items-end gap-x-4 gap-y-2">
					<div className="grid min-w-0 flex-1 basis-64 gap-1">
						<h2 className="font-display text-[22px] leading-7 font-medium">{data.headline}</h2>
						<p className="text-sm text-ink-2">{data.summary}</p>
					</div>
					<span className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs font-medium text-ink-3">
						<Trans>
							{doneMinutes} of {total} min
						</Trans>
						{/* The interview, posting or Knowledge changed since it was planned: plan again on request. */}
						{briefing.outdated && !readOnly && provider && interview && (
							<Button
								variant="link"
								size="sm"
								className="font-sans text-[13px] tracking-normal normal-case"
								loading={generate.isPending}
								onClick={() =>
									void generate.run({ task: "briefing", interviewId: interview.id }).catch(() => undefined)
								}
							>
								{generate.isPending ? <Working steps={workingSteps("briefing")} /> : <Trans>Plan again</Trans>}
							</Button>
						)}
					</span>
				</div>
				<div aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden rounded-md">
					{data.plan.map((row, index) => (
						<span
							key={`${row.title}-${index}`}
							style={{ flexGrow: row.minutes }}
							className={cn(
								"h-full basis-0 transition-[background-color,flex-grow] duration-standard ease-enter",
								done(index) ? "bg-accent" : "bg-sunken",
							)}
						/>
					))}
				</div>

				<div className="overflow-hidden rounded-xl border border-line bg-surface">
					{data.plan.map((row, index) => (
						<div
							key={`${row.title}-${index}`}
							className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:grid-cols-[28px_64px_minmax(0,1fr)_auto]"
						>
							<Checkbox
								className="mt-px"
								aria-label={row.title}
								disabled={readOnly}
								checked={done(index)}
								onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
							/>
							<span className="font-mono text-xs leading-5 font-medium text-ink-3">
								<Trans>{row.minutes} min</Trans>
							</span>
							<div className="col-start-2 grid gap-0.5 sm:col-start-auto">
								<p
									className={cn(
										"text-sm font-semibold transition-colors duration-quick",
										done(index) ? "text-ink-2 line-through" : "text-ink",
									)}
								>
									{row.title}
								</p>
								<p className="text-[13px] leading-[19px] text-ink-2">{row.detail}</p>
							</div>
							<div className="col-start-2 sm:col-start-auto">{action(row)}</div>
						</div>
					))}
				</div>

				{questions.length > 0 && (
					<div ref={questionsRef} className="grid gap-2.5 rounded-xl border border-line bg-surface p-4">
						<h3 className="text-sm font-semibold">
							<Trans>Questions to ask</Trans>
						</h3>
						<ol className="grid gap-2">
							{questions.map((question, index) => (
								<li key={`${question.text}-${index}`} className="flex gap-2.5 text-sm leading-5">
									<span className="w-4 shrink-0 font-mono text-xs leading-5 font-medium text-accent-text">
										{index + 1}
									</span>
									<span className="min-w-0 flex-1">{question.text}</span>
									<span className="shrink-0 text-xs leading-5 text-ink-3">{question.origin}</span>
								</li>
							))}
						</ol>
					</div>
				)}
			</div>

			<div className="grid gap-3.5">
				<div className="grid gap-2.5 rounded-xl border border-line bg-surface p-4">
					<div className="flex items-center gap-2">
						<Icon name="clipboard-text" size={20} className="text-accent-text" />
						<h3 className="flex-1 text-sm font-semibold">
							<Trans>10-minute briefing</Trans>
						</h3>
						<span className="text-xs text-ink-3">
							<Trans>Ready</Trans>
						</span>
					</div>
					<p className="text-[13px] leading-[19px] text-ink-2">
						<Trans>
							Your opening, the stories to bring and questions to ask. It becomes your checklist 10 minutes before the
							call.
						</Trans>
					</p>
					<Button size="sm" variant="secondary" className="w-fit" onClick={() => setReading(true)}>
						<Trans>Read briefing</Trans>
					</Button>
				</div>
				{interview && !readOnly && <RefreshSwitch application={application} interview={interview} />}
				<StoriesToBring application={application} briefing={briefing} />
			</div>
			<BriefingDialog briefing={briefing} open={reading} onOpenChange={setReading} />
		</div>
	);
}

const LEADS = ["24h", "2h", "morning"] as const;

type RefreshSwitchProps = { application: Application; interview: InterviewTimelineEntry };

/** The C5 prepare schedule for this interview: toggling here changes it in Today too. */
function RefreshSwitch({ application, interview }: RefreshSwitchProps) {
	const queryClient = useQueryClient();
	const { when, timeZone, locale } = useCareerTime();
	const connection = useDefaultProvider();
	const { provider } = connection;
	const flags = useRouteContext({ strict: false }).flags;
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const { data: schedules } = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const schedule = schedules?.find((item) => item.kind === "prepare" && item.interviewId === interview.id);
	const lead = LEADS.find((item) => item === schedule?.lead) ?? "24h";
	// The schedule's own connection while it's switched on and tested; otherwise the default, as the run itself does.
	const own = providers?.find(
		(item) => item.id === schedule?.aiProviderId && item.enabled && item.testStatus === "success",
	);
	const providerId = own?.id ?? provider?.id ?? null;
	const providerLabel = own?.label ?? provider?.label ?? "";
	const runAt = schedule?.nextRunAt ?? new Date(new Date(interview.at).getTime() - 24 * 3_600_000);

	const save = useMutation({
		...orpc.career.saveSchedule.mutationOptions(),
		onSuccess: (row) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() });
			toast.add({
				type: "success",
				description: row.enabled ? t`Briefing refresh is on · ${when(row.nextRunAt)}` : t`Briefing refresh paused`,
			});
		},
		onError: (error) => toastError(error, t`Couldn't change the schedule. Try again.`, { allowServerMessage: true }),
	});

	const enabled = save.isPending ? save.variables.enabled : (schedule?.enabled ?? false);
	const available = !connection.isUnavailable && flags?.careerSchedulingEnabled !== false && !!providerId;
	const label = {
		"24h": t`Refresh the briefing 24 hours before`,
		"2h": t`Refresh the briefing 2 hours before`,
		morning: t`Refresh the briefing on the morning of`,
	}[lead];
	const description =
		flags?.careerSchedulingEnabled === false
			? t`Scheduled work isn't available on this server.`
			: connection.isUnavailable
				? t`AI connections are unavailable.`
				: !providerId
					? t`Connect an AI provider in Settings to refresh it automatically.`
					: t`${when(runAt)} · ${providerLabel}. Sends this application and your Knowledge; your provider may charge.`;

	return (
		<div className="rounded-xl border border-line bg-surface px-4 py-2">
			<AiProviderLoadState state={connection} />
			<SwitchRow
				label={<span className="font-semibold">{label}</span>}
				description={description}
				checked={enabled}
				disabled={save.isPending || (!available && !enabled)}
				onCheckedChange={(checked) =>
					save.mutate({
						...(schedule ? { id: schedule.id } : {}),
						kind: "prepare",
						applicationId: application.id,
						interviewId: interview.id,
						lead,
						enabled: checked,
						email: schedule?.email ?? false,
						timezone: timeZone,
						locale,
						nextRunAt: new Date(runAt),
						aiProviderId: providerId,
						query: "",
						intervalDays: null,
					})
				}
			/>
		</div>
	);
}

type StoriesToBringProps = { application: Application; briefing: Briefing };

function StoriesToBring({ application, briefing }: StoriesToBringProps) {
	const { data: stories } = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: application.id } }));
	const bring = briefing.data.storyIds.flatMap((id) => stories?.find((story) => story.id === id) ?? []);
	if (!stories || (bring.length === 0 && !briefing.data.missingStory)) return null;
	return (
		<div className="grid gap-2 rounded-xl border border-line bg-surface p-4">
			<h3 className="text-sm font-semibold">
				<Trans>Stories to bring</Trans>
			</h3>
			{bring.map((story) => (
				<Link
					key={story.id}
					to="/dashboard/career/knowledge/stories/{-$storyId}"
					params={{ storyId: story.id }}
					className="flex items-start gap-2 text-[13px] leading-[19px] text-ink hover:underline"
				>
					<Icon name="book-open" size={18} className="shrink-0 text-ink-2" />
					{story.data.title}
				</Link>
			))}
			{briefing.data.missingStory && (
				<p className="flex items-center gap-1.5 text-xs text-warn-text">
					<Icon name="question" size={16} className="shrink-0" />
					{briefing.data.missingStory}
				</p>
			)}
		</div>
	);
}

/** Focus, opening, stories and the honesty note: stored with the briefing, so it opens without AI. */
function BriefingNotes({ briefing }: { briefing: Briefing }) {
	const { data } = briefing;
	const items = [
		{ label: t`Your focus`, text: data.focus },
		{ label: t`Your opening`, text: data.opening && `“${data.opening}”`, italic: true },
		{ label: data.stories.length === 2 ? t`Two stories` : t`Stories`, text: data.stories.join("\n") },
		{ label: t`Keep it honest`, text: data.honesty },
	];
	return (
		<dl className="grid gap-3.5">
			{items
				.filter((item) => item.text)
				.map((item) => (
					<div key={item.label} className="grid gap-1">
						<dt className="text-[13px] font-semibold text-ink-2">{item.label}</dt>
						<dd className={cn("text-sm leading-[21px] whitespace-pre-line", item.italic && "italic")}>{item.text}</dd>
					</div>
				))}
		</dl>
	);
}

const FULL_SCREEN_ON_PHONES =
	"max-sm:inset-s-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none";

type BriefingDialogProps = { briefing: Briefing; open: boolean; onOpenChange: (open: boolean) => void };

function BriefingDialog({ briefing, open, onOpenChange }: BriefingDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`} className={cn("content-start sm:max-w-[560px]", FULL_SCREEN_ON_PHONES)}>
				<DialogHeader>
					<DialogTitle className="text-2xl leading-8">
						<Trans>10-minute briefing</Trans>
					</DialogTitle>
				</DialogHeader>
				<BriefingNotes briefing={briefing} />
			</DialogContent>
		</Dialog>
	);
}

// ---- W7 / W21: ten minutes before ----

const steps = () => [
	{
		title: t`Check the details`,
		detail: t`Confirm the time, link and who you'll meet. Glance at the resume and letter you sent.`,
		short: t`Time, link, who, what you sent`,
		minutes: 2,
	},
	{
		title: t`Your two-minute introduction`,
		detail: t`Current focus, relevant experience, and why this role interests you.`,
		short: t`Focus, experience, why this role`,
		minutes: 2,
	},
	{
		title: t`Pick two examples`,
		detail: t`For each: situation, task, your action, result, reflection. Leave out numbers you're unsure of.`,
		short: t`Situation, action, result`,
		minutes: 4,
	},
	{
		title: t`Questions to ask`,
		detail: t`What success looks like, which challenge matters most, and the next step.`,
		short: t`Success at 90 days · next step`,
		minutes: 2,
	},
];

type SoonProps = {
	application: Application;
	interview: InterviewTimelineEntry;
	briefing: Briefing | undefined;
	now: Date;
	go: WorkspaceTabProps["go"];
};

function Soon({ application, interview, briefing, now, go }: SoonProps) {
	const { time, locale } = useCareerTime();
	const mobile = useBreakpoint() === "mobile";
	const ticks = useTicks(application.id, `now:${interview.id}`);
	const [reading, setReading] = useState(false);
	const minutes = minutesUntil(new Date(interview.at), now);
	const list = (names: string[]) => formatList(locale, names);
	const names = interview.participants.map((person) => person.name);
	const heading =
		minutes > 0
			? plural(minutes, { one: "Starts in # minute", other: "Starts in # minutes" })
			: minutes === 0
				? t`Starts now`
				: plural(-minutes, { one: "Started # minute ago", other: "Started # minutes ago" });
	const rehearse = () => go("practise", { speak: true });
	const rows = steps();
	const id = useId();

	if (mobile)
		return (
			<div className="grid gap-2">
				<div className="flex items-center gap-3 rounded-lg bg-warn-soft px-4 py-3.5">
					<Icon name="timer" size={28} className="shrink-0 text-warn-text" />
					<div className="grid min-w-0">
						<p className="font-display text-[22px] leading-7 font-medium">{heading}</p>
						<p className="text-[13px] text-ink-2">
							{[
								interviewTypeLabel(interview.kind),
								names.length > 0 && list(names.map((name) => name.split(" ")[0] ?? name)),
							]
								.filter(Boolean)
								.join(" · ")}
						</p>
					</div>
				</div>
				{rows.map((row, index) => {
					const on = ticks.ticked.includes(String(index));
					return (
						<label
							key={row.title}
							htmlFor={`${id}-${index}`}
							className={cn(
								"flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-quick",
								on ? "border-transparent bg-accent-soft" : "border-line bg-surface",
							)}
						>
							<Checkbox
								id={`${id}-${index}`}
								className="size-[22px]"
								checked={on}
								onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
							/>
							<span className="grid gap-0.5">
								<span className={cn("text-[15px] font-semibold", on && "text-accent-text")}>{row.title}</span>
								<span className="text-[13px] leading-[19px] text-ink-2">{row.short}</span>
							</span>
						</label>
					);
				})}
				{briefing?.data.opening && (
					<div className="mt-1 grid gap-1 rounded-xl bg-sunken p-3.5">
						<Eyebrow>
							<Trans>Your opening</Trans>
						</Eyebrow>
						<p className="font-display text-base leading-6">“{briefing.data.opening}”</p>
					</div>
				)}
				{/* The workspace is full screen on phones (no app tab bar), so the bar pads for the safe area itself. */}
				<div className="sticky bottom-0 -mx-4 mt-3 -mb-6 flex gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
					{briefing && (
						<Button variant="secondary" className="h-12 flex-1 rounded-lg text-[15px]" onClick={() => setReading(true)}>
							<Trans>Briefing</Trans>
						</Button>
					)}
					<Button className="h-12 flex-[1.4] rounded-lg text-[15px]" onClick={rehearse}>
						<Icon name="microphone" size={22} />
						<Trans>Rehearse aloud</Trans>
					</Button>
				</div>
				{briefing && <BriefingDialog briefing={briefing} open={reading} onOpenChange={setReading} />}
			</div>
		);

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px] @5xl:grid-cols-[minmax(0,1fr)_340px]">
			<div className="grid gap-4">
				<div className="flex items-center gap-3.5 rounded-xl border border-warn bg-warn-soft px-5 py-[18px]">
					<Icon name="timer" size={28} className="shrink-0 text-warn-text" />
					<div className="grid min-w-0 gap-0.5">
						<p className="font-display text-[22px] leading-7 font-medium">{heading}</p>
						<p className="text-[13px] text-ink-2">
							{[
								interviewTypeLabel(interview.kind),
								time(interview.at),
								names.length > 0 && list(names),
								interview.location,
							]
								.filter(Boolean)
								.join(" · ")}
						</p>
					</div>
				</div>

				<div className="grid gap-3 rounded-xl border border-line bg-surface px-[18px] py-4">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h2 className="flex-1 text-[15px] font-semibold">
							<Trans>Right now</Trans>
						</h2>
						<span className="text-xs text-ink-3">
							<Trans>Works without AI or new research</Trans>
						</span>
					</div>
					{rows.map((row, index) => {
						const on = ticks.ticked.includes(String(index));
						return (
							<label
								key={row.title}
								htmlFor={`${id}-${index}`}
								className={cn(
									"flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-quick",
									on ? "bg-accent-soft" : "bg-bg",
								)}
							>
								<Checkbox
									id={`${id}-${index}`}
									className="mt-px"
									checked={on}
									onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
								/>
								<span className="grid min-w-0 flex-1 gap-0.5">
									<span
										className={cn("text-sm font-semibold transition-colors duration-quick", on && "text-accent-text")}
									>
										{row.title}
									</span>
									<span className="text-[13px] leading-[19px] text-ink-2">{row.detail}</span>
								</span>
								<span className="ms-auto font-mono text-xs font-medium whitespace-nowrap text-ink-3">
									<Trans>{row.minutes} min</Trans>
								</span>
							</label>
						);
					})}
				</div>

				<Button className="h-10 w-fit px-4" onClick={rehearse}>
					<Icon name="microphone" size={20} />
					<Trans>Rehearse one answer aloud</Trans>
				</Button>
			</div>

			{briefing && (
				<div className="grid gap-3.5 rounded-xl border border-line bg-surface px-[18px] py-4">
					<Eyebrow>
						<Trans>Your briefing</Trans>
					</Eyebrow>
					<BriefingNotes briefing={briefing} />
				</div>
			)}
		</div>
	);
}
