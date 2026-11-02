// Prepare (web workspace/prepare.tsx, W6/W7/W21): before the call, a timed plan from the briefing; from 10 minutes
// before until it ends, a short checklist that works without AI; afterwards, a nudge to Debrief.
import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { firstFutureLead, PREPARE_LEADS } from "@reactive-resume/schema/career-schedule";
import { formatList } from "@reactive-resume/utils/locale";
import {
	latest,
	useGenerate,
	useSavedItems,
	useSchedules,
	useStories,
	useTicks,
	useWorkspace,
	workspaceError,
} from "../hooks";
import { minutesUntil, preparePhase } from "../logic";
import { Actions, AiNotice, Block, CheckRow, Pill, useWorking, workingSteps } from "../parts";
import { WorkspaceScreen } from "../shell";
import { orpc } from "@/api/client";
import { useFlags } from "@/api/flags";
import { useHasAIProvider } from "@/features/ai/providers";
import { interviewTypeLabel, useNow, useUserTime } from "@/features/application-detail/hooks";
import { routes } from "@/routes";
import { Banner, Button, EmptyState, ListRow, Sheet, Skeleton, Switch, Text, showToast, useTheme } from "@/ui";

type Briefing = SavedItem & { data: SavedData<"briefing"> };

const isBriefing = (item: SavedItem | undefined): item is Briefing => item?.data.kind === "briefing";

export function PrepareTab() {
	return <WorkspaceScreen tab="prepare">{(props) => <Prepare {...props} />}</WorkspaceScreen>;
}

function Prepare({ application, version, interview, now, go, addInterview }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const saved = useSavedItems(application.id);

	if (!interview && !isBriefing(version))
		return (
			<EmptyState
				variant="card"
				title={t`Add an interview to plan for it`}
				message={t`Once a round is scheduled, Interview prep builds a timed plan, your opening and the questions to ask.`}
			>
				<Button variant="secondary" icon="calendar-dot" label={t`Add an interview`} onPress={addInterview} />
			</EmptyState>
		);

	const briefing = isBriefing(version) ? version : latest(saved.data, "briefing", interview?.id ?? null);

	if (interview && !isBriefing(version)) {
		const phase = preparePhase(interview, now);
		if (phase === "after")
			return (
				<EmptyState
					variant="card"
					title={t`How did it go?`}
					message={t`Write down what they asked while it's fresh. The coach compares your answers with your stories.`}
				>
					<Button label={t`Start a debrief`} onPress={() => go("debrief")} />
				</EmptyState>
			);
		if (phase === "soon")
			return <Soon application={application} interview={interview} briefing={briefing} now={now} go={go} />;
	}

	if (!briefing) {
		if (saved.isPending) return <Skeleton height={space.s12 * 5} />;
		return interview ? <PlanEmpty application={application} interview={interview} /> : null;
	}

	return <Plan application={application} interview={interview} briefing={briefing} readOnly={!!version} go={go} />;
}

type PlanEmptyProps = { application: Application; interview: InterviewTimelineEntry };

