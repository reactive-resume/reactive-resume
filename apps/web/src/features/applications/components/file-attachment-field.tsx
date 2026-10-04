import { t } from "@lingui/core/macro";
import { useRef } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";

export type FileAttachment = { url: string; name: string };

type Props = {
	// A saved attachment, a locally picked file, or nothing.
	value: FileAttachment | File | null;
	onChange: (value: File | null) => void;
	// Copy for the empty-state button, e.g. "Attach a cover letter (PDF)".
	attachLabel: string;
	disabled?: boolean;
};

// Picking/removing changes only the parent's draft; the application save owns storage.
export function FileAttachmentField({ value, onChange, attachLabel, disabled }: Props) {
	const inputRef = useRef<HTMLInputElement>(null);

	const onSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (file.type !== "application/pdf") {
			toast.add({ type: "error", description: t`Please upload a PDF file.` });
			return;
		}
		onChange(file);
		event.target.value = "";
	};

	return (
		<>
			{value ? (
				<div className="flex items-center gap-3 rounded-lg border border-line p-2.5">
					<span className="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent-text">
						<Icon name="picture_as_pdf" size={16} />
					</span>
					{value instanceof File ? (
						<span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
					) : (
						<a
							href={value.url}
							target="_blank"
							rel="noreferrer"
							className="min-w-0 flex-1 truncate text-sm hover:underline"
						>
							{value.name}
						</a>
					)}
					<button
						type="button"
						title={t`Remove file`}
						disabled={disabled}
						className="text-ink-3 hover:text-danger-text disabled:opacity-40"
						onClick={() => onChange(null)}
					>
						<Icon name="close" size={16} />
					</button>
				</div>
			) : (
				<button
					type="button"
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
					className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line p-2.5 text-sm text-ink-3 transition-[background-color,opacity] hover:bg-sunken/50 disabled:opacity-60"
				>
					<Icon name="upload" size={16} />
					{attachLabel}
				</button>
			)}
			<input
				ref={inputRef}
				type="file"
				accept="application/pdf"
				className="hidden"
				disabled={disabled}
				onChange={onSelect}
			/>
		</>
	);
}
