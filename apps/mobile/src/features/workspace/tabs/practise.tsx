// Practise (web workspace/practise.tsx): one question at a time, answered typed or spoken. A spoken answer is
// recorded on the device and transcribed by the user's AI connection; feedback is saved as an attempt.
import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "../shell";
import type { RecordStop, Recording, VoiceSettings } from "../voice";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { latest, useDraft, useGenerate, useSavedItems, useStories, workspaceError } from "../hooks";
import { acceptedAudioType, clock, MAX_SECONDS, writeNumbersAsDigits } from "../logic";
import { Actions, AiNotice, Block, PrivacyLine, Progress, useWorking, workingSteps } from "../parts";
import { WorkspaceScreen } from "../shell";
import { afterTranscribed, createRequests, playLatest } from "../state";
import { deleteQuietly, speak, transcribe, usePlayer, useRecorder, useVoiceSettings } from "../voice";
import { client } from "@/api/client";
import { AIProviderSetupSheet, useHasAIProvider } from "@/features/ai/providers";
import { useUserTime } from "@/features/application-detail/hooks";
import {
	Banner,
	Button,
	Icon,
	ListRow,
	Segmented,
	SelectSheet,
	Sheet,
	Skeleton,
	Switch,
	Text,
	TextArea,
	showToast,
	useTheme,
} from "@/ui";

type Practice = SavedData<"practice">;
type Attempt = SavedItem & { data: Practice };
type Question = { text: string; origin: Practice["origin"] };
type Mode = Practice["mode"];
/** A transcribed answer: the server's transcript id and text. */
type Spoken = { id: string; text: string; seconds: number | null };
type PracticeDraft = { question: Question; mode: Mode; answer: string; spoken: Spoken | null };
type Step =
	| { name: "idle" }
	| { name: "starting" }
	| { name: "recording" }
	| { name: "transcribing" }
	| { name: "blocked" }
	| { name: "failed"; message: string }
	| { name: "error" };

const isAttempt = (item: SavedItem): item is Attempt => item.data.kind === "practice";

export function PractiseTab() {
	return <WorkspaceScreen tab="practise">{(props) => <Practise {...props} />}</WorkspaceScreen>;
}

function Practise({ application, version, interview, speak: speakFirst, story, now, go }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const saved = useSavedItems(application.id);
	const stories = useStories(application.id);
	const voice = useVoiceSettings();
	const viewing = version && isAttempt(version) ? version : undefined;
	const attempts = saved.data?.filter(isAttempt) ?? [];
	const selectedStory = story ? stories.data?.find((item) => item.id === story) : undefined;
	const company = application.company;

	if (story && stories.isError)
		return (
			<Banner
				tone="danger"
				message={t`Your story couldn't be loaded.`}
				action={{ label: t`Try again`, onPress: () => void stories.refetch() }}
			/>
		);
	if (story && stories.isPending) return <Skeleton height={space.s12 * 5} />;
	if (story && !selectedStory)
		return (
			<View style={{ gap: space.s3 }}>
				<Banner tone="warn" message={t`This story is unavailable or uses facts that are switched off.`} />
				<Button variant="secondary" label={t`Practice another question`} onPress={() => go("practise")} />
			</View>
		);

	const storyTitle = selectedStory?.data.title;
	// The briefing's practice questions for this interview, then questions recalled in Debrief; generic ones otherwise.
	const simulated = latest(saved.data, "briefing", interview?.id)?.data.practiceQuestions ?? [];
	const recalled = (saved.data ?? []).flatMap((item) => (item.data.kind === "debrief" ? [item.data.question] : []));
	const found: Question[] = [
		...simulated.map((text) => ({ text, origin: "simulated" as const })),
		...[...new Set(recalled)].map((text) => ({ text, origin: "recalled" as const })),
	];
	const questions: Question[] = storyTitle
		? [
				{
					text: t`Tell me about “${storyTitle}”. What was your part, what did you do, and what changed?`,
					origin: "simulated",
				},
			]
		: found.length > 0
			? found
			: [
					t`Tell me about a piece of work you're proud of. What was your part in it, and how did you measure success?`,
					t`Tell me about a time you disagreed with a colleague. How did you resolve it?`,
					t`Why do you want this role at ${company}?`,
				].map((text) => ({ text, origin: "simulated" as const }));

	return (
		<View style={{ gap: space.s4 }}>
			{viewing ? (
				<SavedAttempt item={viewing} />
			) : saved.isPending ? (
				<Skeleton height={space.s12 * 6} />
			) : (
				<Session
					key={`${application.id}:${interview?.id ?? "none"}:${story ?? "general"}`}
					application={application}
					applicationId={application.id}
					interviewId={interview?.id ?? null}
					questions={questions}
					storyId={selectedStory?.id}
					storyTitle={storyTitle}
					voice={voice}
					initialMode={speakFirst ? "spoken" : "typed"}
				/>
			)}
			<Block title={t`Your attempts`}>
				{attempts.length === 0 ? (
					<Text variant="callout" color="ink3">
						{t`Each answer you get feedback on is kept here, newest first.`}
					</Text>
				) : (
					attempts.map((item) => (
						<AttemptRow
							key={item.id}
							item={item}
							now={now}
							current={item.id === viewing?.id}
							onOpen={() => go("practise", { version: item.id })}
						/>
					))
				)}
				<Text variant="caption" color="ink3">
					{t`Compare attempts to see what improved. Practice questions are simulated, not from ${company}.`}
				</Text>
			</Block>
		</View>
	);
}

