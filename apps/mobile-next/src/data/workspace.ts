import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { File } from "expo-file-system";
import { useState } from "react";
import { usePlatformActions } from "./actions";
import { markApplied } from "./applied";
import { zonedParts, now } from "./clock";
import { ensureApproved, type Connection } from "./consent";
import { isFake, screenTexts } from "./fixtures";
import { closeApplication, reopenApplication } from "./lifecycle";
import { activeDataScope, assertDataScope } from "./scope";
import { rest } from "@/api/client";

type Input = RouterInput["career"]["generate"];
export function validatePracticeAudio(size: number, mediaType: string) {
	if (!Number.isFinite(size) || size <= 0 || size > 2 * 1024 * 1024) throw new Error(t`Choose audio up to 2 MB.`);
	if (!["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg"].includes(mediaType))
		throw new Error(t`Unsupported audio format.`);
}
export async function uploadPracticeAudio(
	input: {
		uri: string;
		name: string;
		mediaType: string;
		applicationId: string | null;
		connection: Connection;
		model: string;
	},
	signal: AbortSignal,
) {
	const scope = activeDataScope();
	const file = new File(input.uri);
	validatePracticeAudio(file.size, input.mediaType);
	if (!(await ensureApproved("audio", input.connection))) throw new Error(t`Audio sharing was not approved.`);
	assertDataScope(scope);
	signal.throwIfAborted();
	if (isFake()) return { id: "practice-transcript", text: screenTexts("W4-Practice")[1] ?? "" };
	const body = new FormData();
	body.append("audio", file, input.name);
	body.append("providerId", input.connection.id);
	body.append("model", input.model);
	if (input.applicationId) body.append("applicationId", input.applicationId);
	const response = await rest("/career/voice/transcribe", { method: "POST", body, signal }, scope);
	assertDataScope(scope);
	signal.throwIfAborted();
	if (!response.ok) throw new Error(t`Couldn't transcribe the recording. It is kept on this device.`);
	const result: unknown = await response.json();
	if (
		!result ||
		typeof result !== "object" ||
		!("id" in result) ||
		!("text" in result) ||
		typeof result.id !== "string" ||
		typeof result.text !== "string"
	)
		throw new Error(t`Invalid transcript response.`);
	return { id: result.id, text: result.text };
}
export function useWorkspaceActions(applicationId: string) {
	const actions = usePlatformActions();
	const [progress, setProgress] = useState<"idle" | "generating" | "complete" | "failed">("idle");
	return {
		progress,
		save: (input: Omit<RouterInput["career"]["saveWorkspace"], "applicationId">) =>
			actions.write("applications", "career.saveWorkspace", { ...input, applicationId }),
		async generate(task: Input["task"], locale = "en-US", signal?: AbortSignal) {
			setProgress("generating");
			try {
				const result = await actions.run("career.generate", { applicationId, task, locale }, signal);
				setProgress("complete");
				return result;
			} catch (error) {
				setProgress("failed");
				throw error;
			}
		},
		redraftMessage: (message: string, locale = "en-US", signal?: AbortSignal) =>
			actions.run("career.generate", { applicationId, task: { task: "reply", message }, locale }, signal),
		logFollowUp: (input: Omit<RouterInput["applications"]["logFollowUp"], "id">) =>
			actions.run("applications.logFollowUp", { ...input, id: applicationId }),
		applyReply: (input: RouterInput["career"]["applyReply"]) => actions.run("career.applyReply", input),
		undoReply: (input: RouterInput["career"]["undoReply"]) => actions.run("career.undoReply", input),
	};
}
export function useApplicationActions() {
	const actions = usePlatformActions();
	const [progress, setProgress] = useState<"idle" | "reading" | "review" | "saving" | "complete" | "failed">("idle");
	return {
		progress,
		markApplied,
		close: closeApplication,
		reopen: reopenApplication,
		move: (input: RouterInput["applications"]["update"]) =>
			actions.write("applications", "applications.update", {
				...input,
				stageEnteredAt: input.stageEnteredAt ?? zonedParts(now()).date,
			}),
		importMany: (input: RouterInput["applications"]["import"]) => actions.run("applications.import", input),
		bulkMove: (input: RouterInput["applications"]["bulkUpdate"]) =>
			actions.write("applications", "applications.bulkUpdate", input),
		addInterview: (input: RouterInput["applications"]["addInterview"]) =>
			actions.run("applications.addInterview", input),
		updateInterview: (input: RouterInput["applications"]["updateInterview"]) =>
			actions.run("applications.updateInterview", input),
		async parsePosting(input: string, useAI = false, signal?: AbortSignal) {
			setProgress("reading");
			try {
				const result = await actions.run("applications.ai.parsePosting", { input, useAI }, signal);
				setProgress("review");
				return result;
			} catch (error) {
				setProgress("failed");
				throw error;
			}
		},
		async saveJob(input: RouterInput["applications"]["create"]) {
			setProgress("saving");
			try {
				const id = await actions.run("applications.create", input);
				setProgress("complete");
				return id;
			} catch (error) {
				setProgress("failed");
				throw error;
			}
		},
		/** Selection returns a reviewable Saved application input; saving remains explicit. */
		selectOpportunity: (id: string) => actions.run("career.trackOpportunity", { id }),
	};
}
