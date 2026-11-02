import { useDialogStore } from "@/dialogs/store";
import { useCommandPaletteStore } from "@/features/command-palette/store";

export function shortcutOverlayOpen() {
	if (useDialogStore.getState().open || useCommandPaletteStore.getState().open) return true;
	return Boolean(
		document.querySelector(
			'[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="context-menu-content"], [role="menu"], [role="listbox"]',
		),
	);
}
