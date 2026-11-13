import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { WORKSPACE_TABS } from "@reactive-resume/schema/career";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { formatList } from "@reactive-resume/utils/locale";
import { isolate } from "@reactive-resume/utils/string";
import { latest } from "../hooks";
import { CareerLoadError } from "../load-state";
import { midSentence, tabLabel, useCareerTime } from "../shared";
import { HeroCard } from "@/components/calm/hero-card";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { Columns } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
import { StageStepper } from "@/components/calm/stage-stepper";
import { ApplicationActionsMenu } from "@/features/applications/components/application-actions-menu";
import { buildIcs } from "@/features/applications/ics";
import { interviewKindOf } from "@/features/applications/interviews";
import { getDisplayLane, getLaneLabel, isCurrentLaneEvent } from "@/features/applications/lanes";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { offerHintFor, useOfferHints } from "@/features/applications/queries";
import { getStageLabel, PIPELINE } from "@/features/applications/stages";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";

export const workspaceIcons: Record<WorkspaceTab, IconName> = {
	fit: "target",
	apply: "paper-plane-tilt",
	prepare: "chalkboard-teacher",
	practise: "microphone",
	debrief: "note-pencil",
	messages: "envelope-simple",
	saved: "books",
};

type Props = Pick<WorkspaceTabProps, "application" | "interview" | "now" | "go"> & {
	saved: SavedItem[];
	onDetails: (opener: HTMLButtonElement) => void;
	onEdit: () => void;
	savedPending: boolean;
	savedFailed: boolean;
	onRetrySaved: () => void;
};

