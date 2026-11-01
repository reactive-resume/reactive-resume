import type { Active, Over } from "@dnd-kit/core";
import { beforeAll, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { dndContextProps } from "./dnd";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

const entry = (id: string, data?: Record<string, unknown>) =>
	({ id, data: { current: data }, rect: { current: { initial: null, translated: null } } }) as unknown as Active & Over;

it("reads out names and places, never ids, including drops with no target and items without a name", () => {
	const announce = dndContextProps(false).accessibility?.announcements;
	const card = entry("0c4f8e2a-uuid", { label: "Designer, Acme" });
	const lane = entry("lane-uuid", { label: "Interviewing" });
	const unnamed = entry("9d1b-uuid");

	expect(announce?.onDragStart({ active: unnamed })).toBe("Picked up Untitled item.");
	expect(announce?.onDragOver({ active: card, over: lane })).toBe("Designer, Acme is over Interviewing.");
	expect(announce?.onDragOver({ active: card, over: null })).toBe("Designer, Acme is not over a place it can go.");
	expect(announce?.onDragEnd({ active: card, over: null })).toBe(
		"Designer, Acme was dropped where it can't go. Nothing moved.",
	);
	expect(announce?.onDragEnd({ active: card, over: entry("other-uuid", {}) })).toBe(
		"Designer, Acme was dropped on Untitled item.",
	);
	expect(announce?.onDragCancel({ active: card, over: lane })).toBe(
		"Moving Designer, Acme was cancelled. Nothing moved.",
	);
	expect(dndContextProps(false).accessibility?.screenReaderInstructions?.draggable).toBe(
		"Drag it with a pointer to move it, or use its menu.",
	);
});

it("places an item in another column by that column, and within its own list by position and group", () => {
	const announce = dndContextProps(true).accessibility?.announcements;
	const sortable = (containerId: string, index: number) => ({ containerId, index, items: ["a", "b", "c"] });
	const summary = entry("summary", { label: "Summary", sortable: sortable("page-0-main", 0) });
	const education = entry("education", {
		label: "Education",
		group: "Page 1, Main",
		sortable: sortable("page-0-main", 2),
	});
	const awards = entry("awards", {
		label: "Awards",
		group: "Page 2, Sidebar",
		sortable: sortable("page-1-sidebar", 0),
	});

	expect(announce?.onDragOver({ active: summary, over: education })).toBe(
		"Summary is over position 3 of 3, Page 1, Main.",
	);
	expect(announce?.onDragEnd({ active: summary, over: awards })).toBe("Summary was dropped on Page 2, Sidebar.");
	expect(announce?.onDragEnd({ active: summary, over: summary })).toBe(
		"Summary was dropped where it started. Nothing moved.",
	);
});
