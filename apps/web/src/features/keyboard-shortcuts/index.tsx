import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatForDisplay, HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useId } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { shortcutOverlayOpen } from "./blocking";
import { CharacterShortcutSetting } from "./character-shortcuts";
import { useShortcutSettings } from "./settings";
import { showKeyboardShortcuts, useShortcutHelp } from "./store";

/** The `?` shortcut and its dialog. The sidebar's Shortcuts row and the command palette open the same list. */
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
			<DialogHeader className="gap-1.5">
				<DialogTitle>
					<Trans>Keyboard shortcuts</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Shortcuts available on this page. <Kbd>?</Kbd> opens this list on any page. List commands require focus
						inside their list.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<dl className="grid gap-x-8 sm:grid-cols-2">
				{named.map((shortcut) => (
					<div key={shortcut.id} className="flex min-h-[30px] items-center justify-between gap-4">
						<dt className="min-w-0 truncate">{shortcut.options.meta?.name}</dt>
						<dd>
							<Kbd>{formatForDisplay(shortcut.hotkey)}</Kbd>
						</dd>
					</div>
				))}
			</dl>
			<div className="h-px bg-line" />
			<CharacterShortcutSetting />
		</DialogContent>
	);
}
