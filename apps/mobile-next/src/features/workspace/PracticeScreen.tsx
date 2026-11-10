// W4 · Practice, spoken: the question large, the recorder, and "Your attempts" in a row at the bottom that opens
// them as a sheet. The first recording sent opens S7; transcription and feedback follow Finish.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_BYTES, Recorder, type Take } from "./Recorder";
import { sendUnavailable, STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { clockTime, interviewKindWord, isoDay } from "@/features/applications/model";
import { useBarMenu } from "@/features/applications/parts";
import {
	BottomSheet,
	Button,
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
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const insets = useSafeAreaInsets();
	const ws = useWorkspace(id);
	const ai = useAIRun(ws.connection);
	const more = useBarMenu();
	const [index, setIndex] = useState(0);
	const [typing, setTyping] = useState(false);
	const [answer, setAnswer] = useState("");
	const [notice, setNotice] = useState<string | undefined>();
	const [attemptsOpen, setAttemptsOpen] = useState(false);
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
	const question = questions[index % questions.length] ?? "";
	const round = ws.interview ? interviewKindWord(ws.interview.kind) : t`practice`;
	const heading = t`${round.charAt(0).toLocaleUpperCase()}${round.slice(1)} · question ${index + 1} of ${questions.length}`;

	const send = (take: Take) => {
		if (take.bytes === 0 || take.bytes > MAX_BYTES)
			return setNotice(t`That recording was empty or over 2 MB. Try a shorter answer.`);
		setNotice(undefined);
		void ai.run("audio", sendUnavailable);
	};
	const latest = attempts[0];
	const latestLine = latest
		? `${isoDay(new Date(latest.createdAt), ws.zone) === isoDay(ws.at, ws.zone) ? t`Today, ${clockTime(new Date(latest.createdAt), ws.zone)}` : isoDay(new Date(latest.createdAt), ws.zone)} · ${latest.data.mode === "spoken" ? t`spoken` : t`typed`} · ${latest.data.note}`
		: t`None yet`;

	return (
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
			<View style={{ flex: 1, paddingTop: 8 }}>
				<View style={{ paddingHorizontal: layout.screenMargin, gap: 16 }}>
					<Text variant="ui" color="ink3">
						{heading}
					</Text>
					<Text variant="title" accessibilityRole="header">
						{question}
					</Text>
				</View>
				<View style={{ flex: 1 }} />
				{ai.running ? <Working steps={STEPS.feedback()} onStop={ai.stop} /> : null}
				{typing ? (
					<View style={{ paddingHorizontal: layout.screenMargin, gap: 12, paddingBottom: 12 }}>
						<TextField
							label={t`Your answer`}
							value={answer}
							onChangeText={setAnswer}
							multiline
							minHeight={160}
							autoFocus
						/>
						<Button
							label={t`Get feedback`}
							tone="primary"
							size="lg"
							block
							disabled={answer.trim().length < 10}
							onPress={() => void ai.run("chat", sendUnavailable)}
						/>
					</View>
				) : (
					<View style={{ paddingBottom: 8 }}>
						<Recorder
							recorded={attempts.length > 0}
							onFinish={send}
							onTypeInstead={() => setTyping(true)}
							notice={ai.failed ? t`Nothing was heard. Try again, or type your answer.` : notice}
						/>
					</View>
				)}
			</View>
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
		</PushScreen>
	);
}
