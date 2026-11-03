import type { DialogSchema } from "./schemas";
import { lazy, Suspense, useState } from "react";
import { Dialog } from "@reactive-resume/ui/components/dialog";
import { Sheet } from "@reactive-resume/ui/components/sheet";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { useDialogStore } from "./store";

type RenderDialogProps = { dialog: DialogSchema; mobileSheet: boolean };

// Forms, importers and editors load on first open.
const DialogContent = lazy(async () => {
	const { renderDialog } = await import("./renderers");
	return { default: ({ dialog, mobileSheet }: RenderDialogProps) => renderDialog(dialog, mobileSheet) };
});

type DialogInstanceProps = { dialog: DialogSchema };

function DialogInstance({ dialog }: DialogInstanceProps) {
	const { open, onOpenChange } = useDialogStore();
	const breakpoint = useBreakpoint();
	// Rotating/resizing an open form must not replace its provider and discard its draft/import.
	const [mobileSheet] = useState(() => dialog.type === "document.new" && breakpoint === "mobile");
	const Layer = mobileSheet ? Sheet : Dialog;
	return (
		<Layer open={open} onOpenChange={onOpenChange}>
			<Suspense>
				<DialogContent dialog={dialog} mobileSheet={mobileSheet} />
			</Suspense>
		</Layer>
	);
}

export function DialogManager() {
	const { activeDialog, openCount } = useDialogStore();
	return activeDialog && <DialogInstance key={openCount} dialog={activeDialog} />;
}
