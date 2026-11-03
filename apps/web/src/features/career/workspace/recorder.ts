// Speaking an answer: recording in the browser (nothing leaves it here), the browser's own dictation and voice for
// when no connection offers speech models, and tidying the transcript.

export const MAX_SECONDS = 120;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"];
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

export const canRecord = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/** A chosen file in a type transcription accepts, or null when it's empty, over 2 MB or another format. */
export function acceptAudioFile(file: File) {
	const type = file.type === "audio/x-m4a" ? "audio/mp4" : file.type === "audio/x-wav" ? "audio/wav" : file.type;
	if (!file.size || file.size > MAX_AUDIO_BYTES || !AUDIO_TYPES.includes(type)) return null;
	return type === file.type ? file : new File([file], file.name, { type });
}

type RecordOptions = {
	onTick: (seconds: number) => void;
	/** The audio (null when empty or over 2 MB), its length, and whether the 2-minute limit stopped it. */
	onStop: (file: File | null, seconds: number, atLimit: boolean) => void;
};

/**
 * Starts recording from the microphone; rejects with a DOMException named NotAllowedError when it's blocked.
 * `stop` ends it and hands over the audio, `cancel` throws it away.
 */
export async function record({ onTick, onStop }: RecordOptions) {
	const media = await navigator.mediaDevices.getUserMedia({ audio: true });
	const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
	if (!mimeType) {
		for (const track of media.getTracks()) track.stop();
		throw new Error("No supported recording format.");
	}
	let recorder: MediaRecorder;
	try {
		recorder = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 64_000 });
	} catch {
		recorder = new MediaRecorder(media, { mimeType });
	}
	const chunks: Blob[] = [];
	const started = Date.now();
	let bytes = 0;
	let atLimit = false;
	let cancelled = false;
	const elapsed = () => Math.min(MAX_SECONDS, Math.floor((Date.now() - started) / 1000));
	const finish = () => {
		window.clearInterval(timer);
		for (const track of media.getTracks()) track.stop();
		if (recorder.state !== "inactive") recorder.stop();
	};
	const timer = window.setInterval(() => {
		const seconds = elapsed();
		onTick(seconds);
		if (seconds < MAX_SECONDS) return;
		atLimit = true;
		finish();
	}, 250);
	recorder.ondataavailable = ({ data }) => {
		chunks.push(data);
		bytes += data.size;
		if (bytes > MAX_AUDIO_BYTES) finish();
	};
	recorder.onerror = finish;
	recorder.onstop = () => {
		if (cancelled) return;
		const type = mimeType.split(";")[0] ?? "audio/webm";
		const extension = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
		const file = bytes && bytes <= MAX_AUDIO_BYTES ? new File(chunks, `practice-answer.${extension}`, { type }) : null;
		onStop(file, elapsed(), atLimit);
	};
	recorder.start(1000);
	return {
		stop: finish,
		cancel: () => {
			cancelled = true;
			finish();
		},
	};
}

// ---- The browser's own speech (Web Speech API) ----

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start: () => void;
	stop: () => void;
	abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

const recognition = () => {
	const scope = globalThis as {
		SpeechRecognition?: RecognitionConstructor;
		webkitSpeechRecognition?: RecognitionConstructor;
	};
	return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
};

/** Chrome, Edge and Safari take dictation; Firefox doesn't. */
export const canDictate = () => Boolean(recognition());

/** Every major browser can read text aloud. */
export const canSpeakAloud = () => typeof speechSynthesis !== "undefined";

type DictateOptions = {
	lang: string;
	onTick: (seconds: number) => void;
	/** Everything heard so far. */
	onText: (text: string) => void;
	/** What was heard, how long it took, and whether the 2-minute limit stopped it. */
	onStop: (text: string, seconds: number, atLimit: boolean) => void;
	/** The browser's reason: "not-allowed", "no-speech", "network", "audio-capture"… */
	onError: (error: string) => void;
};

/**
 * Dictation by the browser's own speech service, for when no connection can transcribe. Words arrive as they're heard;
 * this app records and uploads nothing, though the browser's maker may process the audio. `stop` ends it and hands
 * over the text, `cancel` throws it away.
 */
export function dictate({ lang, onTick, onText, onStop, onError }: DictateOptions) {
	const Recognition = recognition();
	if (!Recognition) throw new Error("Dictation is unavailable.");
	const session = new Recognition();
	session.lang = lang;
	session.continuous = true;
	session.interimResults = true;
	const started = Date.now();
	let text = "";
	let atLimit = false;
	let ended = false;
	const elapsed = () => Math.min(MAX_SECONDS, Math.floor((Date.now() - started) / 1000));
	const timer = window.setInterval(() => {
		const seconds = elapsed();
		onTick(seconds);
		if (seconds < MAX_SECONDS) return;
		atLimit = true;
		session.stop();
	}, 250);
	session.onresult = (event) => {
		text = Array.from(event.results, (result) => result[0]?.transcript ?? "")
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		onText(text);
	};
	session.onerror = (event) => {
		if (event.error === "aborted") return;
		ended = true;
		window.clearInterval(timer);
		onError(event.error);
	};
	// The browser may end a long or silent session itself; what it heard counts as the answer.
	session.onend = () => {
		window.clearInterval(timer);
		if (ended) return;
		ended = true;
		onStop(text, elapsed(), atLimit);
	};
	session.start();
	return {
		stop: () => session.stop(),
		cancel: () => {
			ended = true;
			window.clearInterval(timer);
			session.abort();
		},
	};
}

/** Reads text aloud with the browser's voice, preferring one on this device for the language. */
export function speakAloud(text: string, lang: string, onEnd?: () => void) {
	speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = lang;
	const language = lang.slice(0, 2).toLowerCase();
	const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(language));
	const voice = voices.find((item) => item.localService) ?? voices[0];
	if (voice) utterance.voice = voice;
	utterance.onend = () => onEnd?.();
	utterance.onerror = () => onEnd?.();
	speechSynthesis.speak(utterance);
	return () => {
		utterance.onend = null;
		utterance.onerror = null;
		speechSynthesis.cancel();
	};
}

/** "0:47" */
export const clock = (seconds: number, locale: string) =>
	`${new Intl.NumberFormat(locale, { useGrouping: false }).format(Math.floor(seconds / 60))}:${new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false }).format(seconds % 60)}`;

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
function parse(phrase: string) {
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
 * → "18 customers". Numbers under ten stay words ("a six person team") unless they're a percentage; everything
 * else is left as it was.
 */
export function writeNumbersAsDigits(text: string) {
	return text.replace(RANGE, "$1$4$2$3$4").replace(PHRASE, (match, words: string, percent: string | undefined) => {
		const value = parse(words);
		if (value === null || (value < 10 && !percent)) return match;
		return percent ? `${value}%` : String(value);
	});
}
