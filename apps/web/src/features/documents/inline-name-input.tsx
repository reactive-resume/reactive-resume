import { t } from "@lingui/core/macro";
import { useRef, useState } from "react";
import { toastError } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";

type InlineNameInputProps = {
	name: string;
	disabled?: boolean;
	onSave: (name: string) => void | Promise<unknown>;
	onDone: () => void;
};

/** Enter and blur commit once; Escape cancels. Failed saves keep the entered name open. */
export function InlineNameInput({ name, disabled, onSave, onDone }: InlineNameInputProps) {
	const [value, setValue] = useState(name);
	const [saving, setSaving] = useState(false);
	const settled = useRef(false);
	const commit = async () => {
		if (settled.current || disabled) return;
		settled.current = true;
		const next = value.trim();
		if (!next || next === name) return onDone();
		setSaving(true);
		try {
			await onSave(next);
			onDone();
		} catch (error) {
			settled.current = false;
			setSaving(false);
			toastError(error, t`Couldn't rename the document. Try again.`);
		}
	};

	return (
		<input
			// oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename was chosen from the document menu.
			autoFocus
			value={value}
			maxLength={100}
			aria-label={t`Name`}
			disabled={disabled || saving}
			onChange={(event) => setValue(event.target.value)}
			onFocus={(event) => event.target.select()}
			onBlur={() => void commit()}
			onKeyDown={(event) => {
				if (isImeComposing(event)) return;
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					void commit();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					settled.current = true;
					onDone();
				}
			}}
			className="h-7 w-full min-w-0 rounded-md border border-accent bg-raised px-1.5 text-sm font-semibold ring-3 ring-accent-soft outline-none"
		/>
	);
}
