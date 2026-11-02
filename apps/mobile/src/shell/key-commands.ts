import type { KeyCommand } from "../../modules/key-commands";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { keyCommands } from "../../modules/key-commands";

/** A hardware keyboard shortcut and what it does. */
export type KeyBinding = KeyCommand & { run: () => void; enabled?: boolean };

type Owner = { bindings: readonly KeyBinding[]; token: number };
let nextOwner = 0;

// Every mounted `useKeyCommands`, in mount order. For the same keys the latest mounted one wins.
const owners = new Set<Owner>();
let blockers = 0;

const active = () => {
	if (blockers) return [];
	const byKey = new Map<string, KeyBinding & { nativeId: string }>();
	for (const owner of owners)
		for (const binding of owner.bindings)
			if (binding.enabled !== false && (binding.modifier !== "none" || supportsUnmodifiedCommands))
				byKey.set(`${binding.modifier ?? "primary"}:${binding.input}:${!!binding.shift}`, {
					...binding,
					nativeId: `${owner.token}:${binding.id}`,
				});
	return [...byKey.values()];
};

export const supportsUnmodifiedCommands = keyCommands?.supportsUnmodifiedCommands === true;

let registered: readonly KeyCommand[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
/** Eligible metadata only: snapshot before opening a sheet, which suspends commands. */
export const getRegisteredKeyCommands = () => registered;
export const useRegisteredKeyCommands = () => useSyncExternalStore(subscribe, getRegisteredKeyCommands);

const sync = () => {
	const bindings = active();
	const next = bindings.map(({ id, input, shift, title, modifier }) => ({
		id,
		input,
		shift: !!shift,
		title,
		...(modifier ? { modifier } : {}),
	}));
	keyCommands?.setCommands(next.map((command, index) => ({ ...command, id: bindings[index]?.nativeId ?? command.id })));
	if (JSON.stringify(next) !== JSON.stringify(registered)) {
		registered = next;
		for (const listener of listeners) listener();
	}
};

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
		.find((binding) => binding.nativeId === id)
		?.run(),
);

/**
 * Registers hardware shortcuts (Cmd/Ctrl by default; bare keys need intentional focus or an accessible off switch).
 * By default they are live only while
 * the calling screen is focused, so an editor behind another screen never reacts; `global` keeps them while mounted.
 * A no-op in dev clients without the `key-commands` module.
 */
export function useKeyCommands(bindings: readonly KeyBinding[], scope: "screen" | "global" = "screen") {
	const focused = useIsFocused();
	const live = scope === "global" || focused;
	const owner = useRef<Owner>({ bindings, token: ++nextOwner });
	useEffect(() => {
		owner.current.bindings = bindings;
	});
	const signature = bindings
		.map(
			({ id, input, shift, title, modifier, enabled }) => `${id}:${input}:${!!shift}:${title}:${modifier}:${enabled}`,
		)
		.join("|");
	useEffect(() => {
		if (!keyCommands || !live) return;
		const registration = owner.current;
		owners.add(registration);
		sync();
		return () => {
			owners.delete(registration);
			sync();
		};
	}, [signature, live]);
}
