import type { KeyCommand } from "../../modules/key-commands";
import type { ComponentRef } from "react";
import type { Pressable } from "react-native";
import { useLingui } from "@lingui/react/macro";
import Storage from "expo-sqlite/kv-store";
import { useRef } from "react";
import { AccessibilityInfo, Platform, TextInput, View } from "react-native";
import { create } from "zustand";
import { getRegisteredKeyCommands, useKeyCommands } from "./key-commands";
import { Button, IconButton, Sheet, Switch, Text, useTheme } from "@/ui";

const storageKey = "character-shortcuts";
const readEnabled = () => {
	try {
		return Storage.getItemSync(storageKey) !== "off";
	} catch {
		return true;
	}
};

type ShortcutHelpState = {
	commands: readonly KeyCommand[];
	open: boolean;
	characterShortcuts: boolean;
	returnFocus: (() => void) | undefined;
	show: (returnFocus?: () => void) => void;
	close: () => void;
	setCharacterShortcuts: (enabled: boolean) => void;
};

export const useShortcutHelp = create<ShortcutHelpState>((set) => ({
	commands: [],
	open: false,
	characterShortcuts: readEnabled(),
	returnFocus: undefined,
	show: (returnFocus) => {
		const input = TextInput.State.currentlyFocusedInput();
		set({ commands: getRegisteredKeyCommands(), open: true, returnFocus: returnFocus ?? (() => input?.focus()) });
	},
	close: () => set({ open: false }),
	setCharacterShortcuts: (enabled) => {
		set({ characterShortcuts: enabled });
		try {
			Storage.setItemSync(storageKey, enabled ? "on" : "off");
		} catch {
			// Storage may be unavailable; the setting still applies for this session.
		}
	},
}));

/** Available from collection and document/workspace headers without a hardware keyboard. */
export function ShortcutHelpButton() {
	const { t } = useLingui();
	const ref = useRef<ComponentRef<typeof Pressable>>(null);
	return (
		<IconButton
			ref={ref}
			icon="keyboard"
			label={t`Keyboard shortcuts`}
			onPress={() =>
				useShortcutHelp.getState().show(() => {
					if (ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
				})
			}
		/>
	);
}

/** Snapshot the command owner before the sheet suspends background commands. */
export function KeyboardShortcuts() {
	const { t } = useLingui();
	const { space } = useTheme();
	const { commands, open, characterShortcuts, show, close } = useShortcutHelp();
	useKeyCommands(
		!open && characterShortcuts
			? [{ id: "help.shortcuts", input: "?", modifier: "none", title: t`Keyboard shortcuts`, run: show }]
			: [],
		"global",
	);
	return (
		<Sheet
			open={open}
			onClose={close}
			onDismissed={() => useShortcutHelp.getState().returnFocus?.()}
			title={t`Keyboard shortcuts`}
			footer={<Button label={t`Close`} variant="secondary" onPress={close} />}
		>
			<Text variant="title" accessibilityRole="header">{t`Keyboard shortcuts`}</Text>
			<Text color="ink2">{t`Shortcuts available on this page. List commands require keyboard mode in the list.`}</Text>
			{commands.map((command) => (
				<View
					key={command.id}
					style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s3 }}
				>
					<Text style={{ flex: 1 }}>{command.title}</Text>
					<Text variant="label">{`${command.modifier === "none" ? "" : Platform.OS === "ios" ? "⌘ " : "Ctrl + "}${command.shift ? (Platform.OS === "ios" ? "⇧ " : "Shift + ") : ""}${command.input.toUpperCase()}`}</Text>
				</View>
			))}
			{commands.length === 0 ? <Text color="ink2">{t`No keyboard shortcuts are available here.`}</Text> : null}
			<CharacterShortcutSetting />
		</Sheet>
	);
}

export function CharacterShortcutSetting() {
	const { t } = useLingui();
	const { space } = useTheme();
	const { characterShortcuts, setCharacterShortcuts } = useShortcutHelp();
	return (
		<>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s3 }}>
				<Text style={{ flex: 1 }}>{t`Single-character shortcuts`}</Text>
				<Switch
					label={t`Single-character shortcuts`}
					value={characterShortcuts}
					onValueChange={setCharacterShortcuts}
				/>
			</View>
			<Text
				variant="callout"
				color="ink2"
			>{t`Allow ? outside text fields. Turn off when using speech input. List commands only work in keyboard mode.`}</Text>
		</>
	);
}
