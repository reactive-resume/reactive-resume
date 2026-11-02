import type { KeyCommand } from "../../modules/key-commands";
import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";
import { keyCommands } from "../../modules/key-commands";

/** A hardware keyboard shortcut and what it does. */
export type KeyBinding = KeyCommand & { run: () => void };

type Owner = { readonly current: readonly KeyBinding[] };

// Every mounted `useKeyCommands`, in mount order. For the same keys the latest mounted one wins.
const owners = new Set<Owner>();
let blockers = 0;

const active = () => {
	if (blockers) return [];
	const byKey = new Map<string, KeyBinding>();
	for (const owner of owners)
		for (const binding of owner.current) byKey.set(`${binding.input}:${!!binding.shift}`, binding);
	return [...byKey.values()];
};

const sync = () =>
	keyCommands?.setCommands(active().map(({ id, input, shift, title }) => ({ id, input, shift: !!shift, title })));

/** Sheets and alerts suspend background commands, including late native events. */
export function useKeyCommandBlocker(open: boolean) {
	useEffect(() => {
		if (!open) return;
		blockers++;
		sync();
		return () => {
			blockers--;
			sync();
		};
	}, [open]);
}

keyCommands?.addListener("onKeyCommand", ({ id }) =>
	active()
		.find((binding) => binding.id === id)
		?.run(),
);

/**
 * Registers ⌘-shortcuts (Ctrl on Android) for iPad and Android hardware keyboards. By default they are live only while
 * the calling screen is focused, so an editor behind another screen never reacts; `global` keeps them while mounted.
 * A no-op in dev clients without the `key-commands` module.
 */
export function useKeyCommands(bindings: readonly KeyBinding[], scope: "screen" | "global" = "screen") {
	const focused = useIsFocused();
	const live = scope === "global" || focused;
	const owner = useRef<readonly KeyBinding[]>(bindings);
	useEffect(() => {
		owner.current = bindings;
	});
	const signature = bindings.map(({ id, input, shift, title }) => `${id}:${input}:${!!shift}:${title}`).join("|");
	useEffect(() => {
		if (!keyCommands || !live) return;
		owners.add(owner);
		sync();
		return () => {
			owners.delete(owner);
			sync();
		};
	}, [signature, live]);
}
