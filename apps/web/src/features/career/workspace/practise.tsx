import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { AI_VOICE_MODELS } from "@reactive-resume/ai/types";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { useCoachKnowledge } from "../coach-thread";
import { latest, useDefaultProvider, useGenerate, useSavedItems, useSessionDraft } from "../hooks";
import { CollapseRow, PrivacyLine, useCareerTime, Working, workingSteps } from "../shared";
import {
	acceptAudioFile,
	canDictate,
	canRecord,
	canSpeakAloud,
	clock,
	dictate,
	MAX_SECONDS,
	record,
	speakAloud,
	writeNumbersAsDigits,
} from "./recorder";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { D2, EASE, ENTER_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

type Practice = SavedData<"practice">;
type Attempt = SavedItem & { data: Practice };
type Question = { text: string; origin: Practice["origin"] };
type Mode = Practice["mode"];

const isAttempt = (item: SavedItem): item is Attempt => item.data.kind === "practice";

/** The briefing's practice questions for this interview, then questions recalled in Debrief; generic ones without either. */
function practiceQuestions(items: SavedItem[] | undefined, interviewId: string | undefined, company: string) {
	const simulated = latest(items, "briefing", interviewId)?.data.practiceQuestions ?? [];
	const recalled = (items ?? []).flatMap((item) => (item.data.kind === "debrief" ? [item.data.question] : []));
	const questions: Question[] = [
		...simulated.map((text) => ({ text, origin: "simulated" as const })),
		...[...new Set(recalled)].map((text) => ({ text, origin: "recalled" as const })),
	];
	if (questions.length > 0) return questions;
	return [
		t`Tell me about a piece of work you're proud of. What was your part in it, and how did you measure success?`,
		t`Tell me about a time you disagreed with a colleague. How did you resolve it?`,
		t`Why do you want this role at ${company}?`,
	].map((text) => ({ text, origin: "simulated" as const }));
}

export function PractiseTab({ application, version, interview, speak, story, now, go }: WorkspaceTabProps) {
	const saved = useSavedItems(application.id);
	const knowledge = useCoachKnowledge(application.id);
	const voice = useVoiceSettings();
	const viewing = version && isAttempt(version) ? version : undefined;
	const attempts = saved.data?.filter(isAttempt) ?? [];
	const selectedStory = story ? knowledge.stories.find((item) => item.id === story) : undefined;
	const questions: Question[] = selectedStory
		? [
				{
					text: t`Tell me about “${selectedStory.data.title}”. What was your part, what did you do, and what changed?`,
					origin: "simulated",
				},
			]
		: practiceQuestions(saved.data, interview?.id, application.company);
	if (story && knowledge.isError)
		return (
			<Notice icon="warning-circle">
				<span>
					<Trans>Your story couldn't be loaded.</Trans>
				</span>
				<Button onClick={() => knowledge.retry()}>
					<Trans>Try again</Trans>
				</Button>
			</Notice>
		);
	if (story && !knowledge.loaded) return <Skeleton className="h-60 rounded-xl" />;
	if (story && !selectedStory)
		return (
			<Notice icon="warning-circle">
				<span>
					{knowledge.allStories.some((item) => item.id === story) ? (
						<Trans>
							This story has no facts in use here. Link a fact to it in Knowledge, or switch its facts on, to practice
							it.
						</Trans>
					) : (
						<Trans>This story is unavailable or uses facts that are switched off.</Trans>
					)}
				</span>
				<Button variant="secondary" onClick={() => go("practise")}>
					<Trans>Practice another question</Trans>
				</Button>
			</Notice>
		);

	return (
		<div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_280px]">
			{viewing ? (
				<SavedAttempt item={viewing} />
			) : saved.isPending ? (
				<div className="grid gap-4">
					<Skeleton className="h-40 rounded-xl" />
					<Skeleton className="h-60 rounded-xl" />
				</div>
			) : (
				<Session
					key={`${application.id}:${interview?.id ?? "none"}:${story ?? "general"}`}
					applicationId={application.id}
					interviewId={interview?.id ?? null}
					questions={questions}
					storyId={selectedStory?.id}
					storyTitle={selectedStory?.data.title}
					voice={voice}
					initialMode={speak ? "spoken" : "typed"}
				/>
			)}
			<aside className="grid gap-3 rounded-xl border border-line bg-surface p-4">
				<h2 className="border-b border-line pb-3 text-sm font-semibold">
					<Trans>Your attempts</Trans>
				</h2>
				{attempts.length === 0 ? (
					<p className="text-[13px] leading-[19px] text-ink-3">
						<Trans>Each answer you get feedback on is kept here, newest first.</Trans>
					</p>
				) : (
					<ul className="-mx-2 grid gap-0.5">
						{attempts.map((item) => (
							<li key={item.id}>
								<AttemptRow
									item={item}
									now={now}
									current={item.id === viewing?.id}
									onOpen={() => go("practise", { version: item.id })}
								/>
							</li>
						))}
					</ul>
				)}
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						Compare attempts to see what improved. Practice questions are simulated, not from {application.company}.
					</Trans>
				</p>
			</aside>
		</div>
	);
}

