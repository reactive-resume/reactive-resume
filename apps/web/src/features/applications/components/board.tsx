import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { Application } from "../types";
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { t } from "@lingui/core/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { STAGES } from "@reactive-resume/schema/applications/data";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { orpc } from "@/libs/orpc/client";
import { applicationsListQueryKey } from "../queries";
import { ApplicationCard } from "./application-card";

type Props = {
	applications: Application[];
	onOpen: (application: Application) => void;
	onEdit: (application: Application) => void;
};

export function ApplicationBoard({ applications, onOpen, onEdit }: Props) {
	const queryClient = useQueryClient();
	const [activeId, setActiveId] = useState<string | null>(null);

	// A small activation distance so a click still opens the detail panel instead of starting a drag.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

	const listKey = applicationsListQueryKey();

	const move = useMutation(
		orpc.applications.update.mutationOptions({
			onMutate: async ({ id, status }) => {
				await queryClient.cancelQueries({ queryKey: listKey });
				const previous = queryClient.getQueryData<Application[]>(listKey);
				queryClient.setQueryData<Application[]>(listKey, (rows) =>
					(rows ?? []).map((row) => (row.id === id && status ? { ...row, status } : row)),
				);
				return { previous };
			},
			onError: (_error, _vars, context) => {
				if (context?.previous) queryClient.setQueryData(listKey, context.previous);
				toast.add({ type: "error", description: t`Couldn't move the application. Please try again.` });
			},
			onSettled: () => void queryClient.invalidateQueries({ queryKey: listKey }),
		}),
	);

	const byStage = useMemo(() => {
		const map = new Map<ApplicationStatus, Application[]>(STAGES.map((s) => [s.value, []]));
		for (const app of applications) map.get(app.status)?.push(app);
		return map;
	}, [applications]);

	const activeApp = activeId ? applications.find((a) => a.id === activeId) : null;

	const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

	const onDragEnd = (event: DragEndEvent) => {
		setActiveId(null);
		const { active, over } = event;
		if (!over) return;
		const target = over.id as ApplicationStatus;
		const app = applications.find((a) => a.id === active.id);
		if (!app || app.status === target) return;
		move.mutate({ id: app.id, status: target });
	};

	return (
		<DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
			<div className="flex h-full min-h-0 gap-4 overflow-x-auto pb-4">
				{STAGES.map((stage) => (
					<Column
						key={stage.value}
						stage={stage}
						applications={byStage.get(stage.value) ?? []}
						onOpen={onOpen}
						onEdit={onEdit}
					/>
				))}
			</div>

			{/* No drop animation: the optimistic move lands after an await, so the default would fly the card back. */}
			<DragOverlay dropAnimation={null}>
				{activeApp ? <ApplicationCard application={activeApp} dragging /> : null}
			</DragOverlay>
		</DndContext>
	);
}

type ColumnProps = {
	stage: (typeof STAGES)[number];
	applications: Application[];
	onOpen: (application: Application) => void;
	onEdit: (application: Application) => void;
};

// Cap the cards rendered per column so a stage with hundreds of applications doesn't mount
// hundreds of draggable nodes at once. Users reveal the rest in batches. Server-side paging
// isn't needed here — the list payload is small; the cost is DOM/drag nodes.
const COLUMN_PAGE_SIZE = 50;

function Column({ stage, applications, onOpen, onEdit }: ColumnProps) {
	const { setNodeRef, isOver } = useDroppable({ id: stage.value });
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);

	const shown = applications.slice(0, visible);
	const remaining = applications.length - shown.length;

	return (
		<div className="flex w-72 shrink-0 flex-col rounded-2xl border border-border bg-muted/30">
			<div className="flex items-center gap-2 px-3.5 py-3">
				<span className="size-2.5 rounded-sm" style={{ background: stage.color }} />
				<span className="font-semibold text-sm tracking-tight">{stage.label}</span>
				<span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground text-xs">
					{applications.length}
				</span>
			</div>
			<div
				ref={setNodeRef}
				className={cn(
					"flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-3 transition-colors",
					isOver && "bg-muted/60",
				)}
			>
				{shown.map((app) => (
					<DraggableCard key={app.id} application={app} onOpen={() => onOpen(app)} onEdit={onEdit} />
				))}
				{remaining > 0 && (
					<button
						type="button"
						onClick={() => setVisible((v) => v + COLUMN_PAGE_SIZE)}
						className="rounded-lg border border-border border-dashed py-2 text-muted-foreground text-xs hover:bg-muted/60"
					>
						{t`Show ${Math.min(remaining, COLUMN_PAGE_SIZE)} more`}
					</button>
				)}
			</div>
		</div>
	);
}

function DraggableCard({
	application,
	onOpen,
	onEdit,
}: {
	application: Application;
	onOpen: () => void;
	onEdit: (application: Application) => void;
}) {
	const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: application.id });

	return (
		<div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-30")}>
			<ApplicationCard application={application} onClick={onOpen} onEdit={onEdit} />
		</div>
	);
}
