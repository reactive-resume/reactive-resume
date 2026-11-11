// J6 · one application: company as the title, a hero for the next step (its action is the only accent button),
// "Work on it" (W1–W5, Debrief, Library) and the details as plain rows. The hero crossfades (d3) when the step changes.
import type { IconName } from "@/ui";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { useApplicationActions } from "./actions";
import {
	CloseOthersSheet,
	EditDetailsSheet,
	LinkDocumentSheet,
	useClosedForOffer,
	useOtherOpen,
} from "./detail-sheets";
import {
	type Application,
	applicationHeroId,
	clockTime,
	closedLine,
	dayMonth,
	interviewTitle,
	isLink,
	longWeekday,
	nextInterview,
	type SavedItem,
	stageBeforeClose,
	stageDate,
	stageLabel,
	weekday,
} from "./model";
import { FadeIn, LoadError, useBarMenu } from "./parts";
import { storyboard } from "./storyboard";
import { useApplication } from "@/data";
import { now, timeZone } from "@/data/clock";
import { useSavedItems } from "@/features/workspace/shared";
import {
	Button,
	flyBack,
	HeroCard,
	IconButton,
	IconTile,
	Icon,
	ListRow,
	MenuItem,
	motion,
	PageSubtitle,
	PushScreen,
	SectionHeading,
	Skeleton,
	StageDot,
	Text,
} from "@/ui";

const DAY_MS = 86_400_000;

/** What each "Work on it" row says, from the application and the work saved for it. */
export function workStatus(app: Application, items: readonly SavedItem[], at: Date, zone: string) {
	const latest = (kind: string) =>
		items
			.filter((item) => item.applicationId === app.id && item.data.kind === kind)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
	const fit = latest("fit");
	const fitLine =
		fit?.data.kind === "fit"
			? t`${fit.data.requirements.filter((r) => r.status !== "missing").length} of ${fit.data.requirements.length} requirements have evidence`
			: t`Not checked yet`;
	const sentOn = stageDate(app, "applied");
	const applyLine =
		app.status !== "saved" && sentOn
			? app.sentCoverLetterVersionId || app.coverLetterId
				? t`Resume and letter sent ${dayMonth(sentOn, zone)}`
				: t`Resume sent ${dayMonth(sentOn, zone)}`
			: t`Documents, answers and where to apply`;
	const upcoming = nextInterview(app, at);
	const prepLine = latest("briefing")
		? t`Briefing ready`
		: upcoming
			? t`No briefing yet`
			: t`Add an interview to prepare`;
	const practice = latest("practice");
	const days = practice ? Math.floor((at.getTime() - new Date(practice.createdAt).getTime()) / DAY_MS) : null;
	const practiceLine =
		days === null
			? t`Practise likely questions aloud`
			: days === 0
				? t`Last session today`
				: days === 1
					? t`Last session yesterday`
					: t`Last session ${days} days ago`;
	const debriefLine = upcoming
		? t`After ${weekday(new Date(upcoming.at), zone)} · say what happened`
		: latest("debrief")
			? t`Debrief saved`
			: t`Say what happened after an interview`;
	const messagesLine = latest("reply") ? t`Reply drafted` : t`Follow-ups, thank-you notes and replies`;
	return { fitLine, applyLine, prepLine, practiceLine, debriefLine, messagesLine, briefing: !!latest("briefing") };
}

