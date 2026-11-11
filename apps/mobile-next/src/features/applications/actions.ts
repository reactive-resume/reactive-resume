import type { CLOSED_REASONS } from "./model";
// Stage moves, Close, Reopen and Move to Trash, shared by J1, J2, J6, J7 and J9. Applied means sent: every route to
// Applied opens J7's "What did you send?" step (BUILD.md §3.5); nothing changes until it is confirmed.
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { PIPELINE, stageLabel } from "./model";
import { closeApplication, moveToTrash, reopenApplication, restore, useDataActions } from "@/data";
import { now, zonedParts } from "@/data/clock";
import { allApplicationTrash } from "@/data/trash";
import { haptic, showToast } from "@/ui";

type Moveable = { id: string; status: ApplicationStatus };
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/** The href of the "What did you send?" step; `queue` holds more applications of a bulk move, answered one by one. */
export const sentStepHref = (id: string, queue: readonly string[] = []) =>
	`/applications/${id}/stage?step=sent${queue.length ? `&queue=${queue.join(",")}` : ""}` as const;

/** The stage after this one, or null at Offer and Closed. */
export function nextStage(status: ApplicationStatus): ApplicationStatus | null {
	const index = PIPELINE.indexOf(status as (typeof PIPELINE)[number]);
	return index >= 0 && index < PIPELINE.length - 1 ? (PIPELINE[index + 1] ?? null) : null;
}

export function useApplicationActions() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { write } = useDataActions();
	const refresh = () => queryClient.invalidateQueries();

	const setStage = (id: string, status: Exclude<ApplicationStatus, "applied" | "closed">) =>
		write("applications", "applications.update", { id, status, stageEnteredAt: zonedParts(now()).date });

	/** Move one application: Applied opens the sent step; others move at once with a toast and Undo. */
	async function moveTo(app: Moveable, status: ApplicationStatus) {
		if (status === app.status) return true;
		if (status === "applied") {
			router.push(sentStepHref(app.id));
			return false;
		}
		if (status === "closed") {
			router.push(`/applications/${app.id}/stage?step=close`);
			return false;
		}
		const previous = app.status;
		try {
			if (previous === "closed") await reopenApplication(app.id, status);
			else await setStage(app.id, status);
			await refresh();
		} catch (error) {
			// Stages edited on another device: refresh them and let the person choose again.
			const changed = (error as { code?: string }).code === "CONFLICT";
			if (changed) await refresh();
			showToast({
				message: changed
					? t`Your stages changed somewhere else. They've been refreshed; try again.`
					: t`Couldn't update the application. Try again.`,
			});
			return false;
		}
		showToast({
			message: t`Moved to ${stageLabel(status)}.`,
			action: {
				label: t`Undo`,
				onPress: () => {
					if (previous !== "applied" && previous !== "closed") void setStage(app.id, previous).then(refresh);
				},
			},
			// A stage that expects an interview offers to schedule it (J2).
			...(status === "interview"
				? {
						secondAction: {
							label: t`Schedule it`,
							onPress: () => router.push(`/applications/${app.id}/interview`),
						},
					}
				: {}),
		});
		return true;
	}

	/** Move several: Applied asks for each in turn; the rest move together. */
	async function moveMany(apps: readonly Moveable[], status: ApplicationStatus) {
		const moving = apps.filter((app) => app.status !== status);
		if (status === "applied") {
			const [first, ...rest] = moving;
			if (first)
				router.push(
					sentStepHref(
						first.id,
						rest.map((app) => app.id),
					),
				);
			return;
		}
		if (status === "closed") return;
		try {
			for (const app of moving)
				if (app.status === "closed") await reopenApplication(app.id, status);
				else await setStage(app.id, status);
			await refresh();
			showToast({ message: t`Moved to ${stageLabel(status)}.` });
		} catch {
			showToast({ message: t`Couldn't update the application. Try again.` });
		}
	}

	/** Reversible: `light`, a toast with Undo, and the same Undo in Trash. */
	async function moveToTrashWithUndo(ids: readonly string[]) {
		try {
			for (const id of ids) await moveToTrash({ type: "application", id });
		} catch {
			showToast({ message: t`Couldn't move it to Trash. Try again.` });
			return;
		}
		haptic("light");
		await refresh();
		showToast({
			message: ids.length === 1 ? t`Moved to Trash` : t`Moved ${ids.length} applications to Trash`,
			action: {
				label: t`Undo`,
				onPress: () => {
					void (async () => {
						// Read Trash now: the screen's Trash query may be an older generation by the time Undo is tapped.
						const items = await allApplicationTrash();
						for (const id of ids) {
							const row = items.find((item) => item.id === id);
							if (row) await restore({ type: "application", id, trashedAt: row.trashedAt });
						}
						await refresh();
					})().catch(() => showToast({ message: t`Couldn't restore it. Open Trash to try again.` }));
				},
			},
		});
	}

	async function close(id: string, reason: ClosedReason, note?: string, before?: ApplicationStatus, toast = true) {
		await closeApplication(id, reason, note);
		await refresh();
		if (reason === "accepted") haptic("success");
		if (toast)
			showToast({
				message: t`Closed`,
				action: { label: t`Undo`, onPress: () => void reopen(id, before) },
			});
	}

	/** Reopen at the stage it closed from. Applied can only be re-entered through the sent step, so it reopens Saved. */
	async function reopen(id: string, before?: ApplicationStatus | null) {
		const status = before && before !== "applied" && before !== "closed" ? before : undefined;
		try {
			await reopenApplication(id, status);
			await refresh();
		} catch {
			showToast({ message: t`Couldn't reopen the application. Try again.` });
		}
	}

	return { moveTo, moveMany, moveToTrash: moveToTrashWithUndo, close, reopen };
}
