import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { useBatchActions } from "./document-actions";
import { DocumentRow } from "./document-card";
import { LibraryError } from "./library-error";
import { PageHeader } from "@/components/layout/page-header";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";

const noop = () => undefined;
const documentKey = (document: { type: string; id: string }) => `${document.type}:${document.id}`;

/**
 * Trash: documents stay 30 days, then go for good. Rows can be selected for Restore or Delete permanently; Empty
 * trash is a separate server-side operation that covers every document in Trash, not only the loaded or selected IDs.
 */
export function TrashPage() {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [busy, setBusy] = useState(false);
	const confirm = useConfirm();
	const batch = useBatchActions();
	const {
		data: documents,
		isPending,
		isError,
		isFetching,
		refetch,
	} = useQuery(orpc.documents.list.queryOptions({ input: { trashed: true } }));
	const counts = useQuery(orpc.documents.counts.queryOptions());
	const all = documents ?? [];
	const selection = all.filter((document) => selected.has(documentKey(document)));
	const selecting = selection.length > 0;
	const allSelected = all.length > 0 && selection.length === all.length;
	const trashCount = counts.data?.trash ?? all.length;

	const clearSelection = () => setSelected(new Set());
	const selectAll = (on: boolean) => setSelected(new Set(on ? all.map(documentKey) : []));
	const setSelectedFor = (document: (typeof all)[number], on: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			if (on) next.add(documentKey(document));
			else next.delete(documentKey(document));
			return next;
		});

	useHotkey("Escape", () => {
		if (selecting && !busy) clearSelection();
	});

	const run = async (action: () => Promise<boolean>) => {
		setBusy(true);
		try {
			// A partial or failed batch keeps the remaining selection so the user can retry it.
			if (await action()) clearSelection();
		} catch {
			// The action reports its own error; the selection stays so the user can retry.
		} finally {
			setBusy(false);
		}
	};

	const purgeSelected = async () => {
		const confirmed = await confirm(
			selection.length === 1
				? t`Delete “${selection[0]?.name ?? ""}” forever?`
				: plural(selection.length, {
						one: "Delete # selected document forever?",
						other: "Delete # selected documents forever?",
					}),
			{
				description:
					selection.length === 1
						? t`The selected document will be deleted for good and can't be restored.`
						: t`The selected documents will be deleted for good and can't be restored.`,
				confirmText: t`Hold to delete`,
				cancelText: t`Keep in Trash`,
				hold: true,
			},
		);
		if (!confirmed) return;
		await run(() => batch.purge(selection));
	};

	const emptyTrash = async () => {
		const confirmed = await confirm(t`Empty Trash?`, {
			description:
				trashCount === 1
					? t`The document in Trash will be deleted for good and can't be restored.`
					: t`All ${trashCount} documents in Trash will be deleted for good and can't be restored.`,
			confirmText: t`Hold to delete`,
			cancelText: t`Keep in Trash`,
			hold: true,
		});
		if (!confirmed) return;
		await run(() => batch.emptyTrash());
	};

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<PageHeader
				back={
					<Link
						to="/dashboard"
						className={buttonVariants({ variant: "ghost", size: "sm", className: "-ms-2.5 w-fit gap-1.5 text-ink-2" })}
					>
						<Icon name="arrow-left" size={18} />
						<Trans>Back to documents</Trans>
					</Link>
				}
				title={<Trans>Trash</Trans>}
				description={<Trans>Documents are deleted permanently after 30 days.</Trans>}
				actions={
					all.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							className="text-danger-text hover:bg-danger-soft"
							onClick={() => void emptyTrash()}
						>
							<Icon name="trash" />
							<Trans>Empty trash…</Trans>
						</Button>
					) : undefined
				}
			/>

			{isError && <LibraryError retrying={isFetching} onRetry={() => void refetch()} />}

			{isError && !documents ? null : !isPending && documents?.length === 0 ? (
				<div className="grid justify-items-center gap-2 py-16 text-center">
					<Icon name="trash" size={28} className="text-ink-3" />
					<p className="font-semibold">
						<Trans>Trash is empty</Trans>
					</p>
					<p className="text-sm text-ink-2">
						<Trans>Documents you move here stay for 30 days.</Trans>
					</p>
				</div>
			) : (
				<table className="w-full table-fixed border-collapse">
					<caption className="sr-only">
						<Trans>Trash</Trans>
					</caption>
					<thead>
						<tr className="border-b border-line text-xs font-medium text-ink-3">
							<th className="w-10 ps-3">
								<Checkbox
									checked={allSelected}
									indeterminate={selecting && !allSelected}
									onCheckedChange={(on) => selectAll(on)}
									aria-label={t`Select this page in Trash`}
								/>
							</th>
							<th className="h-10 ps-3 text-start font-medium">
								<Trans>Name</Trans>
							</th>
							<th className="w-24 px-2 text-start font-medium max-sm:hidden">
								<Trans>Type</Trans>
							</th>
							<th className="w-1/4 px-2 text-start font-medium max-sm:hidden">
								<Trans>Application</Trans>
							</th>
							<th className="w-28 px-2 text-start font-medium max-sm:w-24">
								<Trans>Deleted in</Trans>
							</th>
							<th className="w-12">
								<span className="sr-only">
									<Trans>Options</Trans>
								</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{documents?.map((document) => (
							<DocumentRow
								key={documentKey(document)}
								document={document}
								onTags={noop}
								onLink={noop}
								selected={selected.has(documentKey(document))}
								onSelectedChange={(on) => setSelectedFor(document, on)}
							/>
						))}
					</tbody>
				</table>
			)}

			<TrashSelectionBar
				selection={selection}
				allSelected={allSelected}
				busy={busy}
				onSelectAll={() => selectAll(true)}
				onClear={clearSelection}
				onRestore={() => void run(() => batch.restore(selection))}
				onPurge={() => void purgeSelected()}
			/>
		</div>
	);
}

