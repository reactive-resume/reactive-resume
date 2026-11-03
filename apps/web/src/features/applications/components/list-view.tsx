import type { ApplicationLane } from "../lanes";
import type { OfferHint } from "../next-step";
import type { ApplicationSummary } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { useFloatingToolbarSpace } from "@reactive-resume/ui/hooks/use-floating-toolbar-space";
import { cn } from "@reactive-resume/utils/style";
import { getStageDisplay } from "../lanes";
import { getCategoryLane, getDisplayLane, getLaneLabel } from "../lanes";
import { compareNextStepSortKeys, describeNextStep, getNextStep, nextStepSortKey } from "../next-step";
import { offerHintFor, useOfferHints } from "../queries";
import { getStageLabel, LIST_ORDER, PIPELINE } from "../stages";
import { useApplicationActions, useInvalidateApplications, useMoveWithUndo } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ClosedLaneItems } from "./application-actions-menu";
import { TagChips } from "./tag-chips";
import { useCareerTime, useNow } from "@/features/career/shared";
import { useConfirm } from "@/hooks/use-confirm";
import { formatRelativeTime } from "@/libs/locale";
import { D2, EASE, EXIT } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

type SortKey = "role" | "next" | "updated";
type Sort = { key: SortKey; direction: "asc" | "desc" };
type SortValue = string | number | readonly [number, number];

// Sort keys are computed once per row, not once per comparison.
const sortValue: Record<
	SortKey,
	(application: ApplicationSummary, now: Date, timeZone: string, offer?: OfferHint | null) => SortValue
> = {
	role: (application) => application.role,
	next: (application, now, timeZone, offer) => nextStepSortKey(application, now, timeZone, offer),
	updated: (application) => new Date(application.updatedAt).getTime(),
};

const compareValues = (a: SortValue, b: SortValue, aId: string, bId: string, direction: Sort["direction"]) => {
	const sign = direction === "asc" ? 1 : -1;
	if (typeof a === "string" && typeof b === "string") return sign * a.localeCompare(b);
	if (typeof a === "object" && typeof b === "object") return compareNextStepSortKeys(a, b, aId, bId, direction);
	return sign * (Number(a) - Number(b));
};

type ListViewProps = {
	applications: ApplicationSummary[];
	showClosed: boolean;
	selectedId: string | null;
	onOpen: (application: ApplicationSummary) => void;
};

/**
 * The default view: applications grouped by lane, by the stage that needs you first (Interview, Offer, Screening,
 * Applied, Saved, then Closed when shown) and in the owner's lane order within a stage. Within a group rows follow
 * Next step: dated steps soonest first, then the longest wait. Groups collapse, headers sort within groups, and row checkboxes select
 * for bulk moves, tags, closing and deleting. Phones get two-line rows.
 */
