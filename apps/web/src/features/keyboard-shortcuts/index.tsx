import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatForDisplay, HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { shortcutOverlayOpen } from "./blocking";
import { CharacterShortcutSetting } from "./character-shortcuts";
import { useShortcutSettings } from "./settings";
import { showKeyboardShortcuts, useShortcutHelp } from "./store";

export function KeyboardShortcuts() {
	const { t } = useLingui();
	const { shortcuts, opener, close } = useShortcutHelp();
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const scope = useId();
	useHotkey(
		"?",
		(event) => {
			if (event.repeat || event.keyCode === 229 || shortcutOverlayOpen()) return;
			event.preventDefault();
			showKeyboardShortcuts();
		},
		{
			enabled: characterShortcuts,
			requireReset: true,
			preventDefault: false,
			stopPropagation: false,
			meta: { name: t`Keyboard shortcuts` },
		},
	);

	return (
		<>
			<Button
				id="keyboard-shortcuts-trigger"
				variant="secondary"
				className="fixed end-3 bottom-[max(5rem,var(--floating-toolbar-clearance,0px))] z-30 gap-2 sm:bottom-[max(0.75rem,var(--floating-toolbar-clearance,0px))] print:hidden"
				onClick={() => showKeyboardShortcuts()}
				aria-keyshortcuts={characterShortcuts ? "?" : undefined}
			>
				<Icon name="keyboard" />
				<Trans>Keyboard shortcuts</Trans>
			</Button>
			<Dialog
				open={shortcuts !== null}
				onOpenChange={(value) => {
					if (!value) close();
				}}
			>
				{shortcuts !== null && (
					<HotkeysProvider scope={scope} exclusive>
						<ShortcutContent shortcuts={shortcuts} onClose={close} opener={opener} />
					</HotkeysProvider>
				)}
			</Dialog>
		</>
	);
}

type ShortcutContentProps = {
	shortcuts: HotkeyRegistrationView[];
	onClose: () => void;
	opener: HTMLElement | null;
};

function ShortcutContent({ shortcuts, onClose, opener }: ShortcutContentProps) {
	const { t } = useLingui();
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"?",
		(event) => {
			if (!event.repeat && event.keyCode !== 229) onClose();
		},
		{ enabled: characterShortcuts, requireReset: true },
	);
	const named = [
		...new Map(
			shortcuts.map((shortcut) => [`${shortcut.options.meta?.name}:${formatForDisplay(shortcut.hotkey)}`, shortcut]),
		).values(),
	];
	return (
		<DialogContent
			closeLabel={t`Close`}
			finalFocus={() =>
				opener?.isConnected
					? opener
					: (document.querySelector<HTMLElement>("[data-chat-shortcut-help]") ??
						document.getElementById("keyboard-shortcuts-trigger"))
			}
		>
			<DialogHeader>
				<DialogTitle>
					<Trans>Keyboard shortcuts</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>Shortcuts available on this page. List commands require focus inside their list.</Trans>
				</DialogDescription>
			</DialogHeader>
			<dl className="grid gap-3">
				{named.map((shortcut) => (
					<div key={shortcut.id} className="flex items-center justify-between gap-4">
						<dt>{shortcut.options.meta?.name}</dt>
						<dd>
							<kbd className="rounded border border-line px-2 py-1 font-mono text-xs">
								{formatForDisplay(shortcut.hotkey)}
							</kbd>
						</dd>
					</div>
				))}
			</dl>
			<CharacterShortcutSetting />
		</DialogContent>
	);
}
