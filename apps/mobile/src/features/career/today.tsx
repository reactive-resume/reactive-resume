import type { Schedule } from "./hooks";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { type ComponentRef, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { client, useCareerAction, useCareerTime, useNow, useTodayQueries, useUndoRows } from "./hooks";
import { ScheduleSheet, scheduleTitle } from "./schedule-sheet";
import { collectInterviews, rollForward } from "./scheduling";
import { Actions, LoadState, Section, SwitchRow } from "./shared";
import { getNextStep } from "@/features/applications/next-step";
import { useApplications } from "@/features/applications/queries";
import { getStageLabel } from "@/features/applications/stages";
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
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

export function TodayScreen() {
	const { t } = useLingui();
	const { colors, space, size } = useTheme();
	const [width, setWidth] = useState(0);
	const tablet = width >= size.panel * 2 + space.s6;
	const router = useRouter();
	const now = useNow();
	const time = useCareerTime();
	const queries = useTodayQueries();
	const applications = useApplications();
	const action = useCareerAction();
	const pull = usePullRefresh(action.refresh, applications.refetch, time.profile.refetch);
	const undo = useUndoRows();
	const [sheet, setSheet] = useState<{ schedule: Schedule | null; kind: "discovery" | "prepare" | "follow-up" } | null>(
		null,
	);
	const [showRead, setShowRead] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	const rolesY = useRef(0);
	const groupY = useRef(0);
	const columnY = useRef(0);
	const interviews = collectInterviews(applications.data ?? [], now);
	const next = interviews[0];
	const schedules = (queries.schedules.data ?? []).filter((row) => !undo.hidden.includes(row.id));
	const discovery =
		schedules.find((row) => row.kind === "discovery" && row.enabled) ??
		schedules.find((row) => row.kind === "discovery");
	const roles = (queries.opportunities.data ?? [])
		.filter((row) => !row.trackedApplicationId && !undo.hidden.includes(row.id))
		.sort(
			(a, b) =>
				b.matches.length - a.matches.length || new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
		);
	const notes = (queries.notifications.data ?? []).filter(
		(row) => showRead || (!row.readAt && !undo.hidden.includes(row.id)),
	);
	const firstAppearance = useFirstAppearance(!queries.notifications.isPending);
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
							{next ? (
								<Card style={{ gap: space.s3 }}>
									<Text variant="title">
										{next.application.company} ·{" "}
										{next.interview.kind === "technical"
											? t`Technical interview`
											: next.interview.kind === "screening"
												? t`Screening interview`
												: next.interview.kind === "behavioral"
													? t`Behavioral interview`
													: next.interview.kind === "onsite"
														? t`Onsite interview`
														: t`Interview`}
									</Text>
									<Text>{time.when(next.start)}</Text>
									<Text color="ink3">
										{getStageLabel(next.application.status)} ·{" "}
										{new Intl.NumberFormat(time.locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(
											next.interview.durationMinutes,
										)}
									</Text>
									{queries.briefings.data?.some((row) => row.interviewId === next.interview.id) ? (
										<Chip label={t`Briefing ready`} />
									) : null}
									<Button
										variant="secondary"
										label={t`Open workspace`}
										onPress={() => router.push(routes.application(next.application.id, "prepare"))}
									/>
								</Card>
							) : !applications.isPending && !applications.isError ? (
								<Text color="ink3">{t`No upcoming interviews.`}</Text>
							) : null}
						</Section>
						<Section title={t`Needs you`}>
							<LoadState query={queries.notifications} />
							{!queries.notifications.isPending && !queries.notifications.isError && notes.length === 0 ? (
								<EmptyState
									title={t`You're up to date`}
									message={t`New roles, reminders and finished briefings appear here.`}
								/>
							) : null}
							{notes.map((row, index) => (
								<Animated.View key={row.id} {...listItemMotion(index, firstAppearance)} layout={listLayout}>
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
														undo.remove(row.id, t`Marked as read`, () =>
															client.career.markNotificationRead({ id: row.id }),
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
							{(applications.data ?? [])
								.filter((row) => getNextStep(row, now).kind === "no-reply")
								.map((row) => (
									<Card key={row.id} style={{ gap: space.s3 }}>
										<Text>
											{row.company} · {t`No reply yet`}
										</Text>
										<Button
											variant="secondary"
											label={t`Review draft`}
											onPress={() => router.push(routes.application(row.id, "messages"))}
										/>
									</Card>
								))}
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
								{(expanded ? roles : roles.slice(0, 5)).map((row) => (
									<Card key={row.id} style={{ gap: space.s3 }}>
										<Text variant="title">{row.role}</Text>
										<Text color="ink2">{[row.company, row.location].filter(Boolean).join(" · ")}</Text>
										<Text variant="caption" color="ink3">{t`Found ${time.when(row.firstSeenAt)}`}</Text>
										<Text>{row.snippet}</Text>
										<Actions>
											{row.matches.map((match) => (
												<Chip key={match} label={match} />
											))}
											{row.unknowns.map((unknown) => (
												<Chip
													key={unknown}
													label={unknown === "salary" ? t`Salary not listed` : t`Office days not stated`}
												/>
											))}
										</Actions>
										<Actions>
											<Button
												variant="secondary"
												label={t`Track in Applications`}
												disabled={action.pending}
												onPress={() =>
													undo.remove(row.id, t`Saved to Applications with the posting`, async () => {
														await client.career.trackOpportunity({ id: row.id });
													})
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
												onPress={() =>
													undo.remove(row.id, t`Hidden from New roles`, () =>
														client.career.dismissOpportunity({ id: row.id }),
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
								<Text color="ink3">{t`Nothing scheduled yet.`}</Text>
							) : null}
							{schedules.map((row) => (
								<Card key={row.id} style={{ gap: space.s3 }}>
									<Text variant="title">{scheduleTitle(row.kind)}</Text>
									<Text>
										{row.query ||
											applications.data?.find((application) => application.id === row.applicationId)?.company}
									</Text>
									<Text color="ink3">
										{!row.intervalDays && row.lastQueuedAt ? t`Done` : row.enabled ? t`On` : t`Paused`} ·{" "}
										{time.when(row.nextRunAt)}
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
							>{t`Reminders appear here. Email copies are optional and need a verified address.`}</Text>
						</Section>
					</View>
				</View>
			</ScrollView>
			{sheet ? (
				<ScheduleSheet
					key={sheet.schedule?.id ?? "new"}
					{...sheet}
					onClose={() => setSheet(null)}
					onDelete={(id) => undo.remove(id, t`Schedule deleted`, () => client.career.deleteSchedule({ id }))}
				/>
			) : null}
		</Screen>
	);
}
