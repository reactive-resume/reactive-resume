// The frame around every workspace tab, ported from apps/web/src/features/career/workspace/shell.tsx: header, tab
// strip with badges, the read-only banner for a saved version, loading and failure states, the Coach sheet and the
// interview editor. The context column (next step, what you sent, notes) is the Details screen on mobile.
import type { SavedItem } from "./hooks";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { WORKSPACE_TABS } from "@reactive-resume/schema/career";
import { CoachSheet } from "./coach-sheet";
import { useSavedItems, useWorkspace } from "./hooks";
import { currentInterview, minutesUntil } from "./logic";
import { useNow, useUserTime } from "@/features/application-detail/hooks";
import { InterviewSheet } from "@/features/application-detail/interview-sheet";
import { applicationError } from "@/features/applications/error";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { getLaneLabel, resolveLane } from "@/features/applications/lanes";
import { useApplication } from "@/features/applications/queries";
import { routes } from "@/routes";
import { useWorkspaceChrome } from "@/shell/workspace-chrome";
import { Banner, Button, EmptyState, Screen, Text, useTheme } from "@/ui";
import { useKeyboardScrollSpace } from "@/ui/keyboard";

export type WorkspaceSearch = { version?: string; speak?: boolean; story?: string };

/** What every tab receives: the application, and a saved version to show read-only ("Open in Prepare"). */
export type WorkspaceTabProps = {
	application: Application;
	/** A saved item opened from Saved: the tab shows it read-only with "Back to current". */
	version: SavedItem | undefined;
	/** The next interview still to come, or the most recent one if it just ended. */
	interview: InterviewTimelineEntry | undefined;
	/** Practise: open with Speak selected. */
	speak: boolean;
	/** Practise: a story from Knowledge to practise. */
	story: string | undefined;
	now: Date;
	go: (tab: WorkspaceTab, search?: WorkspaceSearch) => void;
	/** Opens the interview editor for a new round. */
	addInterview: () => void;
};

const archiveKinds = {
	fit: "fit",
	apply: "answers",
	prepare: "briefing",
	practise: "practice",
	debrief: "debrief",
	messages: "reply",
	saved: null,
} satisfies Record<WorkspaceTab, SavedItem["data"]["kind"] | null>;

/** `/applications/<id>/<tab>?version=…&speak=1&story=…` */
export function workspaceHref(id: string, tab: WorkspaceTab, search: WorkspaceSearch = {}) {
	const query = [
		search.version ? `version=${encodeURIComponent(search.version)}` : "",
		search.speak ? "speak=1" : "",
		search.story ? `story=${encodeURIComponent(search.story)}` : "",
	].filter(Boolean);
	return `${routes.application(id, tab)}${query.length > 0 ? `?${query.join("&")}` : ""}` as const;
}

type WorkspaceScreenProps = { tab: WorkspaceTab; children: (props: WorkspaceTabProps) => ReactNode };

export function WorkspaceScreen({ tab, children }: WorkspaceScreenProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const keyboardSpace = useKeyboardScrollSpace();
	const router = useRouter();
	const params = useLocalSearchParams<{ id: string; version?: string; speak?: string; story?: string }>();
	const id = params.id;
	const now = useNow();
	const query = useApplication(id);
	const saved = useSavedItems(id);
	const workspace = useWorkspace(id);
	const [coach, setCoach] = useState(false);
	const [addingInterview, setAddingInterview] = useState(false);
	const application = query.data;

	if (query.isPending)
		return (
			<Screen>
				<ActivityIndicator />
			</Screen>
		);
	if (!application)
		return (
			<Screen>
				<EmptyState
					icon="warning-circle"
					title={t`This application couldn't be opened.`}
					message={query.error ? applicationError(query.error) : undefined}
					action={{ label: t`Try again`, onPress: () => void query.refetch() }}
				/>
				<Button
					variant="secondary"
					label={t`Back to applications`}
					onPress={() => router.replace(routes.applications())}
				/>
			</Screen>
		);

	const interview = currentInterview(application.activity, now);
	const version = params.version ? saved.data?.find((item) => item.id === params.version) : undefined;
	const archived = params.version !== undefined;
	const archiveUnavailable = archived && (!version || version.data.kind !== archiveKinds[tab]);
	const waiting = saved.isPending || (!archived && tab !== "saved" && workspace.isPending);
	const failed =
		(saved.isError && saved.data === undefined) ||
		(!archived && tab !== "saved" && workspace.query.isError && workspace.query.data === undefined);
	const blocked = waiting || failed || archiveUnavailable;
	const go = (next: WorkspaceTab, search: WorkspaceSearch = {}) => router.push(workspaceHref(id, next, search));
	const backToCurrent = () => router.replace(workspaceHref(id, tab));
	const props: WorkspaceTabProps = {
		application,
		version,
		interview,
		now,
		go,
		speak: params.speak === "1",
		story: params.story,
		addInterview: () => setAddingInterview(true),
	};

	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen options={{ title: application.company }} />
			<Button
				label={t`Stage, details and timeline`}
				variant="secondary"
				onPress={() => router.push(routes.applicationDetails(application.id))}
			/>
			<KeyboardAwareScrollView
				extraKeyboardSpace={keyboardSpace}
				bottomOffset={space.s6}
				keyboardShouldPersistTaps="handled"
				contentInsetAdjustmentBehavior="automatic"
				contentContainerStyle={{ padding: space.s4, gap: space.s4, paddingBottom: space.s12 }}
			>
				<Header application={application} onAskCoach={() => setCoach(true)} />
				<TabBadges saved={saved.data} interview={interview} now={now} />
				{blocked ? (
					<View style={{ gap: space.s3 }}>
						{waiting ? (
							<View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: space.s2 }}>
								<ActivityIndicator />
								<Text color="ink2">{archived ? t`Loading saved version…` : t`Loading workspace…`}</Text>
							</View>
						) : (
							<Banner
								tone="danger"
								message={
									failed
										? archived
											? t`This saved version couldn't be loaded.`
											: t`This workspace couldn't be loaded.`
										: version
											? t`This saved version belongs to a different tab. Open it from Library.`
											: t`This saved version is no longer available.`
								}
							/>
						)}
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{failed ? (
								<Button
									variant="secondary"
									label={t`Try again`}
									onPress={() => {
										void saved.refetch();
										if (!archived) void workspace.query.refetch();
									}}
								/>
							) : null}
							{archived ? <Button variant="secondary" label={t`Back to current`} onPress={backToCurrent} /> : null}
						</View>
					</View>
				) : (
					<>
						{version ? (
							<Banner
								tone="info"
								icon="clock-counter-clockwise"
								message={t`You're looking at a saved version. It can't be edited.`}
								action={{ label: t`Back to current`, onPress: backToCurrent }}
							/>
						) : null}
						{children(props)}
					</>
				)}
			</KeyboardAwareScrollView>
			<CoachSheet application={application} tab={tab} open={coach} onClose={() => setCoach(false)} />
			<InterviewSheet
				application={application}
				interview={null}
				open={addingInterview}
				onClose={() => setAddingInterview(false)}
			/>
		</View>
	);
}

