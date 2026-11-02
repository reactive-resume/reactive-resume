// Pure workspace logic ported from apps/web/src/features/career/workspace/{apply,debrief,practise,recorder,shell}.
// No React Native, Lingui or path-alias imports, so the M6-T2 Node scenarios run it directly.
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";

// ---- Answers (Apply) ----

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
export const countCharacters = (text: string) => [...text].length;

/** A fact's chip label: its first few words. */
export const shortLabel = (text: string) => {
	const words = text.split(/\s+/).filter(Boolean);
	return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : text;
};

export type DiffPart = { type: "same" | "removed" | "added"; text: string };

/**
 * Word-level diff by longest common subsequence. ponytail: O(words²) table, fine for form answers (≤ ~1,000 words);
 * swap in a Myers diff if answers grow far past that.
 */
export function diffWords(before: string, after: string): DiffPart[] {
	const a = before.split(/\s+/).filter(Boolean);
	const b = after.split(/\s+/).filter(Boolean);
	const width = b.length + 1;
	const table = new Uint16Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i * width + j] =
				a[i] === b[j]
					? (table[(i + 1) * width + j + 1] ?? 0) + 1
					: Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);

	const parts: DiffPart[] = [];
	const push = (type: DiffPart["type"], word: string) => {
		const last = parts.at(-1);
		if (last?.type === type) last.text += ` ${word}`;
		else parts.push({ type, text: word });
	};
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			push("same", a[i] ?? "");
			i++;
			j++;
		} else if (
			j < b.length &&
			(i >= a.length || (table[i * width + j + 1] ?? 0) >= (table[(i + 1) * width + j] ?? 0))
		) {
			push("added", b[j] ?? "");
			j++;
		} else {
			push("removed", a[i] ?? "");
			i++;
		}
	}
	return parts;
}

type WrittenAnswer = { question: string; answer: string };

/** The answers as a Markdown or plain-text file body, as web's Download. Unanswered questions are left out. */
export function answersDocument(title: string, answers: WrittenAnswer[], format: "md" | "txt") {
	const written = answers.filter((answer) => answer.answer.trim());
	const body =
		format === "md"
			? [`# ${title}`, ...written.map((answer) => `## ${answer.question}\n\n${answer.answer}`)].join("\n\n")
			: [title, ...written.map((answer) => `${answer.question}\n\n${answer.answer}`)].join("\n\n\n");
	return `${body}\n`;
}

/** "Question\nAnswer" blocks for Copy answers. */
export const answersClipboard = (answers: WrittenAnswer[]) =>
	answers
		.filter((answer) => answer.answer.trim())
		.map((answer) => `${answer.question}\n${answer.answer}`)
		.join("\n\n");

// ---- Interviews ----

const DAY = 86_400_000;
const end = (interview: InterviewTimelineEntry) => +new Date(interview.at) + interview.durationMinutes * 60_000;
const byStart = (activity: { type: string }[]) =>
	(activity.filter((entry) => entry.type === "interview") as InterviewTimelineEntry[]).sort(
		(a, b) => +new Date(a.at) - +new Date(b.at),
	);

/** The interview a workspace is about: the next one to come, else the latest one if it ended in the last day. */
export function currentInterview(activity: { type: string }[], now: Date) {
	const interviews = byStart(activity);
	return (
		interviews.find((interview) => end(interview) >= +now) ??
		interviews.filter((interview) => +now - end(interview) < DAY).at(-1)
	);
}

/** The round to write down in Debrief: the most recent interview that has ended, else the next one. */
export function debriefRound(activity: { type: string }[], now: Date) {
	const interviews = byStart(activity);
	return interviews.filter((interview) => end(interview) <= +now).at(-1) ?? interviews[0];
}

/** Prepare's phase: before the plan window, the 10 minutes before through the end, or after the interview. */
export function preparePhase(interview: InterviewTimelineEntry, now: Date): "plan" | "soon" | "after" {
	const start = +new Date(interview.at);
	if (+now > end(interview)) return "after";
	return +now >= start - 10 * 60_000 ? "soon" : "plan";
}

/** Whole minutes until `at`; negative once it has started. */
export const minutesUntil = (at: Date, now: Date) => Math.round((at.getTime() - now.getTime()) / 60_000);

// ---- Debrief week plan ----

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

