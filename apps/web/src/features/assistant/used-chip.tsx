import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";

type UsedChipProps = { label: string; title: string; children: ReactNode };

/** One "Used" group under an answer (facts, stories, a document): the exact items it relied on, in a popover. */
export function UsedChip({ label, title, children }: UsedChipProps) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						className="inline-flex h-6 items-center rounded-sm border border-line-2 px-2 text-xs font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink aria-expanded:bg-hover"
					/>
				}
			>
				{label}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
				<h2 className="text-xs font-semibold text-ink-3">{title}</h2>
				<ul className="grid max-h-72 gap-2 overflow-y-auto">{children}</ul>
			</PopoverContent>
		</Popover>
	);
}
