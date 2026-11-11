import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { AccountAvatar, CollectionState, DocumentPlaceholders, useOpenDocument } from "../documents/shared";
import { zoneCity } from "../settings/PreferencesScreen";
import { chooseHero, todaySteps } from "./model";
import { useSession } from "@/auth/session";
import {
	completeStep,
	isStepComplete,
	undoStep,
	usePlatformActions,
	useAccount,
	useCareerSchedules,
	useDataBackend,
	useDocuments,
	useToday,
	useTravelNotice,
} from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	SwipeRow,
	BottomSheet,
	Checkbox,
	showToast,
	Card,
	DocThumb,
	HeroCard,
	Icon,
	IconButton,
	ListRow,
	Monogram,
	RowDate,
	SectionHeading,
	StageDot,
	TabScreen,
	Text,
	TextLink,
	motion,
	useFadeUp,
} from "@/ui";
import { curve } from "@/ui/motion";

/** Two-letter company mark: first letters of the first two words, or the first two letters of one word. */
const monogram = (company: string) => {
	const words = company.split(/\s+/).filter(Boolean);
	return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : company.slice(0, 2)).toUpperCase();
};

type FirstRunPartProps = { index: number; children: ReactNode };
function FirstRunPart({ index, children }: FirstRunPartProps) {
	const style = useFadeUp({
		px: motion.fadeUpFirstRun,
		ms: motion.d3,
		delay: index * motion.stagger.firstRun,
		easing: curve.easeOutStrong,
	});
	return <Animated.View style={style}>{children}</Animated.View>;
}

