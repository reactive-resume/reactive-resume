// Board geometry and drag/drop state.

/** Fit the open lanes after sidebar/padding; retain readable scrolling columns on smaller tablets. */
export function tabletColumnWidth(width: number, openLanes: number, padding: number, gap: number) {
	const count = Math.max(1, openLanes);
	return Math.max(208, Math.min(250, (width - padding * 2 - gap * (count - 1)) / count));
}

/** A dropped card shown in its new column until the list's optimistic update lands. */
export type PendingMove = { id: string; from: string; to: string };

/** Drops the override once the list no longer shows the card at its old stage (moved, rolled back past, or gone). */
export const keepPending = (
	pending: PendingMove | null,
	applications: readonly { id: string; status: string; laneId?: string | null | undefined }[],
) =>
	pending &&
	applications.some(
		(application) => application.id === pending.id && (application.laneId ?? application.status) === pending.from,
	)
		? pending
		: null;

/**
 * A failed move clears its own override. Without this, a failure that rolls back before the optimistic update
 * renders leaves the list at `from` and the override showing the failed stage forever.
 */
export const pendingAfterError = (pending: PendingMove | null, id: string, to: string) =>
	pending?.id === id && pending.to === to ? null : pending;

export type ColumnRect = { x: number; width: number };

/** The stage whose column (in window coordinates) contains `x`, or null between and outside columns. */
export function stageAt(x: number, rects: ReadonlyMap<string, ColumnRect>) {
	for (const [stage, rect] of rects) if (x >= rect.x && x <= rect.x + rect.width) return stage;
	return null;
}
