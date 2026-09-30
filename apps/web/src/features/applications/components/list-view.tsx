import type { Application } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { useMemo, useState } from "react";
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
import { describeNextStep, getNextStep } from "../next-step";
import { CLOSED_REASONS, getClosedReasonLabel, getStageColor, getStageLabel, LIST_ORDER, PIPELINE } from "../stages";
import { useInvalidateApplications } from "../use-application-actions";
import { useConfirm } from "@/hooks/use-confirm";
import { formatRelativeTime } from "@/libs/locale";
import { D2, EASE, EXIT } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

type SortKey = "role" | "next" | "updated";
type Sort = { key: SortKey; direction: "asc" | "desc" };

const nextStepTime = (application: Application) => {
	const step = getNextStep(application);
	return step.kind === "interview" || step.kind === "follow-up" ? step.at.getTime() : Number.POSITIVE_INFINITY;
};

const compare: Record<SortKey, (a: Application, b: Application) => number> = {
	role: (a, b) => a.role.localeCompare(b.role) || a.company.localeCompare(b.company),
	next: (a, b) => nextStepTime(a) - nextStepTime(b),
	updated: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
};

type ListViewProps = {
	applications: Application[];
	showClosed: boolean;
	selectedId: string | null;
	onOpen: (application: Application) => void;
};

/**
 * The default view: applications grouped by stage in the order that needs you first (Interview, Offer, Screening,
 * Applied, Saved, then Closed when shown). Groups collapse, headers sort within groups, and row checkboxes select
 * for bulk moves, tags, closing and deleting. Phones get two-line rows.
 */