function PlanEmpty({ application, interview }: PlanEmptyProps) {
	const { t } = useLingui();
	const provider = useHasAIProvider().defaultProvider;
	const generate = useGenerate(application.id);
	const label = useWorking(generate.isPending, workingSteps("briefing"), t`Plan my preparation`);
	return (
		<EmptyState
			variant="card"
			title={t`A focused plan for this round`}
			message={t`A timed plan, your opening, the stories to bring and questions to ask. It becomes your checklist 10 minutes before the call.`}
		>
			{provider ? (
				<Button
					label={label}
					loading={generate.isPending}
					onPress={() => void generate.run({ task: "briefing", interviewId: interview.id }).catch(() => undefined)}
				/>
			) : null}
			<AiNotice task="briefing" application={application} interview centered />
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
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const router = useRouter();
	const { data } = briefing;
	const ticks = useTicks(application.id, `plan:${briefing.id}`);
	const workspace = useWorkspace(application.id);
	const [reading, setReading] = useState(false);
	const provider = useHasAIProvider().defaultProvider;
	const generate = useGenerate(application.id);
	const againLabel = useWorking(generate.isPending, workingSteps("briefing"), t`Plan again`);
	const done = (index: number) => ticks.ticked.includes(String(index));
	const total = data.plan.reduce((sum, row) => sum + row.minutes, 0);
	const doneMinutes = data.plan.reduce((sum, row, index) => sum + (done(index) ? row.minutes : 0), 0);
	const questions = [...data.questions, ...workspace.data.questions];

	const action = (row: SavedData<"briefing">["plan"][number]) => {
		switch (row.action) {
			case "story":
				return { label: t`Open story`, onPress: () => router.push(routes.career("knowledge")) };
			case "draft-story":
				return { label: t`Draft story`, onPress: () => router.push(routes.career("knowledge")) };
			case "practise":
				return { label: t`Practice`, onPress: () => go("practise", { speak: true }) };
			case "questions":
			case "none":
				return null;
		}
	};

	return (
		<View style={{ gap: space.s4 }}>
			<View style={{ gap: space.s1 }}>
				<Text variant="heading">{data.headline}</Text>
				<Text color="ink2">{data.summary}</Text>
				<Text variant="mono" color="ink3">
					{t`${doneMinutes} of ${total} min`}
				</Text>
			</View>
			{/* The interview, posting or Knowledge changed since it was planned: plan again on request. */}
			{briefing.outdated && !readOnly && provider && interview ? (
				<Button
					variant="secondary"
					label={againLabel}
					loading={generate.isPending}
					onPress={() => void generate.run({ task: "briefing", interviewId: interview.id }).catch(() => undefined)}
				/>
			) : null}
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{ flexDirection: "row", height: 6, gap: 2, borderRadius: radius.rSm, overflow: "hidden" }}
			>
				{data.plan.map((row, index) => (
					<View
						key={`${row.title}-${index}`}
						style={{
							flexGrow: row.minutes,
							flexBasis: 0,
							backgroundColor: done(index) ? colors.accent : colors.sunken,
						}}
					/>
				))}
			</View>

			<Block>
				{data.plan.map((row, index) => {
					const next = action(row);
					const minutes = row.minutes;
					return (
						<View key={`${row.title}-${index}`} style={{ gap: space.s1 }}>
							<CheckRow
								label={row.title}
								detail={row.detail}
								checked={done(index)}
								disabled={readOnly}
								strike
								onChange={(on) => ticks.toggle(String(index), on)}
								trailing={
									<Text variant="mono" color="ink3">
										{t`${minutes} min`}
									</Text>
								}
							/>
							{next ? (
								<View style={{ paddingStart: space.s8 }}>
									<Button variant="secondary" size="sm" label={next.label} onPress={next.onPress} />
								</View>
							) : null}
						</View>
					);
				})}
			</Block>

			{questions.length > 0 ? (
				<Block title={t`Questions to ask`}>
					{questions.map((question, index) => (
						<View key={`${question.text}-${index}`} style={{ flexDirection: "row", gap: space.s2 }}>
							<Text variant="mono" color="accentText">
								{index + 1}
							</Text>
							<Text style={{ flex: 1 }}>{question.text}</Text>
							<Text variant="caption" color="ink3">
								{question.origin}
							</Text>
						</View>
					))}
				</Block>
			) : null}

			<Block title={t`10-minute briefing`} trailing={<Pill tone="accent" label={t`Ready`} />}>
				<Text variant="callout" color="ink2">
					{t`Your opening, the stories to bring and questions to ask. It becomes your checklist 10 minutes before the call.`}
				</Text>
				<Button variant="secondary" size="sm" label={t`Read briefing`} onPress={() => setReading(true)} />
			</Block>
			{interview && !readOnly ? <RefreshSwitch application={application} interview={interview} /> : null}
			<StoriesToBring application={application} briefing={briefing} />
			<BriefingSheet briefing={briefing} open={reading} onClose={() => setReading(false)} />
		</View>
	);
}

type RefreshSwitchProps = { application: Application; interview: InterviewTimelineEntry };

