import type { Application } from "@/features/applications/types";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	ArchiveIcon,
	BriefcaseIcon,
	CalendarDotsIcon,
	ChartBarIcon,
	DownloadSimpleIcon,
	FunnelIcon,
	KanbanIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	RowsIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Label } from "@reactive-resume/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { Combobox } from "@/components/ui/combobox";
import { ApplicationDetailSheet } from "@/features/applications/components/application-detail-sheet";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";
import { ApplicationBoard } from "@/features/applications/components/board";
import { ApplicationCalendar } from "@/features/applications/components/calendar-view";
import { ExportApplicationsSheet } from "@/features/applications/components/export-applications-sheet";
import { ImportApplicationsSheet } from "@/features/applications/components/import-applications-sheet";
import { ApplicationInsights } from "@/features/applications/components/insights-view";
import { ApplicationTable } from "@/features/applications/components/table-view";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";
import { DashboardHeader } from "../-components/header";

const SORT_OPTIONS = [
	{ value: "updated", label: msg`Last updated` },
	{ value: "applied", label: msg`Date applied` },
	{ value: "company", label: msg`Company A–Z` },
	{ value: "role", label: msg`Role A–Z` },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const searchSchema = z.object({
	search: z.string().default(""),
	view: z.enum(["board", "table", "calendar", "insights"]).default("board"),
	tags: z.array(z.string()).default([]),
	sort: z.enum(["updated", "applied", "company", "role"]).default("updated"),
	archived: z.boolean().default(false),
	create: z.boolean().default(false),
	applicationId: z.string().optional(),
});
type Search = z.output<typeof searchSchema>;
const defaultSearch: Search = { search: "", view: "board", tags: [], sort: "updated", archived: false, create: false };

export const Route = createFileRoute("/dashboard/applications/")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
});

