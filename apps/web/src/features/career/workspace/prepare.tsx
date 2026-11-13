import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useId, useState } from "react";
import { firstFutureLead, PREPARE_LEADS } from "@reactive-resume/schema/career-schedule";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useTicks, useWorkspace } from "../hooks";
import {
	Eyebrow,
	midSentence,
	minutesUntil,
	useCareerTime,
	useNow,
	GenerateNotice,
	Working,
	workingSteps,
} from "../shared";
import { AiNotice } from "./fit";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { List, ListRow } from "@/components/calm/list-row";
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { interviewTypeLabel } from "@/features/applications/components/interview-dialog";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Briefing = SavedItem & { data: SavedData<"briefing"> };

const isBriefing = (item: SavedItem | undefined): item is Briefing => item?.data.kind === "briefing";

/** Before start − 10 min: the plan (W6). Until the end: the 10-minute checklist (W7/W21). After: "How did it go?". */
export function PrepareTab({ application, version, interview, now, go }: WorkspaceTabProps) {
	const [checklist, setChecklist] = useState(false);
	const saved = useSavedItems(application.id);
	const provider = useDefaultProvider();

	if (!interview && !isBriefing(version))
		return (
			<>
				<PageHeader title={t`Interview prep`} />
				<EmptyState
					title={t`Add an interview to plan for it`}
					description={
						<Trans>
							Once a round is scheduled, Interview prep builds a timed plan, your opening and the questions to ask.
						</Trans>
					}
					action={
						<Button variant="secondary" onClick={() => go("prepare", { edit: "interview" })}>
							<Icon name="calendar-dot" size={18} />
							<Trans>Add an interview</Trans>
						</Button>
					}
				/>
			</>
		);

	const briefing = isBriefing(version) ? version : latest(saved.data, "briefing", interview?.id ?? null);

	if (interview && !isBriefing(version)) {
		const start = new Date(interview.at).getTime();
		const end = start + interview.durationMinutes * 60_000;
		if (now.getTime() > end)
			return (
				<EmptyState
					title={t`How did it go?`}
					description={
						<Trans>
							Write down what they asked while it's fresh. The coach compares your answers with your stories.
						</Trans>
					}
					action={
						<Button onClick={() => go("debrief")}>
							<Trans>Start a debrief</Trans>
						</Button>
					}
				/>
			);
		if (now.getTime() >= start - 10 * 60_000)
			return <Soon application={application} interview={interview} briefing={briefing} now={now} go={go} />;
	}

	if (!briefing) {
		if (saved.isPending) return <Skeleton className="h-64 rounded-xl" />;
		if (interview && !provider.isUnavailable && !provider.provider)
			return <PrepWithoutAi application={application} interview={interview} now={now} go={go} />;
		return interview ? (
			<>
				<PageHeader title={t`Interview prep`} />
				<Button variant="secondary" className="mb-4" onClick={() => setChecklist(true)}>
					<Icon name="timer" />
					<Trans>10-minute version</Trans>
				</Button>
				<PlanEmpty application={application} interview={interview} />
				<Dialog open={checklist} onOpenChange={setChecklist}>
					<DialogContent closeLabel={t`Close`} className="sm:max-w-[560px]">
						<Soon application={application} interview={interview} briefing={undefined} now={now} go={go} />
					</DialogContent>
				</Dialog>
			</>
		) : null;
	}

	return (
		<>
			<PageHeader
				title={t`Interview prep`}
				className="[&>div]:min-h-9 [&>p]:py-0.5 [&>p]:text-sm/5"
				actions={
					!version &&
					interview && (
						<>
							<Button variant="ghost" onClick={() => setChecklist(true)}>
								<Icon name="clipboard-text" />
								<Trans>10-minute version</Trans>
							</Button>
							<Button onClick={() => go("practise")}>
								<Icon name="microphone" />
								{plural(briefing.data.practiceQuestions.length || 3, {
									one: "Practice # likely question",
									other: "Practice # likely questions",
								})}
							</Button>
						</>
					)
				}
				subtitle={interview && <InterviewLine interview={interview} now={now} go={!version ? go : undefined} />}
			/>
			<Plan application={application} interview={interview} briefing={briefing} readOnly={!!version} go={go} />
			{interview && !version && (
				<BriefingDialog
					application={application}
					interview={interview}
					briefing={briefing}
					open={checklist}
					onOpenChange={setChecklist}
				/>
			)}
		</>
	);
}