type AttemptRowProps = { item: Attempt; now: Date; current: boolean; onOpen: () => void };

function AttemptRow({ item, now, current, onOpen }: AttemptRowProps) {
	const { day, time, when } = useCareerTime();
	const hour = time(item.createdAt);
	const at = day(item.createdAt) === day(now) ? t`Today, ${hour}` : when(item.createdAt);
	return (
		<button
			type="button"
			aria-current={current || undefined}
			onClick={onOpen}
			className="grid w-full gap-1 rounded-lg px-2 py-2 text-start transition-colors duration-quick hover:bg-hover aria-[current]:bg-sunken"
		>
			<span className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon name={item.data.mode === "spoken" ? "microphone" : "keyboard"} size={15} />
				{at} · {item.data.mode === "spoken" ? t`spoken` : t`typed`}
			</span>
			<q className="line-clamp-2 text-[13px] leading-[19px] text-ink">{item.data.answer}</q>
			{item.data.note && <span className="text-xs text-warn-text">{item.data.note}</span>}
		</button>
	);
}

// ---- One question at a time ----

type VoiceSettings = ReturnType<typeof useVoiceSettings>;
/** A transcribed answer; `id` is the server's transcript, null when the browser took dictation. */
type Spoken = { id: string | null; text: string; seconds: number | null };
const practiceDraftSchema = z.object({
	question: z.object({ text: z.string().min(1).max(500), origin: z.enum(["simulated", "recalled"]) }),
	mode: z.enum(["typed", "spoken"]),
	answer: z.string().max(6000),
	spoken: z
		.object({ id: z.string().nullable(), text: z.string().max(6000), seconds: z.number().nullable() })
		.nullable(),
});
type PracticeDraft = z.infer<typeof practiceDraftSchema>;
type Audio = { file: File; url: string; seconds: number | null };
type Step =
	| { name: "idle" }
	| { name: "starting" }
	| { name: "recording"; seconds: number }
	| { name: "transcribing" }
	| { name: "blocked" }
	| { name: "failed"; message: string }
	| { name: "error" };

type SessionProps = {
	applicationId: string;
	interviewId: string | null;
	questions: Question[];
	storyId: string | undefined;
	storyTitle: string | undefined;
	voice: VoiceSettings;
	initialMode: Mode;
};

