import { cn } from "@reactive-resume/utils/style";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			dir="ltr"
			className={cn(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-sunken px-1 font-mono text-xs font-medium text-ink-3 select-none in-data-[slot=tooltip-content]:bg-bg/15 in-data-[slot=tooltip-content]:text-bg [&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			{...props}
		/>
	);
}

const isApple = () =>
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/**
 * A shortcut written with Mac glyphs ("⌘K", "⇧⌘Z", "⌥↑") as this platform shows it: unchanged on Apple devices,
 * "Ctrl+K", "Ctrl+Shift+Z", "Alt+↑" elsewhere (the bindings use Mod, so the key really is Ctrl there).
 */
function formatShortcut(shortcut: string, apple = isApple()): string {
	if (apple) return shortcut;
	const names: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⇧": "Shift", "⌥": "Alt" };
	const modifiers = [...shortcut].filter((char) => char in names);
	if (modifiers.length === 0) return shortcut;
	const key = [...shortcut].filter((char) => !(char in names)).join("");
	// Ctrl first, as Windows and Linux write it.
	const order = ["Ctrl", "Shift", "Alt"];
	const named = [...new Set(modifiers.map((char) => names[char] ?? ""))].toSorted(
		(a, b) => order.indexOf(a) - order.indexOf(b),
	);
	return [...named, key].join("+");
}

export { formatShortcut, Kbd };