type TrashSelectionBarProps = {
	selection: { type: string; id: string; name: string }[];
	allSelected: boolean;
	busy: boolean;
	onSelectAll: () => void;
	onClear: () => void;
	onRestore: () => void;
	onPurge: () => void;
};

/** Floats over Trash while rows are selected: Restore or Delete permanently the selected loaded documents. */
function TrashSelectionBar({
	selection,
	allSelected,
	busy,
	onSelectAll,
	onClear,
	onRestore,
	onPurge,
}: TrashSelectionBarProps) {
	const count = selection.length;

	return (
		<div
			role="toolbar"
			aria-label={t`Selected documents in Trash`}
			aria-hidden={count === 0}
			inert={count === 0}
			className={cn(
				"fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-1 rounded-xl border border-line bg-raised p-1.5 shadow-e3 transition-[opacity,translate] duration-standard ease-enter max-sm:bottom-4",
				count === 0 && "pointer-events-none translate-y-2 opacity-0",
			)}
		>
			<span className="px-2 text-sm font-semibold whitespace-nowrap" aria-live="polite">
				<Trans>{count} selected</Trans>
			</span>
			{!allSelected && (
				<Button variant="ghost" size="sm" disabled={busy} onClick={onSelectAll} className="max-sm:hidden">
					<Trans>Select this page</Trans>
				</Button>
			)}
			<Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
				<Icon name="arrow-counter-clockwise" />
				<span className="max-sm:sr-only">
					<Trans>Restore</Trans>
				</span>
			</Button>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				className="text-danger-text hover:bg-danger-soft"
				onClick={onPurge}
			>
				<Icon name="trash" />
				<span className="max-sm:sr-only">
					<Trans>Delete permanently…</Trans>
				</span>
			</Button>
			<IconButton icon="x" size="icon-sm" label={t`Clear selection`} className="text-ink-2" onClick={onClear} />
		</div>
	);
}