/** The prepare schedule for this interview: switching it here changes it in Career → Today too. */
function RefreshSwitch({ application, interview }: RefreshSwitchProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const { when, timeZone } = useUserTime();
	const connection = useHasAIProvider();
	const flags = useFlags();
	const schedules = useSchedules();
	const schedule = schedules.data?.find((item) => item.kind === "prepare" && item.interviewId === interview.id);
	const now = useNow();
	const next = firstFutureLead(new Date(interview.at), timeZone, now);
	const lead = schedule?.lead ?? next?.lead ?? PREPARE_LEADS[0];
	// The schedule's own connection while it's switched on and tested; otherwise the default, as the run itself does.
	const own = connection.usableProviders.find((item) => item.id === schedule?.aiProviderId);
	const provider = own ?? connection.defaultProvider;
	const providerId = provider?.id ?? null;
	const providerLabel = provider?.label ?? "";
	const runAt = schedule?.nextRunAt ?? next?.runAt ?? null;
	const scheduling = flags.data?.careerSchedulingEnabled !== false;

	const save = useMutation({
		...orpc.career.saveSchedule.mutationOptions(),
		onSuccess: (row) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.schedules.key() });
			const nextAt = when(row.nextRunAt);
			showToast({ message: row.enabled ? t`Briefing refresh is on · ${nextAt}` : t`Briefing refresh paused` });
		},
		onError: (error) => showToast({ message: workspaceError(error, t`Couldn't change the schedule. Try again.`) }),
	});

	const enabled = (save.isPending ? save.variables.enabled : schedule?.enabled) ?? false;
	const available = !connection.isUnavailable && scheduling && !!providerId;
	const label = next
		? {
				"24h": t`Refresh the briefing 24 hours before`,
				"2h": t`Refresh the briefing 2 hours before`,
				morning: t`Refresh the briefing on the morning of`,
			}[next.lead]
		: t`Refresh the briefing`;
	const at = runAt ? when(runAt) : "";
	const description = !scheduling
		? t`Scheduled work isn't available on this server.`
		: connection.isUnavailable
			? t`AI connections are unavailable.`
			: !providerId
				? t`Connect an AI provider in Settings to refresh it automatically.`
				: at
					? t`${at} · ${providerLabel}. Sends this application and your Knowledge; your provider may charge.`
					: t`Too close to the interview to schedule a refresh.`;

	return (
		<Block>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
				<View style={{ flex: 1, gap: space.s0 }}>
					<Text variant="label">{label}</Text>
					<Text variant="callout" color="ink2">
						{description}
					</Text>
				</View>
				<Switch
					label={label}
					value={enabled}
					disabled={save.isPending || (!available && !enabled) || (!next && !enabled)}
					onValueChange={(checked) =>
						save.mutate({
							...(schedule ? { id: schedule.id } : {}),
							kind: "prepare",
							applicationId: application.id,
							interviewId: interview.id,
							lead: (next?.lead ?? lead) as "24h" | "2h" | "morning",
							enabled: checked,
							email: schedule?.email ?? false,
							timezone: timeZone,
							locale: i18n.locale,
							nextRunAt: next?.runAt ?? runAt ?? new Date(interview.at),
							aiProviderId: providerId,
							query: "",
							intervalDays: null,
						})
					}
				/>
			</View>
		</Block>
	);
}

type StoriesToBringProps = { application: Application; briefing: Briefing };

function StoriesToBring({ application, briefing }: StoriesToBringProps) {
	const { t } = useLingui();
	const router = useRouter();
	const stories = useStories(application.id);
	const bring = briefing.data.storyIds.flatMap((id) => stories.data?.find((story) => story.id === id) ?? []);
	if (!stories.data || (bring.length === 0 && !briefing.data.missingStory)) return null;
	return (
		<Block title={t`Stories to bring`}>
			{bring.map((story) => (
				<ListRow
					key={story.id}
					title={story.data.title}
					leading="book-open"
					chevron
					onPress={() => router.push(routes.career("knowledge"))}
				/>
			))}
			{briefing.data.missingStory ? <Banner tone="warn" icon="question" message={briefing.data.missingStory} /> : null}
		</Block>
	);
}