type InterviewLineProps = { interview: InterviewTimelineEntry; now: Date; go?: WorkspaceTabProps["go"] | undefined };

/** "Technical interview · Tuesday 10 Nov, 10:00 · 60 min · video call · in 3 days  Edit interview" */
function InterviewLine({ interview, now, go }: InterviewLineProps) {
	const time = useCareerTime();
	return (
		<>
			{t`${interviewTypeLabel(interview.kind)} interview`} ·{" "}
			{time.format(interview.at, { weekday: "long", day: "numeric", month: "short" })}, {time.time(interview.at)} ·{" "}
			{t`${interview.durationMinutes} min`} · {midSentence(interview.location)} ·{" "}
			{time.relative(interview.at, now).toLocaleLowerCase(time.locale)}
			{go && (
				<Button
					variant="link"
					size="sm"
					className="ms-1 h-auto px-0 text-[13px]/5"
					onClick={() => go("prepare", { edit: "interview" })}
				>
					<Trans>Edit interview</Trans>
				</Button>
			)}
		</>
	);
}

type PrepWithoutAiProps = {
	application: Application;
	interview: InterviewTimelineEntry;
	now: Date;
	go: WorkspaceTabProps["go"];
};

/** N6: without AI, the fixed checklist becomes the plan, with what was sent, the people and the stories. */
function PrepWithoutAi({ application, interview, now, go }: PrepWithoutAiProps) {
	const time = useCareerTime();
	const ticks = useTicks(application.id, `now:${interview.id}`);
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const { data: stories } = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: application.id } }));
	const rows = steps();
	const total = rows.reduce((sum, row) => sum + row.minutes, 0);
	const done = rows.reduce((sum, row, index) => sum + (ticks.ticked.includes(String(index)) ? row.minutes : 0), 0);
	const sent = [
		application.sentResumeVersionId && application.resumeId
			? { id: application.resumeId, kind: "resume" as const, label: t`Resume · kept as sent` }
			: null,
		application.sentCoverLetterVersionId && application.coverLetterId
			? { id: application.coverLetterId, kind: "letter" as const, label: t`Cover letter · kept as sent` }
			: null,
	].flatMap((entry) => {
		const document = entry && documents.data?.find((item) => item.id === entry.id);
		return entry && document ? [{ ...entry, name: document.name }] : [];
	});
	const action = (index: number) =>
		index === 1 ? (
			<Button
				variant="link"
				className="h-auto p-0 text-sm/5 text-accent-text"
				onClick={() => go("practise", { speak: true })}
			>
				<Trans context="Button: rehearse interview answers">Practice</Trans>
			</Button>
		) : index === 2 ? (
			<Link
				to="/dashboard/career/knowledge/stories/{-$storyId}"
				className="inline-flex text-sm/5 font-medium text-accent-text"
			>
				<Trans>Open stories</Trans>
			</Link>
		) : null;

	return (
		<>
			<PageHeader
				title={t`Interview prep`}
				className="[&>div]:min-h-9 [&>p]:py-0.5 [&>p]:text-sm/5"
				actions={
					<Button onClick={() => go("practise", { warmup: true, round: interview.id })}>
						<Icon name="microphone" />
						<Trans>Practice 3 general questions</Trans>
					</Button>
				}
				subtitle={<InterviewLine interview={interview} now={now} go={go} />}
			/>
			<AiNotice
				needs={<Trans>A timed plan, your opening and likely questions need AI.</Trans>}
				works={<Trans>The checklist, people and stories work without it.</Trans>}
			/>
			<div className="grid items-start gap-10 @3xl:grid-cols-[minmax(0,1fr)_264px]">
				<div>
					<SectionHeading className="pt-[22px]" note={t`${done} of ${total} min done`}>
						<Trans>Before the call</Trans>
					</SectionHeading>
					{rows.map((row, index) => (
						<div
							key={row.title}
							className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-px border-b border-line py-2.5 last:border-b-0 @xl:grid-cols-[18px_40px_minmax(0,1fr)_auto]"
						>
							<Checkbox
								className="mt-px"
								aria-label={row.title}
								checked={ticks.ticked.includes(String(index))}
								onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
							/>
							<span className="font-mono text-xs/4 font-medium text-ink-3">
								<Trans>{i18n.number(row.minutes)} min</Trans>
							</span>
							<div className="col-start-2 grid gap-px @xl:col-start-auto">
								<p
									className={cn(
										"text-[15px]/[22px] font-medium transition-colors duration-quick",
										ticks.ticked.includes(String(index)) ? "text-ink-3" : "text-ink",
									)}
								>
									{row.title}
								</p>
								<p className="text-[13px]/[18px] text-ink-3">{row.detail}</p>
							</div>
							<div className="col-start-2 @xl:col-start-auto">{action(index)}</div>
						</div>
					))}
					{sent.length > 0 && (
						<>
							<SectionHeading
								className="pt-6"
								note={application.appliedAt ? time.date(application.appliedAt) : undefined}
							>
								<Trans>What you sent</Trans>
							</SectionHeading>
							<List>
								{sent.map((entry) => (
									<ListRow
										key={entry.id}
										render={
											entry.kind === "resume" ? (
												<Link to="/builder/$resumeId" params={{ resumeId: entry.id }} />
											) : (
												<Link to="/builder/letter/$coverLetterId" params={{ coverLetterId: entry.id }} />
											)
										}
										leading={<DocumentThumb kind={entry.kind === "resume" ? "resume" : "letter"} />}
										className="min-h-[65px]"
										title={entry.name}
										subtitle={entry.label}
										caret
									/>
								))}
							</List>
						</>
					)}
				</div>
				<aside>
					<SectionHeading className="pt-[22px]">
						<Trans>Who you'll meet</Trans>
					</SectionHeading>
					<List>
						{interview.participants.map((person) => (
							<ListRow
								key={person.name}
								leading={
									<span className="grid size-8 shrink-0 place-items-center rounded-sm bg-sunken text-xs font-semibold text-ink-2">
										{person.name
											.split(/\s+/)
											.map((part) => part[0])
											.slice(0, 2)
											.join("")}
									</span>
								}
								title={person.name}
								subtitle={person.role}
							/>
						))}
					</List>
					{stories && stories.length > 0 && (
						<>
							<SectionHeading className="pt-6" note={stories.length || undefined}>
								<Trans>Your stories</Trans>
							</SectionHeading>
							<List tight>
								{stories.map((story) => (
									<ListRow
										key={story.id}
										render={
											<Link to="/dashboard/career/knowledge/stories/{-$storyId}" params={{ storyId: story.id }} />
										}
										leading={<Icon name="book-open" size={20} />}
										title={story.data.title}
										className="[&_span.truncate]:whitespace-normal"
										caret
									/>
								))}
							</List>
						</>
					)}
				</aside>
			</div>
		</>
	);
}