function RouteComponent() {
	const { i18n } = useLingui();
	const { search, view, tags, sort, archived, create, applicationId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	const [textSearch, setTextSearch] = useState(search);
	const [addOpen, setAddOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);
	const [editing, setEditing] = useState<Application | null>(null);
	const [selected, setSelected] = useState<Application | null>(null);

	// Editing from the detail panel: close the panel, open the edit form on the same application.
	const startEdit = (application: Application) => {
		setSelected(null);
		setEditing(application);
	};

	useEffect(() => {
		if (!create) return;

		setAddOpen(true);
		void navigate({ replace: true, search: (prev: Search) => ({ ...prev, create: false }) });
	}, [create, navigate]);

	const { data: applications } = useQuery(applicationsListQueryOptions());
	const { data: allTags } = useQuery(orpc.applications.tags.queryOptions());

	useEffect(() => {
		if (!applicationId || !applications) return;

		setSelected(applications.find((application) => application.id === applicationId) ?? null);
		void navigate({ replace: true, search: (prev: Search) => ({ ...prev, applicationId: undefined }) });
	}, [applicationId, applications, navigate]);

	// Board & table hide archived; tag/search filters + sort are applied client-side.
	const filtered = useMemo(() => {
		const query = textSearch.trim().toLowerCase();
		const rows = (applications ?? [])
			.filter((app) => archived || !app.archived)
			.filter((app) => tags.length === 0 || tags.every((tag: string) => app.tags.includes(tag)))
			.filter((app) => !query || app.company.toLowerCase().includes(query) || app.role.toLowerCase().includes(query));

		const compare: Record<SortKey, (a: Application, b: Application) => number> = {
			updated: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			applied: (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
			company: (a, b) => a.company.localeCompare(b.company),
			role: (a, b) => a.role.localeCompare(b.role),
		};
		return rows.sort(compare[sort as SortKey]);
	}, [applications, textSearch, tags, sort, archived]);

	const archivedCount = (applications ?? []).filter((app) => app.archived).length;

	const isEmpty = (applications?.length ?? 0) === 0;

	const setUrlSearch = (patch: Partial<Search>) => void navigate({ search: (prev: Search) => ({ ...prev, ...patch }) });

	return (
		<div className="flex h-[calc(100dvh-2rem)] flex-col gap-4">
			<DashboardHeader
				className="max-sm:flex-col max-sm:gap-y-3"
				icon={BriefcaseIcon}
				title={t`Applications`}
				actions={
					!isEmpty ? (
						<>
							<Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
								<DownloadSimpleIcon />
								<Trans>Export CSV</Trans>
							</Button>
							<Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
								<DownloadSimpleIcon />
								<Trans>Import CSV</Trans>
							</Button>
							<Button size="sm" onClick={() => setAddOpen(true)}>
								<PlusIcon />
								<Trans>Add application</Trans>
							</Button>
						</>
					) : undefined
				}
			/>

			<Separator />

			{isEmpty ? (
				<EmptyState onAdd={() => setAddOpen(true)} onImport={() => setImportOpen(true)} />
			) : (
				<>
					{/* One row: search grows, filters stay fixed, icon-only view switcher on the right. */}
					<div className="flex items-center gap-2">
						<InputGroup className="min-w-24 max-w-72 flex-1">
							<InputGroupAddon align="inline-start">
								<MagnifyingGlassIcon />
							</InputGroupAddon>
							<InputGroupInput
								value={textSearch}
								placeholder={t`Search applications…`}
								onChange={(event) => setTextSearch(event.target.value)}
							/>
						</InputGroup>

						{/* Desktop: filters inline. Mobile: collapsed into the Filters popover below. */}
						{(allTags?.length ?? 0) > 0 && (
							<Combobox
								multiple
								className="w-40 min-w-0 shrink max-sm:hidden"
								value={tags}
								placeholder={t`Filter by tags`}
								options={(allTags ?? []).map((tag) => ({ value: tag, label: tag }))}
								onValueChange={(value) => setUrlSearch({ tags: value ?? [] })}
							/>
						)}

						{view !== "insights" && view !== "calendar" && (
							<Combobox
								className="w-40 min-w-0 shrink max-sm:hidden"
								value={sort}
								placeholder={t`Sort by…`}
								options={SORT_OPTIONS.map((option) => ({ value: option.value, label: i18n.t(option.label) }))}
								onValueChange={(value) => value && setUrlSearch({ sort: value as SortKey })}
							/>
						)}

						{archivedCount > 0 && view !== "insights" && (
							<Button
								size="sm"
								variant={archived ? "secondary" : "outline"}
								className="shrink-0 max-sm:hidden"
								onClick={() => setUrlSearch({ archived: !archived })}
							>
								<ArchiveIcon />
								<Trans>Archived</Trans> ({archivedCount})
							</Button>
						)}

						{/* Mobile-only: one button holds every filter so the row never overflows on a phone. */}
						{view !== "insights" && (
							<Popover>
								<PopoverTrigger
									render={
										<Button size="icon-sm" variant="outline" className="relative shrink-0 sm:hidden">
											<FunnelIcon />
											{(tags.length > 0 || archived) && (
												<span className="absolute end-1 top-1 size-1.5 rounded-full bg-primary" />
											)}
										</Button>
									}
								/>
								<PopoverContent align="end" className="w-64 p-3">
									{(allTags?.length ?? 0) > 0 && (
										<div className="space-y-1.5">
											<Label className="text-muted-foreground text-xs">
												<Trans>Filter by tags</Trans>
											</Label>
											<Combobox
												multiple
												className="w-full"
												value={tags}
												placeholder={t`Any tag`}
												options={(allTags ?? []).map((tag) => ({ value: tag, label: tag }))}
												onValueChange={(value) => setUrlSearch({ tags: value ?? [] })}
											/>
										</div>
									)}
									<div className="space-y-1.5">
										<Label className="text-muted-foreground text-xs">
											<Trans>Sort by</Trans>
										</Label>
										<Combobox
											className="w-full"
											value={sort}
											options={SORT_OPTIONS.map((option) => ({ value: option.value, label: i18n.t(option.label) }))}
											onValueChange={(value) => value && setUrlSearch({ sort: value as SortKey })}
										/>
									</div>
									{archivedCount > 0 && (
										<Button
											size="sm"
											variant={archived ? "secondary" : "outline"}
											className="w-full"
											onClick={() => setUrlSearch({ archived: !archived })}
										>
											<ArchiveIcon />
											<Trans>Archived</Trans> ({archivedCount})
										</Button>
									)}
								</PopoverContent>
							</Popover>
						)}

						<Tabs className="ms-auto shrink-0" value={view}>
							<TabsList>
								<TabsTrigger
									value="board"
									title={i18n.t(msg`Board`)}
									nativeButton={false}
									render={<Link to="." search={(p: Search) => ({ ...p, view: "board" })} />}
								>
									<KanbanIcon />
									<span className="sr-only">{i18n.t(msg`Board`)}</span>
								</TabsTrigger>
								<TabsTrigger
									value="table"
									title={i18n.t(msg`Table`)}
									nativeButton={false}
									render={<Link to="." search={(p: Search) => ({ ...p, view: "table" })} />}
								>
									<RowsIcon />
									<span className="sr-only">{i18n.t(msg`Table`)}</span>
								</TabsTrigger>
								<TabsTrigger
									value="calendar"
									title={i18n.t(msg`Calendar`)}
									nativeButton={false}
									render={<Link to="." search={(p: Search) => ({ ...p, view: "calendar" })} />}
								>
									<CalendarDotsIcon />
									<span className="sr-only">{i18n.t(msg`Calendar`)}</span>
								</TabsTrigger>
								<TabsTrigger
									value="insights"
									title={i18n.t(msg`Insights`)}
									nativeButton={false}
									render={<Link to="." search={(p: Search) => ({ ...p, view: "insights" })} />}
								>
									<ChartBarIcon />
									<span className="sr-only">{i18n.t(msg`Insights`)}</span>
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>

					<div className="flex min-h-0 flex-1 flex-col">
						{view !== "insights" && filtered.length === 0 ? (
							<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
								<p className="font-medium text-sm">
									<Trans>No applications match your filters.</Trans>
								</p>
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										setTextSearch("");
										setUrlSearch({ search: "", tags: [], archived: false });
									}}
								>
									<Trans>Clear filters</Trans>
								</Button>
							</div>
						) : (
							<>
								{view === "board" && (
									<ApplicationBoard applications={filtered} onOpen={setSelected} onEdit={setEditing} />
								)}
								{view === "table" && (
									<ApplicationTable applications={filtered} onOpen={setSelected} onEdit={setEditing} />
								)}
								{view === "calendar" && (
									<ApplicationCalendar
										applications={filtered}
										allApplications={applications ?? []}
										onOpen={setSelected}
									/>
								)}
								{view === "insights" && <ApplicationInsights applications={applications ?? []} />}
							</>
						)}
					</div>
				</>
			)}

			<ApplicationFormSheet open={addOpen} onOpenChange={setAddOpen} />
			<ApplicationFormSheet open={!!editing} application={editing} onOpenChange={(open) => !open && setEditing(null)} />
			<ImportApplicationsSheet open={importOpen} onOpenChange={setImportOpen} />
			<ExportApplicationsSheet
				open={exportOpen}
				onOpenChange={setExportOpen}
				applications={applications ?? []}
				filtered={filtered}
			/>
			<ApplicationDetailSheet
				application={selected}
				onOpenChange={(open) => !open && setSelected(null)}
				onEdit={startEdit}
			/>
		</div>
	);
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
			<div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
				<BriefcaseIcon className="size-7 text-muted-foreground" />
			</div>
			<div className="max-w-md space-y-1.5">
				<h2 className="font-semibold text-lg">
					<Trans>Track your first application</Trans>
				</h2>
				<p className="text-muted-foreground text-sm">
					<Trans>
						Add a job you're applying to and link the resume you sent. Move it across the board as you hear back.
					</Trans>
				</p>
			</div>
			<div className="flex gap-2">
				<Button onClick={onAdd}>
					<PlusIcon />
					<Trans>Add application</Trans>
				</Button>
				<Button variant="outline" onClick={onImport}>
					<DownloadSimpleIcon />
					<Trans>Import from CSV</Trans>
				</Button>
			</div>
		</div>
	);
}