function Session({ applicationId, interviewId, questions, voice, initialMode, storyId, storyTitle }: SessionProps) {
	const id = useId();
	const generate = useGenerate(applicationId);
	const connection = useDefaultProvider();
	const { provider } = connection;
	const draft = useSessionDraft<PracticeDraft>(
		`practice:${applicationId}:${interviewId ?? "none"}:${storyId ?? "general"}`,
		{
			question: questions[0] ?? { text: t`Tell me about a piece of work you're proud of.`, origin: "simulated" },
			mode: initialMode,
			answer: "",
			spoken: null,
		},
		(value) => {
			const parsed = practiceDraftSchema.safeParse(value);
			return parsed.success ? parsed.data : undefined;
		},
	);
	const { question, mode, answer, spoken } = draft.value;
	const setMode = (mode: Mode) => draft.setValue((current) => ({ ...current, mode }));
	const setAnswer = (answer: string) => draft.setValue((current) => ({ ...current, answer }));
	const setSpoken = (spoken: Spoken | null) => draft.setValue((current) => ({ ...current, spoken }));
	const index = Math.max(
		0,
		questions.findIndex((item) => item.text === question.text),
	);
	const [feedback, setFeedback] = useState<{ answer: string; data: Practice } | null>(null);
	const [step, setStep] = useState<Step>({ name: "idle" });
	const [audio, setAudio] = useState<Audio | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const recording = useRef<{ stop: () => void; cancel: () => void } | null>(null);
	// What the browser's dictation has heard so far.
	const [heard, setHeard] = useState("");
	const { i18n } = useLingui();
	const fileInput = useRef<HTMLInputElement>(null);
	const alive = useRef(true);
	const transcription = useRef<AbortController | null>(null);
	useEffect(
		() => () => transcription.current?.abort(),
		[applicationId, voice.settings.transcribe.providerId, voice.settings.transcribe.model],
	);

	const browserDictation = voice.settings.transcribe.providerId === BROWSER;
	const canHear = !connection.isUnavailable && (voice.settings.speak.providerId !== BROWSER || canSpeakAloud());
	const canTalk = !connection.isUnavailable && (!browserDictation || canDictate());
	const busy = step.name === "starting" || step.name === "recording" || step.name === "transcribing";
	const showFeedback = feedback !== null && feedback.answer === answer;
	// Asking again for the same words would only save a duplicate attempt.
	const ready = answer.trim().length >= 10 && (mode === "typed" || spoken !== null) && !busy && !showFeedback;

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			recording.current?.cancel();
		};
	}, []);
	// The recording lives only in this browser tab; its object URL goes when it's replaced or the tab closes.
	useEffect(() => () => (audio ? URL.revokeObjectURL(audio.url) : undefined), [audio]);

	if (!question) return null;

	const transcribe = async (next: Audio) => {
		if (connection.isUnavailable) return;
		transcription.current?.abort();
		const request = new AbortController();
		transcription.current = request;
		setStep({ name: "transcribing" });
		try {
			const result = await client.career.voice.transcribe(
				{
					providerId: voice.settings.transcribe.providerId,
					model: voice.settings.transcribe.model,
					applicationId,
					audio: next.file,
				},
				{ signal: request.signal },
			);
			if (!alive.current || request.signal.aborted) return;
			setAnswer(result.text);
			setSpoken({ id: result.id, text: result.text, seconds: next.seconds });
			setStep({ name: "idle" });
			if (!voice.settings.keep) setAudio(null);
		} catch {
			if (alive.current && transcription.current === request)
				setStep(request.signal.aborted ? { name: "idle" } : { name: "error" });
		}
	};
	const takeAudio = (file: File, seconds: number | null) => {
		const next = { file, url: URL.createObjectURL(file), seconds };
		setAudio(next);
		void transcribe(next);
	};
	const startDictation = () => {
		setHeard("");
		try {
			recording.current = dictate({
				lang: i18n.locale,
				onTick: (seconds) => setStep({ name: "recording", seconds }),
				onText: setHeard,
				onStop: (text, seconds, atLimit) => {
					recording.current = null;
					setAnnouncement(t`Stopped at ${clock(seconds)}`);
					if (atLimit) toast.add({ description: t`Dictation stopped at the 2-minute limit.` });
					if (!text) return setStep({ name: "failed", message: t`Nothing was heard. Try again, or type your answer.` });
					setAnswer(text);
					setSpoken({ id: null, text, seconds });
					setStep({ name: "idle" });
				},
				onError: (error) => {
					recording.current = null;
					setStep(
						error === "not-allowed" || error === "service-not-allowed"
							? { name: "blocked" }
							: error === "no-speech"
								? { name: "failed", message: t`Nothing was heard. Try again, or type your answer.` }
								: { name: "failed", message: t`Your browser's dictation stopped. Try again, or type your answer.` },
					);
				},
			});
			setStep({ name: "recording", seconds: 0 });
			setAnnouncement(t`Dictation started`);
		} catch {
			setStep({ name: "failed", message: t`Your browser can't take dictation here. Type your answer instead.` });
		}
	};
	const startRecording = async () => {
		if (connection.isUnavailable) return;
		if (browserDictation) return startDictation();
		if (!canRecord())
			return setStep({
				name: "failed",
				message: t`This browser can't record here. Choose an audio file, or type your answer.`,
			});
		setStep({ name: "starting" });
		try {
			const started = await record({
				onTick: (seconds) => setStep({ name: "recording", seconds }),
				onStop: (file, seconds, atLimit) => {
					recording.current = null;
					setAnnouncement(t`Stopped at ${clock(seconds)}`);
					if (atLimit)
						toast.add({ description: t`Recording stopped at the 2-minute limit. Transcribing what you said.` });
					if (file) takeAudio(file, seconds);
					else setStep({ name: "failed", message: t`That recording was empty or over 2 MB. Try a shorter answer.` });
				},
			});
			if (!alive.current) return started.cancel();
			recording.current = started;
			setStep({ name: "recording", seconds: 0 });
			setAnnouncement(t`Recording started`);
		} catch (error) {
			setStep(
				error instanceof DOMException && error.name === "NotAllowedError"
					? { name: "blocked" }
					: { name: "failed", message: t`Couldn't start recording. Choose an audio file, or type your answer.` },
			);
		}
	};
	const toggleRecording = () => {
		if (step.name === "recording") recording.current?.stop();
		else if (step.name !== "starting" && step.name !== "transcribing") void startRecording();
	};
	const chooseMode = (next: Mode) => {
		transcription.current?.abort();
		if (step.name === "transcribing") setStep({ name: "idle" });
		if (next === "typed" && recording.current) {
			recording.current.cancel();
			recording.current = null;
			setStep({ name: "idle" });
		}
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
		if (spoken?.id && text !== spoken.text)
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

	const providerName = provider?.label ?? t`your AI connection`;
	const recordingNow = step.name === "recording";
	const elapsed = clock(recordingNow ? step.seconds : 0);
	const model = voice.settings.transcribe.model;
	const position = (index % questions.length) + 1;
	const total = questions.length;
	const answerField = (
		<Textarea
			id={`${id}-answer`}
			aria-labelledby={`${id}-heading`}
			value={answer}
			maxLength={6000}
			placeholder={t`About 90 seconds when spoken`}
			onChange={(event) => setAnswer(event.target.value)}
			className="min-h-28 px-3.5 py-3 text-[15px] leading-[23px] pointer-coarse:text-base"
		/>
	);

	return (
		<div className="grid min-w-0 gap-4">
			<section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="font-mono text-xs font-medium text-ink-2">
						{t`Question ${position} of ${total}`} · {question.origin === "recalled" ? t`Recalled` : t`Practice`}
					</p>
					{canHear && (
						<HearIt
							key={`${question.text}:${voice.settings.speak.providerId}:${voice.settings.speak.model}`}
							text={question.text}
							voice={voice}
						/>
					)}
				</div>
				<h2 className="font-display text-[22px] leading-[29px]">{question.text}</h2>
				{storyTitle && <p className="text-sm text-ink-2">{t`Practicing your story: ${storyTitle}`}</p>}
			</section>

			{/* Space starts and stops recording while focus is in this card (the record button handles it natively). */}
			<section
				aria-labelledby={`${id}-heading`}
				className="grid gap-4 rounded-xl border border-line bg-surface p-4 outline-none md:p-5"
				tabIndex={-1}
				onKeyDown={(event) => {
					if (event.key !== " " || mode !== "spoken" || !canTalk || spoken || event.target !== event.currentTarget)
						return;
					event.preventDefault();
					toggleRecording();
				}}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id={`${id}-heading`} className="text-sm font-semibold">
						<Trans>Your answer</Trans>
					</h2>
					<ModeSwitch value={mode} onChange={chooseMode} />
				</div>

				{mode === "typed" ? (
					answerField
				) : connection.isUnavailable ? (
					<AiProviderLoadState state={connection} />
				) : !canTalk ? (
					<p className="rounded-lg bg-sunken px-3.5 py-3 text-[13px] leading-[19px] text-ink-2">
						<Trans>
							This browser can't take dictation, and none of your AI connections can transcribe speech (OpenAI, Google
							Gemini, Mistral, xAI, Groq or Vercel AI Gateway can). <SetUpAi />, or type your answer.
						</Trans>
					</p>
				) : spoken ? (
					<>
						<p className="-mb-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
							<Icon name="waveform" size={16} />
							<Trans>Transcribed</Trans>
							{spoken.seconds !== null && <span className="font-mono">· {clock(spoken.seconds)}</span>}
							<span>
								· <Trans>check numbers and names before using it</Trans>
							</span>
						</p>
						{answerField}
						<div className="-mt-1 flex flex-wrap gap-2">
							<Button size="sm" variant="secondary" onClick={() => setAnswer(writeNumbersAsDigits(answer))}>
								<Trans>Write numbers as digits</Trans>
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setSpoken(null);
									void startRecording();
								}}
							>
								<Trans>Record again</Trans>
							</Button>
						</div>
					</>
				) : step.name === "transcribing" ? (
					<p role="status" className="flex items-center gap-2.5 rounded-lg bg-sunken px-3.5 py-3 text-sm text-ink-2">
						<Spinner decorative className="text-accent" />
						<Trans>Transcribing with {model}…</Trans>
					</p>
				) : step.name === "error" ? (
					<Notice icon="warning-circle">
						<span className="min-w-0 flex-1">
							<Trans>Couldn't transcribe. Your recording is still here.</Trans>
						</span>
						<span className="flex gap-1">
							<Button size="sm" variant="secondary" onClick={() => audio && void transcribe(audio)}>
								<Trans>Try again</Trans>
							</Button>
							<Button size="sm" variant="ghost" onClick={() => chooseMode("typed")}>
								<Trans>Type instead</Trans>
							</Button>
						</span>
					</Notice>
				) : (
					<>
						<div
							className={cn(
								"flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-lg p-3.5 transition-colors duration-quick",
								recordingNow ? "bg-danger-soft" : "bg-sunken",
							)}
						>
							{/* One button for both, so focus stays on it and Space stops what Space started. */}
							<button
								type="button"
								aria-label={recordingNow ? t`Stop recording` : t`Record your answer`}
								onClick={toggleRecording}
								className="touch-target relative grid size-[52px] shrink-0 place-items-center rounded-sm bg-danger text-white transition-[filter,scale] duration-quick ease-enter hover:brightness-95 active:scale-[0.97]"
							>
								<Icon name={recordingNow ? "stop" : "microphone"} filled={recordingNow} size={24} />
							</button>
							<div className="grid min-w-0 flex-1 basis-48 gap-0.5">
								{recordingNow ? (
									<>
										<p className="text-sm font-semibold text-danger-text">
											<Trans>Recording · {elapsed}</Trans>
										</p>
										<p className="text-[13px] leading-[19px] text-ink-2">
											{browserDictation ? (
												heard || <Trans>Listening… Stop when you're done.</Trans>
											) : (
												<Trans>Stop when you're done. Nothing is sent until then.</Trans>
											)}
										</p>
									</>
								) : (
									<>
										<p className="text-sm font-semibold">
											<Trans>Record your answer</Trans>
										</p>
										<p className="text-[13px] leading-[19px] text-ink-2">
											{browserDictation ? (
												<Trans>Up to 2 minutes. Your words appear as you speak.</Trans>
											) : (
												<Trans>
													Up to 2 minutes. Or{" "}
													<button
														type="button"
														className="underline underline-offset-3 hover:text-ink"
														onClick={() => fileInput.current?.click()}
													>
														choose an audio file
													</button>{" "}
													up to 2 MB.
												</Trans>
											)}
										</p>
									</>
								)}
							</div>
							{recordingNow && (
								<div
									role="progressbar"
									aria-label={t`Recording time`}
									aria-valuemin={0}
									aria-valuemax={MAX_SECONDS}
									aria-valuenow={step.seconds}
									aria-valuetext={clock(step.seconds)}
									className="h-1.5 w-[180px] max-w-full overflow-hidden rounded-sm bg-bg"
								>
									<div
										className="h-full rounded-sm bg-danger-text transition-[width] duration-1000 ease-linear"
										style={{ width: `${(step.seconds / MAX_SECONDS) * 100}%` }}
									/>
								</div>
							)}
							<input
								ref={fileInput}
								type="file"
								accept="audio/*"
								hidden
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									if (!file) return;
									const accepted = acceptAudioFile(file);
									if (accepted) takeAudio(accepted, null);
									else setStep({ name: "failed", message: t`Choose a WebM, MP4, MP3, WAV or Ogg file up to 2 MB.` });
								}}
							/>
						</div>
						{step.name === "blocked" && (
							<Notice icon="warning-circle">
								<span className="min-w-0 flex-1">
									<Trans>Microphone blocked. Allow it in your browser settings, or type your answer.</Trans>
								</span>
								<Button size="sm" variant="secondary" onClick={() => chooseMode("typed")}>
									<Icon name="keyboard" size={16} />
									<Trans>Type instead</Trans>
								</Button>
							</Notice>
						)}
						{step.name === "failed" && <Notice icon="warning-circle">{step.message}</Notice>}
					</>
				)}
				<p className="sr-only" aria-live="polite">
					{announcement}
				</p>

				{mode === "spoken" && canTalk && (
					<PrivacyLine>
						{browserDictation
							? t`Your browser turns your speech into text. Depending on the browser, its maker may process the audio (Google in Chrome, Apple in Safari).`
							: t`Your recording goes to ${voice.settings.transcribe.label} to be transcribed, which may use tokens on that account.`}
					</PrivacyLine>
				)}
				{mode === "spoken" && <VoiceSettingsPanel voice={voice} audio={audio} disabled={busy} />}

				<div className="grid gap-2.5">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<Button disabled={!ready || !provider} loading={generate.isPending} onClick={getFeedback}>
							{generate.isPending ? <Working steps={workingSteps("practice")} /> : <Trans>Get feedback</Trans>}
						</Button>
						<p className="text-xs text-ink-2">
							<Trans>Compared with your stories and the posting.</Trans>
						</p>
					</div>
					{connection.isUnavailable ? (
						<AiProviderLoadState state={connection} />
					) : provider ? (
						<PrivacyLine>
							<Trans>
								Get feedback sends the question, your answer, this posting and your stories to {providerName}.
							</Trans>
						</PrivacyLine>
					) : (
						<PrivacyLine>
							<Trans>
								Feedback needs an AI connection. <SetUpAi />. Nothing is sent until you ask.
							</Trans>
						</PrivacyLine>
					)}
				</div>
			</section>

			{feedback && showFeedback && (
				<FeedbackCard data={feedback.data}>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							variant="secondary"
							onClick={() => {
								chooseMode("typed");
								setSpoken(null);
								setAnswer(feedback.data.opening);
							}}
						>
							<Trans>Try again with this</Trans>
						</Button>
						<Button size="sm" variant="ghost" onClick={nextQuestion}>
							<Trans>Next question</Trans>
							<Icon name="arrow-right" size={16} />
						</Button>
						<span className="ms-auto flex items-center gap-1 text-xs text-ink-3">
							<Icon name="check-circle" size={15} />
							<Trans>Saved to Library · Practice</Trans>
						</span>
					</div>
				</FeedbackCard>
			)}
		</div>
	);
}

