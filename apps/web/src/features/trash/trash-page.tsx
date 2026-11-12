import type { DocumentSummary } from "@/features/documents/filter";
import type { RouterOutput } from "@/libs/orpc/client";
import { i18n } from "@lingui/core";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { getInitials } from "@reactive-resume/utils/string";
import { TRASH_PAGE, trashedApplicationsQueryOptions } from "./queries";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { SelectionBar } from "@/components/calm/selection-bar";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { useBatchActions } from "@/features/documents/document-actions";
import { daysLeftInTrash, documentKey } from "@/features/documents/filter";
import { useDocumentHistory } from "@/features/documents/library-session";
import { PageNavigation } from "@/features/documents/page-navigation";
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
const documentsOf = (items: readonly Item[]) =>
	items.flatMap((item) => (item.kind === "document" ? [item.document] : []));
const applicationsOf = (items: readonly Item[]) =>
	items.flatMap((item) => (item.kind === "application" ? [item.application] : []));

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

	// ponytail: both kinds page together by one offset, so the order is exact only while each kind fits one page
	// (100). Past that, a server-side merged list is the upgrade.
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
	const all: Item[] = [
		...(documents.data?.items ?? []).flatMap((document): Item[] =>
			document.trashedAt
				? [
						{
							kind: "document",
							key: documentKey(document),
							name: document.name,
							trashedAt: document.trashedAt,
							daysLeft: daysLeftInTrash(document.trashedAt, now),
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
			daysLeft: Math.max(0, Math.ceil((application.expiresAt.getTime() - now) / DAY)),
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
						one: "Delete # selected item permanently?",
						other: "Delete # selected items permanently?",
					})
				: only.kind === "application"
					? t`Delete the ${only.name} application permanently?`
					: t`Delete “${only.name}” permanently?`,
			{
				description: !only
					? t`They are deleted permanently now, with their history and timelines. Keeping them leaves them in Trash. This can't be undone.`
					: only.kind === "application"
						? t`Its timeline, notes and contacts go with it. Linked documents are kept. Keeping it leaves it in Trash for ${kept}.`
						: only.document.type === "resume"
							? t`This resume, its version history and its feedback links are deleted permanently. Keeping it leaves it in Trash for ${kept}.`
							: t`This cover letter and its version history are deleted permanently. Keeping it leaves it in Trash for ${kept}.`,
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
					? t`${documentCount} and ${applicationCount} will be deleted permanently now, with their history and timelines, instead of after 30 days. This can't be undone.`
					: t`${totals.documents ? documentCount : applicationCount} will be deleted permanently now, with their history and timelines, instead of after 30 days. This can't be undone.`,
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

	return (
		<Page>
			<PageBody>
				<RootHeader
					title={<Trans>Trash</Trans>}
					subtitle={<Trans>Documents and applications stay here for 30 days, then are deleted permanently.</Trans>}
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
					<div data-design="empty" className="grid justify-items-center gap-2 py-16 text-center">
						<h2 className="t-section-title">
							<Trans>Trash is empty</Trans>
						</h2>
						<p className="text-sm text-ink-3">
							<Trans>What you move here stays for 30 days.</Trans>
						</p>
					</div>
				) : (
					<List className="mt-2" aria-label={t`Trash`} role="list">
						{items.map((item) => (
							<ListRow
								key={item.key}
								role="listitem"
								interactive
								selected={selected.has(item.key)}
								leading={
									<>
										<Checkbox
											disabled={disabled}
											checked={selected.has(item.key)}
											onCheckedChange={(on) => select(item, on)}
											aria-label={t`Select ${item.name}`}
										/>
										{item.kind === "document" ? (
											<DocumentThumb kind={item.document.type} />
										) : (
											<IconTile className="size-8 text-xs">{getInitials(item.name)}</IconTile>
										)}
									</>
								}
								title={item.name}
								subtitle={
									item.kind === "application"
										? t`Application · ${item.application.role}`
										: item.document.type === "resume"
											? t`Resume · last edited ${i18n.date(item.document.editedAt, { day: "numeric", month: "short" })}`
											: t`Cover letter · last edited ${i18n.date(item.document.editedAt, { day: "numeric", month: "short" })}`
								}
								value={
									<>
										<span className="w-28 max-md:hidden">
											{item.trashedAt.toDateString() === movedToday
												? t`Moved today`
												: t`Moved ${i18n.date(item.trashedAt, { day: "numeric", month: "short" })}`}
										</span>
										<span className="w-24 max-sm:w-auto">
											{plural(item.daysLeft, { one: "# day left", other: "# days left" })}
										</span>
									</>
								}
								trailing={
									<>
										<Button
											variant="ghost"
											size="sm"
											disabled={disabled}
											className="text-accent-text"
											onClick={() => void restore([item])}
										>
											<Trans>Restore</Trans>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<IconButton
														icon="dots-three"
														size="icon-sm"
														label={t`More for ${item.name}`}
														className="text-ink-2"
													/>
												}
											/>
											<DropdownMenuContent align="end">
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
				{selection.length > 0 && (
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
