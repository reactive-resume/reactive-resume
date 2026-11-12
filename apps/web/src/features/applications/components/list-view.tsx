import type { ApplicationLane } from "../lanes";
import type { OfferHint } from "../next-step";
import type { ApplicationSummary } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { dayKey } from "../interviews";
import { getCategoryLane, getDisplayLane, getLaneLabel, getStageDisplay, laneDotColor } from "../lanes";
import {
	compareNextStepSortKeys,
	describeNextStepLine,
	describeSent,
	getNextStep,
	nextStepSortKey,
	stepDate,
} from "../next-step";
import { offerHintFor, useOfferHints } from "../queries";
import { getStageLabel, PIPELINE } from "../stages";
import {
	useApplicationActions,
	useInvalidateApplications,
	useMoveWithUndo,
	useTrashWithUndo,
} from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationActionsMenu, ClosedLaneItems, LaneDot } from "./application-actions-menu";
import { TagChips } from "./tag-chips";
import {
	DataTable,
	DataTableBody,
	DataTableCell,
	DataTableHead,
	DataTableHeaderCell,
	DataTableRow,
} from "@/components/calm/data-table";
import { IconTile, List, ListRow, revealOnRowClassName, rowLinkClassName } from "@/components/calm/list-row";
import { SelectionBar } from "@/components/calm/selection-bar";
import { StageDot } from "@/components/calm/stage-dot";
import { useCareerTime, useNow } from "@/features/career/shared";
import { orpc } from "@/libs/orpc/client";

type SortKey = "company" | "next" | "updated";
type Sort = { key: SortKey; direction: "asc" | "desc" };
type SortValue = string | number | readonly [number, number];

// Sort keys are computed once per row, not once per comparison.
const sortValue: Record<
	SortKey,
	(application: ApplicationSummary, now: Date, timeZone: string, offer?: OfferHint | null) => SortValue
> = {
	company: (application) => application.company,
	next: (application, now, timeZone, offer) => nextStepSortKey(application, now, timeZone, offer),
	updated: (application) => new Date(application.updatedAt).getTime(),
};

const compareValues = (a: SortValue, b: SortValue, aId: string, bId: string, direction: Sort["direction"]) => {
	const sign = direction === "asc" ? 1 : -1;
	if (typeof a === "string" && typeof b === "string") return sign * a.localeCompare(b);
	if (typeof a === "object" && typeof b === "object") return compareNextStepSortKeys(a, b, aId, bId, direction);
	return sign * (Number(a) - Number(b));
};

/** "OH" for Orbital Health, "PC" for Parcel & Co., "LU" for Lumen: two letters, as an account's initials read. */
export function companyInitials(company: string) {
	const words = company.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
	const letters =
		words.length > 1 ? words.slice(0, 2).map((word) => [...word][0] ?? "") : [...(words[0] ?? "")].slice(0, 2);
	return letters.join("").toUpperCase();
}

const relativeDay = (days: number, locale: string) => {
	const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
	return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
};

// Application, Stage, Next step, Sent, Updated, between the checkbox and the row menu. Narrower windows drop the
// last two: both are on the application's own page.
const COLUMNS = {
	full: "40px minmax(0,1.1fr) 108px minmax(0,1fr) minmax(180px,max-content) 92px 28px",
	narrow: "40px minmax(0,1.1fr) 108px minmax(0,1fr) 28px",
};

type ListViewProps = {
	applications: ApplicationSummary[];
	showClosed: boolean;
	/** A tag chip filters the page's existing search, rather than starting a second filter state. */
	onTagSelect?: ((tag: string) => void) | undefined;
	/** The line under the table (closed applications: Show or Hide). */
	footer?: ReactNode;
};

/**
 * The default view: one flat table, by next step, soonest first (dated steps, then the longest wait). Closed
 * applications join under their own heading when shown. Headers sort, row checkboxes select for bulk moves, tags,
 * closing and Trash, and a row is a link to the application's page. Phones get two-line rows.
 */
