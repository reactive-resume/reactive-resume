// Speaking an answer on the device (web workspace/recorder.ts and practise.tsx voice parts). expo-audio records an
// .m4a that stays on the device until the user stops; then it goes to `career.voice.transcribe`. Questions are read
// aloud from `career.voice.speak`. There is no on-device speech recognition (README §5.10).
import type { VoiceChoice } from "./logic";
import type { AudioPlayer } from "expo-audio";
import {
	createAudioPlayer,
	requestRecordingPermissionsAsync,
	setAudioModeAsync,
	useAudioRecorder,
	useAudioRecorderState,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useRef, useState } from "react";
import { audioProblem, chooseVoice, MAX_SECONDS, RECORDING_OPTIONS, speechExtension, voiceCapable } from "./logic";
import { client, rest } from "@/api/client";
import { useSession } from "@/auth/session";
import { useHasAIProvider } from "@/features/ai/providers";

// ---- Voice settings: kept on this device, per server ----

type StoredVoice = {
	transcribeWith?: string | undefined;
	transcribeModel?: string | undefined;
	/** A connection id, or "off" to read questions as text only. */
	speakWith?: string | undefined;
	speakModel?: string | undefined;
	keep?: boolean | undefined;
};

const voiceKey = (server: string) => `reactive-resume:career-voice:${server}`;

const readStored = (server: string): StoredVoice => {
	try {
		return JSON.parse(Storage.getItemSync(voiceKey(server)) ?? "{}") as StoredVoice;
	} catch {
		return {};
	}
};

/** Who transcribes answers and who reads questions aloud, from the connections that offer those speech models. */
export function useVoiceSettings() {
	const session = useSession();
	const providerState = useHasAIProvider();
	const usable = providerState.usableProviders;
	const [stored, setStored] = useState(() => ({ server: session.server, value: readStored(session.server) }));
	if (stored.server !== session.server) setStored({ server: session.server, value: readStored(session.server) });
	const update = (patch: StoredVoice) => {
		const value = { ...stored.value, ...patch };
		setStored({ server: session.server, value });
		Storage.setItemSync(voiceKey(session.server), JSON.stringify(value));
	};
	const { value } = stored;
	return {
		providerState,
		transcribers: voiceCapable(usable, "transcription"),
		readers: voiceCapable(usable, "speech"),
		update,
		settings: {
			transcribe: chooseVoice(usable, "transcription", value.transcribeWith, value.transcribeModel),
			speak: chooseVoice(usable, "speech", value.speakWith, value.speakModel),
			speakOff: value.speakWith === "off",
			keep: value.keep === true,
		},
	};
}

export type VoiceSettings = ReturnType<typeof useVoiceSettings>;

// ---- Recording ----

/** Audio waiting to be transcribed: a recording (with its length) or a chosen file. */
export type Recording = { uri: string; seconds: number | null; name: string; type: string };
export type RecordStop =
	| { kind: "recorded"; recording: Recording; atLimit: boolean }
	| { kind: "empty" | "too-large"; atLimit: boolean };

/**
 * The microphone. `start` asks for permission when needed ("denied" when it's refused); `stop` hands over the file,
 * refusing an empty or over-2 MB one; `cancel` throws it away. Recording stops itself at 2 minutes.
 */
