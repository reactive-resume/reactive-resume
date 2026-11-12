import type { ShortcutLine } from "./groups";
import type { HotkeyRegistrationView } from "@tanstack/react-hotkeys";
import { Trans, useLingui } from "@lingui/react/macro";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useId } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { cn } from "@reactive-resume/utils/style";
import { shortcutOverlayOpen } from "./blocking";
import { CharacterShortcutSetting } from "./character-shortcuts";
import { APP_GROUP, groupShortcuts } from "./groups";
import { useShortcutSettings } from "./settings";
import { showKeyboardShortcuts, useShortcutHelp } from "./store";

/** The `?` shortcut and its dialog. The sidebar's Shortcuts row and the command palette open the same list. */
export function KeyboardShortcuts() {
	const { t } = useLingui();
	const { shortcuts, opener, page, close } = useShortcutHelp();
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
			meta: { name: t`This list`, group: APP_GROUP },
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
					<ShortcutContent shortcuts={shortcuts} page={page} onClose={close} opener={opener} />
				</HotkeysProvider>
			)}
		</Dialog>
	);
}

type ShortcutContentProps = {
	shortcuts: HotkeyRegistrationView[];
	page: string | null;
	onClose: () => void;
	opener: HTMLElement | null;
};

function ShortcutContent({ shortcuts, page, onClose, opener }: ShortcutContentProps) {
	const { t } = useLingui();
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"?",
		(event) => {
			if (!event.repeat && event.keyCode !== 229) onClose();
		},
		{ enabled: characterShortcuts, requireReset: true },
	);
	const groups = groupShortcuts(shortcuts);
	const rowId = useId();
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
				<DialogTitle>{page ? <Trans>Shortcuts on {page}</Trans> : <Trans>Keyboard shortcuts</Trans>}</DialogTitle>
				<DialogDescription>
					<Trans>
						<Kbd>?</Kbd> opens this list on any page.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			{/* One group reads in two columns, down then across, so related keys (the editor's 1 to 4) stay together. */}
			<ShortcutList lines={groups.page} columns={groups.row.length === 0} />
			{groups.row.length > 0 && (
				<section aria-labelledby={`${rowId}-label`} className="grid gap-1">
					<h3 id={`${rowId}-label`} className="t-label text-ink-3">
						<Trans>On a row</Trans>
					</h3>
					<ShortcutList lines={groups.row} />
				</section>
			)}
			<div className="h-px bg-line" />
			<CharacterShortcutSetting />
		</DialogContent>
	);
}

function ShortcutList({ lines, columns = false }: { lines: ShortcutLine[]; columns?: boolean }) {
	return (
		<dl className={cn("gap-x-8", columns && "sm:columns-2")}>
			{lines.map((line) => (
				<div key={line.id} className="flex min-h-[30px] break-inside-avoid items-center justify-between gap-4">
					<dt className="min-w-0 truncate">{line.name}</dt>
					<dd className="flex items-center gap-1">
						{line.keys.map((key, index) => (key === "–" ? <span key={index}>–</span> : <Kbd key={index}>{key}</Kbd>))}
					</dd>
				</div>
			))}
		</dl>
	);
}
