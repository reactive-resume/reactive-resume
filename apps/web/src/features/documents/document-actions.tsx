import type { DocumentSummary } from "./filter";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@reactive-resume/ui/components/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useNewDocumentsStore } from "./new-documents";
import { ChipInput } from "@/components/input/chip-input";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Ref = { type: DocumentSummary["type"]; id: string };
const ref = (document: DocumentSummary): Ref => ({ type: document.type, id: document.id });

const failed = (error: unknown) =>
	toast.add({
		type: "error",
		description: getOrpcErrorMessage(error, { fallback: t`Something went wrong. Try again.` }),
	});

/** Everything the card menu does, shared by grid cards, list rows and Trash. */
export function useDocumentActions() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const openDialog = useDialogStore((state) => state.openDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.resume.list.key() }),
		]);

	const rename = useMutation(orpc.documents.rename.mutationOptions({ onSettled: refresh, onError: failed }));
	const setLocked = useMutation(orpc.documents.setLocked.mutationOptions({ onSettled: refresh, onError: failed }));
	const trash = useMutation(orpc.documents.trash.mutationOptions({ onSettled: refresh }));
	const restore = useMutation(orpc.documents.restore.mutationOptions({ onSettled: refresh }));
	const purge = useMutation(orpc.documents.purge.mutationOptions({ onSettled: refresh }));
	const duplicateResume = useMutation(orpc.resume.duplicate.mutationOptions({ onSettled: refresh }));
	const duplicateLetter = useMutation(orpc.coverLetters.duplicate.mutationOptions({ onSettled: refresh }));

	return {
		rename: (document: DocumentSummary, name: string) => {
			const trimmed = name.trim();
			if (!trimmed || trimmed === document.name) return;
			rename.mutate({ ...ref(document), name: trimmed });
		},

		duplicate: async (document: DocumentSummary) => {
			const copied =
				document.type === "resume"
					? duplicateResume.mutateAsync({ id: document.id, name: t`${document.name} (copy)`, tags: document.tags })
					: duplicateLetter.mutateAsync({ id: document.id }).then((letter) => letter.id);
			try {
				markNew(await copied);
				toast.add({ description: t`Duplicated` });
			} catch (error) {
				failed(error);
			}
		},

		copyForJob: (document: DocumentSummary) =>
			openDialog("document.new", { step: "copy", sourceResumeId: document.id }),

		setLocked: (document: DocumentSummary, isLocked: boolean) => setLocked.mutate({ ...ref(document), isLocked }),

		/** Undoable, so it doesn't ask first. */
		trash: async (document: DocumentSummary) => {
			try {
				await trash.mutateAsync(ref(document));
				toast.add({
					description: t`“${document.name}” moved to Trash`,
					actionProps: {
						children: t`Undo`,
						onClick: () => restore.mutate(ref(document), { onError: failed }),
					},
				});
			} catch (error) {
				failed(error);
			}
		},

		restore: async (document: DocumentSummary) => {
			try {
				await restore.mutateAsync(ref(document));
				toast.add({ description: t`Restored “${document.name}”` });
			} catch (error) {
				failed(error);
			}
		},

		/** The only permanent action here; it asks once. */
		purge: async (document: DocumentSummary) => {
			const confirmed = await confirm(t`Delete “${document.name}” now?`, {
				description: t`It will be deleted for good and can't be restored.`,
				confirmText: t`Delete now`,
				cancelText: t`Keep in Trash`,
			});
			if (!confirmed) return;
			try {
				await purge.mutateAsync(ref(document));
				toast.add({ description: t`Deleted “${document.name}”` });
			} catch (error) {
				failed(error);
			}
		},
	};
}