function zonedParts(at: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		hourCycle: "h23",
	}).formatToParts(at);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
	const number = (type: Intl.DateTimeFormatPartTypes) => Number(part(type));
	return {
		weekday: WEEKDAYS.indexOf(part("weekday").toLowerCase() as Weekday),
		year: number("year"),
		month: number("month"),
		day: number("day"),
		hour: number("hour"),
		minute: number("minute"),
	};
}

/** The next `weekday` at 18:00 in `timeZone`; today when it's that day and 18:00 is still ahead. */
export function nextEvening(weekday: Weekday, now: Date, timeZone: string) {
	const today = zonedParts(now, timeZone);
	let ahead = (WEEKDAYS.indexOf(weekday) - today.weekday + 7) % 7;
	if (ahead === 0 && today.hour >= 18) ahead = 7;
	// 18:00 on that date read as UTC, moved by the zone's offset. A second pass takes the offset at the result, so a
	// DST switch earlier that day still lands on 18:00 local (web takes it once, at the guess).
	const wall = Date.UTC(today.year, today.month - 1, today.day + ahead, 18);
	const offsetAt = (instant: number) => {
		const there = zonedParts(new Date(instant), timeZone);
		return Date.UTC(there.year, there.month - 1, there.day, there.hour, there.minute) - instant;
	};
	const first = wall - offsetAt(wall);
	return new Date(wall - offsetAt(first));
}

// ---- Messages ----

type ReplyChange = { type: "stage"; stage: string } | { type: "follow-up" } | { type: "offer" };

/** A stage the application is already at, or can't reach from Saved, is shown fixed: nothing to apply. */
export const isFixedChange = (change: ReplyChange | undefined, status: string) =>
	change?.type === "stage" && change.stage === status;

/** A stage move from Saved records the submission receipt in the same confirmed action. */
export const needsSubmission = (change: ReplyChange | undefined, status: string) =>
	status === "saved" && change?.type === "stage";

/** The changes ticked by default: every one that isn't fixed. */
export const openChanges = (changes: ReplyChange[], status: string) =>
	changes.flatMap((change, index) => (isFixedChange(change, status) ? [] : [index]));

// ---- Speaking an answer ----

export const MAX_SECONDS = 120;
/** `career.voice.transcribe` refuses audio over 2 MB. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/** Why a recording can't be sent, or null when it can: empty, unknown size or over 2 MB. */
export const audioProblem = (bytes: number | null | undefined): "empty" | "too-large" | null =>
	!bytes ? "empty" : bytes > MAX_AUDIO_BYTES ? "too-large" : null;

const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"];

/** A chosen audio file's type as transcription accepts it, or null when it's empty, over 2 MB or another format. */
export function acceptedAudioType(mimeType: string | null | undefined, bytes: number | null | undefined) {
	const type =
		mimeType === "audio/x-m4a" || mimeType === "audio/m4a"
			? "audio/mp4"
			: mimeType === "audio/x-wav"
				? "audio/wav"
				: (mimeType ?? "");
	return audioProblem(bytes) || !AUDIO_TYPES.includes(type) ? null : type;
}

/**
 * AAC in an MPEG-4 container (.m4a), mono speech quality. 48 kbps × 120 s is about 720 KB, well under the 2 MB cap.
 * Shaped like expo-audio's `RecordingOptions`; the numbers are the formats' own (IOSOutputFormat.MPEG4AAC = "aac ").
 */
export const RECORDING_OPTIONS = {
	extension: ".m4a",
	sampleRate: 22_050,
	numberOfChannels: 1,
	bitRate: 48_000,
	android: { outputFormat: "mpeg4", audioEncoder: "aac" },
	ios: { outputFormat: "aac ", audioQuality: 64 },
	web: { mimeType: "audio/mp4", bitsPerSecond: 48_000 },
} as const;

