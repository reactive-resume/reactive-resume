import type { Schedule } from "./hooks";
import { i18n } from "@lingui/core";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { type ComponentRef, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { latestOfferHints } from "@reactive-resume/schema/applications/next-step";
import { upcomingApplicationEvents } from "@reactive-resume/schema/applications/upcoming";
import {
	client,
	prepareRpc,
	useCareerAction,
	useCareerTime,
	useNow,
	useOffers,
	useSaveTimezone,
	useTodayQueries,
	useUndoRows,
} from "./hooks";
import { ScheduleSheet, scheduleTitle } from "./schedule-sheet";
import { rollForward } from "./scheduling";
import { Actions, LoadState, Section, SwitchRow } from "./shared";
import { orpc } from "@/api/client";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { getLaneLabel, resolveLane } from "@/features/applications/lanes";
import {
	compareNextStepSortKeys,
	describeNextStep,
	getNextStep,
	needsAttention,
	nextStepSortKey,
} from "@/features/applications/next-step";
import { useApplications } from "@/features/applications/queries";
import { offerHintFor } from "@/features/applications/stage-actions";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	Card,
	Chip,
	EmptyState,
	Screen,
	Text,
	listItemMotion,
	listLayout,
	showToast,
	useFirstAppearance,
	useReducedMotion,
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

export function TodayScreen() {
	const lanes = useApplicationLanes();
	const { t } = useLingui();
	const { colors, space, size } = useTheme();
	const [width, setWidth] = useState(0);
	const tablet = width >= size.panel * 2 + space.s6;
	const router = useRouter();
	const now = useNow();
	const time = useCareerTime();
	const saveTimezone = useSaveTimezone();
	const queries = useTodayQueries();
	const applications = useApplications();
	const offers = useOffers();
	const hints = useMemo(() => (offers.data ? latestOfferHints(offers.data) : undefined), [offers.data]);
	const action = useCareerAction();
	const pull = usePullRefresh(action.refresh, applications.refetch, time.profile.refetch);
	const undo = useUndoRows();
	const [sheet, setSheet] = useState<{ schedule: Schedule | null; kind: "discovery" | "prepare" | "follow-up" } | null>(
		null,
	);
	const [showRead, setShowRead] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [bulkStatus, setBulkStatus] = useState("");
	const [bulkDone, setBulkDone] = useState<string[]>([]);
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	const rolesY = useRef(0);
	const groupY = useRef(0);
	const columnY = useRef(0);
	const events = upcomingApplicationEvents(applications.data ?? [], hints, now, time.timeZone);
	const next = events[0];
	const eventLabel = (item: (typeof events)[number]) =>
		item.kind === "offer"
			? t`Reply to the offer`
			: item.kind === "follow-up"
				? t`Follow-up reminder`
				: describeNextStep(
						{ kind: "interview", interview: item.interview, at: item.at },
						item.application,
						time.locale,
						time.timeZone,
					).title;
	const schedules = (queries.schedules.data ?? []).filter((row) => !undo.hidden.includes(row.id));
	const discovery =
		schedules.find((row) => row.kind === "discovery" && row.enabled) ??
		schedules.find((row) => row.kind === "discovery");
	const roles = (queries.opportunities.data ?? [])
		.filter((row) => !row.trackedApplicationId && !undo.hidden.includes(row.id) && !bulkDone.includes(row.id))
		.sort(
			(a, b) =>
				b.matches.length - a.matches.length || new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
		);
	const selection = selected.filter((id) => roles.some((row) => row.id === id));
	const bulk = (kind: "track" | "dismiss") => {
		if (!selection.length) return;
		void action.run(async () => {
			const failed: string[] = [];
			// Each write takes the owner's mutex; send one at a time instead of flooding the server's queue.
			for (const id of selection) {
				try {
					if (kind === "track") await client.career.trackOpportunity({ id });
					else await client.career.dismissOpportunity({ id });
				} catch {
					failed.push(id);
				}
			}
			const done = selection.filter((id) => !failed.includes(id));
			setBulkDone((current) => [...new Set([...current, ...done])]);
			setSelected(failed);
			setBulkStatus(
				failed.length
					? t`${i18n.number(done.length)} updated; ${i18n.number(failed.length)} failed. Failed roles remain selected. Refresh or retry.`
					: plural(done.length, { one: "# role updated.", other: "# roles updated." }),
			);
		});
	};
	const notes = (queries.notifications.data ?? []).filter(
		(row) => showRead || (!row.readAt && !undo.hidden.includes(row.id)),
	);
	const firstAppearance = useFirstAppearance(!queries.notifications.isPending);
	const reduced = useReducedMotion();
	// The same next-step rules as the Applications list: due follow-ups, no reply, interviews this week, offers.
	const attention = (applications.data ?? [])
		.flatMap((row) => {
			const step = getNextStep(row, now, lanes.lanes, time.timeZone, offerHintFor(hints, row.id));
			return needsAttention(step, now)
				? [{ row, step, key: nextStepSortKey(row, now, time.timeZone, offerHintFor(hints, row.id)) }]
				: [];
		})
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.row.id, b.row.id));
	const openSchedule = (schedule: Schedule) =>
		setSheet({ schedule, kind: schedule.kind as "discovery" | "prepare" | "follow-up" });
	const toggle = (row: Schedule, enabled: boolean) => {
		if (enabled && !row.intervalDays && row.lastQueuedAt && new Date(row.nextRunAt) <= now) return openSchedule(row);
		void action.run(() =>
			client.career.saveSchedule({
				id: row.id,
				kind: row.kind as "discovery" | "prepare" | "follow-up",
				applicationId: row.applicationId,
				interviewId: row.interviewId,
				query: row.query,
				lead: row.lead as "24h" | "2h" | "morning" | null,
				enabled,
				email: row.email,
				nextRunAt:
					enabled && row.intervalDays
						? rollForward(new Date(row.nextRunAt), row.intervalDays, row.timezone)
						: new Date(row.nextRunAt),
				timezone: row.timezone,
				intervalDays: row.intervalDays,
				aiProviderId: row.aiProviderId,
			}),
		);
	};
	return (
		<Screen scroll={false} contentStyle={{ padding: 0 }}>
			<ScrollView
				alwaysBounceVertical
				refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
				ref={scroll}
				contentContainerStyle={{ padding: space.s4, gap: space.s6 }}
			>
				<Text variant="heading">{t`Make room for the next step.`}</Text>
				<LoadState query={time.profile} />
				<Text variant="callout" color="ink3">
					{time.when(now)} · {time.timeZone}
				</Text>
				{time.deviceTimeZone ? (
					<Button
						variant="link"
						label={t`Use this device's timezone (${time.deviceTimeZone})`}
						disabled={saveTimezone.isPending}
						onPress={() => time.deviceTimeZone && saveTimezone.mutate(time.deviceTimeZone)}
					/>
				) : null}
				{action.error ? <Banner tone="danger" message={action.error} /> : null}
				<View
					onLayout={(event) => {
						groupY.current = event.nativeEvent.layout.y;
						setWidth(event.nativeEvent.layout.width);
					}}
					style={{ flexDirection: tablet ? "row" : "column", gap: space.s6, alignItems: "stretch" }}
				>
					<View
						onLayout={(event) => {
							columnY.current = event.nativeEvent.layout.y;
						}}
						style={{ flex: tablet ? 1 : 0, gap: space.s6 }}
					>
						<Section title={t`Coming up`}>
							<LoadState query={applications} />
							<LoadState query={queries.briefings} />
							<LoadState query={offers} />
							{next ? (
								<Card style={{ gap: space.s3 }}>
									<Text variant="title">
										{next.application.company} · {eventLabel(next)}
									</Text>
									<Text>{time.when(next.at)}</Text>
									{next.kind === "follow-up" && next.note ? <Text>{next.note}</Text> : null}
									<Text color="ink3">
										{getLaneLabel(resolveLane(lanes.lanes, next.application))}
										{next.kind === "interview"
											? ` · ${new Intl.NumberFormat(time.locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(next.interview.durationMinutes)}`
											: ""}
									</Text>
									{next.kind === "interview" &&
									queries.briefings.data?.some((row) => row.interviewId === next.interview.id) ? (
										<Chip label={t`Briefing ready`} />
									) : null}
									<Button
										variant="secondary"
										label={t`Open workspace`}
										onPress={() =>
											router.push(
												routes.application(
													next.application.id,
													next.kind === "interview" ? "prepare" : "messages",
													next.kind === "interview" ? next.interview.id : undefined,
												),
											)
										}
									/>
									{events.slice(1, 3).map((item) => (
										<Pressable
											key={item.key}
											accessibilityRole="link"
											onPress={() =>
												router.push(
													routes.application(
														item.application.id,
														item.kind === "interview" ? "prepare" : "messages",
														item.kind === "interview" ? item.interview.id : undefined,
													),
												)
											}
											style={{ minHeight: size.hit, justifyContent: "center" }}
										>
											<Text color="ink2">
												{time.when(item.at)} · {item.application.company} · {eventLabel(item)}
											</Text>
										</Pressable>
									))}
								</Card>
							) : !applications.isPending && !applications.isError && !offers.isPending && !offers.isError ? (
								<Text color="ink3">{t`Nothing scheduled yet.`}</Text>
							) : null}
						</Section>
						<Section title={t`Needs you`}>
							<LoadState query={queries.notifications} />
							{!queries.notifications.isPending &&
							!queries.notifications.isError &&
							!applications.isPending &&
							notes.length === 0 &&
							attention.length === 0 ? (
								queries.notifications.data?.length === 0 && applications.data?.length === 0 ? (
									// A new account: what Career is for, and the first things to do (web today.tsx).
									<EmptyState
										variant="card"
										title={t`Your job search starts here`}
										message={t`Say what you're looking for, add facts about your work, then ask the coach. New roles, reminders and finished briefings appear here.`}
										action={{ label: t`Set your preferences`, onPress: () => router.push(routes.career("knowledge")) }}
										secondaryAction={{ label: t`Ask the coach`, onPress: () => router.push(routes.career("coach")) }}
									/>
								) : (
									<EmptyState
										variant="card"
										title={t`You're up to date`}
										message={t`New roles, reminders and finished briefings appear here.`}
									/>
								)
							) : null}
							{notes.map((row, index) => (
								<Animated.View
									key={row.id}
									{...listItemMotion(index, firstAppearance, { reduced })}
									layout={listLayout}
								>
									<Card style={{ gap: space.s3 }}>
										<Text variant="title">{row.title}</Text>
										<Text>{row.body}</Text>
										<Text variant="caption" color="ink3">
											{time.when(row.createdAt)}
										</Text>
										<Actions>
											{row.notice.type === "opportunities" ? (
												<Button
													label={t`Review`}
													variant="secondary"
													onPress={() => {
														setExpanded(true);
														scroll.current?.scrollTo({
															y: groupY.current + columnY.current + rolesY.current,
															animated: false,
														});
													}}
												/>
											) : row.notice.type === "schedule-failed" || row.notice.type === "briefing-paused" ? (
												<Button
													label={t`Open the schedule`}
													variant="secondary"
													onPress={() => {
														const id = row.url?.split("schedule=")[1];
														const schedule = schedules.find((item) => item.id === id);
														if (schedule) openSchedule(schedule);
													}}
												/>
											) : row.applicationId ? (
												<Button
													label={row.notice.type === "briefing" ? t`Open briefing` : t`Open workspace`}
													variant="secondary"
													onPress={() =>
														router.push(
															routes.application(
																row.applicationId ?? "",
																row.notice.type === "briefing" ? "prepare" : "messages",
															),
														)
													}
												/>
											) : (
												<Button
													label={t`Open settings`}
													variant="secondary"
													onPress={() => router.push(routes.settings("ai"))}
												/>
											)}
											{!row.readAt && !undo.hidden.includes(row.id) ? (
												<Button
													label={t`Mark as read`}
													variant="ghost"
													onPress={() =>
														undo.remove(
															row.id,
															t`Marked as read`,
															() => prepareRpc(client.career.markNotificationRead, { id: row.id }),
															orpc.career.notifications.key(),
														)
													}
												/>
											) : null}
										</Actions>
									</Card>
								</Animated.View>
							))}
							<Button
								variant="ghost"
								label={showRead ? t`Hide read` : t`Show read`}
								onPress={() => setShowRead(!showRead)}
							/>
							{attention.map(({ row, step }) => {
								const text = describeNextStep(step, row, time.locale, time.timeZone);
								return (
									<Card key={row.id} style={{ gap: space.s3 }}>
										<Text variant="title">{text.title}</Text>
										{text.sub ? <Text>{text.sub}</Text> : null}
										<Text variant="caption" color="ink3">
											{row.company} · {row.role}
										</Text>
										<Button
											variant="secondary"
											label={t`Open workspace`}
											onPress={() =>
												router.push(routes.application(row.id, step.kind === "interview" ? "prepare" : "messages"))
											}
										/>
									</Card>
								);
							})}
						</Section>
						<View
							onLayout={(event) => {
								rolesY.current = event.nativeEvent.layout.y;
							}}
						>
							<Section title={t`New roles from your search`}>
								<Text color="ink3">{t`Nothing is applied for or created until you choose.`}</Text>
								<LoadState query={queries.opportunities} />
								{!queries.opportunities.isPending && !queries.opportunities.isError && roles.length === 0 ? (
									<>
										<Text>
											{discovery
												? discovery.enabled
													? t`No new roles. Discovery runs again at ${time.when(discovery.nextRunAt)}.`
													: t`No new roles. Discovery is paused.`
												: t`Get new roles here every morning`}
										</Text>
										<Button
											variant="secondary"
											label={discovery ? t`Open the schedule` : t`Set up discovery`}
											onPress={() =>
												discovery ? openSchedule(discovery) : setSheet({ schedule: null, kind: "discovery" })
											}
										/>
									</>
								) : null}
								{roles.length ? (
									<Actions>
										<Button
											variant="ghost"
											label={t`Select all roles`}
											disabled={action.pending}
											onPress={() => setSelected(selection.length === roles.length ? [] : roles.map((row) => row.id))}
										/>
										<Text>{t`${i18n.number(selection.length)} selected`}</Text>
										<Button
											variant="secondary"
											label={t`Track selected`}
											disabled={!selection.length || action.pending}
											onPress={() => bulk("track")}
										/>
										<Button
											variant="ghost"
											label={t`Dismiss selected`}
											disabled={!selection.length || action.pending}
											onPress={() => bulk("dismiss")}
										/>
									</Actions>
								) : null}
								{bulkStatus ? <Text accessibilityLiveRegion="polite">{bulkStatus}</Text> : null}
								{(expanded ? roles : roles.slice(0, 5)).map((row) => (
									<Card key={row.id} style={{ gap: space.s3 }}>
										<SwitchRow
											label={t`Select ${row.role}`}
											value={selection.includes(row.id)}
											disabled={action.pending}
											onValueChange={(on) =>
												setSelected((current) =>
													on ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id),
												)
											}
										/>
										<Text variant="title">{row.role}</Text>
										<Text color="ink2">{[row.company, row.location].filter(Boolean).join(" · ")}</Text>
										<Text variant="caption" color="ink3">{t`Found ${time.when(row.firstSeenAt)}`}</Text>
										<Text>{row.snippet}</Text>
										<Text color="ink3">
											{t`Source: ${new URL(row.url).hostname}`} · {t`Last seen in search: ${time.when(row.lastSeenAt)}`}
										</Text>
										<Text color="ink3">
											{row.discoverySource
												? t`Found for “${row.discoverySource.query}”. Posting checked ${time.when(row.discoverySource.checkedAt)}.`
												: t`Earlier discovery result. Search query and posting check time unknown.`}
										</Text>
										<Text color="ink3">{t`Postings can change or close. Publication date unknown; search coverage is incomplete.`}</Text>
										<Text>
											{row.matches.length
												? t`Preference phrase matches: ${row.matches.join(" · ")}`
												: t`No current target-role or location phrase matches.`}
										</Text>
										<Text color="ink3">{t`Keyword overlap: ${(row.keywordOverlap ?? []).join(" · ") || t`None`}`}</Text>
										<Text color="ink3">{t`Phrase and keyword matches are text overlap, not verified salary, workplace or eligibility. AI fit has not been assessed. Track, then open Fit for an optional assessment.`}</Text>
										<Actions>
											{row.matches.map((match) => (
												<Chip key={match} label={match} />
											))}
											{row.unknowns.map((unknown) => (
												<Chip
													key={unknown}
													label={unknown === "salary" ? t`Salary not detected` : t`Workplace arrangement unknown`}
												/>
											))}
										</Actions>
										<Actions>
											<Button
												variant="secondary"
												label={t`Track in Applications`}
												disabled={action.pending}
												onPress={() =>
													undo.remove(
														row.id,
														t`Saved to Applications with the posting`,
														() => prepareRpc(client.career.trackOpportunity, { id: row.id }),
														orpc.career.opportunities.key(),
													)
												}
											/>
											<Button
												variant="ghost"
												label={t`Read posting`}
												onPress={() => {
													if (/^https?:\/\//i.test(row.url))
														void openBrowserAsync(row.url).catch(() =>
															showToast({ message: t`Couldn't open the posting. Try again.` }),
														);
												}}
											/>
											<Button
												variant="ghost"
												label={t`Not for me`}
												disabled={action.pending}
												onPress={() =>
													undo.remove(
														row.id,
														t`Hidden from New roles`,
														() => prepareRpc(client.career.dismissOpportunity, { id: row.id }),
														orpc.career.opportunities.key(),
													)
												}
											/>
										</Actions>
									</Card>
								))}
								{!expanded && roles.length > 5 ? (
									<Button variant="ghost" label={t`Show more`} onPress={() => setExpanded(true)} />
								) : null}
							</Section>
						</View>
					</View>
					<View style={{ flex: tablet ? 1 : 0, gap: space.s4 }}>
						<Section title={t`Schedules`}>
							<Button
								variant="secondary"
								label={t`Add schedule`}
								onPress={() => setSheet({ schedule: null, kind: "discovery" })}
							/>
							<LoadState query={queries.schedules} />
							{!queries.schedules.isError && !queries.schedules.isPending && schedules.length === 0 ? (
								<EmptyState variant="compact" title={t`Nothing scheduled yet.`} />
							) : null}
							{schedules.map((row) => (
								<Card key={row.id} style={{ gap: space.s3 }}>
									<Text variant="title">{scheduleTitle(row.kind)}</Text>
									<Text>
										{row.kind === "follow-up"
											? [
													applications.data?.find((application) => application.id === row.applicationId)?.company,
													row.query,
												]
													.filter(Boolean)
													.join(" · ")
											: row.query ||
												applications.data?.find((application) => application.id === row.applicationId)?.company}
									</Text>
									{/* A one-off's queued run goes by its outcome: running or retrying, failed after its last try, or done. */}
									<Text color={row.lastRun?.status === "failed" ? "dangerText" : "ink3"}>
										{row.lastRun?.status === "failed"
											? row.intervalDays
												? t`Last run failed`
												: t`Failed · open to check it`
											: !row.intervalDays && row.lastQueuedAt
												? row.lastRun?.status === "queued" || row.lastRun?.status === "running"
													? t`Running`
													: t`Done`
												: row.enabled
													? t`On`
													: t`Paused`}{" "}
										· {time.when(row.nextRunAt)}
									</Text>
									{row.intervalDays ? (
										<Text color="ink3">
											{plural(row.intervalDays, { one: "Every day", other: "Every # days" })} · {row.timezone}
										</Text>
									) : null}
									<SwitchRow
										label={scheduleTitle(row.kind)}
										value={row.enabled}
										disabled={action.pending}
										onValueChange={(enabled) => toggle(row, enabled)}
									/>
									<Button label={t`Edit`} variant="ghost" onPress={() => openSchedule(row)} />
								</Card>
							))}
							<Text
								variant="callout"
								color="ink3"
							>{t`Results appear in Needs you. Email copies are optional and need a verified address.`}</Text>
						</Section>
					</View>
				</View>
			</ScrollView>
			{sheet ? (
				<ScheduleSheet
					key={sheet.schedule?.id ?? "new"}
					{...sheet}
					onClose={() => setSheet(null)}
					onDelete={(id) =>
						undo.remove(
							id,
							t`Schedule deleted`,
							() => prepareRpc(client.career.deleteSchedule, { id }),
							orpc.career.schedules.key(),
						)
					}
				/>
			) : null}
		</Screen>
	);
}
