import { t } from "@lingui/core/macro";
import { showToast } from "@/ui";

const RESTORED_MS = 1500;

/** After an Undo in a toast: "Restored" for a moment, with no action, so the tap visibly did something (web undone). */
export function confirmUndone() {
	showToast({ message: t`Restored`, duration: RESTORED_MS });
}
