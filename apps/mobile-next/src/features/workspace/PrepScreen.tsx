import { t } from "@lingui/core/macro";
// W3 · Interview prep, made to be read on the way: the round as the title, a countdown, short serif sections, one
// footer action. Each question names the story to use, or says there isn't one. Sections fade up as they're ready.
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { approveRecurring, useApplicationWorkspace, useCareerStories } from "@/data";
import { clockTime, interviewTitle, isoDay, longWeekday, zoneCity } from "@/features/applications/model";
import { FadeIn, useBarMenu } from "@/features/applications/parts";
import { storyboard } from "@/features/applications/storyboard";
import {
	Button,
	Card,
	FooterBar,
	IconButton,
	layout,
	ListRow,
	MenuItem,
	PageSubtitle,
	PushScreen,
	SectionHeading,
	Segmented,
	showToast,
	Switch,
	Text,
	toggleValue,
} from "@/ui";

const DAY_MS = 86_400_000;

export function PrepScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const ws = useWorkspace(id);
	const workspace = useApplicationWorkspace(id);
	const stories = useCareerStories();
	const ai = useAIRun(ws.connection);
	const more = useBarMenu();
	const app = ws.app;
	const rounds = (app?.activity ?? [])
		.filter((entry) => entry.type === "interview")
		.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
	const [roundId, setRoundId] = useState<string | undefined>(ws.interview?.id);
	const round = rounds.find((r) => r.id === roundId) ?? ws.interview ?? rounds.at(-1);
	const [refresh, setRefresh] = useState(storyboard?.refreshOn ?? false);
	const briefing = ws.latest("briefing")[0];
	const generate = () =>
		round && void ai.run("resume-and-facts", () => ws.actions.generate({ task: "briefing", interviewId: round.id }));

	if (!app) return <PushScreen title={t`Interview prep`}>{null}</PushScreen>;
	const when = round ? new Date(round.at) : null;
	// Calendar days in the zone: Saturday to Tuesday is "in 3 days" whatever the hour.
	const days = when
		? Math.round((Date.parse(isoDay(when, ws.zone)) - Date.parse(isoDay(ws.at, ws.zone))) / DAY_MS)
		: null;
	const countdown = days === null ? "" : days <= 0 ? t`today` : days === 1 ? t`tomorrow` : t`in ${days} days`;
	const storyName = (storyId: string | null | undefined) =>
		stories.data?.find((story) => story.id === storyId)?.data.title ??
		(storyId ? storyboard?.storyNames[storyId] : undefined);
	const madeAt = briefing ? new Date(briefing.createdAt) : null;
	const madeLine = madeAt
		? isoDay(madeAt, ws.zone) === isoDay(ws.at, ws.zone)
			? t`Briefing made today ${clockTime(madeAt, ws.zone)}`
			: t`Briefing made ${longWeekday(madeAt, ws.zone)}`
		: "";
	const refreshAt = when ? new Date(when.getTime() - DAY_MS) : null;
	const questionsToAsk = workspace.data?.questions ?? [];
	const likely = briefing?.data.questions ?? [];

	return (
		<PushScreen
			title={round ? interviewTitle(round.kind) : t`Interview prep`}
			subtitle={
				when ? (
					<View>
						<PageSubtitle>{`${longWeekday(when, ws.zone)}, ${clockTime(when, ws.zone)} · ${countdown}`}</PageSubtitle>
						{madeLine ? (
							<View style={{ paddingTop: 4, paddingHorizontal: layout.screenMargin }}>
								<Text variant="ui" color="ink3">
									{refresh ? t`${madeLine} · next refresh 24 h before` : madeLine}
								</Text>
							</View>
						) : null}
					</View>
				) : (
					<PageSubtitle status>{t`Add an interview to prepare for it.`}</PageSubtitle>
				)
			}
			barEnd={more.wrap(<IconButton icon="dots-three" label={t`More`} onPress={more.open} />)}
			overlay={more.menu(
				<MenuItem
					label={t`Generate briefing now`}
					icon="sparkle"
					onPress={() => {
						more.close();
						generate();
					}}
				/>,
			)}
			footer={
				<FooterBar>
					<Button
						label={t`Practice these questions`}
						icon="microphone"
						tone="primary"
						size="lg"
						grow
						onPress={() => router.push(`/applications/${app.id}/practise`)}
					/>
				</FooterBar>
			}
		>
			{rounds.length > 1 && rounds.length <= 3 ? (
				<View style={{ paddingTop: 16, paddingHorizontal: layout.screenMargin }}>
					<Segmented
						accessibilityLabel={t`Round`}
						value={round?.id ?? ""}
						onChange={setRoundId}
						options={rounds.map((r) => ({ key: r.id, label: interviewTitle(r.kind) }))}
					/>
				</View>
			) : null}
			{ai.running ? <Working steps={STEPS.briefing()} onStop={ai.stop} /> : null}
			{!briefing && !ai.running ? (
				<View style={{ paddingTop: 20, paddingHorizontal: layout.screenMargin }}>
					<Card>
						<Text variant="label">{t`Prepare for ${app.company}`}</Text>
						<Text variant="ui" color="ink2">
							{t`A company brief, likely questions with the stories to use, and questions to ask them.`}
						</Text>
						{ai.failed ? (
							<Text variant="ui" color="dangerText">
								{t`Couldn't make the briefing. Try again.`}
							</Text>
						) : null}
						<Button
							label={ws.connection ? t`Generate briefing now` : t`Set up AI`}
							tone="secondary"
							size="md"
							onPress={ws.connection ? generate : () => router.push("/settings/ai")}
						/>
					</Card>
				</View>
			) : null}
			{briefing ? (
				<FadeIn px={6}>
					<SectionHeading
						title={t`Company brief`}
						count={storyboard ? t`${storyboard.briefSources} sources` : undefined}
					/>
					<View style={{ paddingTop: 4, paddingHorizontal: layout.screenMargin }}>
						<Text variant="prose">{briefing.data.summary}</Text>
					</View>
					<SectionHeading title={t`Likely questions`} count={String(storyboard?.likelyCount ?? likely.length)} />
					{likely.map((q, i) => {
						const story = storyName(briefing.data.storyIds[i]);
						return (
							<ListRow
								key={q.text}
								title={q.text}
								wrapTitle
								secondary={story ? t`Story to use: ${story}` : t`No story yet · add one`}
								trailing="caret"
								last={i === likely.length - 1}
								onPress={() =>
									router.push(
										story ? `/career/knowledge/stories/${briefing.data.storyIds[i]}` : "/career/knowledge/stories",
									)
								}
							/>
						);
					})}
				</FadeIn>
			) : null}
			{questionsToAsk.length ? (
				<>
					<SectionHeading title={t`Questions to ask them`} />
					{questionsToAsk.map((q, i) => (
						<ListRow
							key={q.text}
							title={q.text}
							wrapTitle
							secondary={t`Tap to copy`}
							trailing="caret"
							last={i === questionsToAsk.length - 1}
							boxHidden={i === questionsToAsk.length - 1}
							onPress={() => void Clipboard.setStringAsync(q.text).then(() => showToast({ message: t`Copied` }))}
						/>
					))}
				</>
			) : null}
			{refreshAt && ws.provider ? (
				<>
					<SectionHeading title={t`Refresh`} />
					<ListRow
						title={t`Refresh the briefing 24 hours before`}
						secondary={t`${longWeekday(refreshAt, ws.zone)}, ${clockTime(refreshAt, ws.zone)} ${zoneCity(ws.zone)} · ${ws.provider.label} · may charge`}
						wrapSecondary
						trailing={<Switch value={refresh} interactive={false} />}
						accessibilityRole="switch"
						accessibilityState={{ checked: refresh }}
						last
						onPress={() =>
							toggleValue(refresh, (next) => {
								// Turning it on is the approval for the posting, resume and stories to go to this connection.
								if (next && ws.connection) approveRecurring(ws.connection);
								setRefresh(next);
							})
						}
					/>
				</>
			) : null}
		</PushScreen>
	);
}