type HeaderProps = { application: Application; onAskCoach: () => void };

function Header({ application, onAskCoach }: HeaderProps) {
	const saved = useSavedItems(application.id);
	const lanes = useApplicationLanes();
	const { t } = useLingui();
	const { radius, space } = useTheme();
	const router = useRouter();
	const { day } = useUserTime();
	useWorkspaceChrome({ title: application.company, subtitle: application.role });
	const role = application.role;
	const company = application.company;
	const meta = [
		application.location,
		application.status !== "saved" && application.appliedAt ? t`Applied ${day(application.appliedAt)}` : "",
	].filter(Boolean);

	return (
		<View style={{ gap: space.s3 }}>
			<View style={{ gap: space.s1 }}>
				<Text variant="heading" accessibilityRole="header">
					{t`${role} · ${company}`}
				</Text>
				<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>
					<View
						style={{
							width: 8,
							height: 8,
							borderRadius: radius.rSm,
							backgroundColor: resolveLane(lanes.lanes, application).color,
						}}
					/>
					<Text variant="callout">{getLaneLabel(resolveLane(lanes.lanes, application))}</Text>
					{meta.map((item) => (
						<Text key={item} variant="callout" color="ink2">
							· {item}
						</Text>
					))}
				</View>
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button icon="sparkle" label={t`Ask the coach`} onPress={onAskCoach} />
				{application.status === "offer" ? (
					<Button
						variant="secondary"
						icon="scales"
						label={t`Compare offers`}
						loading={saved.isPending}
						disabled={saved.isPending || saved.isError || !saved.data}
						onPress={() =>
							router.push({
								pathname: routes.career("offers"),
								params: { a: saved.data?.find((item) => item.data.kind === "offer")?.id },
							})
						}
					/>
				) : null}
			</View>
		</View>
	);
}

type TabBadgesProps = {
	saved: SavedItem[] | undefined;
	interview: InterviewTimelineEntry | undefined;
	now: Date;
};

/** WorkspaceChrome owns the one visible tab strip; keep its countdown, unread and saved-count badges. */
function TabBadges({ saved, interview, now }: TabBadgesProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const minutes = interview ? minutesUntil(new Date(interview.at), now) : null;
	// Messages shows the newest read message: it waits for a decision while its changes aren't applied.
	const newestReply = saved?.find((item) => item.data.kind === "reply");
	const unread =
		newestReply?.data.kind === "reply" && newestReply.data.changes.length > 0 && !newestReply.data.applied ? 1 : 0;
	const badge = (tab: WorkspaceTab) => {
		if (tab === "prepare" && minutes !== null && minutes > 0 && minutes < 7 * 24 * 60) {
			const hours = Math.round(minutes / 60);
			return { tone: minutes <= 60 ? "warn" : "accent", text: minutes <= 60 ? t`${minutes} min` : t`${hours} h` };
		}
		if (tab === "messages" && unread > 0) return { tone: "info", text: String(unread) };
		if (tab === "saved" && (saved?.length ?? 0) > 0) return { tone: "plain", text: String(saved?.length) };
		return null;
	};
	const badgeColors = {
		warn: { background: colors.warnSoft, text: "warnText" },
		accent: { background: colors.accentSoft, text: "accentText" },
		info: { background: colors.infoSoft, text: "infoText" },
		plain: { background: "transparent", text: "ink2" },
	} as const;

	useWorkspaceChrome({
		badges: Object.fromEntries(
			WORKSPACE_TABS.map((tab) => {
				const extra = badge(tab);
				const palette = extra ? badgeColors[extra.tone as keyof typeof badgeColors] : null;
				return [
					tab,
					extra && palette ? (
						<View
							key={tab}
							style={{ paddingHorizontal: space.s1, borderRadius: radius.rLg, backgroundColor: palette.background }}
						>
							<Text variant="micro" color={palette.text}>
								{extra.text}
							</Text>
						</View>
					) : null,
				];
			}),
		),
	});
	return null;
}
