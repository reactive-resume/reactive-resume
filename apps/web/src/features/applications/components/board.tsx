import type { ApplicationLane } from "../lanes";
import type { ApplicationSummary } from "../types";
import type { DndLabel } from "@/libs/dnd";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	PointerSensor,
	pointerWithin,
	useDndContext,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { getDisplayLane, getLaneLabel, laneDotColor } from "../lanes";
import { CLOSED_REASONS, getClosedReasonLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationCard } from "./application-card";
import { StageDot } from "@/components/calm/stage-dot";
import { dndContextProps } from "@/libs/dnd";
import { DRAG_SETTLE } from "@/libs/motion";

type BoardProps = {
	applications: ApplicationSummary[];
	showClosed: boolean;
	/** The + on the Saved column. */
	onSaveJob?: (() => void) | undefined;
};

// While the overlay settles, the real card waits hidden in its new slot and the overlay's tilt eases off.
const dropSideEffects = defaultDropAnimationSideEffects({
	styles: { active: { opacity: "0" } },
	className: { dragOverlay: "is-dropping" },
});

/**
 * A column per active lane in the owner's order (Closed lanes only when shown); the columns share the page's width.
 * Dropping a card on a column moves it at once, with the same Undo toast as the other ways to change stage; each
 * card's menu has Move to… for the keyboard. A drag shows both ends: a dashed slot where the card was and a tinted
 * one where it will land. Desktop and tablet only.
 */
export function ApplicationBoard({ applications, showClosed, onSaveJob }: BoardProps) {
	const { moveTo, update } = useApplicationActions();
	const { lanes, active: activeLanes } = useApplicationLanes();
	const reduceMotion = useReducedMotion();
	const [activeId, setActiveId] = useState<string | null>(null);
	const [closing, setClosing] = useState<{ application: ApplicationSummary; lane: ApplicationLane } | null>(null);
	// The list query publishes the optimistic move a task after the drop (TanStack Query notifies on a timeout), so
	// until it does the board shows the dropped card in its new column itself. Otherwise the card blinks back to its
	// old column for a frame, and the drop animation would fly there.
	// Tracked by lane, so a move between two lanes of one category is a move too.
	const [pendingMove, setPendingMove] = useState<{ id: string; from: string; to: string } | null>(null);

	const laneIdOf = (application: ApplicationSummary) => getDisplayLane(lanes, application).id;
	// The query caught up, rolled back, or the card went away: the override has done its job.
	const pendingApplication = pendingMove && applications.find((application) => application.id === pendingMove.id);
	if (
		pendingMove &&
		(!pendingApplication ||
			laneIdOf(pendingApplication) !== pendingMove.from ||
			(update.isError &&
				update.variables?.id === pendingMove.id &&
				(update.variables.laneId ?? update.variables.status) === pendingMove.to))
	)
		setPendingMove(null);
	const laneOf = (application: ApplicationSummary) =>
		pendingMove?.id === application.id ? pendingMove.to : laneIdOf(application);

	// A small activation distance so a click still opens the application instead of starting a drag.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const columns = activeLanes.filter((lane) => showClosed || lane.category !== "closed");

	const byLane = new Map<string, ApplicationSummary[]>(columns.map((lane) => [lane.id, []]));
	for (const application of applications) byLane.get(laneOf(application))?.push(application);

	const active = activeId ? applications.find((application) => application.id === activeId) : null;

	const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

	const onDragEnd = (event: DragEndEvent) => {
		setActiveId(null);
		const target = columns.find((lane) => lane.id === event.over?.id);
		const application = applications.find((item) => item.id === event.active.id);
		if (!target || !application) return;
		const from = laneIdOf(application);
		if (from === target.id) return;
		// A Closed lane without a preset outcome asks for one first.
		if (target.category === "closed" && !target.closedReason) {
			setClosing({ application, lane: target });
			return;
		}
		// Same batched render as setActiveId(null): the card is already in its new column when the drop animation measures it.
		setPendingMove({ id: application.id, from, to: target.id });
		moveTo(application, target);
	};

	return (
		<DndContext
			{...dndContextProps(false)}
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			<div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,176px),1fr))] items-stretch gap-3">
				{columns.map((lane) => (
					<Column
						key={lane.id}
						lane={lane}
						applications={byLane.get(lane.id) ?? []}
						onSaveJob={lane.systemKey === "saved" ? onSaveJob : undefined}
					/>
				))}
			</div>

			{/* The overlay settles into the card's new slot (or back where it came from); the drop itself shows at once, see pendingMove. */}
			<DragOverlay dropAnimation={reduceMotion ? null : { ...DRAG_SETTLE, sideEffects: dropSideEffects }}>
				{active ? <ApplicationCard application={active} dragging /> : null}
			</DragOverlay>
			<Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
				<DialogContent closeLabel={t`Close`}>
					<DialogHeader>
						<DialogTitle>
							<Trans>Mark as closed</Trans>
						</DialogTitle>
						<DialogDescription>
							{closing?.application.company} · {closing?.application.role}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						{CLOSED_REASONS.map((reason) => (
							<Button
								key={reason}
								variant="secondary"
								onClick={() => {
									if (!closing) return;
									const { application, lane } = closing;
									setPendingMove({ id: application.id, from: laneIdOf(application), to: lane.id });
									moveTo(application, lane, reason);
									setClosing(null);
								}}
							>
								{getClosedReasonLabel(reason)}
							</Button>
						))}
					</div>
				</DialogContent>
			</Dialog>
		</DndContext>
	);
}