export function DetailScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const application = useApplication(id);
	const saved = useSavedItems(id);
	const actions = useApplicationActions();
	const more = useBarMenu();
	const [sheet, setSheet] = useState<"edit" | "link" | "others" | null>(null);
	const app = application.data;
	const zone = timeZone();
	const at = now();
	const go = (path: string) => router.push(`/applications/${id}/${path}`);

	if (application.isError)
		return (
			<PushScreen title="">
				<View style={{ paddingTop: 4 }}>
					<LoadError onRetry={() => void application.refetch()} />
				</View>
			</PushScreen>
		);
	if (!app)
		return (
			<PushScreen title="">
				<View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 12 }}>
					<Skeleton width="40%" height={34} />
					<Skeleton width="80%" height={24} />
					<Skeleton height={232} radius={16} />
				</View>
			</PushScreen>
		);

	const status = workStatus(app, saved, at, zone);
	const people = app.contacts.map((contact) => contact.name);
	const notes = app.activity.filter((entry) => entry.type === "note").length;
	const savedOn = new Date(app.createdAt);
	const appliedOn = stageDate(app, "applied");
	const timeline = [
		t`Saved ${dayMonth(savedOn, zone)}`,
		...(appliedOn && app.status !== "saved" ? [t`Applied ${dayMonth(appliedOn, zone)}`] : []),
	].join(" · ");
	const subtitle = [app.role, app.location].filter(Boolean).join(" · ");

	const work: { icon: IconName; title: string; line: string; path: string }[] = [
		{ icon: "target", title: t`Fit`, line: status.fitLine, path: "fit" },
		{ icon: "paper-plane-tilt", title: t`Apply`, line: status.applyLine, path: "apply" },
		{ icon: "chalkboard-teacher", title: t`Interview prep`, line: status.prepLine, path: "prepare" },
		{
			icon: "microphone",
			title: t`Practice`,
			line: storyboard?.practiceLines[app.id] ?? status.practiceLine,
			path: "practise",
		},
		{ icon: "note-pencil", title: t`Debrief`, line: status.debriefLine, path: "debrief" },
		{ icon: "envelope-simple", title: t`Messages`, line: status.messagesLine, path: "messages" },
		{ icon: "books", title: t`Library`, line: t`Saved briefings, fit results and drafts`, path: "library" },
	];

	return (
		<PushScreen
			title={app.company}
			titleHeroId={applicationHeroId(app.id)}
			onBack={() => {
				void flyBack(applicationHeroId(app.id));
				router.back();
			}}
			subtitle={<PageSubtitle status>{subtitle}</PageSubtitle>}
			barEnd={more.wrap(<IconButton icon="dots-three" label={t`More`} onPress={more.open} />)}
			overlay={
				<>
					{more.menu(
						<>
							<MenuItem
								label={t`Edit details`}
								icon="pencil-simple"
								onPress={() => {
									more.close();
									setSheet("edit");
								}}
							/>
							<MenuItem
								label={t`Add interview`}
								icon="calendar-blank"
								onPress={() => {
									more.close();
									go("interview");
								}}
							/>
							<MenuItem
								label={t`Link a resume or letter`}
								icon="link-simple"
								onPress={() => {
									more.close();
									setSheet("link");
								}}
							/>
							{app.status === "closed" ? (
								<MenuItem
									label={t`Reopen`}
									icon="arrow-counter-clockwise"
									onPress={() => {
										more.close();
										void actions.reopen(app.id, stageBeforeClose(app));
									}}
								/>
							) : (
								<MenuItem
									label={t`Close…`}
									icon="check-circle"
									onPress={() => {
										more.close();
										go("stage?step=close");
									}}
								/>
							)}
							<MenuItem
								label={t`Move to Trash`}
								icon="trash"
								danger
								onPress={() => {
									more.close();
									void actions.moveToTrash([app.id]).then(() => router.back());
								}}
							/>
						</>,
					)}
					{sheet === "edit" ? <EditDetailsSheet app={app} onClose={() => setSheet(null)} /> : null}
					{sheet === "link" ? <LinkDocumentSheet app={app} onClose={() => setSheet(null)} /> : null}
					{sheet === "others" ? <OthersSheet app={app} onClose={() => setSheet(null)} /> : null}
				</>
			}
		>
			<FadeIn key={heroKey(app, at)} ms={motion.d3}>
				<NextStepHero
					app={app}
					at={at}
					zone={zone}
					hasBriefing={status.briefing}
					go={go}
					onReopen={() => void actions.reopen(app.id, stageBeforeClose(app))}
					onCloseOthers={() => setSheet("others")}
				/>
			</FadeIn>
			<SectionHeading title={t`Work on it`} />
			{work.map((row, i) => (
				<ListRow
					key={row.path}
					title={row.title}
					secondary={row.line}
					leading={<IconTile icon={row.icon} />}
					trailing="caret"
					last={i === work.length - 1}
					onPress={() => go(row.path)}
				/>
			))}
			<SectionHeading title={t`Details`} />
			<ListRow
				title={t`Stage`}
				accessibilityLabel={`${t`Stage`}, ${app.status === "closed" ? closedLine(app.closedReason) : stageLabel(app.status)}`}
				trailing={
					<View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							<StageDot stage={app.status} />
							<Text variant="ui" color="ink3">
								{app.status === "closed" ? closedLine(app.closedReason) : stageLabel(app.status)}
							</Text>
						</View>
						<Icon name="caret-right" size={24} color="ink2" />
					</View>
				}
				onPress={() => go("stage")}
			/>
			<ListRow
				title={t`Posting`}
				trailing="caret"
				onPress={app.sourceUrl ? () => void openBrowserAsync(app.sourceUrl ?? "") : undefined}
			/>
			<ListRow title={t`People`} secondary={people.join(", ") || t`Add a contact`} trailing="caret" />
			<ListRow title={t`Notes`} secondary={notes === 1 ? t`1 note` : t`${notes} notes`} trailing="caret" />
			<ListRow title={t`Timeline`} secondary={timeline} trailing="caret" last />
		</PushScreen>
	);
}

