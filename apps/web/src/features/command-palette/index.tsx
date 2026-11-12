import { useLingui } from "@lingui/react/macro";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { lazy, Suspense } from "react";
import { useCommandPaletteStore } from "./store";
import { APP_GROUP } from "@/features/keyboard-shortcuts/groups";

const Content = lazy(() => import("./content"));

/** Keep the shortcut available; command groups load only when someone opens the palette. */
export function CommandPalette() {
	const { t } = useLingui();
	const open = useCommandPaletteStore((state) => state.open);
	const setOpen = useCommandPaletteStore((state) => state.setOpen);
	useHotkeys([
		{
			hotkey: "Mod+K",
			options: { meta: { name: t`Search or jump`, group: APP_GROUP }, requireReset: true },
			callback: () => setOpen(!open),
		},
	]);

	return open ? (
		<Suspense
			fallback={
				<div
					role="status"
					className="fixed inset-x-4 top-24 z-50 mx-auto max-w-lg rounded-lg bg-surface p-4 text-ink shadow-e3"
				>{t`Loading…`}</div>
			}
		>
			<Content />
		</Suspense>
	) : null;
}
