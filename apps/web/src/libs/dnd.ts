import type { Active, Announcements, DndContextProps, Over } from "@dnd-kit/core";
import { t } from "@lingui/core/macro";
import { DRAG_AUTO_SCROLL } from "./motion";

/**
 * What a draggable or droppable tells screen readers about itself, passed as dnd-kit `data`: its visible name, and
 * for an item the group it sits in where that matters (a page, a column). Ids are never read out.
 */
export type DndLabel = { label: string; group?: string | undefined };

type SortableData = { containerId: string | number; index: number; items: unknown[] };
type Entry = { id: Active["id"]; data: Active["data"] | Over["data"] };

const dataOf = (entry: Entry) => entry.data.current as (Partial<DndLabel> & { sortable?: SortableData }) | undefined;

const nameOf = (entry: Entry) => dataOf(entry)?.label?.trim() || t`Untitled item`;

/** Where `over` is for `active`: a position in the same list, else the group or the target's own name. */
function placeOf(active: Active, over: Over) {
	const target = dataOf(over);
	const sortable = target?.sortable;
	if (sortable && sortable.containerId === dataOf(active)?.sortable?.containerId) {
		const position = sortable.index + 1;
		const total = sortable.items.length;
		const group = target.group;
		return group
			? t({ message: `position ${position} of ${total}, ${group}`, comment: "Drag and drop: where an item is" })
			: t({ message: `position ${position} of ${total}`, comment: "Drag and drop: where an item is" });
	}
	return target?.group || nameOf(over);
}

// dnd-kit reports the item over its own place as soon as it's picked up; saying so would replace "Picked up".
// One drag at a time, so one flag serves every context.
let left = false;

const announcements: Announcements = {
	onDragStart: ({ active }) => {
		left = false;
		const item = nameOf(active);
		return t`Picked up ${item}.`;
	},
	onDragOver: ({ active, over }) => {
		const item = nameOf(active);
		if (over?.id === active.id) return left ? t`${item} is back where it started.` : undefined;
		left = true;
		if (!over) return t`${item} is not over a place it can go.`;
		const place = placeOf(active, over);
		return t`${item} is over ${place}.`;
	},
	onDragEnd: ({ active, over }) => {
		const item = nameOf(active);
		if (!over) return t`${item} was dropped where it can't go. Nothing moved.`;
		if (over.id === active.id) return t`${item} was dropped where it started. Nothing moved.`;
		const place = placeOf(active, over);
		return t`${item} was dropped on ${place}.`;
	},
	onDragCancel: ({ active }) => {
		const item = nameOf(active);
		return t`Moving ${item} was cancelled. Nothing moved.`;
	},
};

/**
 * The props every `DndContext` shares: gentle edge auto-scroll, and translated announcements and instructions that
 * name items by their `DndLabel`. `keyboard` says whether the context has a KeyboardSensor; without one, the item's
 * menu is the keyboard way to move it, and the instructions say so.
 */
export function dndContextProps(keyboard: boolean): Pick<DndContextProps, "accessibility" | "autoScroll"> {
	return {
		autoScroll: DRAG_AUTO_SCROLL,
		accessibility: {
			announcements,
			screenReaderInstructions: {
				draggable: keyboard
					? t`To pick it up, press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, or Escape to cancel.`
					: t`Drag it with a pointer to move it, or use its menu.`,
			},
		},
	};
}