type AttemptRowProps = { item: Attempt; now: Date; current: boolean; onOpen: () => void };

function AttemptRow({ item, now, current, onOpen }: AttemptRowProps) {
	const { t } = useLingui();
	const { day, time, when } = useUserTime();
	const hour = time(item.createdAt);
	const at = day(item.createdAt) === day(now) ? t`Today, ${hour}` : when(item.createdAt);
	const mode = item.data.mode === "spoken" ? t`spoken` : t`typed`;
	return (
		<ListRow
			title={item.data.answer}
			subtitle={[`${at} · ${mode}`, item.data.note].filter(Boolean).join(" · ")}
			leading={item.data.mode === "spoken" ? "microphone" : "keyboard"}
			selected={current}
			chevron
			onPress={onOpen}
		/>
	);
}

// ---- One question at a time ----

type SessionProps = {
	application: WorkspaceTabProps["application"];
	applicationId: string;
	interviewId: string | null;
	questions: Question[];
	storyId: string | undefined;
	storyTitle: string | undefined;
	voice: VoiceSettings;
	initialMode: Mode;
};

function Session({
	application,
	applicationId,
	interviewId,
	questions,
	voice,
	initialMode,
	storyId,
	storyTitle,
}: SessionProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const generate = useGenerate(applicationId);
	const provider = useHasAIProvider().defaultProvider;
	const draft = useDraft<PracticeDraft>(`practice:${applicationId}:${interviewId ?? "none"}:${storyId ?? "general"}`, {
		question: questions[0] ?? { text: t`Tell me about a piece of work you're proud of.`, origin: "simulated" },
		mode: initialMode,
		answer: "",
		spoken: null,
	});
	const { question, mode, answer, spoken } = draft.value;
	const setMode = (next: Mode) => draft.setValue((current) => ({ ...current, mode: next }));
	const setAnswer = (next: string) => draft.setValue((current) => ({ ...current, answer: next }));
	const setSpoken = (next: Spoken | null) => draft.setValue((current) => ({ ...current, spoken: next }));
	const index = Math.max(
		0,
		questions.findIndex((item) => item.text === question.text),
	);
	const [feedback, setFeedback] = useState<{ answer: string; data: Practice } | null>(null);
	const [step, setStep] = useState<Step>({ name: "idle" });
	const [audio, setAudio] = useState<Recording | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [setup, setSetup] = useState(false);
	const alive = useRef(true);
	const player = usePlayer();
	const transcriber = voice.settings.transcribe;
	const feedbackLabel = useWorking(generate.isPending, workingSteps("practice"), t`Get feedback`);

	// The recording stays on the device; it goes when it's replaced, or when leaving unless the user keeps it.
	// Refs, not render state: transcription finishes after later renders, and must see the recording and Keep as they
	// are then.
	const audioRef = useRef(audio);
	const keepRef = useRef(voice.settings.keep);
	// Bumped by each new transcription and by switching mode, so a slower, older result can't land over newer input.
	const generation = useRef(0);
	const transcription = useRef<AbortController | null>(null);
	useEffect(() => () => transcription.current?.abort(), [applicationId, transcriber?.providerId, transcriber?.model]);
	useEffect(() => {
		keepRef.current = voice.settings.keep;
	});
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			if (audioRef.current && !keepRef.current) deleteQuietly(new File(audioRef.current.uri));
		};
	}, []);
	const replaceAudio = (next: Recording | null) => {
		const previous = audioRef.current;
		if (previous && previous.uri !== next?.uri) deleteQuietly(new File(previous.uri));
		audioRef.current = next;
		setAudio(next);
	};

	const send = async (recording: Recording) => {
		if (!transcriber) return;
		transcription.current?.abort();
		const request = new AbortController();
		transcription.current = request;
		const run = ++generation.current;
		setStep({ name: "transcribing" });
		try {
			const result = await transcribe({
				signal: request.signal,
				recording,
				providerId: transcriber.providerId,
				model: transcriber.model,
				applicationId,
			});
			if (!alive.current || run !== generation.current || request.signal.aborted) return;
			setAnswer(result.text);
			setSpoken({ id: result.id, text: result.text, seconds: recording.seconds });
			setStep({ name: "idle" });
			// Without Keep, the file just uploaded goes, even if another recording has replaced it on screen since.
			const next = afterTranscribed({
				uploaded: recording,
				current: audioRef.current,
				keep: keepRef.current,
				remove: (uploaded) => deleteQuietly(new File(uploaded.uri)),
			});
			audioRef.current = next;
			setAudio(next);
		} catch {
			if (alive.current && run === generation.current)
				setStep(request.signal.aborted ? { name: "idle" } : { name: "error" });
		}
	};

	const onStop = (result: RecordStop) => {
		if (result.kind === "recorded") {
			if (result.atLimit)
				showToast({ message: t`Recording stopped at the 2-minute limit. Transcribing what you said.` });
			replaceAudio(result.recording);
			void send(result.recording);
		} else setStep({ name: "failed", message: t`That recording was empty or over 2 MB. Try a shorter answer.` });
	};
	const recorder = useRecorder(onStop);

	const startRecording = async () => {
		if (!transcriber) return;
		setStep({ name: "starting" });
		const started = await recorder.start();
		if (!alive.current) return void recorder.cancel();
		if (started === "started") setStep({ name: "recording" });
		else if (started === "denied") setStep({ name: "blocked" });
		else setStep({ name: "failed", message: t`Couldn't start recording. Try again, or type your answer.` });
	};
	const chooseFile = async () => {
		const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true }).catch(
			() => null,
		);
		const asset = picked && !picked.canceled ? picked.assets[0] : undefined;
		if (!asset) return;
		const type = acceptedAudioType(asset.mimeType, asset.size);
		if (!type) {
			deleteQuietly(new File(asset.uri));
			return setStep({ name: "failed", message: t`Choose a WebM, MP4, MP3, WAV or Ogg file up to 2 MB.` });
		}
		const recording = { uri: asset.uri, seconds: null, name: asset.name, type };
		replaceAudio(recording);
		void send(recording);
	};
	const toggleRecording = () => {
		if (step.name === "recording") void recorder.stop();
		else if (step.name !== "starting" && step.name !== "transcribing") void startRecording();
	};
	const chooseMode = (next: Mode) => {
		if (next === "typed" && step.name === "recording") void recorder.cancel();
		generation.current++;
		transcription.current?.abort();
		if (next === "typed" || step.name === "transcribing") setStep({ name: "idle" });
		setMode(next);
	};
	const nextQuestion = () => {
		const next = questions[(index + 1) % questions.length];
		if (next) draft.setValue({ question: next, mode, answer: "", spoken: null });
		setFeedback(null);
	};
	const getFeedback = () => {
		const text = answer.trim();
		// Corrections to a transcript are kept with it, so the server's copy matches what was reviewed.
		if (spoken && text !== spoken.text)
			void client.career.voice.saveTranscript({ id: spoken.id, text }).catch(() => undefined);
		generate
			.run({
				task: "practice",
				interviewId,
				...(storyId ? { storyId } : {}),
				question: question.text,
				origin: question.origin,
				mode: spoken ? "spoken" : "typed",
				answer: text,
			})
			.then(({ item }) => {
				if (item?.data.kind === "practice") setFeedback({ answer, data: item.data });
			})
			.catch(() => undefined);
	};

	const busy = step.name === "starting" || step.name === "recording" || step.name === "transcribing";
	const showFeedback = feedback !== null && feedback.answer === answer;
	// Asking again for the same words would only save a duplicate attempt.
	const ready = answer.trim().length >= 10 && (mode === "typed" || spoken !== null) && !busy && !showFeedback;
	const position = (index % questions.length) + 1;
	const total = questions.length;
	const recordingNow = step.name === "recording";
	const elapsed = clock(recorder.seconds);
	const model = transcriber?.model ?? "";
	const transcriberName = transcriber?.label ?? "";
	const spokenFor = spoken?.seconds != null ? clock(spoken.seconds) : t`audio file`;
	const answerField = (
		<TextArea
			label={t`Your answer`}
			value={answer}
			maxLength={6000}
			minLines={5}
			placeholder={t`About 90 seconds when spoken`}
			onChangeText={setAnswer}
		/>
	);

	return (
		<View style={{ gap: space.s4 }}>
			<Block
				title={`${t`Question ${position} of ${total}`} · ${question.origin === "recalled" ? t`Recalled` : t`Practice`}`}
				trailing={<HearIt key={question.text} text={question.text} voice={voice} player={player} />}
			>
				<Text variant="heading">{question.text}</Text>
				{storyTitle ? <Text color="ink2">{t`Practicing your story: ${storyTitle}`}</Text> : null}
			</Block>

			<Block title={t`Your answer`}>
				<Segmented
					label={t`Answer by`}
					value={mode}
					onChange={chooseMode}
					options={[
						{ value: "typed", label: t`Type`, icon: "keyboard" },
						{ value: "spoken", label: t`Speak`, icon: "microphone" },
					]}
				/>

				{mode === "typed" ? (
					answerField
				) : voice.providerState.isLoading ? (
					<Skeleton height={space.s12} />
				) : !transcriber ? (
					<View style={{ gap: space.s2 }}>
						<Banner
							tone="warn"
							message={t`None of your AI connections can transcribe speech (OpenAI, Google Gemini, Mistral, xAI, Groq or Vercel AI Gateway can). Add one, or type your answer.`}
						/>
						<Actions>
							<Button variant="secondary" label={t`Connect an AI provider`} onPress={() => setSetup(true)} />
							<Button variant="ghost" icon="keyboard" label={t`Type instead`} onPress={() => chooseMode("typed")} />
						</Actions>
					</View>
				) : spoken ? (
					<View style={{ gap: space.s2 }}>
						<Text variant="caption" color="ink3">
							{t`Transcribed · ${spokenFor} · check numbers and names before using it`}
						</Text>
						{answerField}
						<Actions>
							<Button
								variant="secondary"
								size="sm"
								label={t`Write numbers as digits`}
								onPress={() => setAnswer(writeNumbersAsDigits(answer))}
							/>
							<Button
								variant="ghost"
								size="sm"
								label={t`Record again`}
								onPress={() => {
									setSpoken(null);
									void startRecording();
								}}
							/>
							{audio ? <RecordingActions audio={audio} player={player} /> : null}
						</Actions>
					</View>
				) : step.name === "transcribing" ? (
					<View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: space.s2 }}>
						<Icon name="waveform" color={colors.accent} />
						<Text color="ink2">{t`Transcribing with ${model}…`}</Text>
					</View>
				) : step.name === "error" ? (
					<View style={{ gap: space.s2 }}>
						<Banner tone="danger" message={t`Couldn't transcribe. Your recording is still here.`} />
						<Actions>
							<Button variant="secondary" size="sm" label={t`Try again`} onPress={() => audio && void send(audio)} />
							{audio ? <RecordingActions audio={audio} player={player} /> : null}
							<Button variant="ghost" size="sm" label={t`Type instead`} onPress={() => chooseMode("typed")} />
						</Actions>
					</View>
				) : (
					<View style={{ gap: space.s3 }}>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space.s3,
								padding: space.s3,
								borderRadius: radius.rLg,
								backgroundColor: recordingNow ? colors.dangerSoft : colors.sunken,
							}}
						>
							{/* One button for both, so the control the user started is the one that stops it. */}
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={recordingNow ? t`Stop recording` : t`Record your answer`}
								accessibilityState={{ busy: step.name === "starting" }}
								disabled={step.name === "starting"}
								onPress={toggleRecording}
								style={({ pressed }) => ({
									width: 52,
									height: 52,
									borderRadius: radius.rLg,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: colors.danger,
									opacity: pressed ? 0.85 : 1,
								})}
							>
								<Icon
									name={recordingNow ? "stop" : "microphone"}
									filled={recordingNow}
									size={24}
									color={colors.onAccent}
								/>
							</Pressable>
							<View style={{ flex: 1, gap: space.s0 }}>
								<Text variant="label" color={recordingNow ? "dangerText" : "ink"}>
									{recordingNow ? t`Recording · ${elapsed}` : t`Record your answer`}
								</Text>
								<Text variant="callout" color="ink2">
									{recordingNow
										? t`Stop when you're done. Nothing is sent until then.`
										: t`Up to 2 minutes · 2 MB maximum.`}
								</Text>
							</View>
						</View>
						{recordingNow ? <Progress value={recorder.seconds / MAX_SECONDS} label={t`Recording time`} /> : null}
						{recordingNow ? (
							<Button variant="ghost" label={t`Cancel recording`} onPress={() => chooseMode("typed")} />
						) : (
							<Button
								variant="link"
								icon="file-arrow-up"
								label={t`Choose an audio file`}
								disabled={step.name === "starting"}
								onPress={() => void chooseFile()}
							/>
						)}
						{step.name === "blocked" ? (
							<View style={{ gap: space.s2 }}>
								<Banner tone="warn" message={t`Allow microphone access in device settings, or type your answer.`} />
								<Actions>
									<Button
										variant="secondary"
										size="sm"
										label={t`Open device settings`}
										onPress={() => void Linking.openSettings()}
									/>
									<Button
										variant="ghost"
										size="sm"
										icon="keyboard"
										label={t`Type instead`}
										onPress={() => chooseMode("typed")}
									/>
								</Actions>
							</View>
						) : null}
						{step.name === "failed" ? <Banner tone="danger" message={step.message} /> : null}
					</View>
				)}

				{mode === "spoken" && transcriber ? (
					<PrivacyLine>
						{t`Your recording goes to ${transcriberName} after you stop, to be transcribed. Your provider may charge. The server keeps transcripts, never recordings.`}
					</PrivacyLine>
				) : null}
				{mode === "spoken" && !voice.providerState.isUnavailable ? (
					<Button
						variant="link"
						icon="sliders-horizontal"
						label={t`Voice settings`}
						disabled={busy}
						onPress={() => setSettingsOpen(true)}
					/>
				) : null}

				<View style={{ gap: space.s2 }}>
					<Button
						label={feedbackLabel}
						disabled={!ready || !provider}
						loading={generate.isPending}
						onPress={getFeedback}
					/>
					<Text variant="caption" color="ink2">
						{t`Compared with your stories and the posting.`}
					</Text>
					<AiNotice task="practice" application={application} interview={interviewId !== null} />
				</View>
			</Block>

			{feedback && showFeedback ? (
				<FeedbackCard data={feedback.data}>
					<Actions>
						<Button
							variant="secondary"
							size="sm"
							label={t`Try again with this`}
							onPress={() => {
								chooseMode("typed");
								setSpoken(null);
								setAnswer(feedback.data.opening);
							}}
						/>
						<Button variant="ghost" size="sm" icon="arrow-right" label={t`Next question`} onPress={nextQuestion} />
					</Actions>
					<Text variant="caption" color="ink3">
						{t`Saved to Library · Practice`}
					</Text>
				</FeedbackCard>
			) : null}

			<VoiceSettingsSheet voice={voice} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</View>
	);
}

