import type { Schedule } from "./hooks";
import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Platform, View } from "react-native";
import { careerScheduleInputSchema } from "@reactive-resume/schema/career";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { client, useCareerAction, useCareerQueries, useCareerTime, useNow } from "./hooks";
import { collectInterviews, firstLeadAhead, nextCareerRun, prepareRunAt, rollForward, toZoned } from "./scheduling";
import { EditorSheet, LoadState, SwitchRow } from "./shared";
import { orpc } from "@/api/client";
import { useFlags } from "@/api/flags";
import { useSession } from "@/auth/session";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { SetUpWebAccess } from "@/features/ai/web-access";
import { useApplications } from "@/features/applications/queries";
import { Banner, Button, SelectSheet, Sheet, Text, TextField, useTheme } from "@/ui";

type Input = RouterInput["career"]["saveSchedule"];
export const scheduleTitle = (kind: string) =>
	kind === "prepare"
		? t`Interview preparation`
		: kind === "follow-up"
			? t`Follow-up reminder`
			: t`Opportunity discovery`;
type ScheduleSheetProps = {
	schedule: Schedule | null;
	kind: Input["kind"];
	onClose: () => void;
	onDelete: (id: string) => void;
};
export function ScheduleSheet(props: ScheduleSheetProps) {
	const { t } = useLingui();
	const account = useCareerTime();
	const career = useCareerQueries();
	const applications = useApplications();
	const ai = useHasAIProvider();
	const session = useSession();
	const web = useQuery({
		...orpc.webAccess.status.queryOptions(),
		enabled: session.status === "signed-in",
		queryKey: [...orpc.webAccess.status.key(), session.server],
	});
	const flags = useFlags();
	const queries = [account.profile, career.profile, applications, web, flags];
	const unavailable = queries.find((query) => query.isError || query.isPending);
	return unavailable ? (
		<Sheet open onClose={props.onClose} title={t`New schedule`} detents={[0.9]}>
			<LoadState query={unavailable} />
		</Sheet>
	) : account.profile.data && career.profile.data && applications.data && web.data && flags.data ? (
		<ScheduleForm
			{...props}
			key={session.server}
			timezone={props.schedule?.timezone ?? account.timeZone}
			locale={account.locale}
			profile={career.profile.data}
			applications={applications.data}
			search={web.data.search}
			reader={web.data.provider}
			available={flags.data.careerSchedulingEnabled ?? false}
			smtp={flags.data.smtpEnabled}
			verified={account.profile.data.emailVerified}
			ai={ai}
		/>
	) : null;
}