function Notice({ icon, children }: { icon: IconName; children: ReactNode }) {
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg bg-danger-soft px-3.5 py-3 text-[13px] leading-[19px] text-danger-text"
		>
			<Icon name={icon} size={18} className="shrink-0" />
			{children}
		</div>
	);
}

function ModeSwitch({ value, onChange }: { value: Mode; onChange: (mode: Mode) => void }) {
	const id = useId();
	const options = [
		{ value: "typed", label: t`Type`, icon: "keyboard" },
		{ value: "spoken", label: t`Speak`, icon: "microphone" },
	] as const;
	return (
		<SegmentedControl aria-label={t`Answer by`} value={value} onValueChange={(next) => onChange(next as Mode)}>
			{options.map((option) => (
				<SegmentedControlItem
					key={option.value}
					value={option.value}
					className="relative data-checked:bg-transparent data-checked:shadow-none"
				>
					{value === option.value && (
						<m.span
							layoutId={`${id}-thumb`}
							transition={{ duration: D2, ease: EASE }}
							className="absolute inset-0 rounded-sm bg-raised shadow-e1"
						/>
					)}
					<Icon name={option.icon} size={16} className="relative" />
					<span className="relative">{option.label}</span>
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

function HearIt({ text, voice }: { text: string; voice: VoiceSettings }) {
	const { i18n } = useLingui();
	const [busy, setBusy] = useState(false);
	const [playing, setPlaying] = useState(false);
	const playback = useRef<(() => void) | null>(null);
	const request = useRef(0);
	const speech = useRef<AbortController | null>(null);
	const reader = voice.settings.speak;
	useEffect(
		() => () => {
			request.current += 1;
			speech.current?.abort();
			playback.current?.();
			playback.current = null;
		},
		[text, reader.providerId, reader.model],
	);
	const stop = () => {
		request.current += 1;
		speech.current?.abort();
		playback.current?.();
		playback.current = null;
		setPlaying(false);
		setBusy(false);
	};
	const play = async () => {
		if (playing || busy) return stop();
		const generation = ++request.current;
		const controller = new AbortController();
		speech.current = controller;
		if (reader.providerId === BROWSER) {
			setPlaying(true);
			playback.current = speakAloud(text, i18n.locale, () => setPlaying(false));
			return;
		}
		setBusy(true);
		try {
			const result = await client.career.voice.speak(
				{ providerId: reader.providerId, model: reader.model, text },
				{ signal: controller.signal },
			);
			if (generation !== request.current) return;
			const bytes = Uint8Array.from(atob(result.audio), (character) => character.charCodeAt(0));
			const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType }));
			const player = new Audio(url);
			playback.current = () => {
				player.removeEventListener("ended", stop);
				player.removeEventListener("error", stop);
				player.pause();
				URL.revokeObjectURL(url);
			};
			player.addEventListener("ended", stop, { once: true });
			player.addEventListener("error", stop, { once: true });
			await player.play();
			if (generation === request.current) setPlaying(true);
		} catch (error) {
			if (controller.signal.aborted) {
				if (speech.current === controller) setBusy(false);
				return;
			}
			if (generation !== request.current) return;
			stop();
			toastError(error, t`Spoken audio is unavailable. Continue with the text question.`, { allowServerMessage: true });
		} finally {
			if (generation === request.current) setBusy(false);
		}
	};
	return (
		<Tooltip>
			<TooltipTrigger render={<Button size="sm" variant="ghost" onClick={() => void play()} />}>
				<Icon name={playing || busy ? "stop" : "speaker-high"} size={16} />
				{playing || busy ? <Trans>Stop audio</Trans> : <Trans>Hear it</Trans>}
			</TooltipTrigger>
			<TooltipContent>
				{reader.providerId === BROWSER
					? t`Read aloud by your browser's voice.`
					: t`Read aloud by ${reader.label}, which may use tokens on that account.`}
			</TooltipContent>
		</Tooltip>
	);
}

// ---- Voice settings: kept in this browser ----

/** The browser's own speech, used when no connection offers a speech model. */
const BROWSER = "browser";
const VOICE_KEY = "career-voice-settings";
type StoredVoice = {
	transcribeWith?: string;
	transcribeModel?: string | undefined;
	speakWith?: string;
	speakModel?: string | undefined;
	keep?: boolean;
};
type VoiceKind = "transcription" | "speech";
type VoiceChoice = { providerId: string; label: string; model: string; models: readonly string[] };

/**
 * Who transcribes answers and who reads questions aloud: a connection whose provider offers that kind of speech model
 * (the first one, unless another was chosen), otherwise the browser.
 */
function useVoiceSettings() {
	const providerState = useHasUsableAiProvider();
	const { usableProviders } = providerState;
	const capable = (kind: VoiceKind) =>
		usableProviders.filter((provider) => (AI_VOICE_MODELS[provider.provider]?.[kind].length ?? 0) > 0);
	const transcribers = capable("transcription");
	const readers = capable("speech");
	const [stored, setStored] = useState<StoredVoice>(() => {
		try {
			return JSON.parse(localStorage.getItem(VOICE_KEY) ?? "{}") as StoredVoice;
		} catch {
			return {};
		}
	});
	const update = (patch: StoredVoice) => {
		const next = { ...stored, ...patch };
		setStored(next);
		try {
			localStorage.setItem(VOICE_KEY, JSON.stringify(next));
		} catch {
			// Storage is blocked: the choice lasts for this visit.
		}
	};
	const choose = (
		list: typeof usableProviders,
		kind: VoiceKind,
		id: string | undefined,
		model: string | undefined,
	): VoiceChoice => {
		const provider = list.find((item) => item.id === id) ?? (id === BROWSER ? undefined : list[0]);
		if (!provider) return { providerId: BROWSER, label: t`Your browser`, model: "", models: [] };
		const models = AI_VOICE_MODELS[provider.provider]?.[kind] ?? [];
		return {
			providerId: provider.id,
			label: provider.label,
			model: models.find((item) => item === model) ?? models[0] ?? "",
			models,
		};
	};
	return {
		providerState,
		transcribers,
		readers,
		update,
		settings: {
			transcribe: choose(transcribers, "transcription", stored.transcribeWith, stored.transcribeModel),
			speak: choose(readers, "speech", stored.speakWith, stored.speakModel),
			keep: stored.keep === true,
		},
	};
}

type VoiceSettingsPanelProps = { voice: VoiceSettings; audio: Audio | null; disabled: boolean };

function VoiceSettingsPanel({ voice, audio, disabled }: VoiceSettingsPanelProps) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const { settings, update, transcribers, readers } = voice;
	const browserTranscribes = settings.transcribe.providerId === BROWSER;
	if (voice.providerState.isUnavailable) return null;
	return (
		<div className="grid">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="touch-target relative flex w-fit items-center gap-1 rounded-sm py-1 text-xs font-medium text-ink-2 transition-colors duration-quick hover:text-ink"
			>
				<Icon
					name="caret-right"
					size={16}
					className={cn("transition-transform duration-standard ease-enter", open && "rotate-90")}
				/>
				<Trans>Voice settings</Trans>
			</button>
			<AnimatePresence initial={false}>
				{open && (
					<CollapseRow>
						<div className="mt-2 grid gap-3 rounded-lg bg-bg p-3">
							<div className="grid gap-3 sm:grid-cols-2">
								<VoiceSelect
									id={`${id}-transcribe`}
									label={t`Transcribe answers with`}
									choice={settings.transcribe}
									connections={transcribers}
									browser={canDictate()}
									disabled={disabled}
									onChange={(transcribeWith, transcribeModel) => update({ transcribeWith, transcribeModel })}
								/>
								<VoiceSelect
									id={`${id}-speak`}
									label={t`Read questions with`}
									choice={settings.speak}
									connections={readers}
									browser={canSpeakAloud()}
									disabled={false}
									onChange={(speakWith, speakModel) => update({ speakWith, speakModel })}
								/>
							</div>
							{!browserTranscribes && (
								<div className="flex flex-wrap items-center justify-between gap-2">
									<label htmlFor={`${id}-keep`} className="flex items-center gap-2.5 text-[13px]">
										<Checkbox id={`${id}-keep`} checked={settings.keep} onCheckedChange={(keep) => update({ keep })} />
										<Trans>Keep the recording in this browser so I can download it</Trans>
									</label>
									{settings.keep && audio && (
										<a
											href={audio.url}
											download={audio.file.name}
											className="flex items-center gap-1 text-[13px] text-accent-text underline-offset-3 hover:underline"
										>
											<Icon name="download-simple" size={16} />
											<Trans>Download</Trans>
										</a>
									)}
								</div>
							)}
							<p className="text-xs leading-[17px] text-ink-3">
								<Trans>
									Connections bill speech separately and may use tokens on your account. Your browser's speech is free,
									but its maker may process the audio. The server keeps transcripts, never recordings.
								</Trans>
							</p>
						</div>
					</CollapseRow>
				)}
			</AnimatePresence>
		</div>
	);
}

type VoiceSelectProps = {
	id: string;
	label: string;
	choice: VoiceChoice;
	connections: ReturnType<typeof useHasUsableAiProvider>["usableProviders"];
	/** Whether the browser can do this itself. */
	browser: boolean;
	disabled: boolean;
	onChange: (providerId: string, model: string | undefined) => void;
};

/** A connection (or the browser) for one kind of speech, and its model when the connection offers several. */
function VoiceSelect({ id, label, choice, connections, browser, disabled, onChange }: VoiceSelectProps) {
	return (
		<div className="grid content-start gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<NativeSelect
				id={id}
				value={choice.providerId}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value, undefined)}
			>
				{connections.map((provider) => (
					<option key={provider.id} value={provider.id}>
						{provider.label}
					</option>
				))}
				{(browser || choice.providerId === BROWSER) && <option value={BROWSER}>{t`Your browser`}</option>}
			</NativeSelect>
			{choice.models.length > 1 && (
				<NativeSelect
					aria-label={t`Model for ${label}`}
					value={choice.model}
					disabled={disabled}
					onChange={(event) => onChange(choice.providerId, event.target.value)}
				>
					{choice.models.map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</NativeSelect>
			)}
		</div>
	);
}

