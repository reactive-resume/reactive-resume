import type { DocumentSummary } from "./filter";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { publicResumeUrl } from "@reactive-resume/resume/sharing";
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
import { isolate } from "@reactive-resume/utils/string";
import { useNewDocumentsStore } from "./new-documents";
import { ChipInput } from "@/components/input/chip-input";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useDocumentDownload } from "@/features/applications/use-document-download";
import { useShareOrigin } from "@/features/resume/share/use-share-origin";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { confirmUndone } from "@/libs/undone";

type Ref = { type: DocumentSummary["type"]; id: string };
const ref = (document: DocumentSummary): Ref => ({ type: document.type, id: document.id });

/** Everything the card menu does, shared by grid cards, list rows and Trash. */
function useRefreshDocuments() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.resume.list.key() }),
		]);
}

export function useDocumentActions() {
	const confirm = useConfirm();
	const openDialog = useDialogStore((state) => state.openDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const refresh = useRefreshDocuments();

	const rename = useMutation(
		orpc.documents.rename.mutationOptions({
			onSettled: refresh,
			onError: (error) => toastError(error, t`Couldn't rename the document. Try again.`),
		}),
	);
	const setLocked = useMutation(orpc.documents.setLocked.mutationOptions({ onSettled: refresh }));
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
				toast.add({ description: t`Duplicated “${document.name}”` });
			} catch (error) {
				toastError(error, t`Couldn't duplicate the document. Try again.`);
			}
		},

		copyForJob: (document: DocumentSummary) =>
			openDialog("document.new", { step: "copy", sourceResumeId: document.id }),

		setLocked: (document: DocumentSummary, isLocked: boolean) =>
			setLocked.mutate(
				{ ...ref(document), isLocked },
				{
					onError: (error) =>
						toastError(
							error,
							isLocked ? t`Couldn't lock the document. Try again.` : t`Couldn't unlock the document. Try again.`,
						),
				},
			),

		/** Undoable, so it doesn't ask first. */
		trash: async (document: DocumentSummary) => {
			try {
				await trash.mutateAsync(ref(document));
				toast.add({
					description: t`“${isolate(document.name)}” moved to Trash`,
					actionProps: {
						children: t`Undo`,
						// The trashed card has gone, and a mutation's own callbacks with it: catch the promise.
						onClick: () =>
							void restore
								.mutateAsync(ref(document))
								.then(confirmUndone)
								.catch((error: unknown) => toastError(error, t`Couldn't restore the document. Try again.`)),
					},
				});
			} catch (error) {
				toastError(error, t`Couldn't move the document to Trash. Try again.`);
			}
		},

		restore: async (document: DocumentSummary) => {
			try {
				await restore.mutateAsync(ref(document));
				toast.add({ description: t`Restored “${document.name}”` });
			} catch (error) {
				toastError(error, t`Couldn't restore the document. Try again.`);
			}
		},

		/** The only permanent action here; it asks once. */
		purge: async (document: DocumentSummary) => {
			const confirmed = await confirm(t`Delete “${document.name}” now?`, {
				description: t`It will be deleted for good and can't be restored.`,
				confirmText: t`Hold to delete`,
				cancelText: t`Keep in Trash`,
				hold: true,
			});
			if (!confirmed) return;
			try {
				await purge.mutateAsync(ref(document));
				toast.add({ description: t`Deleted “${document.name}”` });
			} catch (error) {
				toastError(error, t`Couldn't delete the document. Try again.`);
			}
		},
	};
}

/**
 * The selection bar's actions: each runs on every selected document it applies to, refreshes the library once and
 * says how many changed. Locked documents keep their visibility, tags and place; letters have no public link.
 */
