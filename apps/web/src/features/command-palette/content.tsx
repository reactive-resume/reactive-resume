import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Command, CommandEmpty, CommandInput, CommandList } from "@reactive-resume/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { AskCommandGroup } from "./pages/ask";
import { NavigationCommandGroup } from "./pages/navigation";
import { PreferencesCommandGroup } from "./pages/preferences";
import { ResumesCommandGroup } from "./pages/resumes";
import { useCommandPaletteStore } from "./store";

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

	const isFirstPage = pages.length === 0;
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
					<Trans comment="Screen-reader dialog title for the command palette">Command palette</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans comment="Screen-reader dialog description instructing users how to use the command palette">
						Type a command or search…
					</Trans>
				</DialogDescription>
			</DialogHeader>

			<DialogContent
				closeLabel={t`Close`}
				instant
				className="overflow-hidden p-0"
				aria-label={
					isFirstPage
						? t({
								comment: "Accessible label for the command palette dialog",
								message: "Command palette",
							})
						: t({
								comment: "Accessible label for command palette dialog when browsing a nested command page",
								message: `Command palette: ${currentPage}`,
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
						message: "Command palette",
					})}
					className="[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-ink-3 **:[[cmdk-group]]:px-2 **:[[cmdk-input]]:h-12 **:[[cmdk-item]]:px-2 **:[[cmdk-item]]:py-3"
				>
					<CommandInput
						ref={inputRef}
						value={search}
						onValueChange={handleSearchChange}
						placeholder={
							isFirstPage
								? t({
										comment: "Placeholder in command palette input on root page",
										message: "Type a command or search…",
									})
								: t({
										comment: "Placeholder in command palette input on nested pages",
										message: "Search…",
									})
						}
						aria-label={t({
							comment: "Accessible label for command palette search input",
							message: "Search commands",
						})}
					/>

					<CommandList key={commandListPage} data-command-page={commandListPage}>
						{/* The Ask row is always offered on the first screen once something is typed, so nothing is empty there. */}
						{!(isFirstPage && session && search.trim()) && (
							<CommandEmpty>
								<Trans comment="Empty-state message when no command palette results match the search query">
									No commands match that search.
								</Trans>
							</CommandEmpty>
						)}

						<ResumesCommandGroup />
						<PreferencesCommandGroup />
						<NavigationCommandGroup />
						<AskCommandGroup />
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