/** One job's next step and its seven work areas. All summaries come from the current application. */
export function ApplicationOverview({
	application,
	interview,
	now,
	saved,
	go,
	onDetails,
	onEdit,
	savedPending,
	savedFailed,
	onRetrySaved,
}: Props) {
	const time = useCareerTime();
	const { lanes } = useApplicationLanes();
	const lane = getDisplayLane(lanes, application);
	const stagePosition = PIPELINE.indexOf(application.status) + 1;
	const stageSince = [...application.activity]
		.filter((entry) => isCurrentLaneEvent(entry, application))
		.sort((a, b) => +new Date(b.at) - +new Date(a.at))[0];
	const hints = useOfferHints(application.status === "offer");
	const step = getNextStep(application, now, time.timeZone, offerHintFor(hints, application.id));
	const text = describeNextStep(step, application, time.locale, time.timeZone);
	const heroInterview = step.kind === "interview" ? step.interview : undefined;
	const fit = latest(saved, "fit");
	const briefing = latest(saved, "briefing", interview?.id ?? null);
	const practice = latest(saved, "practice");
	const debrief = latest(saved, "debrief");
	const reply = latest(saved, "reply");
	const supported = fit?.data.requirements.filter((item) => item.status !== "missing").length ?? 0;
	const count = fit?.data.requirements.length ?? 0;
	const sent = formatList(
		time.locale,
		[
			application.sentResumeVersionId || application.resumeFileUrl ? t`Resume` : "",
			application.sentCoverLetterVersionId || application.coverLetterUrl ? t`letter` : "",
		].filter(Boolean),
	);
	// The Notes field holds one note per line; dated notes from Debrief are counted when there are none.
	const notes =
		(application.notes ?? "").split("\n").filter((line) => line.trim()).length ||
		application.activity.filter((entry) => entry.type === "note").length;
	const debriefed = debrief?.interviewId
		? application.activity.find((entry) => entry.type === "interview" && entry.id === debrief.interviewId)
		: undefined;
	const summaries: Record<WorkspaceTab, string> = {
		fit: fit ? t`${supported} of ${count} requirements have evidence` : t`Check the posting against your experience`,
		apply:
			application.status !== "saved" && sent
				? t`${sent} sent ${time.date(application.appliedAt)}`
				: t`Choose documents and prepare your form answers`,
		prepare: briefing ? t`Briefing ready` : t`Plan for your next interview`,
		practise: practice
			? time.date(practice.createdAt) === time.date(now)
				? t`Practiced today`
				: t`Practiced ${time.date(practice.createdAt)}`
			: t`Rehearse an answer, typed or spoken`,
		debrief: !debrief
			? t`Write down what happened after a round`
			: debriefed?.type !== "interview"
				? t`Debrief saved ${time.date(debrief.createdAt)}`
				: debriefed.kind === "screening"
					? t`Screening call debriefed ${time.date(debrief.createdAt)}`
					: t`${interviewKindOf(debriefed.kind)?.label ?? ""} interview debriefed ${time.date(debrief.createdAt)}`,
		messages: reply ? t`Last message ${time.date(reply.createdAt)}` : t`Save a message and write your reply`,
		saved: t`Saved briefings, fit results and drafts`,
	};
	const action =
		application.status === "closed"
			? () => go("saved")
			: application.status === "saved"
				? () => go("fit")
				: application.status === "offer"
					? undefined
					: heroInterview
						? () => go("prepare")
						: () => go("messages");
	const addToCalendar = () => {
		if (!heroInterview) return;
		const start = new Date(heroInterview.at);
		const ics = buildIcs({
			uid: heroInterview.id,
			title: t`${application.company} · ${application.role}`,
			start,
			end: new Date(+start + heroInterview.durationMinutes * 60_000),
			...(heroInterview.location ? { location: heroInterview.location } : {}),
			description: [
				heroInterview.participants.map((person) => [person.name, person.role].filter(Boolean).join(", ")).join("\n"),
				heroInterview.notes,
			]
				.filter(Boolean)
				.join("\n\n"),
			alarmMinutes: 60,
		});
		downloadWithAnchor(
			new Blob([ics], { type: "text/calendar" }),
			`${application.company}-interview.ics`.replace(/[^\w.-]+/g, "-"),
		);
	};
	return (
		<>
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 flex-1 max-sm:basis-full">
					<h1 className="t-page-title">
						<bdi>{application.company}</bdi>
					</h1>
					<p className="h-6 text-sm text-ink-3">
						{[application.role, application.location]
							.filter(Boolean)
							.map((part) => isolate(part as string))
							.join(" · ")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 pt-0.5">
					<Button
						variant="secondary"
						className="min-w-[129px]"
						data-details-trigger
						onClick={(event) => onDetails(event.currentTarget)}
						aria-label={t`Stage: ${getLaneLabel(lane)}. Open stage and details`}
					>
						<StageDot status={application.status} color={lane.color}>
							{null}
						</StageDot>
						{getLaneLabel(lane)}
						<Icon name="caret-down" className="text-ink-3" />
					</Button>
					{/* Phones: the ⋯ menu sits in the top bar (shell.tsx). */}
					<ApplicationActionsMenu
						application={application}
						className="max-sm:hidden [&_[data-slot=icon]]:size-5 [&_button]:size-9"
					/>
					{stagePosition > 0 && (
						<p className="t-small text-ink-3 sm:hidden">
							{stageSince && stageSince.type === "stage" && !stageSince.dateUnknown
								? t`Stage ${stagePosition} of ${PIPELINE.length} · since ${time.date(stageSince.at)}`
								: t`Stage ${stagePosition} of ${PIPELINE.length}`}
						</p>
					)}
				</div>
			</header>
			<StageStepper current={application.status} aria-label={t`Stage`} className="mt-[18px] w-full max-w-[520px]" />
			<HeroCard
				className="mt-5 max-sm:[&>div:last-child]:grid max-sm:[&>div:last-child]:grid-cols-2 max-sm:[&>div:last-child>button]:w-full max-sm:[&>div:last-child>button:first-child]:col-span-2 [&>div>p:last-child]:max-w-none"
				kicker={
					heroInterview
						? t`Next · ${time.format(heroInterview.at, { weekday: "long", day: "numeric", month: "short" })}, ${time.time(heroInterview.at)} · ${time.relative(heroInterview.at, now).toLocaleLowerCase(time.locale)}`
						: t`Next step`
				}
				title={heroInterview ? t`${interviewKindOf(heroInterview.kind)?.label ?? ""} interview` : text.title}
				actions={
					<>
						{action ? (
							<Button size="lg" className="leading-5" onClick={action}>
								{application.status === "closed" ? (
									<Trans>Open Library</Trans>
								) : application.status === "saved" ? (
									<Trans>Check fit</Trans>
								) : heroInterview ? (
									<Trans>Open briefing</Trans>
								) : (
									<Trans>Follow up</Trans>
								)}
							</Button>
						) : savedPending || savedFailed ? (
							<div className="grid gap-2">
								<Button size="lg" disabled loading={savedPending}>
									<Trans>Compare offers</Trans>
								</Button>
								{savedFailed && <CareerLoadError onRetry={onRetrySaved} />}
							</div>
						) : (
							<Link
								to="/dashboard/career/offers"
								search={{ a: saved.find((item) => item.data.kind === "offer")?.id }}
								className={buttonVariants({ size: "lg" })}
							>
								<Trans>Compare offers</Trans>
							</Link>
						)}
						{heroInterview && (
							<>
								<Button size="lg" className="leading-5" variant="ghost" onClick={onEdit}>
									<Icon name="pencil-simple" />
									<Trans>Edit interview</Trans>
								</Button>
								<Button size="lg" className="leading-5" variant="ghost" onClick={addToCalendar}>
									<Icon name="calendar-plus" />
									<Trans>Add to calendar</Trans>
								</Button>
							</>
						)}
					</>
				}
			>
				{heroInterview
					? t`With ${heroInterview.participants.map((person) => isolate(person.name)).join(t` and `)} · ${isolate(midSentence(heroInterview.location) ?? t`Interview`)}.${briefing ? t` Your briefing is ready: likely questions and ${briefing.data.stories.length === 3 ? t`three stories` : plural(briefing.data.stories.length, { one: "# story", other: "# stories" })} to tell.` : ""}`
					: text.sub}
			</HeroCard>
			<Columns
				className="gap-y-0"
				aside={
					<>
						<SectionHeading className="pt-6">
							<Trans>Details</Trans>
						</SectionHeading>
						<List>
							<ListRow
								render={<button type="button" onClick={(event) => onDetails(event.currentTarget)} />}
								title={t`Posting`}
								subtitle={
									application.sourceUrl ? (
										<>
											<span className="t-mono">
												{new URL(application.sourceUrl).host}
												{new URL(application.sourceUrl).pathname}
											</span>
											{" · "}
											{t`saved ${time.date(application.createdAt)}`}
										</>
									) : (
										t`Add a posting`
									)
								}
								caret
							/>
							<ListRow
								render={<button type="button" onClick={(event) => onDetails(event.currentTarget)} />}
								title={t`People`}
								subtitle={application.contacts.map((person) => isolate(person.name)).join(", ") || t`Add a contact`}
								caret
							/>
							<ListRow
								render={<button type="button" onClick={(event) => onDetails(event.currentTarget)} />}
								title={t`Notes`}
								subtitle={plural(notes, { one: "# note", other: "# notes" })}
								caret
							/>
							<ListRow
								render={<button type="button" onClick={(event) => onDetails(event.currentTarget)} />}
								title={t`Timeline`}
								subtitle={application.activity
									.filter((entry) => entry.type === "stage")
									.sort((a, b) => +new Date(a.at) - +new Date(b.at))
									.slice(-2)
									.map((entry) => `${entry.laneLabel ?? getStageLabel(entry.stage)} ${time.date(entry.at)}`)
									.join(" · ")}
								caret
							/>
						</List>
					</>
				}
			>
				<SectionHeading className="pt-6">
					<Trans>Work on it</Trans>
				</SectionHeading>
				<List>
					{WORKSPACE_TABS.map((tab) => (
						<ListRow
							key={tab}
							render={
								<Link
									to="/dashboard/applications/$applicationId/{-$tab}"
									params={{ applicationId: application.id, tab }}
								/>
							}
							leading={
								<IconTile accent={tab === "prepare" && !!briefing}>
									<Icon name={workspaceIcons[tab]} />
								</IconTile>
							}
							title={tabLabel(tab)}
							subtitle={summaries[tab]}
							value={
								tab === "prepare" && interview ? t`For ${time.format(interview.at, { weekday: "long" })}` : undefined
							}
							caret
						/>
					))}
				</List>
			</Columns>
		</>
	);
}