type Player = ReturnType<typeof usePlayer>;

/** Play the kept recording, or share it (Keep the recording on this device). */
function RecordingActions({ audio, player }: { audio: Recording; player: Player }) {
	const { t } = useLingui();
	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				icon={player.playing ? "stop" : "play"}
				label={player.playing ? t`Stop audio` : t`Play recording`}
				onPress={() => (player.playing ? player.stop() : void player.play(audio.uri))}
			/>
			<Button
				variant="ghost"
				size="sm"
				icon="share-network"
				label={t`Share recording`}
				onPress={() =>
					void Sharing.shareAsync(audio.uri, { mimeType: "audio/mp4", UTI: "public.mpeg-4-audio" }).catch(() =>
						showToast({ message: t`Couldn't share the recording. Try again.` }),
					)
				}
			/>
		</>
	);
}

type HearItProps = { text: string; voice: VoiceSettings; player: Player };

/** Reads the question aloud with the chosen speech connection; hidden when there is none or it's set to text only. */
function HearIt({ text, voice, player }: HearItProps) {
	const { t } = useLingui();
	const [busy, setBusy] = useState(false);
	const [requests] = useState(createRequests);
	const speech = useRef<AbortController | null>(null);
	// A reply that lands after leaving (or after a newer question) is deleted instead of played.
	useEffect(() => requests.invalidate, [requests]);
	const reader = voice.settings.speak;
	useEffect(() => () => speech.current?.abort(), [text, reader?.providerId, reader?.model]);
	if (!reader) return null;
	const stop = () => {
		requests.invalidate();
		speech.current?.abort();
		player.stop();
		setBusy(false);
	};
	const play = async () => {
		if (player.playing || busy) return stop();
		setBusy(true);
		const request = new AbortController();
		speech.current = request;
		let played = false;
		try {
			played = await playLatest(
				requests,
				() => speak(reader, text, request.signal),
				(file) => player.play(file.uri, () => deleteQuietly(file)),
				deleteQuietly,
			);
			if (played) setBusy(false);
		} catch (error) {
			if (request.signal.aborted) {
				if (speech.current === request) setBusy(false);
				return;
			}
			stop();
			showToast({ message: workspaceError(error, t`Spoken audio is unavailable. Continue with the text question.`) });
		}
	};
	return (
		<Button
			variant="ghost"
			size="sm"
			icon={player.playing || busy ? "stop" : "speaker-high"}
			label={player.playing || busy ? t`Stop audio` : t`Hear it`}
			loading={busy}
			onPress={() => void play()}
		/>
	);
}

