// S8 · Sign out with unsynced work: a dialog over S1, only when something is still queued. The title counts it, one
// line says what would happen and the next counts it by kind. Online the first button syncs, then signs out; a failed
// sync names its cause with its own first action. Offline, Keep working comes first. Export a copy first stays open
// until the system save finishes. Scrim tap and Android back keep working. `warning` plays when it opens (an
// account-level loss is possible), `success` when the sync finishes.
import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { failureFromError, type PendingCounts, type SignOutStep, totalPending } from "./sign-out";
import { pendingByKind, pendingTitle, signOutMessage } from "./sign-out-copy";
import { signIn, signOut, useSession } from "@/auth/session";
import { saveQueuedBundle, useDataActions } from "@/data";
import { hostOf } from "@/features/auth/options";
import { Dialog, type DialogAction, haptic } from "@/ui";

export function SignOutDialog({
	open,
	counts,
	offline,
	conflicts = 1,
	onClose,
	onSignedOut,
	initial = { step: "ask" },
}: {
	open: boolean;
	counts: PendingCounts;
	offline: boolean;
	conflicts?: number;
	onClose: () => void;
	onSignedOut: () => void;
	/** Storyboard captures of the failure variants. */
	initial?: SignOutStep;
}) {
	const { server } = useSession();
	const actions = useDataActions();
	const [state, setState] = useState<SignOutStep>(initial);
	const busy = state.step === "syncing" || state.step === "exporting";
	useEffect(() => {
		if (open) haptic("warning");
	}, [open]);
	const guard = (fn: () => void) => () => {
		if (!busy) fn();
	};

	const sync = async () => {
		setState({ step: "syncing" });
		try {
			await actions.flush();
			haptic("success");
			await signOut();
			onSignedOut();
		} catch (error) {
			setState({ step: "failed", failure: failureFromError(error) });
		}
	};

	const signInAgain = async () => {
		try {
			if (await signIn(server)) await sync();
		} catch {
			setState({ step: "failed", failure: "session-expired" });
		}
	};

	const exportCopy = async () => {
		setState({ step: "exporting" });
		try {
			await saveQueuedBundle();
			setState({ step: "exported" });
		} catch {
			// Cancelled or failed: still signed in, nothing lost.
			setState({ step: "ask" });
		}
	};

	const discard = async () => {
		await signOut({ discard: true });
		onSignedOut();
	};

	const keepWorking: DialogAction = { label: t`Keep working`, tone: "secondary", onPress: onClose };
	const exportAction: DialogAction = {
		label:
			state.step === "exporting"
				? t`Exporting…`
				: state.step === "exported"
					? t`Saved to Files`
					: t`Export a copy first`,
		tone: "secondary",
		onPress: guard(() => (state.step === "exported" ? undefined : void exportCopy())),
	};
	const discardAction: DialogAction = {
		label: t`Sign out and discard`,
		tone: "ghostDanger",
		onPress: guard(() => void discard()),
	};

	let first: DialogAction;
	if (state.step === "failed")
		first =
			state.failure === "session-expired"
				? { label: t`Sign in again`, tone: "primary", onPress: () => void signInAgain() }
				: state.failure === "conflict"
					? { label: t`Review`, tone: "primary", onPress: onClose }
					: state.failure === "no-response"
						? { label: t`Try again`, tone: "primary", onPress: () => void sync() }
						: { ...keepWorking, tone: "primary" };
	else if (offline) first = { ...keepWorking, tone: "primary" };
	else
		first = {
			label: state.step === "syncing" ? t`Syncing…` : t`Sync and sign out`,
			tone: "primary",
			onPress: guard(() => void sync()),
		};
	const keepFirst = first.label === keepWorking.label;

	return (
		<Dialog
			open={open}
			onClose={guard(onClose)}
			title={pendingTitle(totalPending(counts))}
			message={signOutMessage(state, offline, hostOf(server), conflicts)}
			count={{ icon: "cloud-slash", text: pendingByKind(counts) }}
			actions={[first, ...(keepFirst ? [] : [keepWorking]), exportAction, discardAction]}
		/>
	);
}
