import type { CalendarEvent } from "./calendar";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, Pressable, ScrollView, View } from "react-native";
import {
	collectEvents,
	dateOfKey,
	dayKeyOf,
	groupByDay,
	monthGrid,
	shiftMonth,
	upcomingEvents,
	weekStartsOn,
} from "./calendar";
import { useApplicationSearch } from "./search";
import { ApplicationsViewFrame } from "./views";
import { interviewTypeLabel, useNow, useUserTime } from "@/features/application-detail/hooks";
import { InterviewSheet } from "@/features/application-detail/interview-sheet";
import { FollowUpSheet } from "@/features/application-detail/sheets";
import { applicationError } from "@/features/applications/error";
import { filterApplications } from "@/features/applications/list";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { useIsTablet } from "@/shell/use-is-tablet";
import { Banner, Button, Card, EmptyState, IconButton, SelectSheet, Sheet, Skeleton, Text, useTheme } from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

// Chips per day cell on tablet before "+N more"; phone cells show up to this many dots.
const MAX_PER_DAY = 3;

type Editing =
	| { kind: "interview"; application: Application; interview: InterviewTimelineEntry | null }
	| { kind: "follow-up"; application: Application };

export function CalendarScreen() {
	return (
		<ApplicationsViewFrame current="calendar">
			<ApplicationCalendar />
		</ApplicationsViewFrame>
	);
}

/**
 * Interviews and follow-ups by day on the user's clock (profile timezone), a day's agenda and what's coming up.
 * Tablet puts the agenda beside the month; phone stacks it below.
 */