export function ApplicationList({ applications, showClosed, selectedId, onOpen }: ListViewProps) {
	const breakpoint = useBreakpoint();
	const { timeZone } = useCareerTime();
	const phone = breakpoint === "mobile";
	const { lanes, active, isPending: lanesPending, error: lanesError } = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	const { logFollowUp } = useApplicationActions();
	const rowButtons = useRef(new Map<string, HTMLButtonElement>());
	const restoreFocus = useRef<string | null>(null);
	const now = useNow();
	const hints = useOfferHints();
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	// Next step first: what's dated soonest, then whatever has waited longest in its stage.
	const [sort, setSort] = useState<Sort>({ key: "next", direction: "asc" });
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const { ref: selectionBarRef, space: selectionBarSpace } = useFloatingToolbarSpace();

	const laneOf = (application: ApplicationSummary) => getDisplayLane(lanes, application);
	// Selections only cover what's on screen.
	const visible = applications.filter(
		(application) => (application.status !== "closed" || showClosed) && !collapsed.has(laneOf(application).id),
	);
	const checkedIds = visible.filter((application) => checked.has(application.id)).map((application) => application.id);
	if (checkedIds.length !== checked.size) setChecked(new Set(checkedIds));

	const groups = useMemo(() => {
		const sign = sort.direction === "asc" ? 1 : -1;
		const keys = new Map(
			applications.map((application) => [
				application.id,
				sortValue[sort.key](application, now, timeZone, offerHintFor(hints, application.id)),
			]),
		);
		const key = (application: ApplicationSummary) => keys.get(application.id) ?? 0;
		const rowsByLane = new Map<string, ApplicationSummary[]>();
		for (const application of applications) {
			const id = getDisplayLane(lanes, application).id;
			const rows = rowsByLane.get(id);
			if (rows) rows.push(application);
			else rowsByLane.set(id, [application]);
		}
		return LIST_ORDER.filter((status) => status !== "closed" || showClosed)
			.flatMap((status) => active.filter((lane) => lane.category === status))
			.map((lane) => ({
				lane,
				rows: (rowsByLane.get(lane.id) ?? []).sort(
					(a, b) =>
						compareValues(key(a), key(b), a.id, b.id, sort.direction) ||
						(sort.key === "role" ? sign * a.company.localeCompare(b.company) : 0) ||
						a.id.localeCompare(b.id),
				),
			}))
			.filter((group) => group.rows.length > 0);
	}, [applications, showClosed, sort, lanes, active, timeZone, now, hints]);

	const ordered = groups.flatMap(({ lane, rows }) => (collapsed.has(lane.id) ? [] : rows));
	const rowRef = (id: string, node: HTMLButtonElement | null) => {
		const previous = rowButtons.current.get(id);
		if (!node && previous === document.activeElement) restoreFocus.current = id;
		if (node) rowButtons.current.set(id, node);
		else rowButtons.current.delete(id);
	};
	useLayoutEffect(() => {
		const id = restoreFocus.current;
		restoreFocus.current = null;
		if (id && document.activeElement === document.body) rowButtons.current.get(id)?.focus();
	});
	const step = (id: string, direction: number) => {
		const index = ordered.findIndex((row) => row.id === id);
		if (index < 0) return;
		const next = ordered[Math.max(0, Math.min(ordered.length - 1, index + direction))];
		if (next) rowButtons.current.get(next.id)?.focus();
	};
	const move = (id: string, status: ApplicationStatus) => {
		const application = ordered.find((row) => row.id === id);
		if (!application || lanesPending || lanesError) return;
		const lane = getCategoryLane(lanes, status);
		if (getDisplayLane(lanes, application).id === lane.id) return;
		moveWithUndo({ applications: [application], lane, description: t`Moved to ${getLaneLabel(lane)}` });
	};
	const followedUp = (id: string) => {
		const application = ordered.find((row) => row.id === id);
		if (!application || application.status === "saved" || application.status === "closed" || logFollowUp.isPending)
			return;
		logFollowUp.mutate({ id });
	};

	const toggleGroup = (status: string) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(status)) next.delete(status);
			else next.add(status);
			return next;
		});

	const toggleRow = (id: string) =>
		setChecked((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const sortBy = (key: SortKey) =>
		setSort((current) =>
			current.key === key
				? { key, direction: current.direction === "asc" ? "desc" : "asc" }
				: { key, direction: key === "updated" ? "desc" : "asc" },
		);

	const header = (key: SortKey, label: string, className?: string) => (
		<th
			scope="col"
			aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
			className={cn("px-2 text-start font-medium", className)}
		>
			<button
				type="button"
				onClick={() => sortBy(key)}
				className="inline-flex h-9 items-center gap-1 rounded-md transition-colors hover:text-ink"
			>
				{label}
				{sort.key === key && <Icon name={sort.direction === "asc" ? "arrow-up" : "arrow-down"} size={14} />}
			</button>
		</th>
	);

	return (
		<div
			className="grid min-w-0 content-start gap-3"
			style={{ paddingBottom: checkedIds.length ? selectionBarSpace : undefined }}
		>
			<table className={cn("w-full border-collapse text-sm", !phone && "table-fixed")}>
				{!phone && (
					<thead>
						<tr className="border-b border-line text-xs text-ink-3">
							<th scope="col" className="w-10 ps-3">
								<span className="sr-only">
									<Trans>Select</Trans>
								</span>
							</th>
							{header("role", t`Role`)}
							{header("next", t`Next step`, "w-1/4")}
							<th scope="col" className="w-32 px-2 text-start font-medium max-xl:hidden">
								<Trans>Stage</Trans>
							</th>
							<th scope="col" className="w-36 px-2 text-start font-medium">
								<Trans>Sent</Trans>
							</th>
							{header("updated", t`Updated`, "w-28 max-lg:hidden")}
						</tr>
					</thead>
				)}

				{groups.map(({ lane, rows }) => {
					const open = !collapsed.has(lane.id);
					const groupId = `applications-group-${lane.id}`;
					return (
						<tbody key={lane.id} aria-labelledby={groupId}>
							<tr>
								<th
									scope="colgroup"
									colSpan={phone ? 1 : breakpoint === "wide" ? 6 : breakpoint === "desktop" ? 5 : 4}
									className="pt-3 text-start"
								>
									<button
										type="button"
										id={groupId}
										aria-expanded={open}
										onClick={() => toggleGroup(lane.id)}
										className="flex h-9 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-sm font-semibold transition-colors hover:bg-hover"
									>
										<Icon
											name="caret-right"
											size={18}
											className={cn("text-ink-3 transition-transform duration-standard", open && "rotate-90")}
										/>
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-sm"
											style={{ background: lane.color }}
										/>
										<span className="truncate">{getLaneLabel(lane)}</span>
										<span className="font-mono text-xs font-normal text-ink-3">{rows.length}</span>
									</button>
								</th>
							</tr>
							{open &&
								rows.map((application) => (
									<ApplicationRow
										key={application.id}
										application={application}
										lane={lane}
										phone={phone}
										selected={application.id === selectedId}
										checked={checked.has(application.id)}
										onCheck={toggleRow}
										onOpen={onOpen}
										rowRef={rowRef}
										onStep={step}
										onMove={move}
										onFollowUp={followedUp}
									/>
								))}
						</tbody>
					);
				})}
			</table>

			{/* The bulk bar rises from the bottom edge and floats over the list, so the rows never move. */}
			<AnimatePresence>
				{checkedIds.length > 0 && (
					<m.div
						key="bulk-bar"
						ref={selectionBarRef}
						initial={{ opacity: 0, transform: "translateY(100%)" }}
						animate={{ opacity: 1, transform: "translateY(0%)" }}
						exit={{ opacity: 0, transform: "translateY(100%)", transition: { duration: D2 * EXIT, ease: EASE } }}
						transition={{ duration: D2, ease: EASE }}
						className="fixed inset-x-0 bottom-6 z-30 mx-auto w-fit max-w-[calc(100vw-32px)] max-sm:bottom-[calc(69px+env(safe-area-inset-bottom))]"
					>
						<BulkBar
							ids={checkedIds}
							allSelected={checkedIds.length === visible.length}
							onSelectAll={() => setChecked(new Set(visible.map((application) => application.id)))}
							onDone={() => setChecked(new Set())}
						/>
					</m.div>
				)}
			</AnimatePresence>
		</div>
	);
}

type ApplicationRowProps = {
	application: ApplicationSummary;
	lane: ApplicationLane;
	phone: boolean;
	selected: boolean;
	checked: boolean;
	rowRef: (id: string, node: HTMLButtonElement | null) => void;
	onStep: (id: string, direction: number) => void;
	onMove: (id: string, status: ApplicationStatus) => void;
	onFollowUp: (id: string) => void;
	onCheck: (id: string) => void;
	onOpen: (application: ApplicationSummary) => void;
};

// Memoized with id-taking callbacks, so one row's change doesn't re-render the other rows.
const ApplicationRow = memo(function ApplicationRow({
	application,
	lane,
	phone,
	selected,
	checked,
	rowRef,
	onStep,
	onMove,
	onFollowUp,
	onCheck,
	onOpen,
}: ApplicationRowProps) {
	const openRef = useRef<HTMLButtonElement>(null);
	useHotkeys(
		[
			{ hotkey: "J" as const, callback: () => onStep(application.id, 1), meta: { name: t`Next application` } },
			{ hotkey: "K" as const, callback: () => onStep(application.id, -1), meta: { name: t`Previous application` } },
			{ hotkey: "Enter" as const, callback: () => onOpen(application), meta: { name: t`Open application` } },
			{ hotkey: "X" as const, callback: () => onCheck(application.id), meta: { name: t`Toggle selection` } },
			{ hotkey: "F" as const, callback: () => onFollowUp(application.id), meta: { name: t`Followed up` } },
			...PIPELINE.map((status, index) => ({
				hotkey: `${index + 1}` as "1" | "2" | "3" | "4" | "5",
				callback: () => onMove(application.id, status),
				meta: { name: t`Moved to ${getStageLabel(status)}` },
			})),
		].map(({ callback, meta, ...binding }) => ({
			...binding,
			options: { meta },
			callback: (event: KeyboardEvent) => {
				if (
					!event.repeat &&
					!event.isComposing &&
					event.keyCode !== 229 &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.altKey &&
					!event.shiftKey
				)
					callback();
			},
		})),
		{ target: openRef, requireReset: true, ignoreInputs: true },
	);
	const { i18n } = useLingui();
	const { timeZone } = useCareerTime();
	const hints = useOfferHints(application.status === "offer");
	const { lanes } = useApplicationLanes();
	const accepted = application.status === "closed" && application.closedReason === "accepted";
	const stage = accepted
		? getStageDisplay(lanes, application)
		: { color: lane.color, label: getLaneLabel(lane), accepted: false };
	const next = describeNextStep(
		getNextStep(application, undefined, timeZone, offerHintFor(hints, application.id)),
		application,
		i18n.locale,
		timeZone,
	);
	const sent = application.status !== "saved";
	const tone = next.tone === "warn" ? "text-warn-text" : next.tone === "muted" ? "text-ink-3" : "text-ink-2";

	const initial = (
		<span
			aria-hidden="true"
			className="grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-[13px] font-semibold text-ink-2"
		>
			{application.company.slice(0, 1).toUpperCase()}
		</span>
	);

	const openButton = (
		<button
			type="button"
			ref={(node) => {
				openRef.current = node;
				rowRef(application.id, node);
			}}
			data-application-open
			aria-keyshortcuts="j k Enter 1 2 3 4 5 x f"
			className="focus-visible:outline-focus grid min-w-0 cursor-pointer rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-4"
		>
			<span dir="auto" className="truncate font-medium">
				{application.role}
			</span>
			{/* The company keeps its own direction; on phones the next step after it is interface text. */}
			{phone ? (
				<span className="truncate text-xs text-ink-3">
					<bdi>{application.company}</bdi> · {next.title}
				</span>
			) : (
				<span dir="auto" className="truncate text-xs text-ink-3">
					{[application.company, application.location].filter(Boolean).join(" · ")}
					<TagChips tags={application.tags} />
				</span>
			)}
		</button>
	);

	if (phone) {
		return (
			<tr
				data-application-id={application.id}
				onClick={() => onOpen(application)}
				className={cn("cursor-pointer border-b border-line", selected && "bg-accent-soft/50")}
			>
				<td className="py-2.5 ps-1">
					<div className="flex items-center gap-3">
						{initial}
						{openButton}
						<Icon name="caret-right" size={20} className="ms-auto shrink-0 text-ink-3" />
					</div>
				</td>
			</tr>
		);
	}

	return (
		<tr
			data-application-id={application.id}
			onClick={() => onOpen(application)}
			className={cn(
				"cursor-pointer border-b border-line transition-colors duration-quick hover:bg-hover",
				selected && "bg-accent-soft/50",
			)}
		>
			<td onClick={(event) => event.stopPropagation()} className="w-10 cursor-default ps-3">
				<Checkbox
					checked={checked}
					onCheckedChange={() => onCheck(application.id)}
					aria-label={t`Select ${application.role} at ${application.company}`}
				/>
			</td>
			<td className="py-2 pe-2">
				<div className="flex items-center gap-3">
					{initial}
					{openButton}
				</div>
			</td>
			<td className="px-2">
				<span className={cn("flex items-center gap-1.5", tone)}>
					<Icon name={next.icon} size={16} className="shrink-0" />
					<span className="min-w-0 truncate">{next.title}</span>
				</span>
			</td>
			<td className="px-2 max-xl:hidden">
				<span className="flex min-w-0 items-center gap-1.5 text-ink-2">
					<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: stage.color }} />
					{stage.accepted && <Icon name="check" size={14} className="shrink-0 text-accent-text" />}
					<span className="truncate">{stage.label}</span>
				</span>
			</td>
			<td className="px-2">
				{application.resumeId ||
				application.coverLetterId ||
				application.resumeFileUrl ||
				application.coverLetterUrl ? (
					// Before the job is applied to, the documents are only linked: show them muted and say so.
					<span
						className={cn("flex items-center gap-1", sent ? "text-ink-2" : "text-ink-3 opacity-70")}
						title={sent ? undefined : t`Linked · not sent yet`}
					>
						{!sent && <span className="sr-only">{t`Linked · not sent yet`}</span>}
						{application.resumeFileUrl && (
							<>
								<Icon name="file-pdf" size={18} />
								<span className="sr-only">{t`Resume file`}</span>
							</>
						)}
						{application.coverLetterUrl && (
							<>
								<Icon name="file-pdf" size={18} />
								<span className="sr-only">{t`Cover letter file`}</span>
							</>
						)}
						{application.resumeId && (
							<>
								<Icon name="file-text" size={18} />
								<span className="sr-only">{t`Resume`}</span>
							</>
						)}
						{application.coverLetterId && (
							<>
								<Icon name="envelope-simple" size={18} />
								<span className="sr-only">{t`Cover letter`}</span>
							</>
						)}
					</span>
				) : (
					<span className={cn("text-xs", sent ? "text-warn-text" : "text-ink-3")}>
						<Trans>No documents attached</Trans>
					</span>
				)}
			</td>
			<td className="px-2 text-xs whitespace-nowrap text-ink-3 max-lg:hidden">
				{formatRelativeTime(application.updatedAt, i18n.locale)}
			</td>
		</tr>
	);
});

