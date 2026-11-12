import type { SavedData, SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
import type { PracticeQuestion as Question } from "@reactive-resume/schema/career-practice";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { ph, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { m } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { AI_VOICE_MODELS } from "@reactive-resume/ai/types";
import { threePracticeQuestions } from "@reactive-resume/schema/career-practice";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
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
import { CollapseRow, useCareerTime, useNow, GenerateNotice, Working, workingSteps } from "../shared";
import { AiNotice } from "./fit";
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
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { interviewTypeLabel } from "@/features/applications/components/interview-dialog";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { D2, EASE, ENTER_CLASS } from "@/libs/motion";
import { client } from "@/libs/orpc/client";

type Practice = SavedData<"practice">;
type Attempt = SavedItem & { data: Practice };
type Mode = Practice["mode"];

const isAttempt = (item: SavedItem): item is Attempt => item.data.kind === "practice";

/** The briefing's practice questions for this interview, then questions recalled in Debrief; generic ones without either. */
function practiceQuestions(
	items: SavedItem[] | undefined,
	interviewId: string | undefined,
	company: string,
	warmup = false,
) {
	const simulated = latest(items, "briefing", interviewId)?.data.practiceQuestions ?? [];
	const recalled = (items ?? []).flatMap((item) => (item.data.kind === "debrief" ? [item.data.question] : []));
	const questions: Question[] = [
		...simulated.map((text) => ({ text, origin: "simulated" as const })),
		...[...new Set(recalled)].map((text) => ({ text, origin: "recalled" as const })),
	];
	const fallbacks = [
		t`Tell me about a piece of work you're proud of. What was your part in it, and how did you measure success?`,
		t`Tell me about a time you disagreed with a colleague. How did you resolve it?`,
		t`Why do you want this role at ${company}?`,
	];
	if (warmup) return threePracticeQuestions(questions, fallbacks);
	return questions.length > 0 ? questions : fallbacks.map((text) => ({ text, origin: "simulated" as const }));
}

type PractiseProps = Omit<WorkspaceTabProps, "application"> & { application: WorkspaceTabProps["application"] | null };

type StoryPracticeProps = { storyId: string };

export function StoryPractice({ storyId }: StoryPracticeProps) {
	const saved = useSavedItems(null);
	const [versionId, setVersionId] = useState<string>();
	const now = useNow();
	return (
		<div className="grid gap-3">
			<p className="text-sm text-ink-2">
				<Trans>Practice without an application</Trans>
			</p>
			<PractiseTab
				application={null}
				version={saved.data?.find((item) => item.id === versionId && item.evidence.storyIds.includes(storyId))}
				interview={undefined}
				speak={true}
				story={storyId}
				now={now}
				go={(_tab, search) => setVersionId(search?.version)}
			/>
		</div>
	);
}

export function PractiseTab({ application, version, interview, speak, story, warmup, now, go }: PractiseProps) {
	const [speaking, setSpeaking] = useState(speak === true);
	const saved = useSavedItems(application?.id ?? null);
	const knowledge = useCoachKnowledge(application?.id ?? null);
	const voice = useVoiceSettings();
	const time = useCareerTime();
	if (warmup && !interview)
		return (
			<Notice icon="warning-circle">
				<Trans>This interview is unavailable.</Trans>
			</Notice>
		);
	const viewing = version && isAttempt(version) ? version : undefined;
	const attempts =
		saved.data
			?.filter(isAttempt)
			.filter((item) => application !== null || !story || item.evidence.storyIds.includes(story)) ?? [];
	const selectedStory = story ? knowledge.stories.find((item) => item.id === story) : undefined;
	const questions: Question[] = selectedStory
		? [
				{
					text: t`Tell me about “${selectedStory.data.title}”. What was your part, what did you do, and what changed?`,
					origin: "simulated",
				},
			]
		: practiceQuestions(saved.data, interview?.id, application?.company ?? "", warmup);
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
				{application && (
					<Button variant="secondary" onClick={() => go("practise")}>
						<Trans>Practice another question</Trans>
					</Button>
				)}
			</Notice>
		);

	if (saved.isError)
		return (
			<Notice icon="warning-circle">
				<Trans>Couldn't load this. Your saved data hasn't changed.</Trans>
				<Button onClick={() => void saved.refetch()}>
					<Trans>Try again</Trans>
				</Button>
			</Notice>
		);

	return (
		<div className="relative">
			<PageHeader
				title={application ? t`Practice` : t`Practice without an application`}
				className="[&_h1]:pe-44 [&>div]:min-h-9 [&>p]:pt-1 [&>p]:text-sm/5"
				actions={
					selectedStory && (
						<Link
							to="/dashboard/career/knowledge/stories/{-$storyId}"
							params={{ storyId: selectedStory.id }}
							className="inline-flex h-9 items-center gap-2 px-3.5 text-sm font-medium text-ink-2"
						>
							<Icon name="caret-left" />
							<Trans>Back to the story</Trans>
						</Link>
					)
				}
				subtitle={
					selectedStory
						? application
							? interview
								? t`Practising your story “${selectedStory.data.title}” for ${time.format(interview.at, { weekday: "long" })}'s ${interviewTypeLabel(interview.kind).toLocaleLowerCase(time.locale)} interview. The question is simulated, not from ${application.company}.`
								: t`Practising your story “${selectedStory.data.title}”. The question is simulated, not from ${application.company}.`
							: t`Practising your story “${selectedStory.data.title}”. The question is simulated.`
						: application
							? interview
								? t`Likely questions for ${time.format(interview.at, { weekday: "long" })}'s ${interviewTypeLabel(interview.kind).toLocaleLowerCase(time.locale)} interview. They are simulated, not from ${application.company}.`
								: t`Practice for ${application.company}. Questions are simulated, not from ${application.company}.`
							: t`Practice your story. Questions are simulated.`
				}
			/>
			{!viewing && (
				<AiNotice
					needs={<Trans>Feedback on an answer needs AI.</Trans>}
					works={<Trans>The questions, typing, speaking and Hear it work without it.</Trans>}
				/>
			)}
			<div className={cn("grid items-start gap-12", !speaking && "@3xl:grid-cols-[minmax(0,1fr)_232px]")}>
				{viewing ? (
					<div className="grid gap-3">
						{application === null && (
							<Button variant="secondary" className="justify-self-start" onClick={() => go("practise")}>
								<Trans context="Button: rehearse interview answers">Practice</Trans>
							</Button>
						)}
						<SavedAttempt item={viewing} />
					</div>
				) : saved.isPending ? (
					<div className="grid gap-4">
						<Skeleton className="h-40 rounded-xl" />
						<Skeleton className="h-60 rounded-xl" />
					</div>
				) : (
					<Session
						key={`${application?.id ?? "shared"}:${interview?.id ?? "none"}:${story ?? "general"}:${warmup ? "three" : "all"}`}
						application={application}
						applicationId={application?.id ?? null}
						interviewId={interview?.id ?? null}
						questions={questions}
						storyId={selectedStory?.id}
						storyTitle={selectedStory?.data.title}
						voice={voice}
						initialMode={speak ? "spoken" : "typed"}
						warmup={warmup === true}
						onModeChange={setSpeaking}
					/>
				)}
				{!speaking && (
					<aside className="grid gap-0">
						<SectionHeading className="pt-[22px]" note={attempts.length}>
							<Trans>Your attempts</Trans>
						</SectionHeading>
						{attempts.length === 0 ? (
							<p className="text-[13px] leading-[19px] text-ink-3">
								<Trans>Each answer you get feedback on is kept here, newest first.</Trans>
							</p>
						) : (
							<ul className="grid">
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
						<p className="pt-3 text-[13px]/[18px] text-ink-3">
							<Trans>Open an attempt to compare it with this one and see what improved.</Trans>
						</p>
					</aside>
				)}
			</div>
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
			className="grid min-h-[62px] w-full content-center gap-px border-b border-line py-2.5 text-start transition-colors duration-quick hover:bg-hover aria-[current]:bg-hover"
		>
			<span className="text-[15px]/[22px] font-medium">{item.data.note || item.data.title}</span>
			<span className="text-[13px]/[18px] text-ink-3">
				{at} · {item.data.mode === "spoken" ? t`spoken` : t`typed`}
			</span>
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
	application: WorkspaceTabProps["application"] | null;
	applicationId: string | null;
	interviewId: string | null;
	questions: Question[];
	storyId: string | undefined;
	storyTitle: string | undefined;
	voice: VoiceSettings;
	initialMode: Mode;
	warmup: boolean;
	onModeChange: (speaking: boolean) => void;
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
	warmup,
	onModeChange,
}: SessionProps) {
	const id = useId();
	const generate = useGenerate(applicationId);
	const connection = useDefaultProvider();
	const { provider } = connection;
	const draft = useSessionDraft<PracticeDraft>(
		`practice:${applicationId}:${interviewId ?? "none"}:${storyId ?? "general"}${warmup ? ":three" : ""}`,
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
	useEffect(() => onModeChange(mode === "spoken"), [mode, onModeChange]);
	const setMode = (mode: Mode) => {
		draft.setValue((current) => ({ ...current, mode }));
		onModeChange(mode === "spoken");
	};
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
					setAnnouncement(t`Stopped at ${clock(seconds, i18n.locale)}`);
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
					setAnnouncement(t`Stopped at ${clock(seconds, i18n.locale)}`);
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
	const changeQuestion = (offset: number) => {
		const next = questions[(index + offset + questions.length) % questions.length];
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

	const recordingNow = step.name === "recording";
	const elapsed = clock(recordingNow ? step.seconds : 0, i18n.locale);
	const model = voice.settings.transcribe.model;
	const position = (index % questions.length) + 1;
	const total = questions.length;
	const answerField = (
		<Textarea
			// What people paste or write here can be in any language: its own text sets the direction.
			dir="auto"
			id={`${id}-answer`}
			aria-labelledby={`${id}-heading`}
			value={answer}
			maxLength={6000}
			placeholder={t`About 90 seconds when spoken`}
			onChange={(event) => setAnswer(event.target.value)}
			className="min-h-[152px] px-3 py-2.5 text-sm/[22px] pointer-coarse:text-base"
		/>
	);

	return (
		<div className={cn("grid min-w-0 gap-0", mode === "spoken" && "@3xl:pe-[312px]")}>
			<section className="grid gap-0 pt-[22px]">
				<div className="flex min-h-7 items-center justify-between gap-2">
					<p className="flex-1 text-[13px]/[18px] text-ink-3">
						{storyTitle ? t`From your story` : question.origin === "recalled" ? t`Recalled` : t`From your briefing`}
					</p>
					{!storyTitle && (
						<div className="absolute end-0 top-0 flex items-center gap-0.5">
							<IconButton
								icon="caret-left"
								label={t`Previous question`}
								disabled={index === 0 || busy}
								onClick={() => changeQuestion(-1)}
							/>
							<span className="text-[13px]/[18px] font-medium text-ink-2">{t`Question ${ph({ position: i18n.number(position) })} of ${ph({ total: i18n.number(total) })}`}</span>
							<IconButton
								icon="caret-right"
								label={t`Next question`}
								disabled={index >= questions.length - 1 || busy}
								onClick={() => changeQuestion(1)}
							/>
						</div>
					)}
					{canHear && (
						<HearIt
							key={`${question.text}:${voice.settings.speak.providerId}:${voice.settings.speak.model}`}
							text={question.text}
							voice={voice}
						/>
					)}
				</div>
				<h2 className="t-section-title">{question.text}</h2>
			</section>

			{/* Space starts and stops recording while focus is in this card (the record button handles it natively). */}
			<section
				aria-labelledby={`${id}-heading`}
				className="grid gap-2.5 pt-[22px] outline-none"
				tabIndex={-1}
				onKeyDown={(event) => {
					if (event.key !== " " || mode !== "spoken" || !canTalk || spoken || event.target !== event.currentTarget)
						return;
					event.preventDefault();
					toggleRecording();
				}}
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id={`${id}-heading`} className="flex-1 t-label">
						<Trans>Your answer</Trans>
					</h2>
					<ModeSwitch value={mode} onChange={chooseMode} />
				</div>

				{mode === "typed" ? (
					<>
						{answerField}
						<p className="-mt-2.5 pt-1.5 text-xs/4 text-ink-3">
							{plural(answer.trim() ? answer.trim().split(/\s+/).length : 0, {
								one: "# word · aim for about 90 seconds when spoken",
								other: "# words · aim for about 90 seconds when spoken",
							})}
						</p>
					</>
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
							{spoken.seconds !== null && <span className="font-mono">· {clock(spoken.seconds, i18n.locale)}</span>}
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
								"flex flex-wrap items-center gap-x-3.5 gap-y-3.5 rounded-xl px-[18px] pt-4 pb-[18px] transition-colors duration-quick",
								recordingNow ? "bg-raised ring-1 ring-accent ring-offset-2 ring-offset-accent-soft" : "bg-sunken",
							)}
						>
							{/* One button for both, so focus stays on it and Space stops what Space started. */}
							<button
								type="button"
								aria-label={recordingNow ? t`Stop recording` : t`Record your answer`}
								onClick={toggleRecording}
								className={cn(
									"touch-target relative flex shrink-0 items-center justify-center gap-2 rounded-md transition-colors",
									recordingNow
										? "order-1 h-9 bg-accent px-3.5 text-sm font-medium text-on-accent"
										: "size-11 bg-sunken text-ink",
								)}
							>
								<Icon name={recordingNow ? "stop" : "microphone"} size={recordingNow ? 18 : 24} />
								{recordingNow && <Trans>Stop</Trans>}
							</button>
							<div className="grid min-w-0 flex-1 basis-48 gap-0.5">
								{recordingNow ? (
									<>
										<p className="flex items-center gap-3.5">
											<span className="size-3 rounded-full bg-danger-fill" aria-hidden="true" />
											<span className="t-label">
												<Trans>Recording</Trans>
											</span>
											<span className="font-mono text-[13px]/4">
												{elapsed} / {clock(MAX_SECONDS, i18n.locale)}
											</span>
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
									aria-valuetext={clock(step.seconds, i18n.locale)}
									className="order-2 h-1 w-full overflow-hidden rounded-full bg-sunken"
								>
									<div
										className="h-full bg-ink-3 transition-[width] duration-1000 ease-linear"
										style={{ width: `${(step.seconds / MAX_SECONDS) * 100}%` }}
									/>
								</div>
							)}
							{recordingNow && (
								<p className="order-3 w-full t-body" aria-live="polite">
									{browserDictation
										? heard || t`Listening… Stop when you're done.`
										: t`Stop when you're done. Nothing is sent until then.`}
								</p>
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
						{recordingNow && (
							<>
								<p className="text-xs/5 text-ink-3">
									{browserDictation
										? t`Your words appear as you speak. Nothing is sent until you stop; then you can correct the text before asking for feedback.`
										: t`Nothing is sent until you stop. After transcription, correct the text before asking for feedback.`}
								</p>
								<Button variant="link" size="sm" className="w-fit p-0" onClick={() => chooseMode("typed")}>
									<Trans>Type instead</Trans>
								</Button>
							</>
						)}
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

				{mode === "spoken" && (
					<aside className="@3xl:absolute @3xl:end-0 @3xl:top-[80px] @3xl:w-[264px]">
						<SectionHeading className="pt-[22px]">
							<Trans>Voice</Trans>
						</SectionHeading>
						<VoiceSettingsPanel voice={voice} audio={audio} disabled={busy} />
					</aside>
				)}

				<div className="grid gap-2.5">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						{provider && !recordingNow && !showFeedback && (
							<Button
								variant={feedback && showFeedback ? "secondary" : "primary"}
								disabled={!ready}
								loading={generate.isPending}
								onClick={getFeedback}
							>
								{generate.isPending ? <Working steps={workingSteps("practice")} /> : <Trans>Get feedback</Trans>}
							</Button>
						)}
						<p className={cn("text-xs text-ink-2", (recordingNow || showFeedback) && "sr-only")}>
							{application ? (
								<Trans>Compared with your stories and the posting.</Trans>
							) : (
								<Trans>Compared with your stories.</Trans>
							)}
						</p>
					</div>
					<GenerateNotice generate={generate} onRetry={getFeedback} className="w-fit" />
				</div>
			</section>

			{feedback && showFeedback && (
				<FeedbackCard data={feedback.data}>
					<div className="flex flex-wrap items-center gap-2">
						<Button disabled={index >= questions.length - 1} onClick={() => changeQuestion(1)}>
							<Trans>Next question</Trans>
							<Icon name="arrow-right" size={16} />
						</Button>
						<Button
							variant="secondary"
							onClick={() => {
								chooseMode("typed");
								setSpoken(null);
								setAnswer(feedback.data.opening);
							}}
						>
							<Trans>Try again with this opening</Trans>
						</Button>
						<span className="ms-auto flex items-center gap-1.5 text-[13px]/[18px] text-ink-3">
							<Icon name="check-circle" size={16} />
							<Trans>Saved to Library</Trans>
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
					className="relative flex-none data-checked:bg-transparent data-checked:shadow-none"
				>
					{value === option.value && (
						<m.span
							layoutId={`${id}-thumb`}
							transition={{ duration: D2, ease: EASE }}
							className="absolute inset-0 rounded-sm bg-raised shadow-e1"
						/>
					)}
					<Icon name={option.icon} size={18} className="relative" />
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
	const { settings, update, transcribers, readers } = voice;
	const browserTranscribes = settings.transcribe.providerId === BROWSER;
	if (voice.providerState.isUnavailable) return null;
	return (
		<div className="grid">
			<CollapseRow>
				<div className="grid gap-3.5">
					<div className="grid gap-3.5">
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
							<label htmlFor={`${id}-keep`} className="flex items-start gap-2.5 text-[13px]/[18px] text-ink-3">
								<Checkbox
									id={`${id}-keep`}
									className="mt-px"
									checked={settings.keep}
									onCheckedChange={(keep) => update({ keep })}
								/>
								<span>
									<Trans>Keep the recording in this browser so I can download it</Trans>
								</span>
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
							Connections bill speech separately and may use tokens on your account. Your browser's speech is free, but
							its maker may process the audio. The server keeps transcripts, never recordings.
						</Trans>
					</p>
				</div>
			</CollapseRow>
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
					className="h-8 font-mono text-xs"
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
		<section aria-label={t`Feedback`} className={cn("grid gap-0", ENTER_CLASS)}>
			<SectionHeading className="pt-[26px]">{data.title}</SectionHeading>
			<p className="pb-3 text-[13px]/[18px] text-ink-3">
				<Trans>Feedback · compared with your stories and the posting</Trans>
			</p>
			<div className="grid gap-6 sm:grid-cols-2">
				<div className="grid content-start gap-0">
					<p className="flex items-center gap-1.5 text-[13px]/[22px] font-semibold text-accent-text">
						<Icon name="thumbs-up" size={16} />
						<Trans>What works</Trans>
					</p>
					<p className="text-sm/5">{data.works}</p>
				</div>
				<div className="grid content-start gap-0">
					<p className="flex items-center gap-1.5 text-[13px]/[22px] font-semibold text-warn-text">
						<Icon name="wrench" size={16} />
						<Trans>Strengthen</Trans>
					</p>
					<p className="text-sm/5">{data.strengthen}</p>
				</div>
			</div>
			<div className="mt-[18px] mb-[22px] grid gap-1 border-s-[3px] border-line-2 py-0.5 ps-4">
				<p className="text-[13px]/[18px] text-ink-3">
					<Trans>Try this opening</Trans>
				</p>
				<q className="font-display text-[18px]/[26px]">{data.opening}</q>
			</div>
			{children}
		</section>
	);
}

/** A practice attempt opened from Saved: its question, answer and feedback, read-only. */
function SavedAttempt({ item }: { item: Attempt }) {
	return (
		<div className="grid min-w-0 gap-4">
			<section className="grid gap-3">
				<p className="text-xs font-medium text-ink-2">{item.data.origin === "recalled" ? t`Recalled` : t`Practice`}</p>
				<h2 className="t-section-title">{item.data.question}</h2>
			</section>
			<section className="grid gap-3">
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