type VoiceSettingsSheetProps = { voice: VoiceSettings; open: boolean; onClose: () => void };

/** Which connection transcribes answers and which reads questions, their models, and keeping the recording. */
function VoiceSettingsSheet({ voice, open, onClose }: VoiceSettingsSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { settings, update, transcribers, readers } = voice;
	const transcribe = settings.transcribe;
	const reader = settings.speak;
	return (
		<Sheet open={open} onClose={onClose} title={t`Voice settings`} detents={[0.75]}>
			<View style={{ gap: space.s2 }}>
				{transcribers.length > 0 && transcribe ? (
					<SelectSheet
						label={t`Transcribe answers with`}
						value={transcribe.providerId}
						options={transcribers.map((provider) => ({ value: provider.id, label: provider.label }))}
						onChange={(transcribeWith) => update({ transcribeWith, transcribeModel: undefined })}
					/>
				) : null}
				{transcribe && transcribe.models.length > 1 ? (
					<SelectSheet
						label={t`Transcription model`}
						value={transcribe.model}
						options={transcribe.models.map((model) => ({ value: model, label: model }))}
						onChange={(transcribeModel) => update({ transcribeModel })}
					/>
				) : null}
				<SelectSheet
					label={t`Read questions with`}
					value={reader?.providerId ?? "off"}
					options={[
						...readers.map((provider) => ({ value: provider.id, label: provider.label })),
						{ value: "off", label: t`Text only` },
					]}
					onChange={(speakWith) => update({ speakWith, speakModel: undefined })}
				/>
				{reader && reader.models.length > 1 ? (
					<SelectSheet
						label={t`Speech model`}
						value={reader.model}
						options={reader.models.map((model) => ({ value: model, label: model }))}
						onChange={(speakModel) => update({ speakModel })}
					/>
				) : null}
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3, paddingHorizontal: space.s4 }}>
					<Text style={{ flex: 1 }}>{t`Keep the recording on this device so I can share it`}</Text>
					<Switch
						label={t`Keep the recording on this device so I can share it`}
						value={settings.keep}
						onValueChange={(keep) => update({ keep })}
					/>
				</View>
				<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4 }}>
					{t`Speech may be billed separately by your provider. Without a speech connection, type your answer instead. The server keeps transcripts, never recordings.`}
				</Text>
			</View>
		</Sheet>
	);
}