const heroKey = (app: Application, at: Date) => `${app.status}:${nextInterview(app, at)?.id ?? ""}`;

function NextStepHero({
	app,
	at,
	zone,
	hasBriefing,
	go,
	onReopen,
	onCloseOthers,
}: {
	app: Application;
	at: Date;
	zone: string;
	hasBriefing: boolean;
	go: (path: string) => void;
	onReopen: () => void;
	onCloseOthers: () => void;
}) {
	const router = useRouter();
	const actions = useApplicationActions();
	const others = useOtherOpen(app);
	const closedForOffer = useClosedForOffer(app);
	const interview = nextInterview(app, at);
	if (interview) {
		const when = new Date(interview.at);
		const people = interview.participants.map((person) => person.name);
		const first = people.slice(0, -1).join(", ");
		const last = people.at(-1) ?? "";
		const with_ = people.length > 1 ? t`With ${first} and ${last}` : last ? t`With ${last}` : "";
		const where = interview.location ? (isLink(interview.location) ? t`video call` : interview.location) : "";
		return (
			<HeroCard
				keyLine={t`Next · ${longWeekday(when, zone)}, ${clockTime(when, zone)}`}
				stage={app.status}
				title={interviewTitle(interview.kind)}
				body={[with_, where].filter(Boolean).join(" · ") || undefined}
				// "Where" holding a meeting link: the line opens it in the system browser.
				onBodyPress={
					isLink(interview.location)
						? () =>
								void openBrowserAsync(
									/^https?:\/\//.test(interview.location) ? interview.location : `https://${interview.location}`,
								)
						: undefined
				}
			>
				<Button
					label={hasBriefing ? t`Open briefing` : t`Prepare for it`}
					tone="primary"
					size="lg"
					block
					onPress={() => go("prepare")}
				/>
			</HeroCard>
		);
	}
	if (app.status === "closed")
		return (
			<HeroCard
				keyLine={closedLine(app.closedReason)}
				stage="closed"
				title={t`This application is closed`}
				body={t`Its history and Insights are kept.`}
			>
				<Button label={t`Reopen`} tone="primary" size="lg" block onPress={onReopen} />
				{app.closedReason === "accepted" && others.length > 0 && closedForOffer.value.ids.length === 0 ? (
					<Button
						label={
							others.length === 1 ? t`Close the other application…` : t`Close the other ${others.length} applications…`
						}
						tone="secondary"
						size="lg"
						block
						onPress={onCloseOthers}
					/>
				) : null}
				{closedForOffer.value.ids.length > 0 && !closedForOffer.value.dismissed ? (
					<>
						<Button
							label={t`Reopen the ${closedForOffer.value.ids.length}`}
							tone="secondary"
							size="lg"
							block
							onPress={() => {
								void (async () => {
									for (const id of closedForOffer.value.ids) await actions.reopen(id);
									closedForOffer.set({ ids: [], dismissed: false });
								})();
							}}
						/>
						<Button
							label={t`Dismiss`}
							tone="ghost"
							size="lg"
							block
							onPress={() => closedForOffer.set({ ...closedForOffer.value, dismissed: true })}
						/>
					</>
				) : null}
			</HeroCard>
		);
	if (app.status === "offer")
		return (
			<HeroCard
				keyLine={t`Next`}
				stage="offer"
				title={t`Decide on the offer`}
				body={t`Compare it with your other offers before you reply.`}
			>
				<Button
					label={t`Compare offers`}
					tone="primary"
					size="lg"
					block
					onPress={() => router.push("/career/offers")}
				/>
			</HeroCard>
		);
	if (app.status === "saved")
		return (
			<HeroCard
				keyLine={t`Next`}
				stage="saved"
				title={t`Check your fit`}
				body={t`See which requirements your resume and Knowledge already cover.`}
			>
				<Button label={t`Check fit`} tone="primary" size="lg" block onPress={() => go("fit")} />
			</HeroCard>
		);
	return (
		<HeroCard
			keyLine={t`Next`}
			stage={app.status}
			title={t`Follow up`}
			body={t`A short note keeps you in mind while they decide.`}
		>
			<Button label={t`Draft a follow-up`} tone="primary" size="lg" block onPress={() => go("messages")} />
		</HeroCard>
	);
}

function OthersSheet({ app, onClose }: { app: Application; onClose: () => void }) {
	const others = useOtherOpen(app);
	return <CloseOthersSheet app={app} others={others} onClose={onClose} />;
}