type BulkBarProps = {
	ids: string[];
	allSelected: boolean;
	onSelectAll: () => void;
	onDone: () => void;
};

/** For the checked rows: move them or close them (with Undo), tag them, or delete them (after asking). */
function BulkBar({ ids, allSelected, onSelectAll, onDone }: BulkBarProps) {
	const scope = `applications-bulk-${useId()}`;
	const invalidate = useInvalidateApplications();
	const moveWithUndo = useMoveWithUndo();
	const rows = ids.map((id) => ({ id }));
	const confirm = useConfirm();
	const { lanes, active } = useApplicationLanes();
	const [tag, setTag] = useState("");

	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({
				description: plural(result.updated, { one: "# application updated", other: "# applications updated" }),
			});
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't update the applications. Try again.` }),
	});
	const bulkDelete = useMutation({
		...orpc.applications.bulkTrash.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({
				description: t`Moved ${result.deleted} to Trash.`,
			});
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't delete the applications. Try again.` }),
	});
	const disabled = ids.length > 200 || bulkUpdate.isPending || bulkDelete.isPending;

	return (
		<div
			role="toolbar"
			aria-label={t`Applications`}
			className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-raised p-1.5 text-ink shadow-e3"
		>
			<span className="px-2 text-sm font-semibold whitespace-nowrap" aria-live="polite">
				<Plural value={ids.length} one="# selected" other="# selected" />
			</span>
			{!allSelected && (
				<Button size="sm" variant="ghost" disabled={disabled} onClick={onSelectAll}>
					<Trans>Select all</Trans>
				</Button>
			)}
			{ids.length > 200 && (
				<p role="status" className="w-full px-2 text-sm text-warn-text">
					<Trans>Choose up to 200 applications per bulk action.</Trans>
				</p>
			)}

			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="ghost" disabled={disabled} />}>
					<Icon name="tag" />
					<Trans>Tags…</Trans>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-60 p-2">
					<HotkeysProvider scope={`${scope}-tags`} exclusive>
						<form
							className="flex gap-1.5"
							onSubmit={(event) => {
								event.preventDefault();
								if (disabled || !tag.trim()) return;
								bulkUpdate.mutate({ ids, addTags: [tag.trim()] });
								setTag("");
							}}
						>
							<Input aria-label={t`Tag`} value={tag} onChange={(event) => setTag(event.target.value)} autoFocus />
							<Button size="sm" type="submit" disabled={disabled || !tag.trim()}>
								<Trans>Add</Trans>
							</Button>
						</form>
					</HotkeysProvider>
				</PopoverContent>
			</Popover>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} />}>
					<Icon name="arrow-right" />
					<Trans>Move to…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<HotkeysProvider scope={`${scope}-0`} exclusive>
						{active
							.filter((lane) => lane.category !== "closed")
							.map((lane) => (
								<DropdownMenuItem
									key={lane.id}
									onClick={() => {
										const label = getLaneLabel(lane);
										moveWithUndo({
											applications: rows,
											lane,
											description: plural(ids.length, {
												one: `# application moved to ${label}`,
												other: `# applications moved to ${label}`,
											}),
										});
										onDone();
									}}
								>
									<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: lane.color }} />
									<span className="truncate">{getLaneLabel(lane)}</span>
								</DropdownMenuItem>
							))}
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} />}>
					<Trans>Close…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<HotkeysProvider scope={`${scope}-1`} exclusive>
						<ClosedLaneItems
							lanes={active}
							onPick={(lane, reason) => {
								moveWithUndo({
									applications: rows,
									lane: lane ?? getCategoryLane(lanes, "closed"),
									closedReason: lane ? reason : (reason ?? null),
									description: plural(ids.length, { one: "# application closed", other: "# applications closed" }),
								});
								onDone();
							}}
						/>
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<IconButton icon="x" size="icon-sm" label={t`Clear selection`} className="text-ink-2" onClick={onDone} />
			<Button
				size="sm"
				variant="ghost"
				disabled={disabled}
				className="text-danger-text hover:bg-danger-soft"
				onClick={async () => {
					const confirmed = await confirm(t`Move to Trash`, {
						description: t`Applications and their timelines can be restored from Trash.`,
						confirmText: t`Move to Trash`,
						cancelText: plural(ids.length, { one: "Keep application", other: "Keep applications" }),
						variant: "danger",
					});
					if (confirmed) bulkDelete.mutate({ ids });
				}}
			>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</Button>
		</div>
	);
}
