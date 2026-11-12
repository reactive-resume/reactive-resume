import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { formatForDisplay } from "@tanstack/react-hotkeys";

/** `meta.group` for keys that work on every page (search, this list): listed after the page's own. */
export const APP_GROUP = "app";
/** `meta.group` for keys that need a focused row in a list. */
export const ROW_GROUP = "row";

export type ShortcutLine = { id: string; name: string; keys: string[] };
export type ShortcutGroups = { page: ShortcutLine[]; row: ShortcutLine[] };

// "⌘K", as every other key hint in the app writes it.
const display = (shortcut: HotkeyRegistrationView) => formatForDisplay(shortcut.hotkey).replaceAll(" ", "");

/** Runs of three or more digit keys whose names start alike become one line: "Move to Saved … Offer", 1 – 5. */
function collapseRanges(lines: ShortcutLine[]): ShortcutLine[] {
	const result: ShortcutLine[] = [];
	for (let index = 0; index < lines.length;) {
		let end = index;
		const digit = (line: ShortcutLine | undefined) => (line?.keys.length === 1 ? Number(line.keys[0]) : Number.NaN);
		while (digit(lines[end + 1]) === digit(lines[end]) + 1) end += 1;
		const run = lines.slice(index, end + 1);
		const words = run.map((line) => line.name.split(" "));
		let shared = 0;
		while (words.every((name) => name.length > shared + 1 && name[shared] === words[0]?.[shared])) shared += 1;
		const first = run[0];
		const last = run.at(-1);
		if (run.length >= 3 && shared > 0 && first && last) {
			const prefix = words[0]?.slice(0, shared).join(" ");
			const rest = (name: string[] | undefined) => name?.slice(shared).join(" ");
			result.push({
				id: first.id,
				name: `${prefix} ${rest(words[0])} … ${rest(words.at(-1))}`,
				keys: [first.keys[0] ?? "", "–", last.keys[0] ?? ""],
			});
		} else result.push(...run);
		index = end + 1;
	}
	return result;
}

/**
 * The page's keys first, then the app-wide ones, then the keys that need a focused row ("On a row"): `ROW_GROUP`, or
 * keys bound to a row's link. One line per name, the first key it was registered with.
 */
export function groupShortcuts(shortcuts: HotkeyRegistrationView[]): ShortcutGroups {
	const seen = new Set<string>();
	const page: ShortcutLine[] = [];
	const app: ShortcutLine[] = [];
	const row: ShortcutLine[] = [];
	for (const shortcut of shortcuts) {
		const name = shortcut.options.meta?.name;
		if (!name) continue;
		const onRow =
			shortcut.options.meta?.group === ROW_GROUP ||
			(typeof HTMLAnchorElement !== "undefined" && shortcut.target instanceof HTMLAnchorElement);
		const key = `${onRow ? "row" : "page"}:${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const line = { id: shortcut.id, name, keys: [display(shortcut)] };
		if (onRow) row.push(line);
		else if (shortcut.options.meta?.group === APP_GROUP) app.push(line);
		else page.push(line);
	}
	return { page: collapseRanges([...page, ...app]), row: collapseRanges(row) };
}