/** Focus, opening, stories and the honesty note: stored with the briefing, so it opens without AI. */
function BriefingNotes({ briefing }: { briefing: Briefing }) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { data } = briefing;
	const items = [
		{ label: t`Your focus`, text: data.focus },
		{ label: t`Your opening`, text: data.opening && `“${data.opening}”`, italic: true },
		{ label: data.stories.length === 2 ? t`Two stories` : t`Stories`, text: data.stories.join("\n") },
		{ label: t`Keep it honest`, text: data.honesty },
	];
	return (
		<View style={{ gap: space.s3 }}>
			{items
				.filter((item) => item.text)
				.map((item) => (
					<View key={item.label} style={{ gap: space.s1 }}>
						<Text variant="label" color="ink2">
							{item.label}
						</Text>
						<Text style={item.italic ? { fontStyle: "italic" } : null}>{item.text}</Text>
					</View>
				))}
		</View>
	);
}

type BriefingSheetProps = { briefing: Briefing; open: boolean; onClose: () => void };

function BriefingSheet({ briefing, open, onClose }: BriefingSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	return (
		<Sheet open={open} onClose={onClose} title={t`10-minute briefing`} detents={[0.9]}>
			<View style={{ paddingHorizontal: space.s4 }}>
				<BriefingNotes briefing={briefing} />
			</View>
		</Sheet>
	);
}

// ---- W7 / W21: ten minutes before ----

type SoonProps = {
	application: Application;
	interview: InterviewTimelineEntry;
	briefing: Briefing | undefined;
	now: Date;
	go: WorkspaceTabProps["go"];
};

function Soon({ application, interview, briefing, now, go }: SoonProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, space } = useTheme();
	const ticks = useTicks(application.id, `now:${interview.id}`);
	const [reading, setReading] = useState(false);
	const minutes = minutesUntil(new Date(interview.at), now);
	const names = interview.participants.map((person) => person.name.split(" ")[0] ?? person.name);
	const heading =
		minutes > 0
			? plural(minutes, { one: "Starts in # minute", other: "Starts in # minutes" })
			: minutes === 0
				? t`Starts now`
				: plural(-minutes, { one: "Started # minute ago", other: "Started # minutes ago" });
	const who = [interviewTypeLabel(interview.kind), formatList(i18n.locale, names)].filter(Boolean).join(" · ");
	const rows = [
		{ title: t`Check the details`, short: t`Time, link, who, what you sent` },
		{ title: t`Your two-minute introduction`, short: t`Focus, experience, why this role` },
		{ title: t`Pick two examples`, short: t`Situation, action, result` },
		{ title: t`Questions to ask`, short: t`Success at 90 days · next step` },
	];

	return (
		<View style={{ gap: space.s3 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.s3,
					padding: space.s4,
					borderRadius: radius.rLg,
					backgroundColor: colors.warnSoft,
				}}
			>
				<Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
					{heading}
				</Text>
			</View>
			{who ? <Text color="ink2">{who}</Text> : null}
			<Text variant="caption" color="ink3">
				{t`Works without AI or new research`}
			</Text>
			<Block>
				{rows.map((row, index) => (
					<CheckRow
						key={row.title}
						label={row.title}
						detail={row.short}
						checked={ticks.ticked.includes(String(index))}
						onChange={(on) => ticks.toggle(String(index), on)}
					/>
				))}
			</Block>
			{briefing?.data.opening ? (
				<Block title={t`Your opening`}>
					<Text variant="title">“{briefing.data.opening}”</Text>
				</Block>
			) : null}
			<Actions>
				{briefing ? <Button variant="secondary" label={t`Briefing`} onPress={() => setReading(true)} /> : null}
				<Button icon="microphone" label={t`Rehearse aloud`} onPress={() => go("practise", { speak: true })} />
			</Actions>
			{briefing ? <BriefingSheet briefing={briefing} open={reading} onClose={() => setReading(false)} /> : null}
		</View>
	);
}
