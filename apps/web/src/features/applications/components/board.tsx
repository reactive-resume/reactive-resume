import type { ApplicationLane } from "../lanes";
import type { ApplicationSummary } from "../types";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
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
import { cn } from "@reactive-resume/utils/style";
import { getDisplayLane, getLaneLabel } from "../lanes";
import { CLOSED_REASONS, getClosedReasonLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationCard } from "./application-card";
import { DRAG_SETTLE } from "@/libs/motion";

type BoardProps = {
	applications: ApplicationSummary[];
	showClosed: boolean;
	onOpen: (application: ApplicationSummary) => void;
};

// While the overlay settles, the real card waits hidden in its new slot and the overlay's tilt eases off.
const dropSideEffects = defaultDropAnimationSideEffects({
	styles: { active: { opacity: "0" } },
	className: { dragOverlay: "is-dropping" },
});

/**
 * A column per active lane in the owner's order (Closed lanes only when shown). Dropping a card on a column moves it, with the same toast as the
 * other ways to change stage; each card's menu has Move to… for the keyboard. Desktop and tablet only.
 */
export function ApplicationBoard({ applications, showClosed, onOpen }: BoardProps) {
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

	// A small activation distance so a click still opens the detail sheet instead of starting a drag.
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
		<DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
			<div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-4">
				{columns.map((lane) => (
					<Column key={lane.id} lane={lane} applications={byLane.get(lane.id) ?? []} onOpen={onOpen} />
				))}
			</div>

			{/* The overlay settles into the card's new slot (or back where it came from); the drop itself shows at once, see pendingMove. */}
			<DragOverlay dropAnimation={reduceMotion ? null : { ...DRAG_SETTLE, sideEffects: dropSideEffects }}>
				{active ? <ApplicationCard application={active} dragging /> : null}
			</DragOverlay>
			<Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>
							<Trans>Mark as closed</Trans>
						</DialogTitle>
						<DialogDescription>
							{closing?.application.role} · {closing?.application.company}
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
	onOpen: (application: ApplicationSummary) => void;
};

function Column({ lane, applications, onOpen }: ColumnProps) {
	const { setNodeRef, isOver } = useDroppable({ id: lane.id });
	const label = getLaneLabel(lane);
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);
	const shown = applications.slice(0, visible);
	const remaining = applications.length - shown.length;

	return (
		<section
			aria-label={label}
			className={cn(
				"flex w-[272px] shrink-0 flex-col rounded-xl border bg-sunken transition-colors duration-quick",
				isOver ? "border-accent bg-accent-soft" : "border-transparent",
			)}
		>
			<h2 className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm font-semibold">
				<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: lane.color }} />
				<span className="truncate" title={label}>
					{label}
				</span>
				<span className="font-mono text-xs font-normal text-ink-3">{applications.length}</span>
			</h2>
			<div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
				{shown.map((application) => (
					<DraggableCard key={application.id} application={application} onOpen={onOpen} />
				))}
				{remaining > 0 && (
					<button
						type="button"
						onClick={() => setVisible((count) => count + COLUMN_PAGE_SIZE)}
						className="rounded-lg border border-dashed border-line py-2 text-xs text-ink-3 transition-colors hover:bg-hover"
					>
						{t`Show ${Math.min(remaining, COLUMN_PAGE_SIZE)} more`}
					</button>
				)}
			</div>
		</section>
	);
}

type DraggableCardProps = { application: ApplicationSummary; onOpen: (application: ApplicationSummary) => void };

// Re-renders with every drag context change; the closure here stays stable, so the card itself doesn't.
function DraggableCard({ application, onOpen }: DraggableCardProps) {
	const { setNodeRef, listeners, isDragging } = useDraggable({ id: application.id });

	return (
		<div ref={setNodeRef} {...listeners} className={cn(isDragging && "opacity-40")}>
			<ApplicationCard application={application} onClick={() => onOpen(application)} withMenu />
		</div>
	);
}
