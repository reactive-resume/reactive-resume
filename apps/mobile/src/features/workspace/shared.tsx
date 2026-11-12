// What every workspace screen (W1–W5, Debrief, Library) reads, and the AI run they share: S7 approval before the
// first send of each kind, a Working label with Stop while it runs, `error` and the person's words kept on failure.
import type { DataKind } from "@/data";
import { t } from "@lingui/core/macro";
import { useRef, useState } from "react";
import { View } from "react-native";
import {
	ensureApproved,
	providerConnection,
	uploadPracticeAudio,
	useAIProviders,
	useApplication,
	useCareerOffers,
	useWorkspaceActions,
} from "@/data";
import { now, timeZone } from "@/data/clock";
import { nextInterview, type SavedItem } from "@/features/applications/model";
import { Button, haptic, layout, WorkingLabel } from "@/ui";

/** Work saved for one application (fit results, briefings, attempts, drafts). */
export function useSavedItems(applicationId: string) {
	const saved = useCareerOffers({ applicationId });
	return (saved.data ?? []).filter((item) => item.applicationId === applicationId);
}

export function useWorkspace(applicationId: string) {
	const application = useApplication(applicationId);
	const items = useSavedItems(applicationId);
	const providers = useAIProviders();
	const provider = providers.data?.find((p) => p.isDefault && p.enabled) ?? providers.data?.find((p) => p.enabled);
	const latest = <K extends SavedItem["data"]["kind"]>(kind: K) =>
		items
			.filter((item): item is SavedItem & { data: Extract<SavedItem["data"], { kind: K }> } => item.data.kind === kind)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	const app = application.data;
	const actions = useWorkspaceActions(applicationId);
	const connection = provider ? providerConnection(provider) : null;
	/** Upload a take and get its transcript (W4, Debrief). */
	const transcribe = (uri: string, signal: AbortSignal) => {
		if (!connection || !provider) return Promise.reject(new Error("No AI connection"));
		const name = uri.split("/").pop() ?? "take.m4a";
		return uploadPracticeAudio(
			{ uri, name, mediaType: "audio/mp4", applicationId, connection, model: provider.model },
			signal,
		);
	};
	return {
		application,
		actions,
		transcribe,
		app,
		items,
		latest,
		provider,
		connection,
		zone: timeZone(),
		at: now(),
		interview: app ? nextInterview(app, now()) : undefined,
	};
}

export const STEPS = {
	fit: () => [t`Reading the posting`, t`Matching your facts`, t`Still working`],
	briefing: () => [t`Reading the posting`, t`Choosing your stories`, t`Still working`],
	draft: () => [t`Reading the thread`, t`Drafting`, t`Still working`],
	feedback: () => [t`Transcribing what you said`, t`Reading your answer`, t`Still working`],
};

/**
 * One AI request at a time for a screen. `run` asks S7 first (once per kind and connection), then sends; Stop
 * cancels. The sending is the data layer's generate action; on failure nothing the person wrote is lost.
 */
export function useAIRun(connection: ReturnType<typeof useWorkspace>["connection"]) {
	const [running, setRunning] = useState(false);
	const [failed, setFailed] = useState(false);
	const controller = useRef<AbortController | null>(null);
	async function run(kind: DataKind, send: (signal: AbortSignal) => Promise<unknown>) {
		if (!connection) return;
		if (!(await ensureApproved(kind, connection))) return;
		controller.current = new AbortController();
		setFailed(false);
		setRunning(true);
		try {
			await send(controller.current.signal);
			haptic("success");
		} catch {
			if (!controller.current.signal.aborted) {
				haptic("error");
				setFailed(true);
			}
		} finally {
			setRunning(false);
		}
	}
	const stop = () => {
		haptic("light");
		controller.current?.abort();
		setRunning(false);
	};
	return { running, failed, run, stop };
}

/** Working label with Stop beside it. */
export function Working({ steps, onStop }: { steps: readonly string[]; onStop: () => void }) {
	return (
		<View
			style={{
				paddingTop: 20,
				paddingHorizontal: layout.screenMargin,
				flexDirection: "row",
				alignItems: "center",
				gap: 12,
			}}
		>
			<View style={{ flex: 1 }}>
				<WorkingLabel steps={steps} />
			</View>
			<Button label={t`Stop`} tone="ghost" size="sm" onPress={onStop} />
		</View>
	);
}