export function TodayScreen() {
	const today = useToday();
	const actions = usePlatformActions();
	const [selectingRoles, setSelectingRoles] = useState(false);
	const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
	const [roleId, setRoleId] = useState<string>();
	const selectedRole = today.model.newRoles.find((role) => role.id === roleId);
	const documents = useDocuments();
	const account = useAccount();
	const schedules = useCareerSchedules();
	const session = useSession();
	const { backend } = useDataBackend();
	const router = useRouter();
	const openDocument = useOpenDocument();
	const fake = backend.kind === "fake";
	// Storyboard flows reach T1's states: `preset=up-to-date`, `discovery-off`, `discovery-paused` or `offline`.
	const { preset: presetParam } = useLocalSearchParams<{ preset?: string }>();
	const preset = STORYBOARD ? presetParam : undefined;
	const upToDate = preset === "up-to-date";
	// `preset=travel` puts the phone on Lisbon time for the travel notice (S3).
	const travel = useTravelNotice(preset === "travel" ? "Europe/Lisbon" : undefined);
	const moveSchedules = async () => {
		try {
			await actions.run("auth.updateProfile", { timezone: travel.current });
			await travel.move();
		} catch {
			showToast({ message: t`Couldn't save the timezone. Try again.` });
		}
	};
	const applications = (today.applications.data ?? []).map((app) =>
		fake && app.id === "fieldnote" ? { ...app, appliedAt: new Date("2026-10-28T08:00:00Z") } : app,
	);
	// Swiping a Needs-you row hides its step on this device (completeStep); the revision re-reads that local state.
	const [, setStepRevision] = useState(0);
	const steps = todaySteps(applications, today.offers.data ?? [], today.now, today.timeZone).filter(
		(item) => !isStepComplete({ applicationId: item.application.id, kind: item.step.kind }),
	);
	const completeNextStep = (applicationId: string, kind: string) => {
		try {
			const handle = completeStep({ applicationId, kind });
			setStepRevision((n) => n + 1);
			showToast({
				message: t`Marked done`,
				action: {
					label: t`Undo`,
					onPress: () => {
						try {
							undoStep(handle);
							setStepRevision((n) => n + 1);
						} catch {
							setFailure(true);
						}
					},
				},
			});
		} catch {
			setFailure(true);
		}
	};
	const notifications = today.model.notifications;
	const hasResume = !!documents.data?.some((document) => document.type === "resume");
	const firstRun =
		!today.applications.isPending &&
		!documents.isPending &&
		!today.applications.isError &&
		!documents.isError &&
		!applications.length &&
		!notifications.length &&
		(fake || today.firstRun.data === true);
	const hero = upToDate
		? undefined
		: fake
			? (steps.find((item) => item.application.id === "lumen") ?? chooseHero(steps, today.now))
			: today.model.hero;
	const needs = upToDate
		? []
		: fake
			? steps.filter((item) => item !== hero && item.step.kind !== "interview")
			: today.model.needsYou;
	const upcoming = upToDate ? [] : fake ? steps.filter((item) => item.step.kind === "interview") : today.model.comingUp;
	const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
		date.toLocaleDateString("en-GB", { ...options, timeZone: today.timeZone });
	const time = (date: Date) =>
		date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: today.timeZone });
	const refresh = () => {
		void today.applications.refetch();
		void today.notifications.refetch();
		void today.offers.refetch();
		void today.opportunities.refetch();
		void documents.refetch();
	};
	const savedDiscovery = schedules.data?.find((schedule) => schedule.kind === "discovery");
	const discovery =
		preset === "discovery-off"
			? undefined
			: preset === "discovery-paused" && savedDiscovery
				? { ...savedDiscovery, enabled: false }
				: savedDiscovery;
	const roles = preset?.startsWith("discovery-") ? [] : (today.opportunities.data ?? []);
	const guest = session.status === "guest";
	const [failure, setFailure] = useState(false);
	useEffect(() => {
		if (!fake && today.firstRun.data && (hasResume || applications.length)) void today.firstRun.complete();
	}, [fake, hasResume, applications.length, today.firstRun]);
	const undo = (id: string) => {
		void today.completion.undo(id).catch(() => setFailure(true));
	};
	const complete = async (id: string) => {
		try {
			await today.completion.complete(id);
			showToast({ message: t`Marked done`, action: { label: t`Undo`, onPress: () => undo(id) } });
		} catch {
			setFailure(true);
		}
	};
	return (
		<>
			<TabScreen
				title={t`Today`}
				subtitle={
					firstRun
						? t`Welcome, ${account.data?.name.split(" ")[0] ?? ""}.`
						: `${format(today.now, { weekday: "long" })}, ${format(today.now, { day: "numeric", month: "long" })}`
				}
				avatar={<AccountAvatar />}
				actions={
					firstRun ? undefined : (
						<IconButton icon="magnifying-glass" label={t`Search`} onPress={() => router.push("/search")} />
					)
				}
				refreshing={today.applications.isRefetching}
				onRefresh={refresh}
			>
				{today.connectivity.offline || preset === "offline" ? (
					<View style={{ padding: 24 }}>
						<Text variant="body">{t`Offline. Edits are saved on this device and sync when you reconnect.`}</Text>
					</View>
				) : null}
				{travel.show && travel.home ? (
					<Card style={{ marginHorizontal: 24, marginTop: 20 }}>
						<Text variant="body">
							{t`Your phone is on ${zoneCity(travel.current)} time. Schedules stay on ${zoneCity(travel.home)} time.`}
						</Text>
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button label={t`Move them`} tone="primary" onPress={() => void moveSchedules()} />
							<Button label={t`Keep ${zoneCity(travel.home)} time`} onPress={() => void travel.acknowledge()} />
						</View>
					</Card>
				) : null}
				{failure ? (
					<CollectionState
						message={t`Couldn't save your changes. Try again.`}
						action={t`Retry`}
						onPress={() => {
							void today.completion.refetch();
							setFailure(false);
						}}
					/>
				) : null}
				{guest ? (
					<Card style={{ marginHorizontal: 24, marginTop: 20 }}>
						<Text variant="label">{t`You're using a guest account`}</Text>
						<Text
							variant="body"
							color="ink2"
						>{t`Your work is lost when you sign out or the session ends. Create an account or sign in to keep your resumes, cover letters and applications.`}</Text>
						<Button label={t`Create account`} onPress={() => router.push("/register")} />
						<TextLink label={t`Sign in`} onPress={() => router.push("/sign-in")} />
					</Card>
				) : null}
				{today.applications.isError ? (
					<CollectionState message={t`Couldn't load Today. Try again.`} action={t`Retry`} onPress={refresh} />
				) : null}
				{today.applications.isPending || documents.isPending ? (
					<>
						<View style={{ margin: 24 }}>
							<DocumentPlaceholders />
						</View>
						<DocumentPlaceholders count={4} />
					</>
				) : firstRun ? (
					<>
						<FirstRunPart index={1}>
							<HeroCard
								keyLine={t`Start here`}
								title={t`Bring in your resume`}
								body={t`Import a PDF or Word file and we'll fill in every section. You can check each one after.`}
							>
								<Button
									label={t`Import a resume`}
									size="lg"
									tone="primary"
									block
									onPress={() => router.push("/import")}
								/>
								<View style={{ flexDirection: "row", justifyContent: "center", paddingTop: 12 }}>
									<TextLink label={t`Start from a template instead`} onPress={() => router.push("/new?kind=resume")} />
								</View>
							</HeroCard>
						</FirstRunPart>
						<FirstRunPart index={2}>
							<SectionHeading title={t`How it works`} />
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Bring your resume`}
								secondary={t`Import a file or start from a template`}
								leading={
									hasResume ? (
										<Icon name="check-circle" size={40} color="accentText" />
									) : (
										<Monogram letters="1" numeral />
									)
								}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Save a job you want`}
								secondary={t`Paste a link or share it from the browser`}
								leading={<Monogram letters="2" numeral />}
								onPress={hasResume ? () => router.push("/applications/new") : undefined}
							/>
							<ListRow
								wrapTitle
								wrapSecondary
								title={t`Tailor and apply`}
								secondary={t`Match the resume, write the letter, track it`}
								leading={<Monogram letters="3" numeral />}
								onPress={applications.length ? () => router.push("/applications") : undefined}
								last
								boxHidden
							/>
						</FirstRunPart>
					</>
				) : (
					<>
						{hero ? (
							<HeroCard
								keyLine={
									hero.step.kind === "interview"
										? `${format(hero.step.at, { weekday: "long", day: "numeric", month: "short" }).replace(",", "")} · ${time(hero.step.at)}`
										: hero.step.kind === "offer"
											? t`Offer deadline`
											: t`Needs you`
								}
								stage={hero.application.status}
								title={
									hero.step.kind === "interview"
										? t`Technical interview at ${hero.application.company}`
										: hero.step.kind === "offer"
											? t`Reply to ${hero.application.company}`
											: t`Follow up with ${hero.application.company}`
								}
								body={
									fake && hero.application.id === "lumen"
										? t`Your briefing is ready: likely questions, who you'll meet and three stories to tell.`
										: undefined
								}
							>
								<Button
									label={hero.step.kind === "interview" ? t`Open briefing` : t`Open application`}
									size="lg"
									tone="primary"
									block
									onPress={() =>
										router.push(
											`/applications/${hero.application.id}${hero.step.kind === "interview" ? "/prepare" : ""}`,
										)
									}
								/>
							</HeroCard>
						) : (
							<CollectionState
								message={t`You're up to date. New roles, reminders and finished briefings appear here.`}
							/>
						)}
						{needs.length || notifications.length ? (
							<>
								<SectionHeading title={t`Needs you`} />
								{needs.map(({ application, step }, index) => (
									<SwipeRow
										key={application.id}
										start={{
											key: "done",
											label: t`Done`,
											icon: "check",
											tone: "accent",
											onCommit: () => completeNextStep(application.id, step.kind),
										}}
									>
										<ListRow
											wrapTitle
											wrapSecondary
											key={application.id}
											title={
												step.kind === "offer"
													? t`Reply to ${application.company}`
													: t`Follow up with ${application.company}`
											}
											secondary={
												step.kind === "offer"
													? step.respondBy
														? t`Offer · by ${format(step.respondBy, { weekday: "long", day: "numeric", month: "short" }).replace(",", "")}`
														: t`Compare it with your other offers`
													: fake && application.id === "fieldnote"
														? t`Applied 28 Oct · a short note is fine now`
														: t`A short follow-up is usually fine now`
											}
											leading={<StageDot stage={application.status} />}
											trailing="caret"
											last={index === needs.length - 1 && !notifications.length}
											onPress={() =>
												router.push(
													step.kind === "offer" ? "/career/offers" : `/applications/${application.id}/messages`,
												)
											}
											testID={`today-needs-${application.id}`}
										/>
									</SwipeRow>
								))}
								{notifications.map((notice, index) => (
									<SwipeRow
										key={notice.id}
										start={{
											key: "done",
											label: t`Done`,
											icon: "check",
											tone: "accent",
											onCommit: () => {
												void complete(notice.id);
											},
										}}
									>
										<ListRow
											wrapTitle
											wrapSecondary
											key={notice.id}
											title={notice.title}
											secondary={notice.body}
											trailing="caret"
											last={index === notifications.length - 1}
											onPress={() =>
												router.push(
													notice.applicationId
														? `/applications/${notice.applicationId}/${notice.notice.type === "briefing" ? "prepare" : "messages"}`
														: "/career",
												)
											}
										/>
									</SwipeRow>
								))}
							</>
						) : null}
						{upcoming.length ? (
							<>
								<SectionHeading
									title={t`Coming up`}
									action={t`Calendar`}
									onAction={() => router.push("/applications?view=calendar")}
								/>
								{upcoming.map(({ application, step }, index) =>
									step.kind === "interview" ? (
										<ListRow
											wrapTitle
											wrapSecondary
											key={application.id}
											title={application.company}
											secondary={`${step.interview.kind === "screening" ? t`Screening call` : t`Technical interview`} · ${time(step.at)}`}
											leading={
												<RowDate
													day={format(step.at, { weekday: "short" })}
													date={format(step.at, { day: "numeric" })}
												/>
											}
											trailing="caret"
											last={index === upcoming.length - 1}
											onPress={() => router.push(`/applications/${application.id}`)}
										/>
									) : null,
								)}
							</>
						) : null}
						<SectionHeading
							title={t`New roles`}
							count={fake && roles.length ? t`4 today` : String(roles.length)}
							action={selectingRoles ? t`Done` : t`Select`}
							onAction={() => {
								// Done ends the selection; Select starts an empty one.
								setSelectedRoles([]);
								setSelectingRoles(!selectingRoles);
							}}
						/>
						{roles.length ? (
							roles.map((role) => (
								<ListRow
									wrapTitle
									wrapSecondary
									key={role.id}
									title={role.role}
									secondary={[role.company, role.location, role.snippet].filter(Boolean).join(" · ")}
									leading={
										selectingRoles ? (
											<Checkbox value={selectedRoles.includes(role.id)} interactive={false} />
										) : (
											<Monogram letters={monogram(role.company)} />
										)
									}
									trailing="caret"
									onPress={() =>
										selectingRoles
											? setSelectedRoles((ids) =>
													ids.includes(role.id) ? ids.filter((id) => id !== role.id) : [...ids, role.id],
												)
											: setRoleId(role.id)
									}
									onLongPress={() => {
										setSelectingRoles(true);
										setSelectedRoles([role.id]);
									}}
									testID={`today-role-${role.id}`}
									last
								/>
							))
						) : (
							<CollectionState
								message={
									discovery?.enabled
										? t`No new roles today. Next run tomorrow, 07:00.`
										: discovery
											? t`Discovery is paused.`
											: t`Discovery is off.`
								}
								action={discovery?.enabled ? undefined : discovery ? t`Resume` : t`Turn on`}
								onPress={() =>
									router.push(discovery ? `/career/schedules/${discovery.id}` : "/career/knowledge/preferences")
								}
							/>
						)}
						{selectingRoles && selectedRoles.length ? (
							<View style={{ padding: 24 }}>
								<Button
									label={t`Not for me`}
									onPress={() => {
										void (async () => {
											try {
												for (const id of selectedRoles)
													await actions.write("stories-and-facts", "career.dismissOpportunity", { id });
												setSelectedRoles([]);
											} catch {
												setFailure(true);
											}
										})();
									}}
								/>
							</View>
						) : null}
						<SectionHeading title={t`Pick up where you left off`} />
						{documents.data?.slice(0, 3).map((doc, index) => (
							<ListRow
								wrapTitle
								wrapSecondary
								key={doc.id}
								title={doc.name}
								leading={<DocThumb letter={doc.type === "letter"} />}
								trailing="caret"
								last={index === 2}
								onPress={() => {
									void openDocument(doc);
								}}
							/>
						))}
					</>
				)}
				{today.notifications.data
					?.filter((notice) => today.completion.data?.[notice.id] && today.completion.data[notice.id] !== "undone")
					.map((notice) => (
						<ListRow
							key={notice.id}
							title={notice.title}
							secondary={t`Done`}
							trailing={<TextLink label={t`Undo`} onPress={() => undo(notice.id)} />}
						/>
					))}
			</TabScreen>
			{selectedRole ? (
				<BottomSheet title={selectedRole.role} height={480} onClose={() => setRoleId(undefined)}>
					<View style={{ padding: 24, gap: 20 }}>
						<Text variant="body">
							{selectedRole.company} · {selectedRole.location}
						</Text>
						<Text variant="body">{selectedRole.snippet}</Text>
						<Button
							label={t`Track in Applications`}
							onPress={() => {
								setRoleId(undefined);
								router.push(`/applications/new?opportunityId=${selectedRole.id}`);
							}}
						/>
						<Button
							label={t`Not for me`}
							onPress={() => {
								void actions
									.write("stories-and-facts", "career.dismissOpportunity", { id: selectedRole.id })
									.then(() => setRoleId(undefined))
									.catch(() => setFailure(true));
							}}
						/>
					</View>
				</BottomSheet>
			) : null}
		</>
	);
}