type FormProps = ScheduleSheetProps & {
	timezone: string;
	locale: string;
	profile: NonNullable<ReturnType<typeof useCareerQueries>["profile"]["data"]>;
	applications: NonNullable<ReturnType<typeof useApplications>["data"]>;
	search: boolean;
	reader: string | null;
	available: boolean;
	smtp: boolean;
	verified: boolean;
	ai: ReturnType<typeof useHasAIProvider>;
};
function ScheduleForm({
	schedule,
	kind: initialKind,
	onClose,
	onDelete,
	timezone,
	locale,
	profile,
	applications,
	search,
	reader,
	available,
	smtp,
	verified,
	ai,
}: FormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const now = useNow();
	const upcoming = collectInterviews(applications, now);
	const open = applications.filter((application) => application.status !== "closed");
	const [initial] = useState(() => {
		const at = schedule
			? schedule.intervalDays
				? rollForward(new Date(schedule.nextRunAt), schedule.intervalDays, timezone)
				: new Date(schedule.nextRunAt)
			: nextCareerRun(new Date(), 1, timezone);
		return {
			kind: (schedule?.kind as Input["kind"]) ?? initialKind,
			query:
				schedule?.query ??
				(initialKind === "follow-up" ? "" : [...profile.targetRoles, ...profile.locations].join(" · ")),
			every: String(schedule?.intervalDays ?? 1),
			...toZoned(at, timezone),
			time: schedule ? toZoned(at, timezone).time : "08:00",
			interviewId: schedule?.interviewId ?? upcoming[0]?.interview.id ?? "",
			applicationId: schedule?.applicationId ?? open[0]?.id ?? "",
			lead: (schedule?.lead as NonNullable<Input["lead"]>) ?? firstLeadAhead(upcoming[0]?.start, timezone),
			aiProviderId: schedule?.aiProviderId ?? ai.defaultProvider?.id ?? "",
			enabled: schedule?.enabled ?? true,
			email: schedule?.email ?? false,
		};
	});
	const [draft, setDraft] = useState(initial);
	// A lead the person picked stays; until then it follows the chosen interview (web schedule sheet).
	const [leadChosen, setLeadChosen] = useState(false);
	const [picker, setPicker] = useState<"date" | "time" | null>(null);
	const [setup, setSetup] = useState(false);
	const [validation, setValidation] = useState<string>();
	const action = useCareerAction();
	const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
	const interview = upcoming.find((row) => row.interview.id === draft.interviewId);
	const unchangedFollowUp =
		schedule?.kind === "follow-up" &&
		draft.kind === "follow-up" &&
		draft.date === initial.date &&
		draft.time === initial.time;
	const at = unchangedFollowUp ? new Date(schedule.nextRunAt) : fromZonedDateTime(draft.date, draft.time, timezone);
	const runAt = draft.kind === "prepare" && interview ? prepareRunAt(interview.start, draft.lead, timezone) : at;
	const provider = ai.usableProviders.find((row) => row.id === draft.aiProviderId) ?? ai.defaultProvider;
	const blocked =
		(draft.enabled && !available) ||
		(draft.kind === "prepare"
			? !interview || !ai.hasAIProvider
			: draft.kind === "follow-up"
				? !open.some((row) => row.id === draft.applicationId)
				: draft.enabled && !search);
	const save = () => {
		if (draft.kind === "discovery" && draft.query.trim().length < 3)
			return setValidation(t`Add a role or company to look for.`);
		if (blocked) return;
		if (!runAt) return setValidation(t`This date or time does not exist in your timezone. Choose another time.`);
		if (draft.kind !== "prepare" && !unchangedFollowUp && runAt <= now) return setValidation(t`Pick a time after now.`);
		const input: Input = {
			...(schedule ? { id: schedule.id } : {}),
			kind: draft.kind,
			query: draft.kind !== "prepare" ? draft.query.trim() : "",
			applicationId:
				draft.kind === "prepare"
					? (interview?.application.id ?? null)
					: draft.kind === "follow-up"
						? draft.applicationId
						: null,
			interviewId: draft.kind === "prepare" ? draft.interviewId : null,
			lead: draft.kind === "prepare" ? draft.lead : null,
			enabled: draft.enabled,
			email: smtp && verified && draft.email,
			timezone,
			locale,
			nextRunAt: runAt,
			intervalDays: draft.kind === "discovery" ? Number(draft.every) : null,
			aiProviderId: draft.kind === "prepare" ? (provider?.id ?? null) : null,
		};
		if (!careerScheduleInputSchema.safeParse(input).success) return setValidation(t`Check the fields and try again.`);
		setValidation(undefined);
		void action.run(() => client.career.saveSchedule(input), onClose);
	};
	return (
		<EditorSheet
			title={schedule ? t`Edit schedule` : t`New schedule`}
			dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
			pending={action.pending}
			onClose={onClose}
		>
			<View style={{ padding: space.s4, gap: space.s4 }}>
				<SelectSheet
					label={t`What should run`}
					value={draft.kind}
					onChange={(kind) => set({ kind })}
					disabled={!!schedule || action.pending}
					options={[
						{ value: "discovery", label: t`Find roles` },
						{ value: "prepare", label: t`Interview prep` },
						{ value: "follow-up", label: t`Remind me` },
					]}
				/>
				{!available ? (
					<Banner
						tone="warn"
						message={t`Scheduled work is not available on this server. Ask your server administrator to configure it.`}
					/>
				) : null}
				<Text color="ink3">{t`Times are shown in ${timezone}. Change timezone in Settings → Preferences.`}</Text>
				{draft.kind === "discovery" ? (
					<>
						{!search && (
							<Banner
								tone="warn"
								message={t`Finding roles needs a working web search service. Set it up first, or save jobs manually in Applications.`}
							/>
						)}
						{!search && <SetUpWebAccess />}
						<TextField
							label={t`Look for`}
							value={draft.query}
							maxLength={500}
							onChangeText={(query) => set({ query })}
						/>
						<SelectSheet
							label={t`How often`}
							value={draft.every}
							onChange={(every) => set({ every })}
							options={[
								{ value: "1", label: t`Every day` },
								{ value: "3", label: t`Every 3 days` },
								{ value: "7", label: t`Every week` },
							]}
						/>
						<Text color="ink3">{t`Uses web search set up in Settings. Only this query and search countries are sent; your resume and Knowledge are not sent to search. The service may charge. Results wait in Today; applications and documents are never created for you.`}</Text>
						<Text color="ink3">
							{reader
								? t`Found posting links are read by Reactive Resume and, when needed, ${reader} and the sites being read. The reader may charge.`
								: t`Found posting links are read by Reactive Resume and the sites being read.`}
						</Text>
						<Text color="ink3">{t`AI is optional. Review target roles in Knowledge, wait for Saved, then create a new schedule. Existing schedules keep this query until you edit and save it.`}</Text>
						<Text color="ink3">{t`Repeats at this local time in the displayed timezone across clock changes. A skipped clock time moves forward. Missed runs combine into one search. Results and failures appear in Today; delivery depends on the server runner.`}</Text>
						{draft.enabled && !search ? (
							<Banner tone="warn" message={t`Set up web search in Settings to find roles.`} />
						) : null}
					</>
				) : draft.kind === "prepare" ? (
					<>
						<SelectSheet
							label={t`Interview`}
							value={draft.interviewId}
							onChange={(interviewId) => {
								const chosen = upcoming.find((row) => row.interview.id === interviewId);
								set({
									interviewId,
									...(leadChosen || schedule?.lead || !chosen ? {} : { lead: firstLeadAhead(chosen.start, timezone) }),
								});
							}}
							options={upcoming.map((row) => ({
								value: row.interview.id,
								label: `${row.application.company} · ${new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(row.start)}`,
							}))}
						/>
						{!interview ? <Banner tone="warn" message={t`Add an upcoming interview in Applications first.`} /> : null}
						<SelectSheet
							label={t`Prepare a briefing`}
							value={draft.lead}
							onChange={(lead) => {
								setLeadChosen(true);
								set({ lead });
							}}
							options={[
								{ value: "24h", label: t`24 hours before` },
								{ value: "2h", label: t`2 hours before` },
								{ value: "morning", label: t`Morning of · 08:00 local` },
							]}
						/>
						{runAt ? (
							<Text>
								{runAt <= now
									? t`The lead time has passed. Saving runs the briefing now.`
									: t`Runs at ${new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(runAt)}.`}
							</Text>
						) : null}
						<Text color="ink3">{t`Morning of runs at 08:00, or two hours before interviews starting before 10:00.`}</Text>
						{ai.isLoading ? (
							<Text>{t`Loading AI connections…`}</Text>
						) : ai.error ? (
							<Button
								variant="secondary"
								label={t`Retry AI connections`}
								onPress={() => {
									void ai.retry();
								}}
							/>
						) : null}
						<SelectSheet
							label={t`AI connection`}
							value={provider?.id ?? null}
							onChange={(aiProviderId) => set({ aiProviderId })}
							options={ai.usableProviders.map((row) => ({ value: row.id, label: row.label }))}
						/>
						{!ai.isUnavailable && (
							<Button variant="secondary" label={t`Connect AI provider`} onPress={() => setSetup(true)} />
						)}
						<Text color="ink3">{t`Sends this application and enabled Knowledge to this connection. Your provider may charge. Scheduled work never switches to another connection automatically.`}</Text>
					</>
				) : (
					<>
						<SelectSheet
							label={t`Application`}
							disabled={!!schedule}
							value={draft.applicationId}
							onChange={(applicationId) => set({ applicationId })}
							options={open.map((row) => ({ value: row.id, label: `${row.company} · ${row.role}` }))}
						/>
						<TextField label={t`Follow-up note`} value={draft.query} onChangeText={(query) => set({ query })} />
						{!open.length ? <Banner tone="warn" message={t`Add an application first.`} /> : null}
					</>
				)}
				{draft.kind !== "prepare" ? (
					<>
						<TextField
							label={draft.kind === "follow-up" ? t`Remind me on (YYYY-MM-DD)` : t`First run (YYYY-MM-DD)`}
							value={draft.date}
							onChangeText={(date) => set({ date })}
							maxLength={10}
						/>
						<TextField
							label={t`Time (HH:mm)`}
							value={draft.time}
							onChangeText={(time) => set({ time })}
							maxLength={5}
						/>
						<Button variant="secondary" label={t`Choose date`} onPress={() => setPicker("date")} />
						<Button variant="secondary" label={t`Choose time`} onPress={() => setPicker("time")} />
						{picker ? (
							<DateTimePicker
								value={at ?? now}
								mode={picker}
								timeZoneName={timezone}
								onDismiss={() => setPicker(null)}
								onValueChange={(_event, date) => {
									const value = toZoned(date, timezone);
									set(picker === "date" ? { date: value.date } : { time: value.time });
									if (Platform.OS === "android") setPicker(null);
								}}
							/>
						) : null}
					</>
				) : null}
				<SwitchRow
					label={t`Turn this schedule on`}
					value={draft.enabled}
					onValueChange={(enabled) => set({ enabled })}
				/>
				<SwitchRow
					label={t`Also email a copy`}
					value={smtp && verified && draft.email}
					disabled={!smtp || !verified}
					onValueChange={(email) => set({ email })}
				/>
				<Text color="ink3">{t`Always appears in Today. Email requires a verified address and server mail setup. No push notifications are sent.`}</Text>
				{validation || action.error ? <Banner tone="danger" message={validation ?? action.error ?? ""} /> : null}
				<Button label={t`Save schedule`} loading={action.pending} disabled={blocked} onPress={save} />
				{schedule ? (
					<Button
						variant="danger"
						label={t`Delete schedule`}
						disabled={action.pending}
						onPress={() => {
							onDelete(schedule.id);
							onClose();
						}}
					/>
				) : null}
				<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
			</View>
		</EditorSheet>
	);
}