function ApplicationCalendar() {
	const { t, i18n } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const tablet = useIsTablet();
	const [width, setWidth] = useState(0);
	const query = useApplications();
	const pull = usePullRefresh(query.refetch);
	const { search } = useApplicationSearch();
	const userTime = useUserTime();
	const now = useNow();
	const timeZone = userTime.timeZone;
	const today = dayKeyOf(now, timeZone);
	const [month, setMonth] = useState(() => ({
		year: Number(today.slice(0, 4)),
		month: Number(today.slice(5, 7)) - 1,
	}));
	const [selected, setSelected] = useState(today);
	const [picking, setPicking] = useState(false);
	const [pickedId, setPickedId] = useState<string | null>(null);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);

	const applications = filterApplications(query.data ?? [], { search, tag: "", showClosed: true });
	const open = applications.filter((application) => application.status !== "closed");
	const events = collectEvents(applications, timeZone);
	const byDay = groupByDay(events);
	const upcoming = [...groupByDay(upcomingEvents(events, now, today))];
	const days = monthGrid(month.year, month.month, weekStartsOn(i18n.locale));
	const monthPrefix = `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
	const monthInterviews = events.filter(
		(event) => event.kind === "interview" && event.day.startsWith(monthPrefix),
	).length;
	const isThisMonth = today.startsWith(monthPrefix);

	const utc = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(i18n.locale, { timeZone: "UTC", ...options });
	const monthTitle = utc({ month: "long", year: "numeric" }).format(Date.UTC(month.year, month.month, 1));
	const weekday = utc({ weekday: "narrow" });
	const weekdayLong = utc({ weekday: "long" });
	const fullDay = utc({ weekday: "long", day: "numeric", month: "long" });
	const tomorrow = new Date(dateOfKey(today).getTime() + 86_400_000).toISOString().slice(0, 10);
	const dayHeading = (key: string) =>
		key === today ? t`Today` : key === tomorrow ? t`Tomorrow` : fullDay.format(dateOfKey(key));

	const edit = (next: Editing) => {
		setEditing(next);
		setEditorOpen(true);
	};
	const schedule = () => {
		setPickedId(open[0]?.id ?? null);
		setPicking(true);
	};

	if (query.isError) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Banner tone="warn" message={applicationError(query.error)} />
				<Button label={t`Retry loading applications`} onPress={() => void query.refetch()} />
			</View>
		);
	}
	if (query.isPending) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Skeleton height={space.s12} />
				<Skeleton height={space.s12 * 4} />
			</View>
		);
	}

	const selectedEvents = byDay.get(selected) ?? [];
	const agenda = (
		<View style={{ gap: space.s4 }}>
			<View style={{ gap: space.s2 }}>
				<Text variant="title" accessibilityRole="header">
					{dayHeading(selected)}
				</Text>
				{selectedEvents.length === 0 ? (
					<Text color="ink3">{t`Nothing on this day.`}</Text>
				) : (
					selectedEvents.map((event) => <EventCard key={event.id} event={event} onEdit={edit} />)
				)}
			</View>
			<View style={{ gap: space.s2 }}>
				<Text variant="title" accessibilityRole="header">
					{t`Coming up`}
				</Text>
				{upcoming.length === 0 ? (
					<EmptyState
						icon="calendar-blank"
						title={t`Nothing scheduled yet`}
						message={t`Add screening calls and technical interviews to see them here and on the calendar.`}
						action={open.length ? { label: t`Schedule interview`, onPress: schedule } : undefined}
					/>
				) : (
					upcoming.map(([day, items]) => (
						<View key={day} style={{ gap: space.s2 }}>
							<Text variant="caption" color="ink3">
								{dayHeading(day)}
							</Text>
							{items.map((event) => (
								<EventCard key={event.id} event={event} onEdit={edit} />
							))}
						</View>
					))
				)}
			</View>
		</View>
	);

	const grid = (
		<View style={{ gap: space.s3 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
				<View style={{ flex: 1 }}>
					<Text variant="heading" accessibilityRole="header">
						{monthTitle}
					</Text>
					<Text variant="callout" color="ink3">
						{plural(monthInterviews, { 0: "No interviews", one: "# interview", other: "# interviews" })}
					</Text>
				</View>
				<IconButton
					icon="caret-left"
					label={t`Previous month`}
					onPress={() => setMonth(shiftMonth(month.year, month.month, -1))}
				/>
				<IconButton
					icon="caret-right"
					label={t`Next month`}
					onPress={() => setMonth(shiftMonth(month.year, month.month, 1))}
				/>
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button
					variant="secondary"
					size="sm"
					label={t`This month`}
					disabled={isThisMonth}
					onPress={() => {
						setMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
						setSelected(today);
					}}
				/>
				<Button
					size="sm"
					icon="calendar-plus"
					label={t`Schedule interview`}
					disabled={!open.length}
					onPress={schedule}
				/>
			</View>
			<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.rLg, overflow: "hidden" }}>
				<View style={{ flexDirection: "row" }} importantForAccessibility="no-hide-descendants">
					{days.slice(0, 7).map((day) => (
						<Text
							key={day.key}
							variant="micro"
							color="ink3"
							align="center"
							accessibilityElementsHidden
							style={{ flex: 1, paddingVertical: space.s2 }}
						>
							{weekday.format(dateOfKey(day.key))}
						</Text>
					))}
				</View>
				{Array.from({ length: 6 }, (_, week) => (
					<View key={week} style={{ flexDirection: "row" }}>
						{days.slice(week * 7, week * 7 + 7).map((day) => {
							const items = byDay.get(day.key) ?? [];
							const interviews = items.filter((event) => event.kind === "interview").length;
							const followUps = items.length - interviews;
							const isToday = day.key === today;
							const isSelected = day.key === selected;
							const summary = [
								interviews ? plural(interviews, { one: "# interview", other: "# interviews" }) : "",
								followUps ? plural(followUps, { one: "# follow-up", other: "# follow-ups" }) : "",
							]
								.filter(Boolean)
								.join(", ");
							return (
								<Pressable
									key={day.key}
									accessibilityRole="button"
									accessibilityState={{ selected: isSelected }}
									accessibilityLabel={`${weekdayLong.format(dateOfKey(day.key))} ${fullDay.format(dateOfKey(day.key))}${summary ? `: ${summary}` : ""}`}
									onPress={() => setSelected(day.key)}
									style={{
										flex: 1,
										minHeight: tablet ? size.hit * 2 : size.hit,
										padding: space.s1,
										gap: space.s0,
										alignItems: tablet ? "stretch" : "center",
										borderTopWidth: 1,
										borderColor: colors.line,
										backgroundColor: isSelected
											? colors.selectedFill
											: items.length
												? colors.accentSoft
												: day.inMonth
													? colors.surface
													: colors.sunken,
									}}
								>
									<View
										style={{
											alignSelf: tablet ? "flex-end" : "center",
											minWidth: space.s6,
											minHeight: space.s6,
											borderRadius: radius.rLg,
											alignItems: "center",
											justifyContent: "center",
											backgroundColor: isToday ? colors.accent : "transparent",
										}}
									>
										<Text
											variant={items.length ? "label" : "callout"}
											color={isToday ? "onAccent" : day.inMonth ? (items.length ? "accentText" : "ink") : "ink3"}
										>
											{day.day}
										</Text>
									</View>
									{tablet ? (
										<>
											{items.slice(0, MAX_PER_DAY).map((event) => (
												<Text key={event.id} variant="micro" numberOfLines={1} color="ink2">
													{event.kind === "interview" ? `${userTime.time(event.start)} ` : ""}
													{event.application.company}
												</Text>
											))}
											{items.length > MAX_PER_DAY ? (
												<Text variant="micro" color="ink3">
													{t`+${items.length - MAX_PER_DAY} more`}
												</Text>
											) : null}
										</>
									) : (
										<View style={{ flexDirection: "row", gap: space.s0 }}>
											{items.slice(0, MAX_PER_DAY).map((event) => (
												<View
													key={event.id}
													style={{
														width: space.s1,
														height: space.s1,
														borderRadius: radius.rLg,
														backgroundColor: event.kind === "interview" ? colors.accent : colors.warn,
													}}
												/>
											))}
										</View>
									)}
								</Pressable>
							);
						})}
					</View>
				))}
			</View>
			<View style={{ flexDirection: "row", gap: space.s4 }} accessibilityElementsHidden>
				<Legend color={colors.accent} label={t`Interview`} />
				<Legend color={colors.warn} label={t`Follow-up`} />
			</View>
		</View>
	);

	return (
		<View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
			{tablet && width >= size.panel * 2 + space.s6 + space.s4 * 2 ? (
				<View style={{ flex: 1, flexDirection: "row", gap: space.s6, paddingHorizontal: space.s4 }}>
					<ScrollView
						alwaysBounceVertical
						refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
						style={{ flex: 1 }}
						contentContainerStyle={{ paddingVertical: space.s4 }}
					>
						{grid}
					</ScrollView>
					<ScrollView
						alwaysBounceVertical
						refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
						style={{ width: size.panel, flexGrow: 0 }}
						contentContainerStyle={{ paddingVertical: space.s4 }}
					>
						{agenda}
					</ScrollView>
				</View>
			) : (
				<ScrollView
					alwaysBounceVertical
					refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
					contentContainerStyle={{ padding: space.s4, gap: space.s6 }}
				>
					{grid}
					{agenda}
				</ScrollView>
			)}
			<Sheet open={picking} onClose={() => setPicking(false)} title={t`Schedule an interview`}>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<SelectSheet
						label={t`Application`}
						value={pickedId}
						placeholder={t`Choose an application`}
						options={open.map((application) => ({
							value: application.id,
							label: `${application.company} · ${application.role}`,
						}))}
						onChange={setPickedId}
					/>
					<Button
						fullWidth
						label={t`Continue`}
						disabled={!pickedId}
						onPress={() => {
							const application = open.find((item) => item.id === pickedId);
							setPicking(false);
							// The picker leaves before the interview editor takes its place.
							if (application) setTimeout(() => edit({ kind: "interview", application, interview: null }), 0);
						}}
					/>
				</View>
			</Sheet>
			{editing?.kind === "interview" ? (
				<InterviewSheet
					application={editing.application}
					interview={editing.interview}
					open={editorOpen}
					onClose={() => setEditorOpen(false)}
				/>
			) : null}
			{editing?.kind === "follow-up" ? (
				<FollowUpSheet application={editing.application} open={editorOpen} onClose={() => setEditorOpen(false)} />
			) : null}
		</View>
	);
}

type LegendProps = { color: string; label: string };

function Legend({ color, label }: LegendProps) {
	const { radius, space } = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
			<View style={{ width: space.s2, height: space.s2, borderRadius: radius.rLg, backgroundColor: color }} />
			<Text variant="caption" color="ink3">
				{label}
			</Text>
		</View>
	);
}

type EventCardProps = { event: CalendarEvent; onEdit: (editing: Editing) => void };

/** One interview or follow-up: tap to edit it, or open its application. */
function EventCard({ event, onEdit }: EventCardProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const userTime = useUserTime();
	const { application } = event;
	const interview = event.kind === "interview" ? event.interview : null;
	const otherZone = interview && interview.timezone !== userTime.timeZone ? interview.timezone : null;
	const when = event.kind === "interview" ? `${userTime.time(event.start)} – ${userTime.time(event.end)}` : "";
	const title =
		event.kind === "interview"
			? t`${interviewTypeLabel(event.interview.kind)} interview · ${event.interview.durationMinutes} min`
			: application.followUpNote || t`Follow up`;

	return (
		<Card style={{ borderStartWidth: space.s1, borderStartColor: interview ? colors.accent : colors.warn }}>
			<Pressable
				accessibilityRole="button"
				accessibilityHint={interview ? t`Edit interview` : t`Change the follow-up`}
				onPress={() =>
					onEdit(
						event.kind === "interview"
							? { kind: "interview", application, interview: event.interview }
							: { kind: "follow-up", application },
					)
				}
				style={{ gap: space.s0 }}
			>
				{when ? <Text variant="label">{when}</Text> : null}
				{otherZone && interview ? (
					<Text variant="caption" color="ink3">
						{t`${userTime.time(interview.at, otherZone)} in ${otherZone}`}
					</Text>
				) : null}
				<Text variant="label" numberOfLines={1}>
					{application.company}
				</Text>
				<Text variant="callout" color="ink2" numberOfLines={2}>
					{title} · {application.role}
				</Text>
				{interview?.location ? (
					<Text variant="caption" color="ink3" numberOfLines={1}>
						{interview.location}
					</Text>
				) : null}
			</Pressable>
			<View style={{ flexDirection: "row" }}>
				<Button
					variant="link"
					size="sm"
					label={t`View application`}
					onPress={() => router.push(routes.applicationDetails(application.id))}
				/>
			</View>
		</Card>
	);
}