export function useRecorder(onStop: (result: RecordStop) => void) {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const state = useAudioRecorderState(recorder, 250);
	const active = useRef(false);
	const latestStop = useRef(onStop);
	useEffect(() => {
		latestStop.current = onStop;
	});
	const seconds = Math.min(MAX_SECONDS, Math.floor(state.durationMillis / 1000));

	const finish = async (keep: boolean, atLimit = false) => {
		if (!active.current) return;
		active.current = false;
		await recorder.stop().catch(() => undefined);
		await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
		const uri = recorder.uri;
		if (!uri) return keep ? latestStop.current({ kind: "empty", atLimit }) : undefined;
		const file = new File(uri);
		if (!keep) return deleteQuietly(file);
		const problem = audioProblem(file.exists ? file.size : 0);
		if (problem) {
			deleteQuietly(file);
			return latestStop.current({ kind: problem, atLimit });
		}
		latestStop.current({
			kind: "recorded",
			recording: { uri, seconds, name: "practice-answer.m4a", type: "audio/mp4" },
			atLimit,
		});
	};

	useEffect(() => {
		if (active.current && state.durationMillis >= MAX_SECONDS * 1000) void finish(true, true);
	});
	// Leaving the screen throws an unfinished recording away; nothing was sent.
	useEffect(
		() => () => {
			if (active.current) {
				active.current = false;
				void recorder.stop().catch(() => undefined);
			}
		},
		[recorder],
	);

	return {
		recording: state.isRecording,
		seconds,
		start: async (): Promise<"started" | "denied" | "failed"> => {
			const permission = await requestRecordingPermissionsAsync().catch(() => null);
			if (!permission?.granted) return "denied";
			try {
				await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
				await recorder.prepareToRecordAsync();
				recorder.record();
				active.current = true;
				return "started";
			} catch {
				await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
				return "failed";
			}
		},
		stop: () => finish(true),
		cancel: () => finish(false),
	};
}

export function deleteQuietly(file: File) {
	try {
		if (file.exists) file.delete();
	} catch {
		// Already gone, or the cache was cleared: nothing to do.
	}
}

/**
 * Sends a recording to `career.voice.transcribe`. The REST route takes it as multipart form data, which expo/fetch
 * sends from the file's bytes; the oRPC link here buffers JSON bodies and can't carry a file.
 */
export async function transcribe(input: {
	recording: Recording;
	providerId: string;
	model: string;
	applicationId: string;
	signal?: AbortSignal;
}) {
	const file = new File(input.recording.uri);
	const form = new FormData();
	form.append("providerId", input.providerId);
	form.append("model", input.model);
	form.append("applicationId", input.applicationId);
	// The type is set here because the file's own can read audio/x-m4a, which the server refuses. Expo's FormData
	// sends any part with `bytes()`, `name` and `type`.
	const audio = { name: input.recording.name, type: input.recording.type, bytes: () => file.bytes() };
	form.append("audio", audio as unknown as Blob);
	const response = await rest("/career/voice/transcribe", { method: "POST", body: form, signal: input.signal ?? null });
	if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
	return (await response.json()) as { id: string; text: string };
}

// ---- Playback ----

/** One sound at a time: the question read aloud, or the user's own recording. */
export function usePlayer() {
	const [playing, setPlaying] = useState(false);
	const current = useRef<{ player: AudioPlayer; cleanup: () => void } | null>(null);
	const stop = () => {
		const active = current.current;
		current.current = null;
		if (active) {
			active.player.pause();
			active.player.remove();
			active.cleanup();
		}
		setPlaying(false);
	};
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			stop();
		};
	}, []);
	const play = async (uri: string, cleanup: () => void = () => undefined) => {
		stop();
		await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
		// The screen went away while the audio session switched: nothing plays.
		if (!mounted.current) return cleanup();
		const player = createAudioPlayer({ uri });
		current.current = { player, cleanup };
		player.addListener("playbackStatusUpdate", (status) => {
			if (status.didJustFinish && current.current?.player === player) stop();
		});
		player.play();
		setPlaying(true);
	};
	return { playing, play, stop };
}

/** Reads `text` with the chosen speech connection; returns a temporary file the caller plays and then deletes. */
export async function speak(choice: NonNullable<VoiceChoice>, text: string, signal?: AbortSignal) {
	const result = await client.career.voice.speak(
		{ providerId: choice.providerId, model: choice.model, text },
		signal ? { signal } : {},
	);
	signal?.throwIfAborted();
	const file = new File(Paths.cache, `practise-speech-${Date.now()}.${speechExtension(result.mediaType)}`);
	await file.write(result.audio, { encoding: "base64" });
	return file;
}