/** "0:47" */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The file extension for audio `voice.speak` returns, so the player recognises it. */
export const speechExtension = (mediaType: string) =>
	({ "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "aac" })[
		mediaType.split(";")[0]?.trim() ?? ""
	] ?? "mp3";

/** Speech models per provider kind; a copy of `AI_VOICE_MODELS` in packages/ai/src/types.ts (mobile can't import it). */
export const VOICE_MODELS: Partial<Record<string, { transcription: readonly string[]; speech: readonly string[] }>> = {
	openai: {
		transcription: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
		speech: ["gpt-4o-mini-tts", "tts-1"],
	},
	gemini: {
		transcription: ["gemini-3.5-transcribe"],
		speech: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"],
	},
	mistral: { transcription: ["voxtral-mini-latest"], speech: ["voxtral-mini-tts-latest"] },
	xai: { transcription: ["grok-voice-transcribe-2.0"], speech: ["grok-tts"] },
	groq: { transcription: ["whisper-large-v3-turbo", "whisper-large-v3"], speech: [] },
	"vercel-ai-gateway": {
		transcription: ["openai/gpt-4o-mini-transcribe", "google/gemini-3.5-transcribe", "openai/whisper-1"],
		speech: ["openai/tts-1", "google/gemini-3.8-flash-tts"],
	},
};

export type VoiceKind = "transcription" | "speech";
type VoiceProvider = { id: string; label: string; provider: string };
export type VoiceChoice = { providerId: string; label: string; model: string; models: readonly string[] } | null;

/** Connections that offer this kind of speech model. */
export const voiceCapable = <P extends VoiceProvider>(providers: P[], kind: VoiceKind) =>
	providers.filter((provider) => (VOICE_MODELS[provider.provider]?.[kind].length ?? 0) > 0);

/**
 * The connection and model for one kind of speech: the stored choice while it's still capable, else the first capable
 * one. `"off"` (Read questions with: Text only) and no capable connection give null; mobile has no browser speech.
 */
export function chooseVoice(
	providers: VoiceProvider[],
	kind: VoiceKind,
	id: string | undefined,
	model: string | undefined,
): VoiceChoice {
	if (id === "off") return null;
	const capable = voiceCapable(providers, kind);
	const provider = capable.find((item) => item.id === id) ?? capable[0];
	if (!provider) return null;
	const models = VOICE_MODELS[provider.provider]?.[kind] ?? [];
	return {
		providerId: provider.id,
		label: provider.label,
		model: models.find((item) => item === model) ?? models[0] ?? "",
		models,
	};
}

// ---- "Write numbers as digits" ----

const SMALL = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Record<string, number> = { thousand: 1000, million: 1_000_000 };
const WORD = `(?:${[...SMALL, ...TENS, "hundred", ...Object.keys(SCALES)].join("|")})\\b`;
// "fifty four", "twenty-five", "one hundred and twenty": "and" only joins after hundred or thousand.
const NUMBER = `\\b${WORD}(?:(?:[\\s-]+|(?<=hundred|thousand)\\s+and\\s+)${WORD})*`;
const PERCENT = String.raw`\s+per\s?cent\b`;
const RANGE = new RegExp(`(${NUMBER})(\\s+to\\s+)(${NUMBER})(${PERCENT})`, "gi");
const PHRASE = new RegExp(`(${NUMBER})(${PERCENT})?`, "gi");

/** The value of a spelled-out English number, or null when the words don't form one ("nineteen ninety"). */
function parseNumber(phrase: string) {
	let total = 0;
	let current = 0;
	let last: "small" | "ten" | "hundred" | "scale" | null = null;
	for (const word of phrase.toLowerCase().split(/[\s-]+/)) {
		const small = SMALL.indexOf(word);
		const ten = TENS.indexOf(word);
		if (word === "and") continue;
		if (small >= 0) {
			if (last === "small" || (last === "ten" && (small === 0 || small >= 10))) return null;
			current += small;
			last = "small";
		} else if (ten >= 0) {
			if (last === "small" || last === "ten") return null;
			current += (ten + 2) * 10;
			last = "ten";
		} else if (word === "hundred") {
			if ((last !== "small" && last !== "ten") || current >= 100) return null;
			current *= 100;
			last = "hundred";
		} else {
			if (last === null || last === "scale") return null;
			total += current * (SCALES[word] ?? 1);
			current = 0;
			last = "scale";
		}
	}
	return total + current;
}

/**
 * Rewrites spelled-out numbers as digits: "fifty four to seventy one percent" → "54% to 71%", "eighteen customers"
 * → "18 customers". Numbers under ten stay words unless they're a percentage.
 */
export function writeNumbersAsDigits(text: string) {
	return text.replace(RANGE, "$1$4$2$3$4").replace(PHRASE, (match, words: string, percent: string | undefined) => {
		const value = parseNumber(words);
		if (value === null || (value < 10 && !percent)) return match;
		return percent ? `${value}%` : String(value);
	});
}

/** A streaming or ready, unkept letter draft must be kept or discarded before leaving the editor. */
export const draftNeedsLeaveGuard = (phase: "idle" | "streaming" | "ready" | "failed" | "unsaved") =>
	phase === "streaming" || phase === "ready";
