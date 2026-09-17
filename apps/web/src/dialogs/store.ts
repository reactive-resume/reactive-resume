import type { DialogData, DialogProps, DialogSchema, DialogType } from "./schemas";
import { create } from "zustand/react";

export type { DialogProps };

interface DialogStoreState {
	open: boolean;
	activeDialog: DialogSchema | null;
	onBeforeClose: (() => boolean | Promise<boolean>) | null;
}

interface DialogStoreActions {
	onOpenChange: (open: boolean, eventDetails?: { cancel?: () => void }) => void;
	openDialog: <T extends DialogType>(type: T, data: DialogData<T>) => void;
	closeDialog: () => void;
	setOnBeforeClose: (handler: (() => boolean | Promise<boolean>) | null) => void;
}

type DialogStore = DialogStoreState & DialogStoreActions;

export const useDialogStore = create<DialogStore>((set) => ({
	open: false,
	activeDialog: null,
	onBeforeClose: null,
	onOpenChange: (open, eventDetails) => {
		if (open) return set({ open: true });

		const { onBeforeClose } = useDialogStore.getState();
		if (!onBeforeClose) return useDialogStore.getState().closeDialog();

		void Promise.resolve(onBeforeClose()).then((canClose) => {
			if (canClose) return useDialogStore.getState().closeDialog();
			eventDetails?.cancel?.();
		});
	},
	openDialog: (type, data) =>
		set({
			open: true,
			activeDialog: { type, data } as DialogSchema,
			onBeforeClose: null,
		}),
	closeDialog: () => {
		const closingDialog = useDialogStore.getState().activeDialog;
		set({ open: false });
		setTimeout(() => {
			const state = useDialogStore.getState();
			if (state.open || state.activeDialog !== closingDialog) return;
			set({ activeDialog: null, onBeforeClose: null });
		}, 300);
	},
	setOnBeforeClose: (handler) => set({ onBeforeClose: handler }),
}));
