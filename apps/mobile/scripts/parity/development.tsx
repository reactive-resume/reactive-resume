import type { ResumeDocument } from "../../src/draft/types";
import { useLingui } from "@lingui/react/macro";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { installDevelopmentSession } from "../../src/auth/session";
import { resumeFieldFocus, useResumeStore } from "../../src/draft";
import { Banner, Button, TextField } from "../../src/ui";
import { runParity } from "./device";
import { runReviewChecks } from "./review";

type DevelopmentToolsProps = { id: string; origin: string; fullParity: boolean };
let running: Promise<void> | undefined;

async function prepare(id: string, origin: string, fullParity: boolean) {
	await installDevelopmentSession(origin);
	if (fullParity) await runParity(origin);
	const data = await runReviewChecks(origin);
	data.basics.name = "Draft-backed preview";
	const document: ResumeDocument = {
		id,
		name: "M3-T4 disposable draft",
		slug: "preview",
		tags: [],
		isPublic: false,
		isLocked: false,
		showDownloadButtons: true,
		showInSearchEngines: false,
		hideContactDetails: false,
		isPrimary: false,
		hasPassword: false,
		applicationId: null,
		createdAt: new Date(0),
		updatedAt: new Date(1),
		data,
	};
	const subject = "rr-M3T4-preview";
	const owner = JSON.stringify([origin, subject]);
	Storage.setItemSync(
		`reactive-resume:unsaved:${encodeURIComponent(owner)}:resume:${id}`,
		JSON.stringify({ baseline: document, document, sessionId: "rr-M3T4-preview" }),
	);
	console.info(`[preview-review] ${Platform.OS} SQLite draft prepared for the real Page hook`);
}

/** Required only inside a top-level __DEV__ branch; release Metro never collects this module. */
export function DevelopmentTools({ id, origin, fullParity }: DevelopmentToolsProps) {
	const { t } = useLingui();
	const [status, setStatus] = useState<"checking" | "passed" | "failed">("checking");
	const draft = useResumeStore();
	const editDraft = async () => {
		const undoing = draft.canUndo;
		if (undoing) draft.undo();
		else
			draft.update(
				(value) => {
					value.basics.name = "Draft-backed edit";
				},
				{ newStep: true },
			);
		await draft.flush();
		const owner = JSON.stringify([origin, "rr-M3T4-preview"]);
		const stored = Storage.getItemSync(`reactive-resume:unsaved:${encodeURIComponent(owner)}:resume:${id}`);
		const expected = undoing ? "Draft-backed preview" : "Draft-backed edit";
		if (useResumeStore.getState().data?.basics.name !== expected || !stored?.includes(expected))
			throw new Error("Draft edit/undo did not reach SQLite");
		console.info(`[preview-review] ${Platform.OS} draft ${undoing ? "undo" : "edit"} persisted PASS`);
	};
	useEffect(() => {
		let active = true;
		running ??= prepare(id, origin, fullParity);
		void running.then(
			() => {
				if (active) setStatus("passed");
			},
			(error: unknown) => {
				console.info(`[preview-review] ${Platform.OS} FAIL (${error instanceof Error ? error.message : "error"})`);
				if (active) setStatus("failed");
			},
		);
		return () => {
			active = false;
		};
	}, [id, origin, fullParity]);
	return (
		<>
			<Banner
				tone={status === "failed" ? "danger" : "info"}
				message={
					status === "checking"
						? t`Checking preview resources…`
						: status === "passed"
							? t`Preview review checks passed`
							: t`Preview review checks failed`
				}
			/>
			{status === "passed" && draft.data ? (
				<>
					<TextField
						label={t`Draft name`}
						value={draft.data.basics.name}
						onChangeText={(name) =>
							draft.update(
								(value) => {
									value.basics.name = name;
								},
								{ coalesceKey: "basics.name" },
							)
						}
						{...resumeFieldFocus}
					/>
					<Button
						label={draft.canUndo ? t`Undo draft edit` : t`Edit draft`}
						onPress={() => {
							void editDraft();
						}}
					/>
				</>
			) : null}
		</>
	);
}