// ---- Feedback ----

type FeedbackCardProps = { data: Practice; children?: ReactNode };

/** Always the same shape, so attempts can be compared. */
function FeedbackCard({ data, children }: FeedbackCardProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const panel = (background: string) => ({
		gap: space.s1,
		padding: space.s3,
		borderRadius: radius.rLg,
		backgroundColor: background,
	});
	return (
		<Block title={data.title}>
			<View style={panel(colors.accentSoft)}>
				<Text variant="caption" color="accentText">
					{t`What works`}
				</Text>
				<Text>{data.works}</Text>
			</View>
			<View style={panel(colors.warnSoft)}>
				<Text variant="caption" color="warnText">
					{t`Strengthen`}
				</Text>
				<Text>{data.strengthen}</Text>
			</View>
			<View style={[panel(colors.bg), { borderStartWidth: 3, borderColor: colors.line2 }]}>
				<Text variant="caption" color="ink3">
					{t`Try this opening`}
				</Text>
				<Text variant="title">“{data.opening}”</Text>
			</View>
			{children}
		</Block>
	);
}

/** A practice attempt opened from Saved: its question, answer and feedback, read-only. */
function SavedAttempt({ item }: { item: Attempt }) {
	const { t } = useLingui();
	const { space } = useTheme();
	const mode = item.data.mode === "spoken" ? t`spoken` : t`typed`;
	return (
		<View style={{ gap: space.s4 }}>
			<Block title={item.data.origin === "recalled" ? t`Recalled` : t`Practice`}>
				<Text variant="heading">{item.data.question}</Text>
			</Block>
			<Block title={t`Your answer · ${mode}`}>
				<Text>{item.data.answer}</Text>
			</Block>
			<FeedbackCard data={item.data} />
		</View>
	);
}
