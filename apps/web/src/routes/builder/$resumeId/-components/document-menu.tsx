import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
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
import { useDialogStore } from "@/dialogs/store";
import {
	useCurrentBuilderResumeSelector,
	useCurrentResume,
	usePatchResume,
	useResumeStore,
} from "@/features/resume/builder/draft";
import { DocumentMenuTrigger } from "@/features/resume/editor/chrome";
import { SaveStatus } from "@/features/resume/editor/save-status";
import { useEditorStore } from "@/features/resume/editor/store";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type DocumentDialog = "notes" | "details" | null;

/**
 * The document name in the editor bar opens the document menu: rename, duplicate, lock, notes,
 * details, print and delete.
 */
export function DocumentMenu() {
	const name = useCurrentBuilderResumeSelector((resume) => resume.name);
	const isLocked = useCurrentBuilderResumeSelector((resume) => resume.isLocked);
	const [dialog, setDialog] = useState<DocumentDialog>(null);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger render={<DocumentMenuTrigger name={name} isLocked={isLocked} />} />
				<DocumentMenuItems onOpenDialog={setDialog} />
			</DropdownMenu>
			<SaveStatus />

			<Dialog open={dialog === "notes"} onOpenChange={(open) => !open && setDialog(null)}>
				<DialogContent className="sm:max-w-[560px]">
					<DialogHeader>
						<DialogTitle>
							<Trans>Notes</Trans>
						</DialogTitle>
					</DialogHeader>
					<NotesSectionBuilder />
				</DialogContent>
			</Dialog>

			<Dialog open={dialog === "details"} onOpenChange={(open) => !open && setDialog(null)}>
				<DialogContent className="sm:max-w-[440px]">
					<DocumentDetails />
				</DialogContent>
			</Dialog>
		</>
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
	const { mutate: setLockedResume } = useMutation(orpc.resume.setLocked.mutationOptions());

	// Locking is reversible, so it doesn't ask for confirmation.
	const handleToggleLock = () => {
		setLockedResume(
			{ id, isLocked: !isLocked },
			{
				onSuccess: () => {
					patchResume((draft) => {
						draft.isLocked = !isLocked;
					});
				},
				onError: (error) => {
					toast.add({ type: "error", description: getResumeErrorMessage(error) });
				},
			},
		);
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
			<DropdownMenuItem disabled={isLocked} onClick={() => openDialog("resume.update", { id, name, slug, tags })}>
				<Icon name="pencil-simple" />
				<Trans>Rename…</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={() => openDialog("resume.duplicate", { id, name, slug, tags })}>
				<Icon name="copy" />
				<Trans>Duplicate</Trans>
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
