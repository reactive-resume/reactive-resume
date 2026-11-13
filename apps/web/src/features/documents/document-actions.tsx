import type { DocumentsSearch } from "./documents-page";
import type { DocumentSummary } from "./filter";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useId, useRef, useState } from "react";
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
import { menuLabelClassName } from "@reactive-resume/ui/components/menu-styles";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { toast } from "@reactive-resume/ui/components/toast";
import { isolate } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useDocumentSentDate } from "./document-status";
import { useDocumentEffect } from "./library-session";
import { useNewDocumentsStore } from "./new-documents";
import { useExistingTags } from "./tag-suggestions";
import { List, ListRow } from "@/components/calm/list-row";
import { ChipInput } from "@/components/input/chip-input";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useDocumentDownload } from "@/features/applications/use-document-download";
import { useShareOrigin } from "@/features/resume/share/use-share-origin";
import { useClosingValue } from "@/hooks/use-closing-value";
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
	const onEffect = useDocumentEffect();
	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const refresh = useRefreshDocuments();

	const rename = useMutation(
		orpc.documents.rename.mutationOptions({
			onSettled: refresh,
		}),
	);
	const setLocked = useMutation(orpc.documents.setLocked.mutationOptions({ onSettled: refresh }));
	const trash = useMutation(
		orpc.documents.trash.mutationOptions({
			onSuccess: (_result, document) => onEffect("trash", [document]),
			onSettled: refresh,
		}),
	);
	// Undo counts what it brought back: restoring one that's already back (another tab) or gone changes nothing.
	const restoreMany = useMutation(
		orpc.documents.restoreMany.mutationOptions({
			onSuccess: (result, input) =>
				result.restored === input.documents.length ? onEffect("restore", input.documents) : undefined,
			onSettled: refresh,
		}),
	);
	const duplicateResume = useMutation(orpc.resume.duplicate.mutationOptions({ onSettled: refresh }));
	const duplicateLetter = useMutation(orpc.coverLetters.duplicate.mutationOptions({ onSettled: refresh }));

	// Reversible, so it happens at once and its toast offers the way back (ruling P3). The menu that called this
	// unmounts on select, and a mutation's per-call callbacks with it: catch the promise.
	const lock = (document: DocumentSummary, isLocked: boolean, undo = true) =>
		void setLocked
			.mutateAsync({ ...ref(document), isLocked })
			.then(() =>
				toast.add({
					description: isLocked ? t`“${isolate(document.name)}” locked` : t`“${isolate(document.name)}” unlocked`,
					...(undo ? { actionProps: { children: t`Undo`, onClick: () => lock(document, !isLocked, false) } } : {}),
				}),
			)
			.catch((error: unknown) =>
				toastError(
					error,
					isLocked ? t`Couldn't lock the document. Try again.` : t`Couldn't unlock the document. Try again.`,
				),
			);

	return {
		rename: (document: DocumentSummary, name: string) => {
			const trimmed = name.trim();
			if (!trimmed || trimmed === document.name) return;
			return rename.mutateAsync({ ...ref(document), name: trimmed });
		},

		duplicate: async (document: DocumentSummary) => {
			try {
				// Reversible by renaming or trashing, so it happens at once; the toast offers Rename (D5).
				const name = (await orpc.documents.suggestDuplicateName.call(ref(document))).trim().slice(0, 100);
				const id =
					document.type === "resume"
						? await duplicateResume.mutateAsync({ id: document.id, name, tags: document.tags })
						: (await duplicateLetter.mutateAsync({ id: document.id, name })).id;
				markNew(id);
				toast.add({
					description: t`Duplicated “${document.name}”`,
					actionProps: {
						children: t`Rename`,
						onClick: () => {
							useNewDocumentsStore.getState().requestRename(id);
							void navigate({
								to: "/dashboard/documents",
								search: (previous: DocumentsSearch) => ({
									...previous,
									q: name,
									type: document.type,
									tags: [],
									public: false,
									sort: "created",
								}),
							});
						},
					},
				});
			} catch (error) {
				toastError(error, t`Couldn't duplicate the document. Try again.`);
			}
		},

		copyForJob: (document: DocumentSummary) =>
			openDialog("document.new", { step: "copy", sourceResumeId: document.id }),

		setLocked: lock,

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
							void restoreMany
								.mutateAsync({ documents: [ref(document)] })
								.then(({ restored }) =>
									restored > 0
										? confirmUndone()
										: toast.add({ description: t`Nothing to undo: it was already restored or deleted.` }),
								)
								.catch((error: unknown) => toastError(error, t`Couldn't restore the document. Try again.`)),
					},
				});
			} catch (error) {
				toastError(error, t`Couldn't move the document to Trash. Try again.`);
			}
		},
	};
}

