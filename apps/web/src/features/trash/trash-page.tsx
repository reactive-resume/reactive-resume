import type { DocumentSummary } from "@/features/documents/filter";
import type { RouterOutput } from "@/libs/orpc/client";
import { i18n } from "@lingui/core";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { TRASH_PAGE, trashedApplicationsQueryOptions } from "./queries";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { IconTile, List, ListRow, revealOnRowClassName } from "@/components/calm/list-row";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { SelectionBar } from "@/components/calm/selection-bar";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { companyInitials } from "@/features/applications/components/list-view";
import { useBatchActions } from "@/features/documents/document-actions";
import { documentKey } from "@/features/documents/filter";
import { useDocumentHistory } from "@/features/documents/library-session";
import { PageNavigation } from "@/features/documents/page-navigation";
import { useDocumentRemovalMotion } from "@/features/documents/removal-motion";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

export type TrashKind = "all" | "documents" | "applications";

type TrashedApplication = RouterOutput["applications"]["listTrash"]["items"][number];
type Item = { key: string; name: string; trashedAt: Date; daysLeft: number } & (
	| { kind: "document"; document: DocumentSummary }
	| { kind: "application"; application: TrashedApplication }
);

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);
/** Whole calendar days until the day Trash deletes a row: moved today reads 30, on its last day 0. */
const daysUntil = (expiresAt: number, now: number) =>
	Math.max(0, Math.round((startOfDay(expiresAt) - startOfDay(now)) / DAY));
const documentsOf = (items: readonly Item[]) =>
	items.flatMap((item) => (item.kind === "document" ? [item.document] : []));
const applicationsOf = (items: readonly Item[]) =>
	items.flatMap((item) => (item.kind === "application" ? [item.application] : []));

/** The company a letter was written for: its job's, else its recipient. */
const writtenFor = (letter: DocumentSummary) => letter.application?.company ?? letter.recipient;

type TrashPageProps = { kind: TrashKind; onKindChange: (kind: TrashKind) => void };

/**
 * One Trash for documents and applications: both kinds in one list, newest in Trash first, each kept 30 days. Rows
 * restore at once; deleting permanently and Empty Trash ask first. Empty Trash is server-side and covers everything
 * in Trash, not only the rows loaded or selected.
 */
