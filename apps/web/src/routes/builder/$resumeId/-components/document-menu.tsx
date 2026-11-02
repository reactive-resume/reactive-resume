import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { isolate } from "@reactive-resume/utils/string";
import { NotesSectionBuilder } from "../-sidebar/right/sections/notes";
import { DocumentDetails } from "./document-details";
import { ChipInput } from "@/components/input/chip-input";
import { useDialogStore } from "@/dialogs/store";
import { InlineNameInput } from "@/features/documents/inline-name-input";
import { savePendingChanges, saveResumeMetadata } from "@/features/resume/builder/draft";
import { useCurrentResume, usePatchResume, useResumeStore } from "@/features/resume/builder/draft";
import { setResumeLocked } from "@/features/resume/builder/lock";
import { DocumentMenuTrigger } from "@/features/resume/editor/chrome";
import { SaveStatus } from "@/features/resume/editor/save-status";
import { useEditorStore } from "@/features/resume/editor/store";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type DocumentDialog = "rename" | "tags" | "notes" | "details" | null;

/**
 * The document name in the editor bar opens the document menu: rename, duplicate, lock, notes,
 * details, print and delete.
 */
export function DocumentMenu() {
	const resume = useCurrentResume();
	const { id, name, isLocked } = resume;
	const [dialog, setDialog] = useState<DocumentDialog>(null);
	const saveMetadata = (values: { name?: string; tags?: string[] }) =>
		saveResumeMetadata(id, (expectedUpdatedAt, options) =>
			orpc.resume.update.call({ id, ...values, expectedUpdatedAt }, options),
		);

	return (
		<>
			{dialog === "rename" && !isLocked ? (
				<InlineNameInput
					key={id}
					name={name}
					disabled={isLocked}
					onSave={(next) => saveMetadata({ name: next })}
					onDone={() => setDialog(null)}
				/>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger render={<DocumentMenuTrigger name={name} isLocked={isLocked} />} />
					<DocumentMenuItems onOpenDialog={setDialog} />
				</DropdownMenu>
			)}
			<SaveStatus />
			{dialog === "tags" && (
				<BuilderTagsDialog
					key={id}
					tags={resume.tags}
					locked={isLocked}
					onSave={(tags) => saveMetadata({ tags })}
					onClose={() => setDialog(null)}
				/>
			)}

			<Dialog open={dialog === "notes"} onOpenChange={(open) => !open && setDialog(null)}>
				<DialogContent closeLabel={t`Close`} className="sm:max-w-[560px]">
					<DialogHeader>
						<DialogTitle>
							<Trans>Notes</Trans>
						</DialogTitle>
					</DialogHeader>
					<NotesSectionBuilder />
				</DialogContent>
			</Dialog>

			<Dialog open={dialog === "details"} onOpenChange={(open) => !open && setDialog(null)}>
				<DialogContent closeLabel={t`Close`} className="sm:max-w-[440px]">
					<DocumentDetails />
				</DialogContent>
			</Dialog>
		</>
	);
}

type BuilderTagsDialogProps = {
	tags: string[];
	locked: boolean;
	onSave: (tags: string[]) => Promise<unknown>;
	onClose: () => void;
};

function BuilderTagsDialog({ tags: current, locked, onSave, onClose }: BuilderTagsDialogProps) {
	const [tags, setTags] = useState(current);
	const save = useMutation({ mutationFn: onSave });
	const invalid = tags.length > 20 || tags.some((tag) => !tag.trim() || tag.length > 40);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent closeLabel={t`Close`}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Tags</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Tags group documents in the library; pick one above the grid to filter by it.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (locked || save.isPending || invalid) return;
						save.mutate(tags, {
							onSuccess: onClose,
							onError: (error) => toast.add({ type: "error", description: getResumeErrorMessage(error) }),
						});
					}}
				>
					<fieldset disabled={locked || save.isPending} className="grid gap-3">
						<ChipInput value={tags} onChange={setTags} placeholder={t`Add a tag…`} />
						<p className="text-xs text-ink-3">
							<Trans>Up to 20 tags per document, 40 characters per tag.</Trans>
						</p>
						<DialogFooter>
							<Button type="submit" disabled={invalid}>
								<Trans>Save tags</Trans>
							</Button>
						</DialogFooter>
					</fieldset>
				</form>
			</DialogContent>
		</Dialog>
	);
}