// ---- Feedback ----

type FeedbackCardProps = { data: Practice; children?: ReactNode };

/** Always the same shape, so attempts can be compared. Appears with a short rise when it arrives. */
function FeedbackCard({ data, children }: FeedbackCardProps) {
	return (
		<section
			aria-label={t`Feedback`}
			className={cn("grid gap-4 rounded-xl border border-line bg-surface p-4 md:p-5", ENTER_CLASS)}
		>
			<h2 className="text-base font-semibold">{data.title}</h2>
			<div className="grid gap-2.5 sm:grid-cols-2">
				<div className="grid content-start gap-1.5 rounded-lg bg-accent-soft p-3.5">
					<p className="flex items-center gap-1.5 text-xs font-semibold text-accent-text">
						<Icon name="thumbs-up" size={16} />
						<Trans>What works</Trans>
					</p>
					<p className="text-sm leading-[21px]">{data.works}</p>
				</div>
				<div className="grid content-start gap-1.5 rounded-lg bg-warn-soft p-3.5">
					<p className="flex items-center gap-1.5 text-xs font-semibold text-warn-text">
						<Icon name="wrench" size={16} />
						<Trans>Strengthen</Trans>
					</p>
					<p className="text-sm leading-[21px]">{data.strengthen}</p>
				</div>
			</div>
			<div className="grid gap-1.5 rounded-e-lg border-s-[3px] border-line-2 bg-bg py-3 ps-4 pe-4">
				<p className="text-xs font-semibold text-ink-3">
					<Trans>Try this opening</Trans>
				</p>
				<q className="font-display text-base leading-6 md:text-[17px] md:leading-[26px]">{data.opening}</q>
			</div>
			{children}
		</section>
	);
}

/** A practice attempt opened from Saved: its question, answer and feedback, read-only. */
function SavedAttempt({ item }: { item: Attempt }) {
	return (
		<div className="grid min-w-0 gap-4">
			<section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
				<p className="font-mono text-xs font-medium text-ink-2">
					{item.data.origin === "recalled" ? t`Recalled` : t`Practice`}
				</p>
				<h2 className="font-display text-[22px] leading-[29px]">{item.data.question}</h2>
			</section>
			<section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:p-5">
				<h2 className="flex items-center gap-1.5 text-sm font-semibold">
					<Trans>Your answer</Trans>
					<span className="flex items-center gap-1 text-xs font-normal text-ink-3">
						· <Icon name={item.data.mode === "spoken" ? "microphone" : "keyboard"} size={15} />
						{item.data.mode === "spoken" ? t`spoken` : t`typed`}
					</span>
				</h2>
				<p className="rounded-md border border-line bg-raised px-3.5 py-3 text-[15px] leading-[23px] whitespace-pre-wrap">
					{item.data.answer}
				</p>
			</section>
			<FeedbackCard data={item.data} />
		</div>
	);
}
