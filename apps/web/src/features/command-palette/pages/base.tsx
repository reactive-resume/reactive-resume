import { CommandGroup } from "@reactive-resume/ui/components/command";
import { useCommandPaletteStore } from "../store";

type Props = {
	page?: string;
	heading: React.ReactNode;
	children: React.ReactNode;
	/** Shown whatever the search; its items still rank by how well they match. */
	forceMount?: boolean | undefined;
};

export const BaseCommandGroup = ({ page, heading, children, forceMount }: Props) => {
	const pages = useCommandPaletteStore((state) => state.pages);
	const currentPage = pages[pages.length - 1];
	const isEnabled = currentPage === page;

	if (!isEnabled) return null;

	return (
		<CommandGroup heading={heading} {...(forceMount ? { forceMount } : {})}>
			{children}
		</CommandGroup>
	);
};

/**
 * The quiet word at the end of a row ("Resume", "British English"). It takes the shortcut's slot, so the row shows
 * it in place of the ↵ hint.
 */
export function RowNote({ children }: { children: React.ReactNode }) {
	return (
		<span data-slot="command-shortcut" className="ms-auto shrink-0 text-[13px] leading-[18px] text-ink-3">
			{children}
		</span>
	);
}
