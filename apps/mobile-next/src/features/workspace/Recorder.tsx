import { t } from "@lingui/core/macro";
// W4's voice recorder, also used by Debrief: a live waveform from the mic level (about 15 fps), a timer against
// 2:00, one 72 dp control. It stops itself at the limit (`warning`). Locking, leaving, a call or losing the mic pauses
// the take and keeps it ("Paused at 0:48" with Resume, Finish, Discard). Reduced motion shows a static level meter.
import {
	RecordingPresets,
	requestRecordingPermissionsAsync,
	setAudioModeAsync,
	useAudioRecorder,
	useAudioRecorderState,
} from "expo-audio";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { Button, haptic, layout, RecordButton, Text, TextLink, useMotionPolicy, Waveform } from "@/ui";

export const LIMIT_MS = 120_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const BARS = 24;
const POLL_MS = 66;

export type Take = { uri: string; durationMs: number; bytes: number };
type Status = "idle" | "recording" | "paused" | "denied";

export const clockOf = (ms: number) => {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Metering in dBFS (−160…0) to a 0…1 bar height. */
const levelOf = (db: number | undefined) => (db === undefined ? 0 : Math.max(0, Math.min(1, (db + 50) / 50)));

export type RecorderProps = {
	/** A finished take; the screen uploads and transcribes it (after its own size and approval checks). */
	onFinish: (take: Take) => void;
	onTypeInstead: () => void;
	recorded: boolean;
	/** The message under the control when the screen has one (limit reached, nothing heard). */
	notice?: string | undefined;
	/** Storyboard only: draw a take in progress (levels 0…1, elapsed time) without recording anything. */
	seeded?: { levels: number[]; elapsedMs: number } | undefined;
};

export function Recorder({ onFinish, onTypeInstead, recorded, notice, seeded }: RecorderProps) {
	const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
	const state = useAudioRecorderState(recorder, POLL_MS);
	const { reduced } = useMotionPolicy();
	const [status, setStatus] = useState<Status>("idle");
	const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
	const [limitHit, setLimitHit] = useState(false);
	const statusRef = useRef(status);
	useEffect(() => {
		statusRef.current = status;
	});
	// Each new poll while recording adds a bar (state adjusted during render, not in an effect).
	const [seen, setSeen] = useState(0);
	if (status === "recording" && state.durationMillis !== seen) {
		setSeen(state.durationMillis);
		setLevels((current) => [...current.slice(1), levelOf(state.metering)]);
	}

	const pause = useCallback(() => {
		if (statusRef.current !== "recording") return;
		recorder.pause();
		setStatus("paused");
	}, [recorder]);

	const finish = useCallback(async () => {
		const { durationMillis, fileSize } = recorder.getStatus();
		await recorder.stop();
		setStatus("idle");
		if (recorder.uri) onFinish({ uri: recorder.uri, durationMs: durationMillis, bytes: fileSize });
	}, [recorder, onFinish]);

	// The 2-minute limit stops the take by itself.
	if (status === "recording" && state.durationMillis >= LIMIT_MS && !limitHit) setLimitHit(true);
	useEffect(() => {
		if (!limitHit || statusRef.current !== "recording") return;
		haptic("warning");
		void finish();
	}, [limitHit, finish]);

	// Losing the mic (a call, another app) pauses and keeps the take.
	useEffect(() => {
		if (state.mediaServicesDidReset) pause();
	}, [state.mediaServicesDidReset, pause]);

	// Locking the phone or leaving the app or the screen pauses the take.
	useEffect(() => {
		const sub = AppState.addEventListener("change", (next) => {
			if (next !== "active") pause();
		});
		return () => sub.remove();
	}, [pause]);
	useFocusEffect(useCallback(() => () => pause(), [pause]));

	const start = async () => {
		const permission = await requestRecordingPermissionsAsync();
		if (!permission.granted) return setStatus("denied");
		await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
		await recorder.prepareToRecordAsync();
		recorder.record();
		haptic("light");
		setLimitHit(false);
		setLevels(Array.from({ length: BARS }, () => 0));
		setStatus("recording");
	};
	const stop = () => {
		haptic("light");
		void finish();
	};
	const resume = () => {
		recorder.record();
		setStatus("recording");
	};
	const discard = async () => {
		await recorder.stop();
		setStatus("idle");
	};

	const recording = status === "recording" || (!!seeded && status === "idle");
	const shown = seeded && status === "idle" ? seeded.levels : levels;
	const elapsed = seeded && status === "idle" ? seeded.elapsedMs : state.durationMillis;
	const level = shown[shown.length - 1] ?? 0;
	const label =
		status === "paused"
			? t`Paused at ${clockOf(state.durationMillis)}`
			: recording
				? t`Recording. Tap to stop.`
				: recorded
					? t`Record again`
					: t`Record your answer`;

	return (
		<View style={{ gap: 0 }}>
			<View style={{ paddingHorizontal: layout.screenMargin }}>
				{reduced ? <Waveform levels={[level]} /> : <Waveform levels={shown} />}
			</View>
			<View style={{ paddingTop: 24, alignItems: "center" }}>
				<Text variant="mono" color="ink2">
					{`${clockOf(elapsed)} / ${clockOf(LIMIT_MS)}`}
				</Text>
			</View>
			<View style={{ paddingTop: 12, alignItems: "center" }}>
				{status === "denied" ? null : (
					<RecordButton
						recording={recording}
						onPress={
							status === "recording" ? stop : status === "paused" ? resume : recording ? undefined : () => void start()
						}
					/>
				)}
			</View>
			<View style={{ paddingTop: 12, paddingHorizontal: layout.screenMargin, alignItems: "center" }}>
				<Text variant="small" color="ink2" align="center" accessibilityLiveRegion="polite">
					{status === "denied"
						? t`The microphone is off for Reactive Resume. Type your answer, or turn it on in Settings.`
						: limitHit
							? t`Recording stopped at the 2-minute limit. Transcribing what you said.`
							: (notice ?? label)}
				</Text>
			</View>
			{status === "paused" ? (
				<View style={{ paddingTop: 12, flexDirection: "row", justifyContent: "center", gap: 12 }}>
					<Button label={t`Resume`} tone="secondary" size="md" onPress={resume} />
					<Button label={t`Finish`} tone="primary" size="md" onPress={() => void finish()} />
					<Button label={t`Discard`} tone="ghost" size="md" onPress={() => void discard()} />
				</View>
			) : null}
			<View style={{ paddingTop: 12, alignItems: "center" }}>
				<View style={{ paddingVertical: 4 }}>
					{status === "denied" ? (
						<TextLink label={t`Open Settings`} onPress={() => void Linking.openSettings()} />
					) : (
						<TextLink label={t`Type your answer instead`} icon="keyboard" onPress={onTypeInstead} />
					)}
				</View>
			</View>
		</View>
	);
}
