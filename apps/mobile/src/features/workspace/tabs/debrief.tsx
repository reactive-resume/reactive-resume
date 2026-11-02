// Debrief (web workspace/debrief.tsx): write the interview down while it's fresh, review it against Knowledge, choose
// what to remember, and a light practice plan for the week.
import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { Application } from "@/features/applications/types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Storage from "expo-sqlite/kv-store";
import { useState } from "react";
import { View } from "react-native";
import { latest, useDraft, useFacts, useGenerate, useSavedItems, useTicks, workspaceError } from "../hooks";
import { debriefRound, nextEvening } from "../logic";
import { Actions, AiNotice, Block, CheckRow, Pill, useWorking, workingSteps } from "../parts";
import { shareText } from "../share";
import { WorkspaceScreen } from "../shell";
import { orpc } from "@/api/client";
import { useHasAIProvider } from "@/features/ai/providers";
import { isInterview, useUserTime } from "@/features/application-detail/hooks";
import { buildIcs } from "@/features/reminders";
import { Banner, Button, Chip, Skeleton, Text, TextArea, TextField, showToast, useTheme } from "@/ui";

type Debrief = SavedData<"debrief">;
type Review = Pick<SavedItem, "id" | "interviewId" | "evidence"> & { data: Debrief };
type Draft = { question: string; answer: string; landed: Debrief["landed"] | null };

const isDebrief = (item: SavedItem | undefined): item is SavedItem & { data: Debrief } => item?.data.kind === "debrief";

export function DebriefTab() {
	return <WorkspaceScreen tab="debrief">{(props) => <DebriefBody {...props} />}</WorkspaceScreen>;
}