type PlanEmptyProps = { application: Application; interview: InterviewTimelineEntry };

function PlanEmpty({ application, interview }: PlanEmptyProps) {
	const connection = useDefaultProvider();
	const { provider } = connection;
	const generate = useGenerate(application.id);
	const plan = () => void generate.run({ task: "briefing", interviewId: interview.id }).catch(() => undefined);
	return (
		<EmptyState
			title={t`A focused plan for this round`}
			description={
				<Trans>
					A timed plan, your opening, the stories to bring and questions to ask. It becomes your checklist 10 minutes
					before the call.
				</Trans>
			}
			action={
				connection.isUnavailable ? undefined : provider ? (
					<Button loading={generate.isPending} disabled={!provider} onClick={plan}>
						{generate.isPending ? <Working steps={workingSteps("briefing")} /> : <Trans>Plan my preparation</Trans>}
					</Button>
				) : (
					<SetUpAi />
				)
			}
		>
			{connection.isUnavailable ? (
				<AiProviderLoadState state={connection} />
			) : provider ? (
				<>
					<AiNotice
						needs={<Trans>A timed plan, your opening and likely questions need AI.</Trans>}
						works={<Trans>The checklist, people and stories work without it.</Trans>}
					/>
					<GenerateNotice generate={generate} onRetry={plan} className="max-w-[360px]" />
				</>
			) : null}
		</EmptyState>
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
	const done = (index: number) => ticks.ticked.includes(String(index));
	const total = data.plan.reduce((sum, row) => sum + row.minutes, 0);
	const doneMinutes = data.plan.reduce((sum, row, index) => sum + (done(index) ? row.minutes : 0), 0);
	const questions = [...data.questions, ...workspace.data.questions];
	const { provider } = useDefaultProvider();
	const generate = useGenerate(application.id);
	const planAgain = (interviewId: string) =>
		void generate.run({ task: "briefing", interviewId }).catch(() => undefined);

	const action = (row: SavedData<"briefing">["plan"][number]) => {
		const className = cn(buttonVariants({ variant: "link" }), "h-auto p-0 text-sm/5 text-accent-text");
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
						// The new story starts from this step: its title, and its detail as a note above the parts.
						search={{ edit: true, title: row.title, note: row.detail, plan: briefing.id, factIds: row.factIds }}
						className={className}
					>
						<Trans>Draft story</Trans>
					</Link>
				);
			// The questions are the next section down (W3 draws no action here).
			case "questions":
				return null;
			case "practise":
				return (
					<Button
						variant="link"
						className="h-auto p-0 text-sm/5 text-accent-text"
						onClick={() => go("practise", { speak: true })}
					>
						<Trans context="Button: rehearse interview answers">Practice</Trans>
					</Button>
				);
			case "none":
				return null;
		}
	};

	return (
		<div className="grid items-start gap-10 @3xl:grid-cols-[minmax(0,1fr)_264px]">
			<div>
				<h2 className="pt-[22px] t-section-title">{data.headline}</h2>
				<p className="pt-1 text-sm/5 text-ink-2">{data.summary}</p>
				<SectionHeading
					className="pt-6"
					note={t`${doneMinutes} of ${total} min done`}
					action={
						briefing.outdated &&
						!readOnly &&
						provider &&
						interview && (
							<Button variant="link" size="sm" loading={generate.isPending} onClick={() => planAgain(interview.id)}>
								{generate.isPending ? <Working steps={workingSteps("briefing")} /> : <Trans>Plan again</Trans>}
							</Button>
						)
					}
				>
					<Trans>Your plan</Trans>
				</SectionHeading>

				<div className="">
					{data.plan.map((row, index) => (
						<div
							key={`${row.title}-${index}`}
							className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-px border-b border-line py-2.5 last:border-b-0 @xl:grid-cols-[18px_44px_minmax(0,1fr)_auto]"
						>
							<Checkbox
								className="mt-px"
								aria-label={row.title}
								disabled={readOnly}
								checked={done(index)}
								onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
							/>
							<span className="font-mono text-xs/4 font-medium text-ink-3">
								<Trans>{i18n.number(row.minutes)} min</Trans>
							</span>
							<div className="col-start-2 grid gap-px @xl:col-start-auto">
								<p
									className={cn(
										"text-[15px]/[22px] font-medium transition-colors duration-quick",
										done(index) ? "text-ink-3" : "text-ink",
									)}
								>
									{row.title}
								</p>
								<p className="text-[13px]/[18px] text-ink-3">{row.detail}</p>
							</div>
							<div className="col-start-2 @xl:col-start-auto">
								{index === 0 && row.action === "none" ? (
									<Button variant="link" className="h-auto p-0 text-sm/5 text-accent-text" onClick={() => go("fit")}>
										<Trans>Open Fit</Trans>
									</Button>
								) : (
									action(row)
								)}
							</div>
						</div>
					))}
				</div>

				{data.opening && (
					<>
						<SectionHeading className="pt-6">
							<Trans>Your opening</Trans>
						</SectionHeading>
						<p className="font-display text-[19px]/[27px]">“{data.opening}”</p>
					</>
				)}
				{questions.length > 0 && (
					<div>
						<SectionHeading className="pt-6" note={questions.length || undefined}>
							<Trans>Questions to ask</Trans>
						</SectionHeading>
						<ol className="grid">
							{questions.map((question, index) => (
								<li
									key={`${question.text}-${index}`}
									className="flex min-h-14 items-start gap-3.5 border-b border-line py-2.5 text-[15px]/[22px] last:border-0"
								>
									<span className="w-4 shrink-0 font-mono text-xs/[22px] font-medium text-ink-3">
										{i18n.number(index + 1)}
									</span>
									<span className="min-w-0 flex-1">{question.text}</span>
									<span className="shrink-0 text-[13px]/[18px] text-ink-3">{question.origin}</span>
								</li>
							))}
						</ol>
					</div>
				)}
			</div>

			<aside>
				{interview && (
					<>
						<SectionHeading className="pt-[22px]">
							<Trans>Who you'll meet</Trans>
						</SectionHeading>
						<List>
							{interview.participants.map((person) => (
								<ListRow
									key={person.name}
									leading={
										<span className="grid size-8 shrink-0 place-items-center rounded-sm bg-sunken text-xs font-semibold text-ink-2">
											{person.name
												.split(/\s+/)
												.map((part) => part[0])
												.slice(0, 2)
												.join("")}
										</span>
									}
									title={person.name}
									subtitle={person.role}
								/>
							))}
						</List>
					</>
				)}
				<StoriesToBring application={application} briefing={briefing} />
				{data.honesty && (
					<>
						<SectionHeading className="pt-6">
							<Trans>Keep it honest</Trans>
						</SectionHeading>
						<p className="text-[13px]/[18px] text-ink-2">{data.honesty}</p>
					</>
				)}
				{interview && !readOnly && (
					<div className="mt-5">
						<RefreshSwitch application={application} interview={interview} />
					</div>
				)}
				{readOnly && (
					<Button
						variant="link"
						size="sm"
						className="mt-2 h-auto p-0 text-accent-text"
						onClick={() => setReading(true)}
					>
						<Icon name="timer" size={16} />
						<Trans>10-minute briefing</Trans>
					</Button>
				)}
			</aside>
			<BriefingDialog
				application={application}
				interview={interview}
				briefing={briefing}
				open={reading}
				onOpenChange={setReading}
			/>
		</div>
	);
}

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
	// The first lead still ahead of now; if every one has passed, there is nothing honest to schedule.
	const now = useNow();
	const next = firstFutureLead(new Date(interview.at), timeZone, now);
	const lead = schedule?.lead ?? next?.lead ?? PREPARE_LEADS[0];
	// The schedule's own connection while it's switched on and tested; otherwise the default, as the run itself does.
	const own = providers?.find(
		(item) => item.id === schedule?.aiProviderId && item.enabled && item.testStatus === "success",
	);
	const providerId = own?.id ?? provider?.id ?? null;
	const providerLabel = own?.label ?? provider?.label ?? "";
	const runAt = schedule?.nextRunAt ?? next?.runAt ?? null;

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
	const label = next
		? {
				"24h": t`Refresh 24 hours before`,
				"2h": t`Refresh 2 hours before`,
				morning: t`Refresh on the morning of`,
			}[next.lead]
		: t`Refresh the briefing`;
	const description =
		flags?.careerSchedulingEnabled === false
			? t`Scheduled work isn't available on this server.`
			: connection.isUnavailable
				? t`AI connections are unavailable.`
				: !providerId
					? t`Connect an AI provider in Settings to refresh it automatically.`
					: runAt
						? t`${when(runAt)} · ${providerLabel}`
						: t`Too close to the interview to schedule a refresh.`;

	return (
		<div className="border-t border-line py-2">
			<AiProviderLoadState state={connection} />
			<SwitchRow
				label={label}
				className="gap-3.5 [&>span:first-child]:flex-1"
				description={description}
				checked={enabled}
				disabled={save.isPending || (!available && !enabled) || (!next && !enabled)}
				onCheckedChange={(checked) =>
					save.mutate({
						...(schedule ? { id: schedule.id } : {}),
						kind: "prepare",
						applicationId: application.id,
						interviewId: interview.id,
						lead: (next?.lead ?? lead) as "24h" | "2h" | "morning",
						enabled: checked,
						email: schedule?.email ?? false,
						timezone: timeZone,
						locale,
						nextRunAt: next?.runAt ?? runAt ?? new Date(interview.at),
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
		<section>
			<SectionHeading className="pt-6">
				<Trans>Stories to bring</Trans>
			</SectionHeading>
			<List tight>
				{bring.map((story) => (
					<ListRow
						key={story.id}
						render={<Link to="/dashboard/career/knowledge/stories/{-$storyId}" params={{ storyId: story.id }} />}
						leading={<Icon name="book-open" size={20} />}
						title={story.data.title}
						className="[&_span.truncate]:whitespace-normal"
						caret
					/>
				))}
				{briefing.data.missingStory && (
					<ListRow
						leading={<Icon name="question" size={20} className="text-ink-3" />}
						subtitle={t`No story yet for ${briefing.data.missingStory}`}
						className="[&_span.truncate]:whitespace-normal"
					/>
				)}
			</List>
		</section>
	);
}

/** Focus, opening, stories and the honesty note: stored with the briefing, so it opens without AI. */
function BriefingNotes({ briefing }: { briefing: Briefing }) {
	const { data } = briefing;
	const items = [
		{ label: t`Your focus`, text: data.focus },
		{ label: t`Your opening`, text: data.opening && `“${data.opening}”` },
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
						<dd className="text-sm leading-[21px] whitespace-pre-line">{item.text}</dd>
					</div>
				))}
		</dl>
	);
}