export function useBatchActions() {
	const refresh = useRefreshDocuments();
	const setLocked = useMutation(orpc.documents.setLocked.mutationOptions());
	const trash = useMutation(orpc.documents.trash.mutationOptions());
	const restore = useMutation(orpc.documents.restore.mutationOptions());
	const restoreMany = useMutation(orpc.documents.restoreMany.mutationOptions());
	const purgeMany = useMutation(orpc.documents.purgeMany.mutationOptions());
	const emptyTrash = useMutation(orpc.documents.emptyTrash.mutationOptions());
	const updateResume = useMutation(orpc.resume.update.mutationOptions());

	// The server accepts a large selection, but splitting it keeps one request's body bounded on old clients that
	// still load the whole library.
	const batchSize = 500;
	const chunks = <T,>(items: readonly T[]) =>
		Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) =>
			items.slice(index * batchSize, (index + 1) * batchSize),
		);

	const run = async (
		documents: readonly DocumentSummary[],
		applies: (document: DocumentSummary) => boolean,
		task: (document: DocumentSummary) => Promise<unknown>,
	) => {
		const targets = documents.filter(applies);
		const results = await Promise.allSettled(targets.map(task));
		await refresh();
		return targets.filter((_, index) => results[index]?.status === "fulfilled");
	};

	const report = (done: number, total: number) =>
		toast.add({
			type: done === 0 ? "error" : undefined,
			description:
				done === total
					? plural(done, { one: "# document updated", other: "# documents updated" })
					: t`Updated ${done} of ${total}. Locked documents, and letters for public links, were skipped.`,
		});

	return {
		setPublic: async (documents: readonly DocumentSummary[], isPublic: boolean) => {
			const done = await run(
				documents,
				(document) => document.type === "resume" && !document.isLocked && document.isPublic !== isPublic,
				(document) => updateResume.mutateAsync({ id: document.id, isPublic }),
			);
			// Already in that state counts as done.
			report(done.length + documents.filter((document) => document.isPublic === isPublic).length, documents.length);
		},

		setLocked: async (documents: readonly DocumentSummary[], isLocked: boolean) => {
			const done = await run(
				documents,
				(document) => document.isLocked !== isLocked,
				(document) => setLocked.mutateAsync({ type: document.type, id: document.id, isLocked }),
			);
			report(done.length + documents.filter((document) => document.isLocked === isLocked).length, documents.length);
		},

		/** Undoable, so it doesn't ask first. */
		trash: async (documents: readonly DocumentSummary[]) => {
			const done = await run(
				documents,
				(document) => !document.isLocked,
				(document) => trash.mutateAsync({ type: document.type, id: document.id }),
			);
			if (done.length === 0) return report(0, documents.length);
			toast.add({
				description:
					done.length === documents.length
						? plural(done.length, { one: "# document moved to Trash", other: "# documents moved to Trash" })
						: t`Moved ${done.length} of ${documents.length} to Trash. Locked documents were skipped.`,
				actionProps: {
					children: t`Undo`,
					// Confirmed like a single Undo when everything came back; otherwise how many did, and that the rest wait in
					// Trash.
					onClick: () =>
						void run(
							done,
							() => true,
							(document) => restore.mutateAsync({ type: document.type, id: document.id }),
						).then((restored) => {
							if (restored.length === done.length) return confirmUndone();
							toast.add({
								type: restored.length === 0 ? "error" : undefined,
								description: t`Restored ${restored.length} of ${done.length}. The rest are still in Trash.`,
							});
						}),
				},
			});
		},

		/** Restore selected loaded documents in batches; the server skips any restored or deleted meanwhile. */
		restore: async (documents: readonly DocumentSummary[]) => {
			let restored = 0;
			let failure: unknown;
			for (const group of chunks(documents)) {
				try {
					const result = await restoreMany.mutateAsync({ documents: group.map(ref) });
					restored += result.restored;
				} catch (error) {
					failure = error;
				}
			}
			await refresh();
			if (restored === documents.length)
				toast.add({
					description: plural(restored, { one: "# document restored", other: "# documents restored" }),
				});
			else if (restored === 0 && failure) toastError(failure, t`Couldn't restore the selected documents. Try again.`);
			else if (restored > 0)
				toast.add({
					description: t`Restored ${restored} of ${documents.length}. Refresh and retry any that remain in Trash.`,
				});
			else toast.add({ description: t`No selected documents were restored. Refresh to see what remains.` });
			return restored === documents.length && !failure;
		},

		/** The selected loaded documents, not every document in Trash. The server skips anything no longer in Trash. */
		purge: async (documents: readonly DocumentSummary[]) => {
			let deleted = 0;
			let failure: unknown;
			for (const group of chunks(documents)) {
				try {
					const result = await purgeMany.mutateAsync({ documents: group.map(ref) });
					deleted += result.deleted;
				} catch (error) {
					failure = error;
				}
			}
			await refresh();
			if (deleted === documents.length)
				toast.add({
					description: plural(deleted, { one: "# document deleted forever", other: "# documents deleted forever" }),
				});
			else if (deleted === 0 && failure) toastError(failure, t`Couldn't delete the selected documents. Try again.`);
			else if (deleted > 0)
				toast.add({
					description: t`Deleted ${deleted} of ${documents.length} forever. Refresh to see what remains.`,
				});
			else toast.add({ description: t`No selected documents were deleted. Refresh to see what remains.` });
			return deleted === documents.length && !failure;
		},

		/** Every document in this account's Trash, server-side; selected or loaded IDs don't limit it. */
		emptyTrash: async () => {
			try {
				const result = await emptyTrash.mutateAsync({});
				await refresh();
				toast.add({
					description:
						result.deleted === 0
							? t`Trash was already empty`
							: plural(result.deleted, { one: "# document deleted forever", other: "# documents deleted forever" }),
				});
				return true;
			} catch (error) {
				toastError(error, t`Couldn't empty Trash. Try again.`);
				throw error;
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
	/** Starts a selection with this document; absent in the list, which always shows its checkboxes, and in Trash. */
	onSelect?: (() => void) | undefined;
	/** The same items as a context menu (right-click and long-press) instead of the ⋯ menu. */
	variant?: "dropdown" | "context";
};

/**
 * Open, Share… and Copy public link (resumes), Download PDF, Select, Rename, Duplicate, Copy for a job (or Link to
 * application), Tags, Lock, then Move to Trash.
 */
export function DocumentMenuContent({
	document,
	onOpen,
	onRename,
	onTags,
	onLink,
	onSelect,
	variant = "dropdown",
}: DocumentMenuProps) {
	const actions = useDocumentActions();
	const navigate = useNavigate();
	const { download, downloading } = useDocumentDownload();
	const openDialog = useDialogStore((state) => state.openDialog);
	const { data: session } = authClient.useSession();
	const [, copy] = useCopyToClipboard();
	const origin = useShareOrigin();
	const username = session?.user.username;
	// A resume's public address, or null while its link is off.
	const url =
		document.type === "resume" && document.isPublic && document.slug && username
			? publicResumeUrl(origin, { username, slug: document.slug })
			: null;

	const trashEntries: MenuEntry[] = [
		{ icon: "arrow-counter-clockwise", label: t`Restore`, onSelect: () => void actions.restore(document) },
		{ icon: "trash", label: t`Delete now…`, onSelect: () => void actions.purge(document), danger: true },
	];
	const liveEntries: MenuEntry[] = [
		{ icon: "arrow-square-out", label: t`Open`, onSelect: onOpen },
		...(document.type === "resume"
			? [
					{
						icon: "share-network",
						label: t`Share…`,
						// The editor's Share view: public link, password, web page and download settings.
						onSelect: () =>
							void navigate({ to: "/builder/$resumeId", params: { resumeId: document.id }, search: { mode: "share" } }),
					} satisfies MenuEntry,
				]
			: []),
		{
			icon: "file-pdf",
			label: t`Download PDF`,
			onSelect: () => void download(document.type, document.id),
			disabled: downloading === document.id,
		},
		...(url
			? [
					{
						icon: "link-simple-horizontal",
						label: t`Copy public link`,
						onSelect: () => void copy(url).then((copied) => copied && toast.add({ description: t`Link copied` })),
					} satisfies MenuEntry,
				]
			: []),
		...(onSelect ? [{ icon: "check-square", label: t`Select`, onSelect } satisfies MenuEntry] : []),
		{ icon: "pencil-simple", label: t`Rename`, onSelect: onRename, disabled: document.isLocked },
		{ icon: "copy", label: t`Duplicate`, onSelect: () => void actions.duplicate(document) },
		document.type === "resume"
			? { icon: "briefcase", label: t`Copy for a job…`, onSelect: () => actions.copyForJob(document) }
			: { icon: "briefcase", label: t`Link to application…`, onSelect: onLink, disabled: document.isLocked },
		...(document.type === "resume"
			? [
					{
						icon: "link-simple-horizontal",
						label: t`Link to application…`,
						onSelect: onLink,
						disabled: document.isLocked,
					} satisfies MenuEntry,
				]
			: []),
		...(document.type === "resume"
			? [
					{
						icon: "envelope-simple",
						label: t`Write a letter…`,
						onSelect: () => openDialog("document.new", { context: "letters", sourceResumeId: document.id }),
					} satisfies MenuEntry,
				]
			: []),
		{ icon: "tag", label: t`Tags…`, onSelect: onTags, disabled: document.isLocked },
		document.isLocked
			? { icon: "lock-open", label: t`Unlock`, onSelect: () => actions.setLocked(document, false) }
			: { icon: "lock", label: t`Lock editing`, onSelect: () => actions.setLocked(document, true) },
		{
			icon: "trash",
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

type TagsDialogProps = { documents: DocumentSummary[] | null; onClose: () => void };

/** The tags every one of these documents has. */
const sharedTags = (documents: readonly DocumentSummary[]) =>
	documents[0]?.tags.filter((tag) => documents.every((document) => document.tags.includes(tag))) ?? [];

/**
 * Tags… for one document from its menu, or for a selection: a tag added goes on each document and a tag removed
 * comes off each, leaving their other tags alone. Locked documents keep theirs.
 */
export function TagsDialog({ documents: requested, onClose }: TagsDialogProps) {
	const refresh = useRefreshDocuments();
	// Closing keeps the documents' tags on screen until the dialog has faded out.
	const [documents, onDocumentsOpenChangeComplete] = useClosingValue(requested);
	const [tags, setTags] = useState<string[] | null>(null);
	const setDocumentTags = useMutation(orpc.documents.setTags.mutationOptions());
	const shared = documents ? sharedTags(documents) : [];

	const save = async () => {
		if (!documents) return;
		const next = tags ?? shared;
		const removed = shared.filter((tag) => !next.includes(tag));
		const added = next.filter((tag) => !shared.includes(tag));
		const results = await Promise.allSettled(
			documents
				.filter((document) => !document.isLocked)
				.map((document) =>
					setDocumentTags.mutateAsync({
						type: document.type,
						id: document.id,
						tags: [
							...document.tags.filter((tag) => !removed.includes(tag)),
							...added.filter((tag) => !document.tags.includes(tag)),
						],
					}),
				),
		);
		await refresh();
		const failure = results.find((result) => result.status === "rejected");
		if (failure) toastError(failure.reason, t`Couldn't save the tags. Try again.`);
		else onClose();
	};

	return (
		<Dialog
			open={requested !== null}
			onOpenChange={(open) => !open && onClose()}
			onOpenChangeComplete={(open) => {
				onDocumentsOpenChangeComplete(open);
				// Unsaved edits are dropped once the dialog has closed, so the chips don't change while it fades.
				if (!open) setTags(null);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{documents && documents.length > 1 ? (
							<Plural value={documents.length} one="Tags for # document" other="Tags for # documents" />
						) : (
							<Trans>Tags</Trans>
						)}
					</DialogTitle>
					<DialogDescription>
						{documents && documents.length > 1 ? (
							<Trans>
								Shows the tags they all share. Tags you add go on every document; tags you remove come off every one.
								Locked documents are left as they are.
							</Trans>
						) : (
							<Trans>Tags group documents in the library; pick one above the grid to filter by it.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				<ChipInput value={tags ?? shared} onChange={setTags} />
				<DialogFooter>
					<Button onClick={() => void save()} disabled={setDocumentTags.isPending}>
						<Trans>Save tags</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// The Save a job form reads postings and is large; the library loads it only when someone adds a job here.
const AddApplicationDialog = lazy(() =>
	import("@/features/applications/components/add-application-dialog").then((module) => ({
		default: module.AddApplicationDialog,
	})),
);

type LinkApplicationDialogProps = { document: DocumentSummary | null; onClose: () => void };

/** Link to application… for letters: the job the letter is for. */
export function LinkApplicationDialog({ document: requested, onClose }: LinkApplicationDialogProps) {
	const queryClient = useQueryClient();
	// Closing keeps the list, its highlight and Unlink on screen until the dialog has faded out.
	const [document, onOpenChangeComplete] = useClosingValue(requested);
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: requested !== null });
	const link = useMutation(orpc.documents.linkApplication.mutationOptions());
	const [addingJob, setAddingJob] = useState(false);

	const choose = async (applicationId: string | null) => {
		if (!document) return;
		try {
			await link.mutateAsync({ type: document.type, id: document.id, applicationId });
			await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			await queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
			onClose();
		} catch (error) {
			toastError(
				error,
				applicationId ? t`Couldn't link the application. Try again.` : t`Couldn't unlink the application. Try again.`,
			);
		}
	};

	const submitted =
		document?.type === "letter" &&
		applications?.some((item) => item.coverLetterId === document.id && item.sentCoverLetterVersionId);
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
						<Trans>The application this document is for.</Trans>
					</DialogDescription>
				</DialogHeader>
				{submitted && (
					<p className="text-sm text-ink-2">
						<Trans>This letter is recorded as sent. Its application link stays with that submission.</Trans>
					</p>
				)}
				<div className="grid max-h-72 gap-1 overflow-y-auto">
					{jobs.map((application) => (
						<Button
							key={application.id}
							variant={document?.application?.id === application.id ? "secondary" : "ghost"}
							className="h-auto justify-start py-2 text-start"
							disabled={
								link.isPending ||
								Boolean(submitted) ||
								Boolean(
									document?.type === "letter" &&
									application.sentCoverLetterVersionId &&
									application.coverLetterId !== document.id,
								)
							}
							onClick={() => void choose(application.id)}
						>
							<Icon name="briefcase" className="text-ink-2" />
							<span className="grid min-w-0">
								<span className="truncate font-medium">{application.role}</span>
								<span className="truncate text-xs text-ink-3">{application.company}</span>
								{document?.type === "letter" &&
									application.sentCoverLetterVersionId &&
									application.coverLetterId !== document.id && (
										<span className="text-xs text-ink-3">
											<Trans>Letter already sent</Trans>
										</span>
									)}
							</span>
						</Button>
					))}
					{jobs.length === 0 && (
						<p className="text-sm text-ink-2">
							<Trans>No applications yet.</Trans>
						</p>
					)}
				</div>
				<DialogFooter>
					{document?.application && (
						<Button variant="ghost" disabled={link.isPending || Boolean(submitted)} onClick={() => void choose(null)}>
							<Trans>Unlink</Trans>
						</Button>
					)}
					<Button
						variant="secondary"
						disabled={link.isPending || Boolean(submitted)}
						onClick={() => setAddingJob(true)}
					>
						<Icon name="plus" />
						<Trans>Add a job…</Trans>
					</Button>
				</DialogFooter>
				{addingJob && (
					<Suspense fallback={null}>
						<AddApplicationDialog
							forPicker
							open
							onOpenChange={setAddingJob}
							onAdded={(applicationId) => void choose(applicationId)}
						/>
					</Suspense>
				)}
			</DialogContent>
		</Dialog>
	);
}
