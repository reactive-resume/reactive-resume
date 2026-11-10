import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { type ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { AccountAvatar, CollectionState, DocumentPlaceholders, useOpenDocument } from "../documents/shared";
import { chooseHero, todaySteps } from "./model";
import { useSession } from "@/auth/session";
import { useAccount, useCareerSchedules, useDataBackend, useDocuments, useToday } from "@/data";
import {
	Button,
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
	const documents = useDocuments();
	const account = useAccount();
	const schedules = useCareerSchedules();
	const session = useSession();
	const { backend } = useDataBackend();
	const router = useRouter();
	const openDocument = useOpenDocument();
	const fake = backend.kind === "fake";
	const applications = (today.applications.data ?? []).map((app) =>
		fake && app.id === "fieldnote" ? { ...app, appliedAt: new Date("2026-10-28T12:00:00Z") } : app,
	);
	const steps = todaySteps(applications, today.offers.data ?? [], today.now, today.timeZone);
	const notifications = today.notifications.data?.filter((notice) => !notice.readAt) ?? [];
	const hasResume = !!documents.data?.some((document) => document.type === "resume");
	const firstRun =
		!today.applications.isPending &&
		!documents.isPending &&
		!today.applications.isError &&
		!documents.isError &&
		!applications.length &&
		!notifications.length;
	const hero = fake
		? (steps.find((item) => item.application.id === "lumen") ?? chooseHero(steps, today.now))
		: chooseHero(steps, today.now);
	const needs = steps.filter((item) => item !== hero && item.step.kind !== "interview");
	const upcoming = steps.filter((item) => item.step.kind === "interview");
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
	const discovery = schedules.data?.find((schedule) => schedule.kind === "discovery");
	const guest = session.status === "guest";
	return (
		<TabScreen
			title={t`Today`}
			subtitle={
				firstRun
					? t`Welcome, ${account.data?.name.split(" ")[0] ?? ""}.`
					: format(today.now, { weekday: "long", day: "numeric", month: "long" })
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
							<View style={{ alignItems: "center", paddingVertical: 6 }}>
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
							leading={hasResume ? <Icon name="check-circle" size={40} color="accentText" /> : <Monogram letters="1" />}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Save a job you want`}
							secondary={t`Paste a link or share it from the browser`}
							leading={<Monogram letters="2" />}
							onPress={hasResume ? () => router.push("/applications/new") : undefined}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Tailor and apply`}
							secondary={t`Match the resume, write the letter, track it`}
							leading={<Monogram letters="3" />}
							last
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
									router.push(`/applications/${hero.application.id}${hero.step.kind === "interview" ? "/prepare" : ""}`)
								}
							/>
						</HeroCard>
					) : (
						<CollectionState message={t`You're up to date. New roles, reminders and finished briefings appear here.`} />
					)}
					{needs.length || notifications.length ? (
						<>
							<SectionHeading title={t`Needs you`} />
							{needs.map(({ application, step }, index) => (
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
									onPress={() => router.push(`/applications/${application.id}`)}
								/>
							))}
							{notifications.map((notice, index) => (
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
											<RowDate day={format(step.at, { weekday: "short" })} date={format(step.at, { day: "numeric" })} />
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
						count={fake ? t`4 today` : String(today.opportunities.data?.length ?? 0)}
					/>
					{today.opportunities.data?.length ? (
						today.opportunities.data.map((role) => (
							<ListRow
								wrapTitle
								wrapSecondary
								key={role.id}
								title={role.role}
								secondary={[role.company, role.location, role.snippet].filter(Boolean).join(" · ")}
								leading={<Monogram letters={role.company.slice(0, 2).toUpperCase()} />}
								trailing="caret"
								onPress={() => router.push(`/applications/new?opportunityId=${role.id}`)}
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
		</TabScreen>
	);
}
