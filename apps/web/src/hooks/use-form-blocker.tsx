import type { AnyFormApi } from "@tanstack/react-form";
import { t } from "@lingui/core/macro";
import { useSelector } from "@tanstack/react-form";
import { useEffect, useRef } from "react";
import { useDialogStore } from "@/dialogs/store";
import { useConfirm } from "@/hooks/use-confirm";

interface UseFormBlockerOptions {
	shouldBlock?: () => boolean;
}

export function useFormBlocker(form: Pick<AnyFormApi, "store">, options?: UseFormBlockerOptions) {
	const confirm = useConfirm();
	const onOpenChange = useDialogStore((state) => state.onOpenChange);
	const setOnBeforeClose = useDialogStore((state) => state.setOnBeforeClose);

	const isDirty = useSelector(form.store, (state) => state.isDirty);
	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
	const shouldBlockRef = useRef(options?.shouldBlock);

	useEffect(() => {
		shouldBlockRef.current = options?.shouldBlock;
	}, [options?.shouldBlock]);

	useEffect(() => {
		setOnBeforeClose(() => {
			const shouldBlock = shouldBlockRef.current ? shouldBlockRef.current() : isDirty && !isSubmitting;
			if (!shouldBlock) return true;

			return confirm(t`Are you sure you want to close this dialog?`, {
				description: t`You have unsaved changes that will be lost.`,
				confirmText: t`Leave`,
				cancelText: t`Stay`,
			});
		});
		return () => setOnBeforeClose(null);
	}, [isDirty, isSubmitting, confirm, setOnBeforeClose]);

	// Closing through the store asks the handler above first.
	const requestClose = () => onOpenChange(false);

	return { requestClose };
}