type BriefingDialogProps = {
	application: Application;
	interview: InterviewTimelineEntry | undefined;
	briefing: Briefing;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

function BriefingDialog({ application, interview, briefing, open, onOpenChange }: BriefingDialogProps) {
	const ticks = useTicks(application.id, `now:${interview?.id ?? briefing.interviewId}`);
	const time = useCareerTime();
	const workspace = useWorkspace(application.id);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`} className="content-start sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle className="text-2xl leading-8">
						<Trans>10-minute briefing</Trans>
					</DialogTitle>
					{interview && (
						<p className="t-small text-ink-3">{t`${interviewTypeLabel(interview.kind)} interview at ${application.company} · ${time.when(interview.at)} · with ${interview.participants.map((person) => person.name).join(t` and `)}`}</p>
					)}
				</DialogHeader>
				<div className="grid">
					{steps().map((step, index) => (
						<label key={step.title} className="flex items-start gap-3 border-b border-line py-3">
							<Checkbox
								checked={ticks.ticked.includes(String(index))}
								onCheckedChange={(checked) => ticks.toggle(String(index), checked)}
							/>
							<span className="grid flex-1 gap-1">
								<span className="t-label">
									{index === 1 ? t`Your opening` : index === 2 ? t`Two stories` : step.title}
								</span>
								<span className="text-[13px] whitespace-pre-line text-ink-3">
									{index === 1
										? `“${briefing.data.opening}”`
										: index === 2
											? briefing.data.stories.join(" · ")
											: index === 3
												? [...briefing.data.questions, ...workspace.data.questions]
														.map((question) => question.text)
														.join("\n")
												: step.detail}
								</span>
							</span>
							<span className="text-xs text-ink-3">{t`${step.minutes} min`}</span>
						</label>
					))}
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						<Trans>Open the full plan</Trans>
					</Button>
					<Link
						to="/dashboard/applications/$applicationId/{-$tab}"
						params={{ applicationId: application.id, tab: "practise" }}
						search={{ speak: true, round: interview?.id }}
						className={buttonVariants()}
					>
						<Icon name="microphone" />
						<Trans>Rehearse one answer aloud</Trans>
					</Link>
				</div>
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
						<p className="font-display text-[22px] leading-7">{heading}</p>
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
				{briefing && (
					<BriefingDialog
						application={application}
						interview={interview}
						briefing={briefing}
						open={reading}
						onOpenChange={setReading}
					/>
				)}
			</div>
		);

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px] @5xl:grid-cols-[minmax(0,1fr)_340px]">
			<div className="grid gap-4">
				<div className="flex items-center gap-3.5 rounded-xl border border-warn bg-warn-soft px-5 py-[18px]">
					<Icon name="timer" size={28} className="shrink-0 text-warn-text" />
					<div className="grid min-w-0 gap-0.5">
						<p className="font-display text-[22px] leading-7">{heading}</p>
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
										className={cn(
											"text-[15px]/[22px] font-medium transition-colors duration-quick",
											on && "text-accent-text",
										)}
									>
										{row.title}
									</span>
									<span className="text-[13px] leading-[19px] text-ink-2">{row.detail}</span>
								</span>
								<span className="ms-auto font-mono text-xs font-medium whitespace-nowrap text-ink-3">
									<Trans>{i18n.number(row.minutes)} min</Trans>
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
