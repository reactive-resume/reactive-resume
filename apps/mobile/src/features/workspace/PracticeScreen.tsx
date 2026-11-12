// W4 · Practice, spoken: the question large, the recorder, and "Your attempts" in a row at the bottom that opens
// them as a sheet. The first recording sent opens S7; transcription and feedback follow Finish.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAvoidingView, KeyboardController, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_BYTES, Recorder, type Take } from "./Recorder";
import { STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { useCareerStories } from "@/data";
import { clockTime, interviewKindWord, isoDay } from "@/features/applications/model";
import { useBarMenu } from "@/features/applications/parts";
import { storyboard } from "@/features/applications/storyboard";
import {
	BottomSheet,
	Button,
	Card,
	IconButton,
	IconTile,
	layout,
	ListRow,
	MenuItem,
	PushScreen,
	SheetScrollView,
	Text,
	TextField,
} from "@/ui";

export function PracticeScreen() {
	const { id = "", story: storyParam, take } = useLocalSearchParams<{ id: string; story?: string; take?: string }>();
	const insets = useSafeAreaInsets();
	const ws = useWorkspace(id);
	const stories = useCareerStories();
	const ai = useAIRun(ws.connection);
	const more = useBarMenu();
	const [index, setIndex] = useState(0);
	const [typing, setTyping] = useState(false);
	// With the keyboard up the answer box gives up height so Get feedback stays above it.
	const keyboardUp = useKeyboardState((s) => s.isVisible);
	const [answer, setAnswer] = useState("");
	const [notice, setNotice] = useState<string | undefined>();
	const [attemptsOpen, setAttemptsOpen] = useState(false);
	// The feedback card for the answer just given, until Practice again or Next question.
	const [feedback, setFeedback] = useState(false);
	const app = ws.app;
	const company = app?.company ?? "";
	const briefing = ws.latest("briefing")[0];
	const attempts = ws.latest("practice");
	const simulated = briefing?.data.practiceQuestions ?? [];
	const questions = simulated.length
		? simulated
		: [
				t`Tell me about a piece of work you're proud of. What was your part in it, and how did you measure success?`,
				t`Tell me about a time you disagreed with a colleague. How did you resolve it?`,
				t`Why do you want this role at ${company}?`,
			];
	// From C4's Practice this story: one question, for that story.
	const fromStory = storyParam ? stories.data?.find((s) => s.id === storyParam) : undefined;
	const question = fromStory
		? t`Tell me about a time when: ${fromStory.data.title}.`
		: (questions[index % questions.length] ?? "");
	const storyId = fromStory?.id ?? (simulated.length ? briefing?.data.storyIds[index % questions.length] : undefined);
	const story = storyId
		? (stories.data?.find((s) => s.id === storyId)?.data.title ?? storyboard?.storyNames[storyId])
		: undefined;
	const round = ws.interview ? interviewKindWord(ws.interview.kind) : t`practice`;
	const heading = t`${round.charAt(0).toLocaleUpperCase()}${round.slice(1)} · question ${index + 1} of ${questions.length}`;

	const send = (take: Take) => {
		if (take.bytes === 0 || take.bytes > MAX_BYTES)
			return setNotice(t`That recording was empty or over 2 MB. Try a shorter answer.`);
		setNotice(undefined);
		void ai.run("audio", async (signal) => {
			const transcript = await ws.transcribe(take.uri, signal);
			await practise(transcript.text, "spoken");
			setFeedback(true);
		});
	};
	const practise = (text: string, mode: "spoken" | "typed") =>
		ws.actions.generate({
			task: "practice",
			interviewId: ws.interview?.id ?? null,
			question,
			origin: "simulated",
			mode,
			answer: text,
		});
	const latest = attempts[0];
	const latestLine = latest
		? `${isoDay(new Date(latest.createdAt), ws.zone) === isoDay(ws.at, ws.zone) ? t`Today, ${clockTime(new Date(latest.createdAt), ws.zone)}` : isoDay(new Date(latest.createdAt), ws.zone)} · ${latest.data.mode === "spoken" ? t`spoken` : t`typed`} · ${latest.data.note}`
		: t`None yet`;

	return (
		<>
			<PushScreen
				scroll={false}
				barEnd={more.wrap(<IconButton icon="dots-three" label={t`More`} onPress={more.open} />)}
				overlay={more.menu(
					<MenuItem
						label={t`Practice another question`}
						icon="arrows-clockwise"
						onPress={() => {
							more.close();
							setIndex((i) => i + 1);
						}}
					/>,
				)}
				footer={
					<View style={{ paddingBottom: insets.bottom }}>
						<ListRow
							top
							last
							title={t`Your attempts`}
							secondary={latestLine}
							leading={<IconTile icon="clock-counter-clockwise" />}
							value={String(attempts.length)}
							trailing="up"
							onPress={() => setAttemptsOpen(true)}
						/>
					</View>
				}
			>
				{/* A typed answer and its Get feedback button stay above the keyboard. */}
				<KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1, paddingTop: 8 }}>
					<View style={{ paddingHorizontal: layout.screenMargin, gap: 16 }}>
						<Text variant="ui" color="ink3">
							{heading}
						</Text>
						<Text variant="title" accessibilityRole="header" style={{ lineHeight: 38 }}>
							{question}
						</Text>
						{story ? (
							<Text variant="ui" color="ink3">
								{t`Story to use: ${story} · Situation, Task, Action, Result, Reflection`}
							</Text>
						) : null}
					</View>
					<View style={{ flex: 1 }} />
					{ai.running ? <Working steps={STEPS.feedback()} onStop={ai.stop} /> : null}
					{feedback && latest ? (
						<View style={{ paddingHorizontal: layout.screenMargin, paddingBottom: 12 }}>
							<Card>
								<Text variant="label">{t`What you said`}</Text>
								<Text variant="ui" color="ink2" numberOfLines={4}>
									{latest.data.answer}
								</Text>
								<Text variant="label">{t`What worked`}</Text>
								<Text variant="ui" color="ink2">
									{latest.data.works}
								</Text>
								<Text variant="label">{t`What to add`}</Text>
								<Text variant="ui" color="ink2">
									{latest.data.strengthen}
								</Text>
								<View style={{ flexDirection: "row", gap: 12 }}>
									<Button
										label={t`Practice again`}
										tone="secondary"
										size="md"
										grow
										onPress={() => {
											setFeedback(false);
											setAnswer("");
										}}
									/>
									<Button
										label={t`Next question`}
										tone="primary"
										size="md"
										grow
										onPress={() => {
											setFeedback(false);
											setAnswer("");
											setIndex((i) => i + 1);
										}}
									/>
								</View>
							</Card>
						</View>
					) : typing ? (
						<View style={{ paddingHorizontal: layout.screenMargin, gap: 12, paddingBottom: 12 }}>
							<TextField
								label={t`Your answer`}
								value={answer}
								onChangeText={setAnswer}
								multiline
								minHeight={keyboardUp ? 96 : 160}
								autoFocus
							/>
							<Button
								label={t`Get feedback`}
								tone="primary"
								size="lg"
								block
								disabled={answer.trim().length < 10}
								onPress={() => {
									// The keyboard goes first, so the first-send sheet and the feedback are in view: a sheet opened
									// while it is still leaving brought it back over the sheet.
									void KeyboardController.dismiss().then(() =>
										ai.run("chat", async () => {
											await practise(answer, "typed");
											setFeedback(true);
										}),
									);
								}}
							/>
						</View>
					) : (
						<View style={{ paddingBottom: 8 }}>
							<Recorder
								recorded={attempts.length > 0}
								// Only W4's capture draws the take mid-recording; flows use the real recorder.
								seeded={take === "storyboard" ? storyboard?.recording : undefined}
								onFinish={send}
								onTypeInstead={() => setTyping(true)}
								notice={ai.failed ? t`Nothing was heard. Try again, or type your answer.` : notice}
							/>
						</View>
					)}
				</KeyboardAvoidingView>
			</PushScreen>
			{attemptsOpen ? (
				<BottomSheet title={t`Your attempts`} height={600} onClose={() => setAttemptsOpen(false)}>
					<SheetScrollView>
						{attempts.length === 0 ? (
							<View style={{ paddingHorizontal: layout.screenMargin }}>
								<Text variant="ui" color="ink3">
									{t`Your answers and their feedback appear here, newest first.`}
								</Text>
							</View>
						) : (
							attempts.map((a, i) => (
								<ListRow
									key={a.id}
									title={a.data.question}
									wrapTitle
									secondary={`${a.data.works} ${a.data.strengthen}`.trim()}
									wrapSecondary
									last={i === attempts.length - 1}
								/>
							))
						)}
					</SheetScrollView>
				</BottomSheet>
			) : null}
		</>
	);
}