export function ApplicationList({ applications, showClosed, selectedId, onOpen }: ListViewProps) {
	const phone = useBreakpoint() === "mobile";
	const [collapsed, setCollapsed] = useState<ReadonlySet<ApplicationStatus>>(new Set());
	const [sort, setSort] = useState<Sort>({ key: "updated", direction: "desc" });
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

	// Selections only cover what's on screen.
	const checkedIds = applications
		.filter((application) => checked.has(application.id))
		.map((application) => application.id);

	const groups = useMemo(() => {
		const sign = sort.direction === "asc" ? 1 : -1;
		return LIST_ORDER.filter((status) => status !== "closed" || showClosed)
			.map((status) => ({
				status,
				rows: applications
					.filter((application) => application.status === status)
					.sort((a, b) => sign * compare[sort.key](a, b)),
			}))
			.filter((group) => group.rows.length > 0);
	}, [applications, showClosed, sort]);

	const toggleGroup = (status: ApplicationStatus) =>
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
				{sort.key === key && <Icon name={sort.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={14} />}
			</button>
		</th>
	);

	return (
		<div className="grid min-w-0 content-start gap-3">
			<table className="w-full border-collapse text-sm">
				{!phone && (
					<thead>
						<tr className="border-b border-line text-xs text-ink-3">
							<th scope="col" className="w-10 ps-3">
								<span className="sr-only">
									<Trans>Select</Trans>
								</span>
							</th>
							{header("role", t`Role`)}
							{header("next", t`Next step`)}
							<th scope="col" className="px-2 text-start font-medium max-lg:hidden">
								<Trans>Stage</Trans>
							</th>
							<th scope="col" className="px-2 text-start font-medium">
								<Trans>Sent</Trans>
							</th>
							{header("updated", t`Updated`, "max-md:hidden")}
						</tr>
					</thead>
				)}

				{groups.map(({ status, rows }) => {
					const open = !collapsed.has(status);
					const groupId = `applications-group-${status}`;
					return (
						<tbody key={status} aria-labelledby={groupId}>
							<tr>
								<th scope="colgroup" colSpan={6} className="pt-3 text-start">
									<button
										type="button"
										id={groupId}
										aria-expanded={open}
										onClick={() => toggleGroup(status)}
										className="flex h-9 items-center gap-2 rounded-md px-1.5 text-sm font-semibold transition-colors hover:bg-hover"
									>
										<Icon
											name="chevron_right"
											size={18}
											className={cn("text-ink-3 transition-transform duration-standard", open && "rotate-90")}
										/>
										<span
											aria-hidden="true"
											className="size-2 rounded-full"
											style={{ background: getStageColor(status) }}
										/>
										{getStageLabel(status)}
										<span className="font-mono text-xs font-normal text-ink-3">{rows.length}</span>
									</button>
								</th>
							</tr>
							{open &&
								rows.map((application) => (
									<ApplicationRow
										key={application.id}
										application={application}
										phone={phone}
										selected={application.id === selectedId}
										checked={checked.has(application.id)}
										onCheck={() => toggleRow(application.id)}
										onOpen={() => onOpen(application)}
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
						initial={{ opacity: 0, transform: "translateY(100%)" }}
						animate={{ opacity: 1, transform: "translateY(0%)" }}
						exit={{ opacity: 0, transform: "translateY(100%)", transition: { duration: D2 * EXIT, ease: EASE } }}
						transition={{ duration: D2, ease: EASE }}
						className="sticky bottom-4 z-20 justify-self-center max-sm:bottom-[calc(69px+env(safe-area-inset-bottom))]"
					>
						<BulkBar ids={checkedIds} onDone={() => setChecked(new Set())} />
					</m.div>
				)}
			</AnimatePresence>
		</div>
	);
}

type ApplicationRowProps = {
	application: Application;
	phone: boolean;
	selected: boolean;
	checked: boolean;
	onCheck: () => void;
	onOpen: () => void;
};

function ApplicationRow({ application, phone, selected, checked, onCheck, onOpen }: ApplicationRowProps) {
	const { i18n } = useLingui();
	const next = describeNextStep(getNextStep(application), application, i18n.locale);
	const sent = application.status !== "saved";
	const tone = next.tone === "warn" ? "text-warn-text" : next.tone === "muted" ? "text-ink-3" : "text-ink-2";

	const initial = (
		<span
			aria-hidden="true"
			className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-sunken text-[13px] font-semibold text-ink-2"
		>
			{application.company.slice(0, 1).toUpperCase()}
		</span>
	);

	const openButton = (
		<button type="button" onClick={onOpen} className="grid min-w-0 text-start after:absolute after:inset-0">
			<span className="truncate font-medium">{application.role}</span>
			<span className="truncate text-xs text-ink-3">
				{phone
					? `${application.company} · ${next.title}`
					: [application.company, application.location].filter(Boolean).join(" · ")}
			</span>
		</button>
	);

	if (phone) {
		return (
			<tr className={cn("relative border-b border-line", selected && "bg-accent-soft/50")}>
				<td className="py-2.5 ps-1">
					<div className="flex items-center gap-3">
						{initial}
						{openButton}
						<Icon name="chevron_right" size={20} className="ms-auto shrink-0 text-ink-3" />
					</div>
				</td>
			</tr>
		);
	}

	return (
		<tr
			className={cn(
				"relative border-b border-line transition-colors duration-quick hover:bg-hover",
				selected && "bg-accent-soft/50",
			)}
		>
			<td className="relative z-10 w-10 ps-3">
				<Checkbox
					checked={checked}
					onCheckedChange={onCheck}
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
					<span className="truncate">{next.title}</span>
				</span>
			</td>
			<td className="px-2 max-lg:hidden">
				<span className="flex items-center gap-1.5 text-ink-2">
					<span
						aria-hidden="true"
						className="size-2 rounded-full"
						style={{ background: getStageColor(application.status) }}
					/>
					{getStageLabel(application.status)}
				</span>
			</td>
			<td className="px-2">
				{application.resumeId || application.coverLetterId ? (
					<span className="flex items-center gap-1 text-ink-2">
						{application.resumeId && <Icon name="description" size={18} aria-label={t`Resume`} />}
						{application.coverLetterId && <Icon name="mail" size={18} aria-label={t`Cover letter`} />}
					</span>
				) : (
					<span className={cn("text-xs", sent ? "text-warn-text" : "text-ink-3")}>
						<Trans>None</Trans>
					</span>
				)}
			</td>
			<td className="px-2 text-xs whitespace-nowrap text-ink-3 max-md:hidden">
				{formatRelativeTime(application.updatedAt, i18n.locale)}
			</td>
		</tr>
	);
}

type BulkBarProps = { ids: string[]; onDone: () => void };

/** For the checked rows: move them, tag them, close them with a reason, or delete them (after asking). */
function BulkBar({ ids, onDone }: BulkBarProps) {
	const invalidate = useInvalidateApplications();
	const confirm = useConfirm();
	const [tag, setTag] = useState("");

	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({ description: t`Updated ${result.updated}` });
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't update the applications. Try again.` }),
	});
	const bulkDelete = useMutation({
		...orpc.applications.bulkDelete.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({ description: t`Deleted ${result.deleted}` });
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't delete the applications. Try again.` }),
	});

	return (
		<div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-bg shadow-e3">
			<span className="me-1 text-sm font-semibold">
				<Plural value={ids.length} one="# selected" other="# selected" />
			</span>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
					<Icon name="arrow_forward" size={16} />
					<Trans>Move to…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{PIPELINE.map((status) => (
						<DropdownMenuItem key={status} onClick={() => bulkUpdate.mutate({ ids, status })}>
							<span aria-hidden="true" className="size-2 rounded-full" style={{ background: getStageColor(status) }} />
							{getStageLabel(status)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="secondary" />}>
					<Icon name="sell" size={16} />
					<Trans>Add tag</Trans>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-60 p-2">
					<form
						className="flex gap-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							if (!tag.trim()) return;
							bulkUpdate.mutate({ ids, addTags: [tag.trim()] });
							setTag("");
						}}
					>
						<Input aria-label={t`Tag`} value={tag} onChange={(event) => setTag(event.target.value)} autoFocus />
						<Button size="sm" type="submit" disabled={!tag.trim()}>
							<Trans>Add</Trans>
						</Button>
					</form>
				</PopoverContent>
			</Popover>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
					<Trans>Close…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{CLOSED_REASONS.map((reason) => (
						<DropdownMenuItem
							key={reason}
							onClick={() => bulkUpdate.mutate({ ids, status: "closed", closedReason: reason })}
						>
							{getClosedReasonLabel(reason)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Button
				size="sm"
				variant="secondary"
				className="text-danger-text"
				onClick={async () => {
					const confirmed = await confirm(t`Delete ${ids.length} applications?`, {
						description: t`They and their timelines are deleted permanently. This can't be undone.`,
						confirmText: t`Delete`,
					});
					if (confirmed) bulkDelete.mutate({ ids });
				}}
			>
				<Trans>Delete…</Trans>
			</Button>

			<Button size="sm" variant="ghost" className="ms-auto text-bg hover:bg-bg/15" onClick={onDone}>
				<Trans>Clear</Trans>
			</Button>
		</div>
	);
}