// Cap the cards rendered per column so a stage with hundreds of applications doesn't mount hundreds of draggable
// nodes at once; the rest show in batches.
const COLUMN_PAGE_SIZE = 50;

type ColumnProps = {
	lane: ApplicationLane;
	applications: ApplicationSummary[];
	onSaveJob?: (() => void) | undefined;
};

const slotClassName = "shrink-0 rounded-lg outline-1 -outline-offset-1 outline-dashed";

function Column({ lane, applications, onSaveJob }: ColumnProps) {
	const label = getLaneLabel(lane);
	const { setNodeRef, isOver } = useDroppable({ id: lane.id, data: { label } satisfies DndLabel });
	const { active } = useDndContext();
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);
	const shown = applications.slice(0, visible);
	const remaining = applications.length - shown.length;
	// The card would land here: a tinted slot of its own height waits at the end of the column.
	const landing = isOver && !!active && !applications.some((application) => application.id === active.id);

	return (
		<section
			ref={setNodeRef}
			aria-label={`${label}, ${i18n.number(applications.length)}`}
			// Five open lanes share the page's width; more lanes, or a narrower window, scroll sideways.
			className={cn(
				"flex min-h-24 min-w-0 flex-col gap-2 rounded-lg bg-sunken p-2 dark:shadow-[inset_0_0_0_1px_var(--line)]",
				active && "pb-10",
			)}
		>
			<h2
				title={label}
				className="flex min-w-0 flex-wrap items-center gap-2 px-1.5 pt-1.5 pb-0.5 text-sm font-semibold"
			>
				<StageDot status={lane.category} color={laneDotColor(lane)}>
					{null}
				</StageDot>
				{label}
				{applications.length > 0 && (
					<span className="font-mono text-xs font-medium text-ink-3">{i18n.number(applications.length)}</span>
				)}
				{onSaveJob && (
					<IconButton
						icon="plus"
						size="icon-xs"
						iconSize={16}
						label={t`Save a job to ${label}`}
						className="-my-1 ms-auto -me-0.5"
						onClick={onSaveJob}
					/>
				)}
			</h2>
			{shown.map((application) => (
				<DraggableCard key={application.id} application={application} />
			))}
			{remaining > 0 && (
				<button
					type="button"
					onClick={() => setVisible((count) => count + COLUMN_PAGE_SIZE)}
					className="rounded-lg border border-dashed border-line-2 py-2 text-xs text-ink-3 transition-colors hover:bg-hover"
				>
					{t`Show ${i18n.number(Math.min(remaining, COLUMN_PAGE_SIZE))} more`}
				</button>
			)}
			{landing && (
				<div
					aria-hidden="true"
					className={cn(slotClassName, "bg-accent-soft outline-accent")}
					style={{ height: active.rect.current.initial?.height ?? 118 }}
				/>
			)}
		</section>
	);
}

// Re-renders with every drag context change; the card's own props stay the same, so the card itself doesn't.
function DraggableCard({ application }: { application: ApplicationSummary }) {
	const { setNodeRef, listeners, isDragging } = useDraggable({
		id: application.id,
		data: { label: [application.company, application.role].filter(Boolean).join(", ") } satisfies DndLabel,
	});

	return (
		// Where the card was stays marked while it's in the air.
		<div ref={setNodeRef} {...listeners} className={cn(isDragging && cn(slotClassName, "outline-ink-3 *:invisible"))}>
			<ApplicationCard application={application} withMenu />
		</div>
	);
}
