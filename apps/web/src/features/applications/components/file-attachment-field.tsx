import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { orpc } from "@/libs/orpc/client";

export type FileAttachment = { url: string; name: string };

type Props = {
	// The uploaded file, or null when nothing is attached yet.
	value: FileAttachment | null;
	onChange: (value: FileAttachment | null) => void;
	// Copy for the empty-state button, e.g. "Attach a cover letter (PDF)".
	attachLabel: string;
	disabled?: boolean;
};

// PDF-only upload to the shared storage route, used for both the resume file and cover letter.
// Handles upload + best-effort delete; persistence of the returned URL is the parent's job.
export function FileAttachmentField({ value, onChange, attachLabel, disabled }: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const upload = useMutation(orpc.storage.uploadFile.mutationOptions({ meta: { noInvalidate: true } }));
	const remove = useMutation(orpc.storage.deleteFile.mutationOptions({ meta: { noInvalidate: true } }));

	const onSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (file.type !== "application/pdf") {
			toast.add({ type: "error", description: t`Please upload a PDF file.` });
			return;
		}
		const toastId = toast.add({ type: "loading", description: t`Uploading…` });
		upload.mutate(file, {
			onSuccess: ({ url }) => {
				toast.close(toastId);
				onChange({ url, name: file.name });
				if (inputRef.current) inputRef.current.value = "";
			},
			onError: () =>
				toast.add({ type: "error", description: t`Couldn't upload the file. Please try again.`, id: toastId }),
		});
	};

	const clear = () => {
		if (!value) return;
		// Best-effort delete of the stored file; the storage route defaults a bare filename to the
		// user's upload dir. Clear regardless so the UI reflects the removal.
		const filename = new URL(value.url, window.location.origin).pathname.split("/").pop();
		if (filename) remove.mutate({ filename });
		onChange(null);
	};

	return (
		<>
			{value ? (
				<div className="flex items-center gap-3 rounded-lg border border-line p-2.5">
					<span className="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent-text">
						<Icon name="picture_as_pdf" size={16} />
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
						className="text-ink-3 hover:text-danger-text disabled:opacity-40"
						onClick={clear}
					>
						<Icon name="close" size={16} />
					</button>
				</div>
			) : (
				<button
					type="button"
					disabled={disabled || upload.isPending}
					onClick={() => inputRef.current?.click()}
					className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line p-2.5 text-sm text-ink-3 transition-[background-color,opacity] hover:bg-sunken/50 disabled:opacity-60"
				>
					<Icon name="upload" size={16} />
					{upload.isPending ? <Trans>Uploading…</Trans> : attachLabel}
				</button>
			)}
			<input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={onSelect} />
		</>
	);
}