type DocumentMenuItemsProps = {
	onOpenDialog: (dialog: DocumentDialog) => void;
};

function DocumentMenuItems({ onOpenDialog }: DocumentMenuItemsProps) {
	const navigate = useNavigate();
	const { openDialog } = useDialogStore();
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const { onPrint } = useResumeExport(resume);
	const { id, name, slug, tags, isLocked } = resume;
	const setSheetTab = useEditorStore((state) => state.setSheetTab);
	// Downloads need a connection, as in the bar.
	const offline = useResumeStore((state) => state.saveStatus === "offline");

	const { mutate: trashResume } = useMutation(orpc.documents.trash.mutationOptions());
	const { mutateAsync: restoreResume } = useMutation(orpc.documents.restore.mutationOptions());
	const { mutate: setLockedResume } = useMutation({
		// Through the autosave owner, so the next autosave builds on this revision.
		mutationFn: (next: boolean) => setResumeLocked(id, next),
	});

	// Locking is reversible, so it doesn't ask for confirmation.
	const handleToggleLock = () => {
		setLockedResume(!isLocked, {
			onSuccess: () => {
				patchResume((draft) => {
					draft.isLocked = !isLocked;
				});
			},
			onError: (error) => {
				toast.add({ type: "error", description: getResumeErrorMessage(error) });
			},
		});
	};

	// Undoable, so it doesn't ask first: the resume waits in Trash for 30 days.
	const handleTrash = () => {
		trashResume(
			{ type: "resume", id },
			{
				onSuccess: () => {
					void navigate({ to: "/dashboard" });
					toast.add({
						description: t`“${ph({ name: isolate(name) })}” moved to Trash`,
						actionProps: {
							children: t`Undo`,
							// By now the editor has gone, and a mutation's own callbacks go with it: catch the promise.
							onClick: () =>
								void restoreResume({ type: "resume", id }).catch((error: unknown) =>
									toast.add({ type: "error", description: getResumeErrorMessage(error) }),
								),
						},
					});
				},
				onError: (error) => {
					toast.add({ type: "error", description: getResumeErrorMessage(error) });
				},
			},
		);
	};

	return (
		<DropdownMenuContent align="start" className="w-60">
			<DropdownMenuItem disabled={isLocked} onClick={() => onOpenDialog("rename")}>
				<Icon name="pencil-simple" />
				<Trans>Rename…</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				onClick={() =>
					void orpc.documents.suggestDuplicateName
						.call({ type: "resume", id })
						.then((suggested) => openDialog("resume.duplicate", { id, name: suggested, slug, tags }))
						.catch((error: unknown) => toast.add({ type: "error", description: getResumeErrorMessage(error) }))
				}
			>
				<Icon name="copy" />
				<Trans>Duplicate</Trans>
			</DropdownMenuItem>
			{/* The library card's job copy, from inside the editor: a copy of this resume linked to a job. */}
			<DropdownMenuItem
				onClick={async () => {
					// The copy is made from the saved resume: save what's on screen first, as History does.
					if (!(await savePendingChanges(id))) {
						toast.add({ type: "error", description: t`Save this resume's changes before copying it.` });
						return;
					}
					openDialog("document.new", { step: "copy", sourceResumeId: id });
				}}
			>
				<Icon name="briefcase" />
				<Trans>Copy for a job…</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={isLocked} onClick={() => onOpenDialog("tags")}>
				<Icon name="tag" />
				<Trans>Tags…</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={handleToggleLock}>
				<Icon name={isLocked ? "lock-open" : "lock"} />
				{isLocked ? <Trans>Unlock editing</Trans> : <Trans>Lock editing</Trans>}
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={() => onOpenDialog("notes")}>
				<Icon name="note" />
				<Trans>Notes</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={() => onOpenDialog("details")}>
				<Icon name="info" />
				<Trans>Details</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={() => void onPrint()}>
				<Icon name="printer" />
				<Trans>Print</Trans>
			</DropdownMenuItem>
			{/* Download & history, from every layout: phones have no ▾ beside Download PDF and no clock in the bar. */}
			<DropdownMenuItem disabled={offline} onClick={() => setSheetTab("download")}>
				<Icon name="download-simple" />
				<Trans>More download formats</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={() => setSheetTab("history")}>
				<Icon name="clock-counter-clockwise" />
				<Trans>History</Trans>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" disabled={isLocked} onClick={handleTrash}>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</DropdownMenuItem>
		</DropdownMenuContent>
	);
}
