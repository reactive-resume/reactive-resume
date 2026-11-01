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