type MenuEntry = { icon: IconName; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

type DocumentMenuProps = {
	document: DocumentSummary;
	onOpen: () => void;
	onRename: () => void;
	onTags: () => void;
	onLink: () => void;
	/** The same items as a context menu (right-click and long-press) instead of the ⋯ menu. */
	variant?: "dropdown" | "context";
};

/** Open, Rename, Duplicate, Copy for a job (or Link to application), Tags, Lock, then Move to Trash. */
export function DocumentMenuContent({
	document,
	onOpen,
	onRename,
	onTags,
	onLink,
	variant = "dropdown",
}: DocumentMenuProps) {
	const actions = useDocumentActions();

	const trashEntries: MenuEntry[] = [
		{ icon: "restore_from_trash", label: t`Restore`, onSelect: () => void actions.restore(document) },
		{ icon: "delete_forever", label: t`Delete now…`, onSelect: () => void actions.purge(document), danger: true },
	];
	const liveEntries: MenuEntry[] = [
		{ icon: "open_in_new", label: t`Open`, onSelect: onOpen },
		{ icon: "edit", label: t`Rename`, onSelect: onRename, disabled: document.isLocked },
		{ icon: "content_copy", label: t`Duplicate`, onSelect: () => void actions.duplicate(document) },
		document.type === "resume"
			? { icon: "work", label: t`Copy for a job…`, onSelect: () => actions.copyForJob(document) }
			: { icon: "work", label: t`Link to application…`, onSelect: onLink, disabled: document.isLocked },
		{ icon: "sell", label: t`Tags…`, onSelect: onTags, disabled: document.isLocked },
		document.isLocked
			? { icon: "lock_open", label: t`Unlock`, onSelect: () => actions.setLocked(document, false) }
			: { icon: "lock", label: t`Lock editing`, onSelect: () => actions.setLocked(document, true) },
		{
			icon: "delete",
			label: t`Move to Trash`,
			onSelect: () => void actions.trash(document),
			danger: true,
			disabled: document.isLocked,
		},
	];
	const entries = document.trashedAt ? trashEntries : liveEntries;

	const Content = variant === "context" ? ContextMenuContent : DropdownMenuContent;
	const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
	const Separator = variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;

	return (
		<Content align="end" className="w-60">
			{entries.map((entry) => (
				<div key={entry.label} className="contents">
					{entry.danger && <Separator />}
					<Item
						variant={entry.danger ? "destructive" : "default"}
						disabled={entry.disabled}
						onClick={entry.onSelect}
						title={entry.disabled ? t`Unlock it first` : undefined}
					>
						<Icon name={entry.icon} />
						{entry.label}
					</Item>
				</div>
			))}
		</Content>
	);
}

type TagsDialogProps = { document: DocumentSummary | null; onClose: () => void };

/** Tags… from the card menu: tags filter the library once any exist. */
export function TagsDialog({ document: requested, onClose }: TagsDialogProps) {
	const queryClient = useQueryClient();
	// Closing keeps the document's tags on screen until the dialog has faded out.
	const [document, onDocumentOpenChangeComplete] = useClosingValue(requested);
	const [tags, setTags] = useState<string[] | null>(null);
	const setDocumentTags = useMutation(orpc.documents.setTags.mutationOptions());

	const save = async () => {
		if (!document) return;
		const nextTags = tags ?? document.tags;
		try {
			await setDocumentTags.mutateAsync({ type: document.type, id: document.id, tags: nextTags });
			await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			onClose();
		} catch (error) {
			failed(error);
		}
	};

	return (
		<Dialog
			open={requested !== null}
			onOpenChange={(open) => !open && onClose()}
			onOpenChangeComplete={(open) => {
				onDocumentOpenChangeComplete(open);
				// Unsaved edits are dropped once the dialog has closed, so the chips don't change while it fades.
				if (!open) setTags(null);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Tags</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Tags group documents in the library; pick one above the grid to filter by it.</Trans>
					</DialogDescription>
				</DialogHeader>
				<ChipInput value={tags ?? document?.tags ?? []} onChange={setTags} />
				<DialogFooter>
					<Button onClick={() => void save()} disabled={setDocumentTags.isPending}>
						<Trans>Save</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type LinkApplicationDialogProps = { document: DocumentSummary | null; onClose: () => void };

/** Link to application… for letters: the job the letter is for. */
export function LinkApplicationDialog({ document: requested, onClose }: LinkApplicationDialogProps) {
	const queryClient = useQueryClient();
	// Closing keeps the list, its highlight and Unlink on screen until the dialog has faded out.
	const [document, onOpenChangeComplete] = useClosingValue(requested);
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: requested !== null });
	const link = useMutation(orpc.documents.linkApplication.mutationOptions());

	const choose = async (applicationId: string | null) => {
		if (!document) return;
		try {
			await link.mutateAsync({ type: document.type, id: document.id, applicationId });
			await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			onClose();
		} catch (error) {
			failed(error);
		}
	};

	const jobs = (applications ?? []).filter((application) => application.status !== "closed");

	return (
		<Dialog
			open={requested !== null}
			onOpenChange={(open) => !open && onClose()}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Link to application</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The application this letter is for.</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="grid max-h-72 gap-1 overflow-y-auto">
					{jobs.map((application) => (
						<Button
							key={application.id}
							variant={document?.application?.id === application.id ? "secondary" : "ghost"}
							className="h-auto justify-start py-2 text-start"
							disabled={link.isPending}
							onClick={() => void choose(application.id)}
						>
							<Icon name="work" className="text-ink-2" />
							<span className="grid min-w-0">
								<span className="truncate font-medium">{application.role}</span>
								<span className="truncate text-xs text-ink-3">{application.company}</span>
							</span>
						</Button>
					))}
					{jobs.length === 0 && (
						<p className="text-sm text-ink-2">
							<Trans>No applications yet. Add one in Applications first.</Trans>
						</p>
					)}
				</div>
				{document?.application && (
					<DialogFooter>
						<Button variant="ghost" disabled={link.isPending} onClick={() => void choose(null)}>
							<Trans>Unlink</Trans>
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