export function TrashPage({ kind, onKindChange }: TrashPageProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const batch = useBatchActions();
	const [offset, setOffset] = useState(0);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [busy, setBusy] = useState(false);
	// Days left are counted from when the page opened.
	const [now] = useState(() => Date.now());

	// ponytail: under All, both kinds page together by one offset, so the mixed order is exact only while each kind
	// fits one page (100); the Documents and Applications tabs are always exact. A server-side merged list is the
	// upgrade.
	const documents = useQuery({
		...orpc.documents.page.queryOptions({ input: { trashed: true, limit: TRASH_PAGE, offset } }),
		gcTime: 0,
		placeholderData: (previous) => previous,
	});
	const applications = useQuery({
		...trashedApplicationsQueryOptions(offset),
		placeholderData: (previous) => previous,
	});
	const totals = { documents: documents.data?.total ?? 0, applications: applications.data?.total ?? 0 };
	const total = totals.documents + totals.applications;
	useDocumentHistory(totals.documents > 0);

	const loaded = Boolean(documents.data && applications.data);
	const failed = documents.isError || applications.isError;
	const fetching = documents.isFetching || applications.isFetching;
	// Restored and deleted documents fade out before the list refreshes.
	const listRef = useRef<HTMLDivElement>(null);
	useDocumentRemovalMotion({
		container: listRef,
		scope: `${kind}:${offset}`,
		trashed: true,
		data: documents.data,
		fetching: documents.isFetching,
		failed: documents.isError,
	});
	const all: Item[] = [
		...(documents.data?.items ?? []).flatMap((document): Item[] =>
			document.trashedAt
				? [
						{
							kind: "document",
							key: documentKey(document),
							name: document.name,
							trashedAt: document.trashedAt,
							daysLeft: daysUntil(document.trashedAt.getTime() + 30 * DAY, now),
							document,
						},
					]
				: [],
		),
		...(applications.data?.items ?? []).map((application): Item => ({
			kind: "application",
			key: `application:${application.id}`,
			name: application.company,
			trashedAt: application.trashedAt,
			daysLeft: daysUntil(application.expiresAt.getTime(), now),
			application,
		})),
	].sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime());
	const items = all.filter((item) => kind === "all" || (kind === "documents") === (item.kind === "document"));
	const selection = items.filter((item) => selected.has(item.key));
	const pageTotal = kind === "all" ? Math.max(totals.documents, totals.applications) : totals[kind];
	if (loaded && offset > 0 && offset >= pageTotal) {
		setOffset(Math.max(0, Math.floor((pageTotal - 1) / TRASH_PAGE) * TRASH_PAGE));
		setSelected(new Set());
	}

	const clearSelection = () => setSelected(new Set());
	const select = (item: Item, on: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			if (on) next.add(item.key);
			else next.delete(item.key);
			return next;
		});

	const refreshApplications = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.applications.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.career.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.documents.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.agent.key() }),
		]);

	/** Each trashed application takes its own request; the server refuses one restored or deleted meanwhile. */
	const eachApplication = async (
		rows: readonly TrashedApplication[],
		task: (input: { id: string; trashedAt: Date }) => Promise<unknown>,
		done: (count: number) => void,
		failure: string,
	) => {
		if (rows.length === 0) return true;
		const results = await Promise.allSettled(rows.map(({ id, trashedAt }) => task({ id, trashedAt })));
		await refreshApplications();
		const rejected = results.find((result) => result.status === "rejected");
		const count = results.length - results.filter((result) => result.status === "rejected").length;
		if (count > 0) done(count);
		if (rejected) toastError(rejected.reason, failure);
		return !rejected;
	};

	/** Runs on documents and applications alike; a partial or failed run keeps the selection for a retry. */
	const run = async (action: () => Promise<boolean>) => {
		if (busy || fetching) return;
		setBusy(true);
		try {
			if (await action()) clearSelection();
		} catch {
			// Each action reports its own error.
		} finally {
			setBusy(false);
		}
	};

	const restore = (rows: readonly Item[]) =>
		run(async () => {
			const [docs, apps] = [documentsOf(rows), applicationsOf(rows)];
			const documentsDone = docs.length === 0 || (await batch.restore(docs));
			const only = apps.length === 1 ? apps[0] : undefined;
			const applicationsDone = await eachApplication(
				apps,
				client.applications.restore,
				(count) =>
					toast.add({
						description: plural(count, { one: "# application restored", other: "# applications restored" }),
						...(only
							? {
									actionProps: {
										children: t`Open`,
										onClick: () => void navigate({ to: "/dashboard/applications", search: { applicationId: only.id } }),
									},
								}
							: {}),
					}),
				t`Couldn't restore the application. Try again.`,
			);
			return documentsDone && applicationsDone;
		});

	const purge = async (rows: readonly Item[]) => {
		const [docs, apps] = [documentsOf(rows), applicationsOf(rows)];
		const only = rows.length === 1 ? rows[0] : undefined;
		if (!only && rows.length === 0) return;
		const kept = only ? plural(only.daysLeft, { one: "# more day", other: "# more days" }) : "";
		const confirmed = await confirm(
			!only
				? plural(rows.length, {
						one: "Delete # item permanently?",
						other: "Delete # items permanently?",
					})
				: only.kind === "application"
					? t`Delete the ${only.name} application permanently?`
					: t`Delete “${only.name}” permanently?`,
			{
				description: !only
					? t`They are deleted for good now, with their history and timelines. Keeping them leaves them in Trash. This can't be undone.`
					: only.kind === "application"
						? t`Its timeline, notes and contacts go with it. Linked documents are kept. Keeping it leaves it in Trash for ${kept}.`
						: only.document.type === "resume"
							? t`This resume, its version history and its feedback links are deleted for good. Keeping it leaves it in Trash for ${kept}.`
							: t`This cover letter and its version history are deleted for good. Keeping it leaves it in Trash for ${kept}.`,
				confirmText: t`Delete permanently`,
				cancelText: t`Keep in Trash`,
				variant: "danger",
			},
		);
		if (!confirmed) return;
		await run(async () => {
			const documentsDone = docs.length === 0 || (await batch.purge(docs));
			const applicationsDone = await eachApplication(
				apps,
				client.applications.purge,
				(count) =>
					toast.add({
						description: plural(count, {
							one: "# application deleted permanently",
							other: "# applications deleted permanently",
						}),
					}),
				t`Couldn't delete the application. Try again.`,
			);
			return documentsDone && applicationsDone;
		});
	};

	const emptyTrash = async () => {
		const documentCount = plural(totals.documents, { one: "# document", other: "# documents" });
		const applicationCount = plural(totals.applications, { one: "# application", other: "# applications" });
		const confirmed = await confirm(t`Empty Trash?`, {
			description:
				totals.documents && totals.applications
					? t`${documentCount} and ${applicationCount} are deleted for good now, with their history and timelines, instead of after 30 days. This can't be undone.`
					: t`${totals.documents ? documentCount : applicationCount} are deleted for good now, with their history and timelines, instead of after 30 days. This can't be undone.`,
			confirmText: t`Empty Trash`,
			cancelText: t`Keep in Trash`,
			variant: "danger",
		});
		if (!confirmed) return;
		await run(async () => {
			// The document half reports itself; an already empty half says nothing.
			if (totals.documents) await batch.emptyTrash();
			if (!totals.applications) return true;
			try {
				const { deleted } = await client.applications.emptyTrash({});
				await refreshApplications();
				if (deleted > 0)
					toast.add({
						description: plural(deleted, {
							one: "# application deleted permanently",
							other: "# applications deleted permanently",
						}),
					});
				return true;
			} catch (error) {
				toastError(error, t`Couldn't empty Trash. Try again.`);
				return false;
			}
		});
	};

	const movedToday = new Date(now).toDateString();
	const disabled = busy || fetching;
	const empty = loaded && !failed && total === 0;
	const selecting = selection.length > 0;

	return (
		<Page>
			<PageBody>
				<RootHeader
					title={<Trans>Trash</Trans>}
					subtitle={
						empty ? undefined : (
							<Trans>Documents and applications stay here for 30 days, then are deleted for good.</Trans>
						)
					}
					actions={
						<>
							{total > 0 && (
								<Button variant="danger-text" disabled={disabled} className="-me-3.5" onClick={() => void emptyTrash()}>
									<Trans>Empty Trash…</Trans>
								</Button>
							)}
							<PhoneHeaderActions />
						</>
					}
				/>

				{!empty && (
					<Tabs
						value={kind}
						onValueChange={(value: TrashKind) => {
							clearSelection();
							setOffset(0);
							onKindChange(value);
						}}
						className="mt-5"
					>
						<TabsList variant="line" aria-label={t`Show`} className="w-full justify-start">
							<TabsTrigger value="all">
								<Trans>All</Trans>
								{loaded && <TabsCount>{i18n.number(total)}</TabsCount>}
							</TabsTrigger>
							<TabsTrigger value="documents">
								<Trans>Documents</Trans>
								{loaded && <TabsCount>{i18n.number(totals.documents)}</TabsCount>}
							</TabsTrigger>
							<TabsTrigger value="applications">
								<Trans>Applications</Trans>
								{loaded && <TabsCount>{i18n.number(totals.applications)}</TabsCount>}
							</TabsTrigger>
						</TabsList>
					</Tabs>
				)}

				{failed ? (
					<Alert variant="error" className="mt-4">
						<Icon name="warning-circle" />
						<AlertTitle>
							<Trans>Couldn't load Trash</Trans>
						</AlertTitle>
						<AlertDescription>
							<p>
								<Trans>Check your connection and try again.</Trans>
							</p>
							<Button
								variant="secondary"
								className="mt-2"
								loading={fetching}
								onClick={() => {
									void documents.refetch();
									void applications.refetch();
								}}
							>
								<Trans>Try again</Trans>
							</Button>
						</AlertDescription>
					</Alert>
				) : !loaded ? (
					// Rows at their final size while Trash loads.
					<div className="mt-2 grid" aria-busy="true">
						{[0, 1, 2].map((row) => (
							<div key={row} className="flex min-h-(--row) items-center gap-3.5 border-b border-line">
								<Skeleton className="h-11 w-8 rounded-paper" />
								<Skeleton className="h-4 w-56" />
							</div>
						))}
					</div>
				) : items.length === 0 ? (
					<EmptyState
						className="mt-5"
						title={<Trans>Trash is empty</Trans>}
						description={
							<Trans>Documents and applications you move here stay for 30 days, then are deleted for good.</Trans>
						}
					/>
				) : (
					<List ref={listRef} className="mt-2" aria-label={t`Trash`} role="list">
						{items.map((item) => (
							<ListRow
								key={item.key}
								role="listitem"
								data-document-key={item.kind === "document" ? item.key : undefined}
								interactive
								selected={selected.has(item.key)}
								leading={
									// The checkbox takes the picture's place on hover and focus, and on every row while selecting.
									// Touch screens have no hover: they show both.
									<span className="relative flex w-8 shrink-0 items-center justify-center pointer-coarse:w-auto pointer-coarse:gap-3.5">
										<Checkbox
											disabled={disabled}
											checked={selected.has(item.key)}
											onCheckedChange={(on) => select(item, on)}
											aria-label={t`Select ${item.name}`}
											className={cn(
												"absolute z-10 pointer-coarse:static",
												!selecting &&
													"opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
											)}
										/>
										<span
											className={cn(
												"flex pointer-coarse:visible",
												selecting ? "invisible" : "group-focus-within/row:invisible group-hover/row:invisible",
											)}
										>
											{item.kind === "document" ? (
												<DocumentThumb kind={item.document.type} />
											) : (
												<IconTile aria-hidden="true" className="size-8 rounded-sm text-xs">
													{companyInitials(item.name)}
												</IconTile>
											)}
										</span>
									</span>
								}
								title={item.name}
								subtitle={
									item.kind === "application"
										? t`Application · ${item.application.role}`
										: item.document.type === "resume"
											? t`Resume · last edited ${i18n.date(item.document.editedAt, { day: "numeric", month: "short" })}`
											: writtenFor(item.document)
												? t`Cover letter · written for ${writtenFor(item.document)}`
												: t`Cover letter · last edited ${i18n.date(item.document.editedAt, { day: "numeric", month: "short" })}`
								}
								value={
									<>
										<span className="w-[120px] max-md:hidden">
											{item.trashedAt.toDateString() === movedToday
												? t`Moved today`
												: t`Moved ${i18n.date(item.trashedAt, { day: "numeric", month: "short" })}`}
										</span>
										<span className="ms-2 w-[168px] max-lg:w-24 max-sm:w-auto">
											{item.daysLeft === 0
												? t`Deleted today`
												: plural(item.daysLeft, { one: "# day left", other: "# days left" })}
										</span>
									</>
								}
								trailing={
									<>
										<Button variant="link" disabled={disabled} onClick={() => void restore([item])}>
											<Trans>Restore</Trans>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<IconButton
														icon="dots-three"
														size="icon-sm"
														label={t`More for ${item.name}`}
														className={cn(
															"ms-5 text-ink-2 aria-expanded:opacity-100",
															revealOnRowClassName,
															selecting && "invisible",
														)}
													/>
												}
											/>
											<DropdownMenuContent align="end" className="w-62">
												<DropdownMenuItem disabled={disabled} onClick={() => void restore([item])}>
													<Icon name="arrow-counter-clockwise" />
													<Trans>Restore</Trans>
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem variant="destructive" disabled={disabled} onClick={() => void purge([item])}>
													<Icon name="trash" />
													<Trans>Delete permanently…</Trans>
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</>
								}
							/>
						))}
					</List>
				)}

				<PageNavigation
					offset={offset}
					total={pageTotal}
					busy={disabled}
					onChange={(next) => {
						clearSelection();
						setOffset(next);
					}}
				/>
				{selecting && (
					<SelectionBar
						label={t`Selected in Trash`}
						count={selection.length}
						total={items.length}
						onSelectAll={() => setSelected(new Set(items.map((item) => item.key)))}
						onClear={clearSelection}
						className="fixed max-sm:bottom-[calc(var(--app-tabbar,0px)+16px)]"
					>
						<Button variant="ghost" size="sm" disabled={disabled} onClick={() => void restore(selection)}>
							<Icon name="arrow-counter-clockwise" />
							<Trans>Restore</Trans>
						</Button>
						<Button variant="danger-text" size="sm" disabled={disabled} onClick={() => void purge(selection)}>
							<Icon name="trash" />
							<Trans>Delete permanently…</Trans>
						</Button>
					</SelectionBar>
				)}
			</PageBody>
		</Page>
	);
}