export function ApplicationList({ applications, showClosed, onTagSelect, footer }: ListViewProps) {
	const breakpoint = useBreakpoint();
	const { timeZone } = useCareerTime();
	const phone = breakpoint === "mobile";
	const { lanes, isPending: lanesPending, error: lanesError } = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	const { logFollowUp } = useApplicationActions();
	const rowLinks = useRef(new Map<string, HTMLAnchorElement>());
	const restoreFocus = useRef<string | null>(null);
	const now = useNow();
	const hints = useOfferHints();
	// Next step first: what's dated soonest, then whatever has waited longest in its stage.
	const [sort, setSort] = useState<Sort>({ key: "next", direction: "asc" });
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

	const { open, closed } = useMemo(() => {
		const sign = sort.direction === "asc" ? 1 : -1;
		const keys = new Map(
			applications.map((application) => [
				application.id,
				sortValue[sort.key](application, now, timeZone, offerHintFor(hints, application.id)),
			]),
		);
		const key = (application: ApplicationSummary) => keys.get(application.id) ?? 0;
		const sorted = applications.toSorted(
			(a, b) =>
				compareValues(key(a), key(b), a.id, b.id, sort.direction) ||
				(sort.key === "company" ? sign * a.role.localeCompare(b.role) : 0) ||
				a.id.localeCompare(b.id),
		);
		return {
			open: sorted.filter((application) => application.status !== "closed"),
			closed: showClosed ? sorted.filter((application) => application.status === "closed") : [],
		};
	}, [applications, showClosed, sort, timeZone, now, hints]);

	// Selections only cover what's on screen.
	const ordered = [...open, ...closed];
	const checkedIds = ordered.filter((application) => checked.has(application.id)).map((application) => application.id);
	if (checkedIds.length !== checked.size) setChecked(new Set(checkedIds));
	const selecting = checkedIds.length > 0;

	const rowRef = (id: string, node: HTMLAnchorElement | null) => {
		const previous = rowLinks.current.get(id);
		if (!node && previous === document.activeElement) restoreFocus.current = id;
		if (node) rowLinks.current.set(id, node);
		else rowLinks.current.delete(id);
	};
	useLayoutEffect(() => {
		const id = restoreFocus.current;
		restoreFocus.current = null;
		if (id && document.activeElement === document.body) rowLinks.current.get(id)?.focus();
	});
	const step = (id: string, direction: number) => {
		const index = ordered.findIndex((row) => row.id === id);
		if (index < 0) return;
		const next = ordered[Math.max(0, Math.min(ordered.length - 1, index + direction))];
		if (next) rowLinks.current.get(next.id)?.focus();
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

	const header = (key: SortKey, label: string) => (
		<DataTableHeaderCell
			aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
		>
			<button
				type="button"
				onClick={() => sortBy(key)}
				className="flex min-w-0 flex-1 items-center gap-1 rounded-xs text-start transition-colors hover:text-ink"
			>
				{label}
				{sort.key === key && <Icon name={sort.direction === "asc" ? "arrow-up" : "arrow-down"} size={14} />}
			</button>
		</DataTableHeaderCell>
	);

	const row = (application: ApplicationSummary) => (
		<ApplicationRow
			key={application.id}
			application={application}
			lane={getDisplayLane(lanes, application)}
			phone={phone}
			wide={breakpoint === "desktop" || breakpoint === "wide"}
			selecting={selecting}
			checked={checked.has(application.id)}
			onCheck={toggleRow}
			onTagSelect={onTagSelect}
			rowRef={rowRef}
			onStep={step}
			onMove={move}
			onFollowUp={followedUp}
		/>
	);

	const closedHeading = (
		<>
			<span>
				<Trans>Closed</Trans>
			</span>
			<span className="font-mono text-xs font-medium text-ink-3">{i18n.number(closed.length)}</span>
		</>
	);

	return (
		<>
			{phone ? (
				<>
					<List className="mt-3">{open.map(row)}</List>
					{closed.length > 0 && (
						<>
							<h2 className="flex items-baseline gap-2.5 pt-4 pb-1 text-sm font-semibold">{closedHeading}</h2>
							<List>{closed.map(row)}</List>
						</>
					)}
				</>
			) : (
				<DataTable
					aria-label={t`Applications`}
					columns={breakpoint === "tablet" ? COLUMNS.narrow : COLUMNS.full}
					className="mt-3"
				>
					<DataTableHead>
						<DataTableRow variant="header" className="group/row">
							<DataTableHeaderCell className="justify-center">
								<Checkbox
									checked={ordered.length > 0 && checkedIds.length === ordered.length}
									indeterminate={selecting && checkedIds.length < ordered.length}
									disabled={ordered.length === 0}
									onCheckedChange={(on) =>
										setChecked(on ? new Set(ordered.map((application) => application.id)) : new Set())
									}
									aria-label={t`Select all visible applications`}
									className={cn(!selecting && revealOnRowClassName)}
								/>
							</DataTableHeaderCell>
							{header("company", t`Application`)}
							<DataTableHeaderCell>
								<Trans>Stage</Trans>
							</DataTableHeaderCell>
							{header("next", t`Next step`)}
							{breakpoint !== "tablet" && (
								<>
									<DataTableHeaderCell>
										<Trans>Sent</Trans>
									</DataTableHeaderCell>
									{header("updated", t`Updated`)}
								</>
							)}
							<DataTableHeaderCell>
								<span className="sr-only">
									<Trans>More</Trans>
								</span>
							</DataTableHeaderCell>
						</DataTableRow>
					</DataTableHead>
					<DataTableBody>{open.map(row)}</DataTableBody>
					{closed.length > 0 && (
						<DataTableBody>
							<DataTableRow variant="group" className="items-start">
								<DataTableCell header full className="items-baseline gap-2.5 font-semibold">
									{closedHeading}
								</DataTableCell>
							</DataTableRow>
							{closed.map(row)}
						</DataTableBody>
					)}
				</DataTable>
			)}

			{footer}

			{/* The bar floats over the list from the first tick to the last, so the rows never move; the page's foot
			    keeps the last rows clear of it. */}
			{selecting && (
				<BulkBar
					ids={checkedIds}
					total={ordered.length}
					onSelectAll={() => setChecked(new Set(ordered.map((application) => application.id)))}
					onDone={() => setChecked(new Set())}
				/>
			)}
		</>
	);
}

type ApplicationRowProps = {
	application: ApplicationSummary;
	lane: ApplicationLane;
	phone: boolean;
	/** Wide enough for the Sent and Updated columns. */
	wide: boolean;
	/** A selection exists: every row shows its checkbox. */
	selecting: boolean;
	checked: boolean;
	rowRef: (id: string, node: HTMLAnchorElement | null) => void;
	onStep: (id: string, direction: number) => void;
	onMove: (id: string, status: ApplicationStatus) => void;
	onFollowUp: (id: string) => void;
	onCheck: (id: string) => void;
	onTagSelect?: ((tag: string) => void) | undefined;
};

// Memoized with id-taking callbacks, so one row's change doesn't re-render the other rows.
const ApplicationRow = memo(function ApplicationRow({
	application,
	lane,
	phone,
	wide,
	selecting,
	checked,
	rowRef,
	onStep,
	onMove,
	onFollowUp,
	onCheck,
	onTagSelect,
}: ApplicationRowProps) {
	const openRef = useRef<HTMLAnchorElement>(null);
	const open = (event: KeyboardEvent) => (event.target as HTMLElement).closest("a")?.click();
	useHotkeys(
		[
			{ hotkey: "J" as const, callback: () => onStep(application.id, 1), meta: { name: t`Next application` } },
			{ hotkey: "K" as const, callback: () => onStep(application.id, -1), meta: { name: t`Previous application` } },
			// The link's own Enter is taken by the binding, so it follows the link itself.
			{ hotkey: "Enter" as const, callback: open, meta: { name: t`Open` } },
			{ hotkey: "X" as const, callback: () => onCheck(application.id), meta: { name: t`Select` } },
			{ hotkey: "F" as const, callback: () => onFollowUp(application.id), meta: { name: t`Mark as followed up` } },
			...PIPELINE.map((status, index) => ({
				hotkey: `${index + 1}` as "1" | "2" | "3" | "4" | "5",
				callback: () => onMove(application.id, status),
				meta: { name: t`Move to ${getStageLabel(status)}` },
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
					callback(event);
			},
		})),
		{ target: openRef, requireReset: true, ignoreInputs: true },
	);
	const { i18n } = useLingui();
	const { timeZone, relative } = useCareerTime();
	const now = useNow();
	const hints = useOfferHints(application.status === "offer");
	const { lanes } = useApplicationLanes();
	const stage = getStageDisplay(lanes, application);
	const next = describeNextStepLine(
		getNextStep(application, now, timeZone, offerHintFor(hints, application.id)),
		application,
		i18n.locale,
		timeZone,
		now,
	);
	const sent = describeSent(application, i18n.locale, timeZone);
	const updated = new Date(application.updatedAt);
	// By the calendar, as people say it: "2 hours ago" today, "Yesterday", "3 days ago", then the date.
	const daysAgo = Math.round((Date.parse(dayKey(now, timeZone)) - Date.parse(dayKey(updated, timeZone))) / 86_400_000);
	const badge = next.needsYou && (
		<Badge variant="warn">
			<Trans>Needs you</Trans>
		</Badge>
	);

	const link = (
		<Link
			to="/dashboard/applications/$applicationId/{-$tab}"
			params={{ applicationId: application.id }}
			ref={(node) => {
				openRef.current = node;
				rowRef(application.id, node);
			}}
			data-application-open
			aria-keyshortcuts="j k Enter 1 2 3 4 5 x f"
			dir="auto"
			className={cn("truncate text-[15px]/[22px] font-medium text-ink", rowLinkClassName)}
		>
			{application.company}
		</Link>
	);
	const place = [application.role, application.location].filter(Boolean).join(" · ");

	if (phone) {
		return (
			<ListRow
				data-application-id={application.id}
				interactive
				leading={<IconTile aria-hidden="true">{companyInitials(application.company)}</IconTile>}
				title={link}
				subtitle={
					<>
						<bdi>{application.role}</bdi> · {next.title}
					</>
				}
				trailing={badge || undefined}
				caret
			/>
		);
	}

	return (
		<DataTableRow
			data-application-id={application.id}
			selected={checked}
			className={cn(!checked && "focus-within:border-transparent focus-within:before:bg-hover")}
		>
			{/* Initials until the row is pointed at or focused; the checkbox for every row while a selection exists. */}
			<DataTableCell className="relative z-10 justify-center">
				{!selecting && (
					<IconTile
						aria-hidden="true"
						className="group-focus-within/row:hidden group-hover/row:hidden pointer-coarse:hidden"
					>
						{companyInitials(application.company)}
					</IconTile>
				)}
				<span
					className={cn(
						"flex",
						!selecting &&
							"sr-only group-focus-within/row:not-sr-only group-hover/row:not-sr-only pointer-coarse:not-sr-only",
					)}
				>
					<Checkbox
						checked={checked}
						onCheckedChange={() => onCheck(application.id)}
						aria-label={t`Select ${application.role} at ${application.company}`}
					/>
				</span>
			</DataTableCell>
			<DataTableCell header className="font-normal">
				{/* The name keeps its width; tags take what is left of the column, and one that doesn't fit whole is left out. */}
				<span className="flex max-w-full min-w-0 shrink-0 flex-col">
					{link}
					<span dir="auto" className="truncate text-[13px]/[18px] text-ink-3">
						{place}
					</span>
				</span>
				<TagChips
					tags={application.tags}
					onSelect={onTagSelect}
					className="relative z-10 ms-0 h-4 min-w-0 flex-1 flex-wrap overflow-hidden *:shrink-0"
				/>
			</DataTableCell>
			<DataTableCell>
				<StageDot
					status={stage.accepted ? "offer" : application.status}
					color={stage.accepted ? undefined : laneDotColor(lane)}
					className="min-w-0 gap-2 text-sm"
				>
					{stage.accepted && <Icon name="check" size={14} className="shrink-0 text-accent-text" />}
					<span className="truncate">{stage.label}</span>
				</StageDot>
			</DataTableCell>
			<DataTableCell>
				<span className="flex min-w-0 flex-col">
					<span className={cn("truncate text-sm", next.muted ? "text-ink-3" : "font-medium")}>{next.title}</span>
					{/* With a badge the line is a row, so its text is cut rather than ended with an ellipsis. */}
					{(next.sub || badge) && (
						<span
							className={cn(
								"h-[18px] text-[13px]/[18px] text-ink-3",
								badge ? "flex items-center gap-2 overflow-hidden whitespace-nowrap" : "truncate",
							)}
						>
							{next.sub}
							{badge}
						</span>
					)}
				</span>
			</DataTableCell>
			{wide && (
				<>
					<DataTableCell>
						<span className={cn("text-sm whitespace-nowrap", !sent.sent && "text-ink-3")}>{sent.text}</span>
					</DataTableCell>
					<DataTableCell>
						<span className="text-[13px]/[18px] whitespace-nowrap text-ink-3">
							{daysAgo === 0
								? relative(updated, now)
								: daysAgo < 7
									? relativeDay(-daysAgo, i18n.locale)
									: stepDate(updated, i18n.locale, timeZone)}
						</span>
					</DataTableCell>
				</>
			)}
			<DataTableCell className="relative z-10">
				<ApplicationActionsMenu application={application} className={revealOnRowClassName} />
			</DataTableCell>
		</DataTableRow>
	);
});

// A bar button keeps its hover look while its menu is open. Menus open 14px above the bar's own edge.
const openTrigger = "data-popup-open:bg-hover data-popup-open:text-ink";
const above = { side: "top", align: "start", sideOffset: 14, alignOffset: -4 } as const;

type BulkBarProps = {
	ids: string[];
	total: number;
	onSelectAll: () => void;
	onDone: () => void;
};

/** For the checked rows: tag them, or move them, close them or move them to Trash, each at once with Undo. */
function BulkBar({ ids, total, onSelectAll, onDone }: BulkBarProps) {
	const scope = `applications-bulk-${useId()}`;
	const invalidate = useInvalidateApplications();
	const moveWithUndo = useMoveWithUndo();
	const trashWithUndo = useTrashWithUndo();
	const rows = ids.map((id) => ({ id }));
	const { lanes, active } = useApplicationLanes();
	const [tag, setTag] = useState("");
	const count = ids.length;

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
	const disabled = count > 200 || bulkUpdate.isPending;

	return (
		<SelectionBar
			label={plural(count, { one: "# application selected", other: "# applications selected" })}
			count={count}
			total={total}
			onSelectAll={onSelectAll}
			onClear={onDone}
			className="fixed max-sm:bottom-[calc(var(--app-tabbar,0px)+16px)] sm:left-[calc(50%+32px)] lg:left-[calc(50%+var(--app-sidebar)/2)]"
		>
			{count > 200 && (
				<span role="status" className="px-2 text-sm text-warn-text">
					<Trans>Choose up to 200 applications per bulk action.</Trans>
				</span>
			)}

			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="tag" />
					<Trans>Tags…</Trans>
				</PopoverTrigger>
				<PopoverContent {...above} className="grid w-60 gap-2 p-3">
					<HotkeysProvider scope={`${scope}-tags`} exclusive>
						<p className="text-sm font-medium">
							{plural(count, { one: "Add a tag to # application", other: "Add a tag to # applications" })}
						</p>
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								if (disabled || !tag.trim()) return;
								bulkUpdate.mutate({ ids, addTags: [tag.trim()] });
								setTag("");
							}}
						>
							<Input aria-label={t`Tag`} value={tag} onChange={(event) => setTag(event.target.value)} autoFocus />
							<Button type="submit" variant="secondary" disabled={disabled || !tag.trim()}>
								<Trans>Add</Trans>
							</Button>
						</form>
					</HotkeysProvider>
				</PopoverContent>
			</Popover>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="arrow-right" />
					<Trans>Move to…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					{...above}
					className="min-w-[190px]"
					aria-label={plural(count, { one: "Move # application to", other: "Move # applications to" })}
				>
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
											description: plural(count, {
												one: `# application moved to ${label}`,
												other: `# applications moved to ${label}`,
											}),
										});
										onDone();
									}}
								>
									<LaneDot lane={lane} />
									{getLaneLabel(lane)}
								</DropdownMenuItem>
							))}
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="check-circle" />
					<Trans>Close…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent {...above} className="min-w-[190px]">
					<HotkeysProvider scope={`${scope}-1`} exclusive>
						<ClosedLaneItems
							lanes={active}
							onPick={(lane, reason) => {
								moveWithUndo({
									applications: rows,
									lane: lane ?? getCategoryLane(lanes, "closed"),
									closedReason: lane ? reason : (reason ?? null),
									description: plural(count, { one: "# application closed", other: "# applications closed" }),
								});
								onDone();
							}}
						/>
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<Button
				size="sm"
				variant="danger-text"
				disabled={disabled}
				onClick={() => {
					trashWithUndo(rows);
					onDone();
				}}
			>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</Button>
		</SelectionBar>
	);
}
