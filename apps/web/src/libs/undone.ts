import { t } from "@lingui/core/macro";
import { toast } from "@reactive-resume/ui/components/toast";

const RESTORED_MS = 1500;

/** After an Undo in a toast: "Restored" for a moment, with no action, so the click visibly did something. */
export function confirmUndone() {
	toast.add({ description: t`Restored`, timeout: RESTORED_MS });
}
