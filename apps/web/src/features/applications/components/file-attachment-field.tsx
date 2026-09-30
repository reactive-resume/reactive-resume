import { t } from "@lingui/core/macro";
import { FilePdfIcon, UploadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { toast } from "@reactive-resume/ui/components/toast";

export type FileAttachment = { url: string; name: string };

// A pick that hasn't reached storage yet: the parent keeps the File around and uploads it
// when (and only if) the surrounding change is committed.
export type StagedAttachment = FileAttachment & { file: File };

type Props = {
	// The attached file, or null when nothing is attached yet.
	value: FileAttachment | null;
	// Emits the picked File, or null when the attachment is removed. No storage call happens
	// here — the parent decides when to upload/delete (on save vs. immediately).
	onChange: (file: File | null) => void;
	// Copy for the empty-state button, e.g. "Attach a cover letter (PDF)".
	attachLabel: string;
	disabled?: boolean;
};

// PDF-only attachment picker used for the resume file and cover letter. Deliberately a pure
// value control: staging the File instead of uploading on select — and reporting removal
// instead of deleting — is what lets a cancelled edit leave storage untouched.
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
		// Reset so picking the same file twice in a row still fires a change event.
		if (inputRef.current) inputRef.current.value = "";
	};

	return (
		<>
			{value ? (
				<div className="flex items-center gap-3 rounded-lg border border-border p-2.5">
					<span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
						<FilePdfIcon />
					</span>
					<a
						href={value.url}
						target="_blank"
						rel="noreferrer"
						className="min-w-0 flex-1 truncate text-sm hover:underline"
					>
						{value.name}
					</a>
					<button
						type="button"
						title={t`Remove file`}
						disabled={disabled}
						className="text-muted-foreground hover:text-destructive disabled:opacity-40"
						onClick={() => onChange(null)}
					>
						<XIcon />
					</button>
				</div>
			) : (
				<button
					type="button"
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
					className="flex w-full items-center gap-2 rounded-lg border border-border border-dashed p-2.5 text-muted-foreground text-sm hover:bg-muted/50 disabled:opacity-60"
				>
					<UploadSimpleIcon />
					{attachLabel}
				</button>
			)}
			<input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={onSelect} />
		</>
	);
}