/**
 * The selection bar's actions: each runs on every selected document it applies to, refreshes the library once and
 * says how many changed. Locked documents keep their visibility, tags and place; letters have no public link.
 */
export function useBatchActions() {
	const onEffect = useDocumentEffect();
	const refresh = useRefreshDocuments();
	const setLocked = useMutation(orpc.documents.setLocked.mutationOptions());
	const trash = useMutation(
		orpc.documents.trash.mutationOptions({ onSuccess: (_result, document) => onEffect("trash", [document]) }),
	);
	const restoreMany = useMutation(
		orpc.documents.restoreMany.mutationOptions({
			onSuccess: (result, input) =>
				result.restored === input.documents.length ? onEffect("restore", input.documents) : undefined,
		}),
	);
	const purgeMany = useMutation(
		orpc.documents.purgeMany.mutationOptions({
			onSuccess: (result, input) =>
				result.deleted === input.documents.length ? onEffect("purge", input.documents) : undefined,
		}),
	);
	const emptyTrash = useMutation(
		orpc.documents.emptyTrash.mutationOptions({
			onSuccess: (result) => (result.deleted > 0 ? onEffect("purge") : undefined),
		}),
	);
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

	const number = (value: number) => i18n.number(value);

	return {
		setPublic: async (documents: readonly DocumentSummary[], isPublic: boolean) => {
			const done = await run(
				documents,
				(document) => document.type === "resume" && !document.isLocked && document.isPublic !== isPublic,
				(document) => updateResume.mutateAsync({ id: document.id, isPublic }),
			);
			// Already in that state counts as done.
			const made = done.length + documents.filter((document) => document.isPublic === isPublic).length;
			const total = documents.length;
			toast.add({
				type: made === 0 ? "error" : undefined,
				description:
					made === total
						? isPublic
							? plural(made, { one: "# made public", other: "# made public" })
							: plural(made, { one: "# made private", other: "# made private" })
						: isPublic
							? t`Made ${number(made)} of ${number(total)} public. Letters have no public link, and locked documents are left as they are.`
							: t`Made ${number(made)} of ${number(total)} private. Letters have no public link, and locked documents are left as they are.`,
			});
		},

		/** Reversible, so it happens at once; Undo puts back the documents this changed (ruling P3). */
		setLocked: async (documents: readonly DocumentSummary[], isLocked: boolean) => {
			const done = await run(
				documents,
				(document) => document.isLocked !== isLocked,
				(document) => setLocked.mutateAsync({ type: document.type, id: document.id, isLocked }),
			);
			const failed = documents.filter((document) => document.isLocked !== isLocked).length - done.length;
			if (failed > 0 && done.length === 0)
				return toast.add({
					type: "error",
					description: isLocked
						? t`Couldn't lock the documents. Try again.`
						: t`Couldn't unlock the documents. Try again.`,
				});
			const count = documents.length - failed;
			toast.add({
				description: isLocked
					? plural(count, { one: "# locked", other: "# locked" })
					: plural(count, { one: "# unlocked", other: "# unlocked" }),
				...(done.length > 0
					? {
							actionProps: {
								children: t`Undo`,
								onClick: () =>
									void run(
										done,
										() => true,
										(document) => setLocked.mutateAsync({ type: document.type, id: document.id, isLocked: !isLocked }),
									).then((undone) =>
										toast.add({
											description: isLocked
												? plural(undone.length, { one: "# unlocked", other: "# unlocked" })
												: plural(undone.length, { one: "# locked", other: "# locked" }),
										}),
									),
							},
						}
					: {}),
			});
		},

		/** Undoable, so it doesn't ask first. */
		trash: async (documents: readonly DocumentSummary[]) => {
			const done = await run(
				documents,
				(document) => !document.isLocked,
				(document) => trash.mutateAsync({ type: document.type, id: document.id }),
			);
			if (done.length === 0)
				return toast.add({
					type: "error",
					description: t`Nothing moved to Trash. Locked documents were skipped.`,
				});
			toast.add({
				description:
					done.length === documents.length
						? plural(done.length, { one: "# moved to Trash", other: "# moved to Trash" })
						: t`Moved ${i18n.number(done.length)} of ${i18n.number(documents.length)} to Trash. Locked documents were skipped.`,
				actionProps: {
					children: t`Undo`,
					// Confirmed like a single Undo when everything came back; otherwise how many did. The server counts only
					// documents it restored: one already back (another tab) or deleted since isn't counted.
					onClick: () =>
						void (async () => {
							let restored = 0;
							let failure: unknown;
							for (const group of chunks(done)) {
								try {
									restored += (await restoreMany.mutateAsync({ documents: group.map(ref) })).restored;
								} catch (error) {
									failure = error;
								}
							}
							await refresh();
							if (restored === done.length) return confirmUndone();
							if (restored === 0 && failure) return toastError(failure, t`Couldn't restore them. Try again.`);
							toast.add({
								description: t`Restored ${ph({ restored: i18n.number(restored) })} of ${i18n.number(done.length)}.`,
							});
						})(),
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
					description: t`Restored ${ph({ restored: i18n.number(restored) })} of ${i18n.number(documents.length)}. Refresh and retry any that remain in Trash.`,
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
					description: t`Deleted ${ph({ deleted: i18n.number(deleted) })} of ${i18n.number(documents.length)} forever. Refresh to see what remains.`,
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

type MenuEntry = { icon: IconName; label: string; onSelect: () => void; disabled?: boolean };
type MenuGroup = { label?: string; entries: MenuEntry[] };

type DocumentMenuProps = {
	document: DocumentSummary;
	onOpen: () => void;
	onRename: () => void;
	onTags: () => void;
	onLink: () => void;
	/** Starts a selection with this document. */
	onSelect?: (() => void) | undefined;
	/** The same items as a context menu (right-click and long-press) instead of the ⋯ menu. */
	variant?: "dropdown" | "context";
};

/**
 * The document menu (board X5): Open and Select, then Share, For a job and Organize, then Move to Trash after a
 * rule. A locked document keeps every item in its place, dimmed, and says why once at the top.
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
	const sentOn = useDocumentSentDate(document);
	const username = session?.user.username;
	const isResume = document.type === "resume";
	// A resume's public address, or null while its link is off.
	const url =
		isResume && document.isPublic && document.slug && username
			? publicResumeUrl(origin, { username, slug: document.slug })
			: null;

	const groups: MenuGroup[] = [
		{
			entries: [
				{ icon: "arrow-square-out", label: t`Open`, onSelect: onOpen },
				...(onSelect ? [{ icon: "check-square", label: t`Select`, onSelect } satisfies MenuEntry] : []),
			],
		},
		{
			label: t`Share`,
			entries: [
				...(isResume
					? [
							{
								icon: "share-network",
								label: t`Share…`,
								// The editor's Share view: public link, password, web page and download settings.
								onSelect: () =>
									void navigate({
										to: "/builder/$resumeId",
										params: { resumeId: document.id },
										search: { mode: "share" },
									}),
							} satisfies MenuEntry,
						]
					: []),
				...(url
					? [
							{
								icon: "link",
								label: t`Copy public link`,
								onSelect: () => void copy(url).then((copied) => copied && toast.add({ description: t`Link copied` })),
							} satisfies MenuEntry,
						]
					: []),
				{
					icon: "download-simple",
					label: t`Download PDF`,
					onSelect: () => void download(document.type, document.id),
					disabled: downloading === document.id,
				},
			],
		},
		{
			label: t`For a job`,
			entries: [
				...(isResume
					? ([
							{ icon: "briefcase", label: t`Copy for a job…`, onSelect: () => actions.copyForJob(document) },
							{
								icon: "envelope-simple",
								label: t`Write a letter…`,
								onSelect: () => openDialog("document.new", { context: "letters", sourceResumeId: document.id }),
							},
						] satisfies MenuEntry[])
					: []),
				{
					icon: "link-simple-horizontal",
					label: t`Link to application…`,
					onSelect: onLink,
					disabled: document.isLocked,
				},
			],
		},
		{
			label: t`Organize`,
			entries: [
				{ icon: "pencil-simple", label: t`Rename`, onSelect: onRename, disabled: document.isLocked },
				{ icon: "copy", label: t`Duplicate`, onSelect: () => void actions.duplicate(document) },
				{ icon: "tag", label: t`Tags…`, onSelect: onTags, disabled: document.isLocked },
				document.isLocked
					? { icon: "lock-simple-open", label: t`Unlock editing`, onSelect: () => actions.setLocked(document, false) }
					: { icon: "lock-simple", label: t`Lock editing`, onSelect: () => actions.setLocked(document, true) },
			],
		},
	];

	const Content = variant === "context" ? ContextMenuContent : DropdownMenuContent;
	const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
	const Separator = variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;

	return (
		<Content align="end" className="w-62">
			{/* Visible, not a tooltip: keyboard and touch users never see a title. */}
			{document.isLocked && (
				<p className="px-2.5 pt-2 pb-1.5 t-small text-ink-3">
					{sentOn ? (
						<Trans>Sent on {sentOn} and locked. Unlock it to rename, tag, relink or move it to Trash.</Trans>
					) : (
						<Trans>Locked. Unlock it to rename, tag, relink or move it to Trash.</Trans>
					)}
				</p>
			)}
			{groups.map((group) => (
				// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset can't sit inside a menu
				<div key={group.label ?? "open"} role="group" aria-label={group.label}>
					{group.label && (
						<div aria-hidden="true" className={menuLabelClassName}>
							{group.label}
						</div>
					)}
					{group.entries.map((entry) => (
						<Item key={entry.label} disabled={entry.disabled} onClick={entry.onSelect}>
							<Icon name={entry.icon} />
							{entry.label}
						</Item>
					))}
				</div>
			))}
			<Separator />
			{/* Undoable from its toast, so it never asks (ruling P2). */}
			<Item variant="destructive" disabled={document.isLocked} onClick={() => void actions.trash(document)}>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</Item>
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
	const commitTags = useRef<(() => string[]) | null>(null);
	const limitsId = useId();
	// Tags for several documents: the shared tags as #Tag, the rest offered in one dashed line, no limits line.
	const bulk = (documents?.length ?? 0) > 1;
	const setDocumentTags = useMutation(orpc.documents.setTags.mutationOptions());
	const shared = documents ? sharedTags(documents) : [];
	const suggestions = useExistingTags(documents?.map((document) => document.type) ?? [], requested !== null);

	const save = async () => {
		if (!documents) return;
		const next = commitTags.current?.() ?? tags ?? shared;
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
			<DialogContent closeLabel={t`Close`}>
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
							<Plural
								value={documents.length}
								_2="These are the tags both share. A tag you add goes on both; a tag you remove comes off both. Locked documents are left as they are."
								other="These are the tags they all share. A tag you add goes on every one; a tag you remove comes off every one. Locked documents are left as they are."
							/>
						) : (
							<Trans>Tags group documents. Pick one above the list to filter by it.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-1.5">
					<ChipInput
						commitRef={commitTags}
						value={tags ?? shared}
						onChange={setTags}
						placeholder={t`Add a tag…`}
						suggestions={suggestions}
						suggestionsLabel={t`Your tags`}
						hash={bulk}
						aria-describedby={bulk ? undefined : limitsId}
					/>
					{!bulk && (
						<p id={limitsId} className="t-small text-ink-3">
							<Trans>Up to 20 tags per document, 40 characters each.</Trans>
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
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

/** Link to application…: the job the document is for. Pick a row, then Done links it; Unlink clears it. */
export function LinkApplicationDialog({ document: requested, onClose }: LinkApplicationDialogProps) {
	const queryClient = useQueryClient();
	// Closing keeps the list, its choice and Unlink on screen until the dialog has faded out.
	const [document, onOpenChangeComplete] = useClosingValue(requested);
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: requested !== null });
	const link = useMutation(orpc.documents.linkApplication.mutationOptions());
	const [addingJob, setAddingJob] = useState(false);
	// The row picked in this dialog; until one is picked, the current link.
	const [picked, setPicked] = useState<string | null>(null);
	const current = document?.application?.id ?? null;
	const choice = picked ?? current;

	const close = () => {
		setPicked(null);
		onClose();
	};

	const choose = async (applicationId: string | null) => {
		if (!document) return;
		if (applicationId === current) return close();
		try {
			await link.mutateAsync({ type: document.type, id: document.id, applicationId });
			await queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			await queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
			close();
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
			onOpenChange={(open) => !open && close()}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<DialogContent closeLabel={t`Close`}>
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
				{jobs.length === 0 ? (
					<p className="text-sm text-ink-2">
						<Trans>No applications yet.</Trans>
					</p>
				) : (
					<RadioGroup
						aria-label={t`Application`}
						value={choice}
						onValueChange={(value) => setPicked(value as string)}
						disabled={link.isPending || Boolean(submitted)}
						className="gap-0"
					>
						{/* The rows' hover ground bleeds 12px past the text; the scroller makes room for it. */}
						<List cap tight className="-mx-3 max-h-80 overflow-y-auto px-3">
							{jobs.map((application) => {
								// Another letter already went out with this job, so it keeps that one.
								const taken = Boolean(
									document?.type === "letter" &&
									application.sentCoverLetterVersionId &&
									application.coverLetterId !== document.id,
								);
								return (
									<ListRow
										key={application.id}
										// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- ListRow fills the label with the radio and the job's name.
										render={<label />}
										className={cn("cursor-pointer", taken && "pointer-events-none")}
										variant={taken || submitted ? "dim" : "default"}
										leading={<RadioGroupItem value={application.id} disabled={taken} />}
										title={`${application.company} · ${application.role}`}
										subtitle={taken ? t`Letter already sent` : undefined}
									/>
								);
							})}
						</List>
					</RadioGroup>
				)}
				<DialogFooter>
					<Button
						variant="ghost"
						className="-ms-3.5 me-auto"
						disabled={link.isPending || Boolean(submitted)}
						onClick={() => setAddingJob(true)}
					>
						<Icon name="plus" />
						<Trans>Add a job…</Trans>
					</Button>
					{current && (
						<Button variant="ghost" disabled={link.isPending || Boolean(submitted)} onClick={() => void choose(null)}>
							<Trans>Unlink</Trans>
						</Button>
					)}
					<Button variant="secondary" disabled={link.isPending} onClick={() => void choose(choice)}>
						<Trans>Done</Trans>
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
