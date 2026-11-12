import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
	Command,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	CommandList,
} from "@reactive-resume/ui/components/command";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { AskCommandGroup } from "./pages/ask";
import { CreateItems, JumpItems, MoreItems } from "./pages/navigation";
import { openShortcutsFromPalette, PreferenceItems, PreferencePages } from "./pages/preferences";
import { RecentItems, ResumesCommandGroup } from "./pages/resumes";
import { useCommandPaletteStore } from "./store";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";

export default function CommandPaletteContent() {
	const { session } = useRouteContext({ strict: false });
	const inputRef = useRef<HTMLInputElement>(null);
	const commandRef = useRef<HTMLDivElement>(null);
	const {
		open,
		search,
		pages,
		selected: selectedValue,
		setOpen,
		setSearch,
		setSelected: setSelectedValue,
		goBack,
	} = useCommandPaletteStore();

	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const isFirstPage = pages.length === 0;
	const typing = search.trim().length > 0;
	const currentPage = pages[pages.length - 1];
	const commandListPage = currentPage ?? "root";

	useHotkeys([
		{
			hotkey: "Backspace",
			options: { ignoreInputs: false, preventDefault: false, stopPropagation: false },
			callback: (event) => {
				// Only handle if the command palette is open
				if (!open) return;

				const input = inputRef.current;
				if (!input) return;

				// Only handle if input is focused
				if (document.activeElement !== input) return;

				// If input has text, let the default behavior handle it (delete character)
				if (search.length > 0) return;

				// If input is empty, prevent default and go back
				event.preventDefault();
				goBack();
			},
		},
	]);

	const handleOpenChange = (newOpen: boolean) => {
		setOpen(newOpen);
	};

	const handleSearchChange = (value: string) => {
		setSearch(value);
	};

	useEffect(() => {
		if (!open) return;

		const firstItem = commandRef.current?.querySelector<HTMLElement>(
			`[data-command-page="${commandListPage}"] [cmdk-item]:not([aria-disabled="true"])`,
		);
		const value = firstItem?.getAttribute("data-value");

		if (value) setSelectedValue(value);
		inputRef.current?.focus();
	}, [open, commandListPage, setSelectedValue]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogHeader className="sr-only print:hidden">
				<DialogTitle>
					<Trans comment="Screen-reader dialog title for the command palette">Search and commands</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans comment="Screen-reader dialog description instructing users how to use the command palette">
						Search documents, applications and commands
					</Trans>
				</DialogDescription>
			</DialogHeader>

			<DialogContent
				data-design="pal"
				showCloseButton={false}
				instant
				// 600 wide, 120 from the top; the whole screen on phones.
				className="gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none sm:top-[120px] sm:max-w-[600px] sm:translate-y-0"
				aria-label={
					isFirstPage
						? t({
								comment: "Accessible label for the command palette dialog",
								message: "Search and commands",
							})
						: t({
								comment: "Accessible label for command palette dialog when browsing a nested command page",
								message: `Search and commands: ${currentPage}`,
							})
				}
			>
				<Command
					ref={commandRef}
					loop
					value={selectedValue}
					onValueChange={setSelectedValue}
					onKeyDownCapture={(event) => {
						if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
							useCommandPaletteStore.getState().markSelectionMoved();
					}}
					onPointerMoveCapture={(event) => {
						if (event.target instanceof Element && event.target.closest("[cmdk-item]"))
							useCommandPaletteStore.getState().markSelectionMoved();
					}}
					aria-label={t({
						comment: "Accessible label for command list region inside command palette",
						message: "Search and commands",
					})}
				>
					<CommandInput
						ref={inputRef}
						value={search}
						onValueChange={handleSearchChange}
						placeholder={
							isFirstPage
								? t({
										comment: "Placeholder in command palette input on root page",
										message: "Search documents, applications and commands",
									})
								: t({
										comment: "Placeholder in command palette input on nested pages",
										message: "Search…",
									})
						}
						aria-label={t({
							comment: "Accessible label for command palette search input",
							message: "Search documents, applications and commands",
						})}
						hint={
							<DialogClose
								aria-label={t`Close`}
								className="grid min-h-8 min-w-8 place-items-center rounded-sm text-ink-2"
							>
								<Kbd className="max-sm:hidden">esc</Kbd>
								<Icon name="x" className="sm:hidden" />
							</DialogClose>
						}
					/>

					{/* A second step (theme, language, a kind's full list) says how to return; Backspace in the empty field does too. */}
					{!isFirstPage && (
						<button
							type="button"
							onClick={() => {
								goBack();
								inputRef.current?.focus();
							}}
							className="mx-2 mt-2 inline-flex h-8 items-center gap-1.5 self-start rounded-sm px-2.5 text-[13px] leading-[18px] text-ink-2 [--icon-size:16px] hover:bg-hover hover:text-ink"
						>
							<Icon name="arrow-left" className="rtl:-scale-x-100" />
							<Trans comment="Command palette: return from a second step to the first list">Back</Trans>
						</button>
					)}

					<CommandList
						key={commandListPage}
						data-command-page={commandListPage}
						className="max-h-[min(680px,calc(100svh-236px))] max-sm:max-h-none max-sm:flex-1"
					>
						{/* Signed in, the first screen answers a search itself: results, then "Nothing found" with Create. */}
						{!(isFirstPage && session && typing) && (
							<CommandEmpty>
								<Trans comment="Empty-state message when no command palette results match the search query">
									No commands match that search.
								</Trans>
							</CommandEmpty>
						)}

						{/* Typing replaces the groups with results by kind: documents, applications, commands, then Ask. */}
						<ResumesCommandGroup />
						{isFirstPage &&
							(typing ? (
								<CommandGroup heading={<Trans>Commands</Trans>}>
									<JumpItems />
									<CreateItems />
									<MoreItems />
									<PreferenceItems />
								</CommandGroup>
							) : (
								<>
									<CommandGroup heading={<Trans>Jump to</Trans>}>
										<JumpItems />
									</CommandGroup>
									<CommandGroup heading={<Trans>Create</Trans>}>
										<CreateItems />
									</CommandGroup>
									{session && (
										<CommandGroup heading={<Trans>Recent</Trans>}>
											<RecentItems />
										</CommandGroup>
									)}
									<CommandGroup heading={<Trans>Preferences</Trans>}>
										<PreferenceItems />
									</CommandGroup>
								</>
							))}
						<PreferencePages />
						<AskCommandGroup />
					</CommandList>

					{/* The keys, and the way to the full list. */}
					<CommandFooter className="max-sm:hidden">
						<span>
							<Kbd>
								<Icon name="arrow-up" size={12} />
							</Kbd>
							<Kbd>
								<Icon name="arrow-down" size={12} />
							</Kbd>
							<Trans comment="Command palette key hint: arrow keys move the selection">move</Trans>
						</span>
						<span>
							<Kbd>
								<Icon name="arrow-elbow-down-left" size={12} />
							</Kbd>
							<Trans comment="Command palette key hint: Enter opens the selected row">open</Trans>
						</span>
						<span>
							<Kbd>esc</Kbd>
							<Trans comment="Command palette key hint: Escape closes the palette">close</Trans>
						</span>
						<button
							type="button"
							onClick={openShortcutsFromPalette}
							className="ms-auto rounded-xs text-ink-2 hover:text-ink"
						>
							<Trans>All shortcuts</Trans>
							{characterShortcuts && <Kbd>?</Kbd>}
						</button>
					</CommandFooter>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