function DebriefBody({ application, version, now }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const saved = useSavedItems(application.id);
	const [fresh, setFresh] = useState<Review | null>(null);
	const viewing = isDebrief(version) ? version : undefined;
	const round = viewing
		? application.activity.filter(isInterview).find((entry) => entry.id === viewing.interviewId)
		: debriefRound(application.activity, now);
	const forRound = latest(saved.data, "debrief", round?.id ?? null);
	const review = viewing ?? fresh ?? forRound;
	const plan = viewing ?? fresh ?? latest(saved.data, "debrief");

	return (
		<View style={{ gap: space.s4 }}>
			{saved.isPending ? (
				<Skeleton height={space.s12 * 6} />
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
			{review ? (
				<ReviewCard key={`review:${review.id}`} application={application} review={review} readOnly={!!viewing} />
			) : null}
			{plan ? (
				<WeekPlan key={plan.id} application={application} review={plan} now={now} readOnly={!!viewing} />
			) : (
				<View
					style={{
						padding: space.s4,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderStyle: "dashed",
						borderColor: colors.line2,
					}}
				>
					<Text variant="callout" color="ink3">
						{t`After your first review, a light plan for this week appears here.`}
					</Text>
				</View>
			)}
		</View>
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
	const { t } = useLingui();
	const { space } = useTheme();
	const { day } = useUserTime();
	const generate = useGenerate(application.id);
	const provider = useHasAIProvider().defaultProvider;
	const reviewLabel = useWorking(generate.isPending, workingSteps("debrief"), t`Review my answer`);
	const initial: Draft = from
		? { question: from.data.question, answer: from.data.answer, landed: from.data.landed }
		: { question: "", answer: "", landed: null };
	// Kept on the device (server + account) until it's reviewed, across tabs and restarts.
	const draft = useDraft<Draft>(readOnly ? null : `debrief:${application.id}:${round?.id ?? "none"}`, initial);
	const value = readOnly ? initial : draft.value;
	const change = (patch: Partial<Draft>) => {
		if (!readOnly) draft.setValue((current) => ({ ...current, ...patch }));
	};
	const submit = () => {
		if (!value.landed) return;
		// Edits made while the review runs are a newer revision; only this one is cleared when it lands.
		const submitted = value;
		generate
			.run({
				task: "debrief",
				interviewId: round?.id ?? null,
				question: value.question.trim(),
				answer: value.answer.trim(),
				landed: value.landed,
			})
			.then(({ item }) => {
				if (item?.data.kind !== "debrief") return;
				onReviewed(item as Review);
				draft.clear(submitted);
			})
			.catch(() => undefined);
	};

	const ready = value.question.trim() !== "" && value.answer.trim() !== "" && value.landed !== null;
	const afterRound = {
		screening: t`After the screening`,
		technical: t`After the technical interview`,
		behavioral: t`After the behavioral interview`,
		onsite: t`After the onsite`,
		other: t`After the interview`,
	} satisfies Record<InterviewKind, string>;
	const title =
		(readOnly && !round ? from?.data.round || t`Interview debrief` : afterRound[round?.kind ?? "other"]) +
		(round ? ` · ${day(round.at)}` : "");
	const landed = [
		{ value: "well", label: t`Went well` },
		{ value: "mixed", label: t`Mixed` },
		{ value: "not", label: t`Didn't land` },
	] as const;

	return (
		<Block title={title}>
			<Text variant="caption" color="ink3">
				{t`Write it down while it's fresh`}
			</Text>
			<TextField
				label={t`What did they ask?`}
				value={value.question}
				editable={!readOnly}
				maxLength={500}
				onChangeText={(question) => change({ question })}
			/>
			<TextArea
				label={t`What did you say, as close as you remember?`}
				value={value.answer}
				editable={!readOnly}
				maxLength={6000}
				onChangeText={(answer) => change({ answer })}
			/>
			<View style={{ gap: space.s1 }}>
				<Text variant="callout" color="ink2">
					{t`How did it land?`}
				</Text>
				<Actions>
					{landed.map((option) => (
						<Chip
							key={option.value}
							label={option.label}
							selected={value.landed === option.value}
							onPress={
								readOnly ? undefined : () => change({ landed: value.landed === option.value ? null : option.value })
							}
						/>
					))}
				</Actions>
			</View>
			{!readOnly ? (
				<View style={{ gap: space.s2 }}>
					<Button label={reviewLabel} disabled={!ready || !provider} loading={generate.isPending} onPress={submit} />
					<AiNotice task="debrief" application={application} interview={Boolean(round)} />
				</View>
			) : null}
		</Block>
	);
}

const dismissKey = (id: string) => `reactive-resume:career-memory-dismissed:${id}`;

type ReviewCardProps = { application: Application; review: Review; readOnly: boolean };

/** What the evidence supports versus what was only observed, and one thing worth remembering for this job. */
function ReviewCard({ application, review, readOnly }: ReviewCardProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const { data } = review;
	const facts = useFacts(application.id);
	const [dismissed, setDismissed] = useState(() => Storage.getItemSync(dismissKey(review.id)) === "1");
	const save = useMutation({
		...orpc.career.saveFact.mutationOptions(),
		onSuccess: (fact) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			if (!fact) {
				showToast({ message: t`You forgot this before, so it wasn't saved again.` });
				setDismissed(true);
			}
		},
		onError: (error) => showToast({ message: workspaceError(error, t`Couldn't save that to Knowledge. Try again.`) }),
	});
	const remembered =
		Boolean(save.data) ||
		(facts.data?.some((fact) => fact.source.kind === "debrief" && fact.source.id === review.id) ?? false);
	// Fact ids the model left in its text read as "your Knowledge".
	const readable = (text: string) =>
		[...new Set([...review.evidence.factIds, ...(facts.data ?? []).map((fact) => fact.id)])]
			.filter(Boolean)
			.reduce((value, id) => value.split(id).join(t`your Knowledge`), text);
	const company = application.company;
	const nextRound = readable(data.nextRound);
	const priority = readable(data.priority);

	return (
		<Block title={data.title}>
			{data.verdicts.map((verdict) => (
				<View key={verdict.text} style={{ gap: space.s1 }}>
					<Pill
						tone={verdict.tag === "supported" ? "accent" : "warn"}
						label={verdict.tag === "supported" ? t`Supported` : t`Observation`}
					/>
					<Text>{readable(verdict.text)}</Text>
				</View>
			))}
			{data.nextRound ? (
				<Text>
					<Text variant="label">{t`For the next round:`}</Text> {nextRound}
				</Text>
			) : null}
			{data.priority ? (
				<Text>
					<Text variant="label">{t`Practice priority:`}</Text> {priority}
				</Text>
			) : null}
			{data.remember && !readOnly && !dismissed ? (
				remembered ? (
					<Banner tone="info" icon="check-circle" message={t`Saved to Knowledge, private to this application.`} />
				) : (
					<View style={{ gap: space.s2 }}>
						<Banner
							tone="info"
							icon="bookmark-simple"
							title={t`Remember for ${company} only?`}
							message={data.remember}
						/>
						<Actions>
							<Button
								variant="secondary"
								size="sm"
								label={t`Remember`}
								loading={save.isPending}
								onPress={() => {
									if (!data.remember) return;
									save.mutate({
										applicationId: application.id,
										category: "experience",
										text: data.remember,
										source: { kind: "debrief", id: review.id, quote: data.remember },
									});
								}}
							/>
							<Button
								variant="ghost"
								size="sm"
								label={t`Not now`}
								onPress={() => {
									setDismissed(true);
									Storage.setItemSync(dismissKey(review.id), "1");
								}}
							/>
						</Actions>
					</View>
				)
			) : null}
		</Block>
	);
}

type WeekPlanProps = { application: Application; review: Review; now: Date; readOnly: boolean };

function WeekPlan({ application, review, now, readOnly }: WeekPlanProps) {
	const { t, i18n } = useLingui();
	const { timeZone } = useUserTime();
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
	const weekday = (at: Date) => new Intl.DateTimeFormat(i18n.locale, { timeZone, weekday: "short" }).format(at);

	const addToCalendar = async () => {
		const ics = buildIcs(
			rows.map((row) => ({
				uid: `${review.id}-${row.key}`,
				title: row.task,
				start: row.start,
				end: new Date(row.start.getTime() + row.minutes * 60_000),
				description: t`Practice for your ${company} interviews.`,
			})),
		);
		try {
			await shareText(`${company}-practice-week.ics`, ics, "text/calendar", "com.apple.ical.ics");
		} catch {
			showToast({ message: t`Couldn't share the calendar file. Try again.` });
		}
	};

	return (
		<Block title={t`This week: make your evidence easier to follow`}>
			<Text variant="caption" color="ink3">
				{t`${done} of ${count} done`} · {plural(minutes, { one: "# minute in total", other: "# minutes in total" })}
			</Text>
			{rows.map((row) => {
				const length = row.minutes;
				const day = weekday(row.start);
				return (
					<CheckRow
						key={row.key}
						label={row.task}
						detail={t`${day} · ${length}m`}
						checked={ticks.ticked.includes(row.key)}
						disabled={readOnly}
						onChange={(on) => ticks.toggle(row.key, on)}
					/>
				);
			})}
			{rows.length > 0 ? (
				<Button
					variant="secondary"
					size="sm"
					icon="calendar-plus"
					label={t`Add to calendar`}
					onPress={() => void addToCalendar()}
				/>
			) : null}
			<Text variant="caption" color="ink3">
				{t`Practice priorities, not conclusions about why an employer decided anything.`}
			</Text>
		</Block>
	);
}
